"""Climb ledges from the map's objects (SceneItem.climbable).

The game only lets a player climb at segments the map lists; a custom map has
none, so nothing can be climbed. This finds the edges of the flat tops of the
objects marked climbable and writes them as ledges (the format: studio-py/
sr1_ledges.py). What the game asks of a ledge is in research report BC section 3:

  - Flag "grip to stand", always: the other one is refused on any top deeper
    than about 0.5 m.
  - No grab within 0.35 m of a segment's end unless another segment shares that
    exact end at 2.35 rad or straighter. So ends that join use the same floats, a
    run of short pieces becomes one long segment (pieces under 0.35 m refuse each
    other), and a segment with no place left to grab is left out.
  - The edge has to be 0.75 to 3.15 m over the player's feet, with room over the
    top and nothing between the player and the edge. Edges that fail everywhere
    are left out. Higher ones stay: a jump or a fall can still catch them.

Which way a ledge faces does not matter, so there is no setting for it.

Nothing here has been tried in game yet.
"""
import math
import re
from collections import Counter, defaultdict
from itertools import product
from pathlib import Path

import numpy as np

import interiors
import sr_reborn_core as rc
import sr1_ledges as ledges

TOP_NY = 0.95  # a top: facing up within about 18 degrees
RISE = 0.02  # a face past the edge that goes this much above it is a wall standing on the top, not a drop
WELD = 0.001  # metres: corners this close are the same corner, in the same floats
MIN_RUN = 0.01  # metres of horizontal length: shorter edges are slivers (the game needs some length)
SAG = 0.05  # metres a run of short pieces may stray from the one segment that replaces them
MAX_PIECES = 200  # most pieces one segment replaces (the test is quadratic in them; two segments in line join fine)
END_ZONE = 0.35  # metres from a segment's end where the game wants a neighbour
STRAIGHT = 2.35  # radians: the flattest bend the game accepts between two joined segments
MIN_CLIMB, MAX_CLIMB = 0.75, 3.15  # metres from the player's feet up to the edge
STANCE = 0.5  # metres back from the edge the player hangs
CLEAR_AHEAD = 0.925  # metres over the top the game's clearance check reaches, at height CLEAR_AT
CLEAR_AT = 0.5
CLEAR_UP = 0.9
SAMPLE_EVERY = 2.0  # metres between the spots tried along a segment
MAX_SAMPLES = 5
LOTS = 1000  # more ledges than this is worth a warning: retail's biggest map has 400


class _Weld:
    """Corners within WELD of each other come back as one point, so ends that meet are bit-identical."""

    def __init__(self):
        self.seen = {}

    def __call__(self, p):
        key = tuple(round(v / WELD) for v in p)
        hit = self.seen.get(key)
        if hit is not None:
            return hit
        for d in product((-1, 0, 1), repeat=3):
            near = self.seen.get((key[0] + d[0], key[1] + d[1], key[2] + d[2]))
            if near is not None and math.dist(near, p) <= WELD:
                self.seen[key] = near
                return near
        # + 0.0: no negative zero, whose bits differ from zero's.
        point = tuple(round(k * WELD, 3) + 0.0 for k in key)
        self.seen[key] = point
        return point


def _run(a, b):
    return math.hypot(a[0] - b[0], a[2] - b[2])


def top_edges(verts, faces, convert):
    """The outline of the tops among `faces` (three indices into the editor-space `verts`, wound as drawn), as pairs of game points.

    An edge two tops share is inside the top; one with a face going up past it is the foot of a wall."""
    weld = _Weld()
    placed = {}
    seen = {}
    for face in faces:
        p0, p1, p2 = verts[face[0]], verts[face[1]], verts[face[2]]
        u = [p1[k] - p0[k] for k in range(3)]
        v = [p2[k] - p0[k] for k in range(3)]
        nx, ny, nz = u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]
        size = math.sqrt(nx * nx + ny * ny + nz * nz)
        if size < 1e-12:
            continue
        top = ny / size >= TOP_NY
        points = []
        for i in face[:3]:
            if i not in placed:
                placed[i] = weld(convert(verts[i]))
            points.append(placed[i])
        if len(set(points)) < 3:
            continue
        for k in range(3):
            a, b, other = points[k], points[(k + 1) % 3], points[(k + 2) % 3]
            edge = seen.setdefault((a, b) if a < b else (b, a), [0, False])
            if top:
                edge[0] += 1
            elif other[1] > max(a[1], b[1]) + RISE:
                edge[1] = True
    return [pair for pair, (tops, wall) in seen.items() if tops == 1 and not wall]


def _chains(edges):
    """Edges as lines of points, split where more or fewer than two edges meet; a closed loop starts and ends at its sharpest corner."""
    at = defaultdict(list)
    for e in edges:
        at[e[0]].append(e)
        at[e[1]].append(e)
    used = set()

    def walk(start, first):
        line, e, p = [start], first, start
        while True:
            used.add(e)
            p = e[1] if e[0] == p else e[0]
            line.append(p)
            if len(at[p]) != 2 or p == start:
                return line
            e = at[p][0] if at[p][1] == e else at[p][1]

    out = []
    for p in at:
        if len(at[p]) != 2:
            for e in at[p]:
                if e not in used:
                    out.append(walk(p, e))
    for e in edges:
        if e not in used:
            loop = walk(e[0], e)[:-1]
            k = min(range(len(loop)), key=lambda i: _bend(loop[i], loop[i - 1], loop[(i + 1) % len(loop)]))
            out.append(loop[k:] + loop[:k] + [loop[k]])
    return out


def _bend(p, a, b):
    """The angle at p between its way to a and its way to b, radians (pi: straight on)."""
    u, v = [a[k] - p[k] for k in range(3)], [b[k] - p[k] for k in range(3)]
    size = math.sqrt(sum(x * x for x in u) * sum(x * x for x in v))
    return math.acos(max(-1.0, min(1.0, sum(u[k] * v[k] for k in range(3)) / size))) if size else 0.0


def _off(p, a, b):
    """How far p is from the segment a-b."""
    d = [b[k] - a[k] for k in range(3)]
    size = sum(x * x for x in d)
    t = max(0.0, min(1.0, sum((p[k] - a[k]) * d[k] for k in range(3)) / size)) if size else 0.0
    return math.dist(p, [a[k] + d[k] * t for k in range(3)])


def _thin(line):
    """Fewer points along a line of edges, none straying more than SAG."""
    out, i = [line[0]], 0
    while i < len(line) - 1:
        j = i + 1
        while j + 1 < len(line) and j - i < MAX_PIECES and all(_off(line[k], line[i], line[j + 1]) <= SAG for k in range(i + 1, j + 1)):
            j += 1
        out.append(line[j])
        i = j
    return out


def segments(edges):
    """The outline as long segments: pieces in a line (or a gentle curve) become one, joins keep the same floats."""
    out = []
    for line in _chains(edges):
        points = _thin(line)
        out += [(a, b) for a, b in zip(points, points[1:]) if _run(a, b) >= MIN_RUN]
    return out


def _dead(p, seg, at):
    """Metres from segment end p where the game refuses a grab."""
    others = [o for o in at[p] if o is not seg]
    # With more than one neighbour the game takes whichever it meets first: count on none.
    if len(others) != 1:
        return END_ZONE
    other = others[0]
    q = other[1] if other[0] == p else other[0]
    far = seg[1] if seg[0] == p else seg[0]
    if _bend(p, far, q) < STRAIGHT:
        return END_ZONE
    return max(0.0, END_ZONE - math.dist(p, q))


def usable(segs):
    """(the segments that keep a place to grab, metres of that place, segments left out). Leaving one out can leave its neighbour with none."""
    left = 0
    while True:
        at = defaultdict(list)
        for s in segs:
            at[s[0]].append(s)
            at[s[1]].append(s)
        spans = [math.dist(*s) - _dead(s[0], s, at) - _dead(s[1], s, at) for s in segs]
        keep = [s for s, span in zip(segs, spans) if span > 0]
        if len(keep) == len(segs):
            return segs, sum(spans), left
        left += len(segs) - len(keep)
        segs = keep


class _Solid:
    """The map's solid triangles, for straight rays. A grid over the ground plan keeps each ray to the triangles near it."""

    CELL = 4.0

    def __init__(self, tris):
        self.tris = tris
        cells = defaultdict(list)
        lo, hi = np.floor(tris.min(axis=1) / self.CELL), np.floor(tris.max(axis=1) / self.CELL)
        for t, (i0, j0, i1, j1) in enumerate(zip(lo[:, 0].astype(int).tolist(), lo[:, 2].astype(int).tolist(),
                                                 hi[:, 0].astype(int).tolist(), hi[:, 2].astype(int).tolist())):
            for i in range(i0, i1 + 1):
                for j in range(j0, j1 + 1):
                    cells[i, j].append(t)
        self.cells = {k: np.array(v) for k, v in cells.items()}

    def _near(self, o, end):
        i0, i1 = sorted((math.floor(o[0] / self.CELL), math.floor(end[0] / self.CELL)))
        j0, j1 = sorted((math.floor(o[2] / self.CELL), math.floor(end[2] / self.CELL)))
        found = [self.cells[i, j] for i in range(i0, i1 + 1) for j in range(j0, j1 + 1) if (i, j) in self.cells]
        return np.unique(np.concatenate(found)) if found else None

    def ray(self, o, d, far):
        """Distance to the first triangle along unit direction d (either side of it), or None within `far`."""
        o, d = np.asarray(o, float), np.asarray(d, float)
        near = self._near(o, o + d * far)
        if near is None:
            return None
        t = self.tris[near]
        e1, e2 = t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]
        p = np.cross(d, e2)
        det = (e1 * p).sum(axis=1)
        ok = np.abs(det) > 1e-12
        if not ok.any():
            return None
        e1, e2, p, det, s = e1[ok], e2[ok], p[ok], det[ok], o - t[ok, 0]
        q = np.cross(s, e1)
        u, v, dist = (s * p).sum(axis=1) / det, (d * q).sum(axis=1) / det, (e2 * q).sum(axis=1) / det
        hit = dist[(u >= 0) & (v >= 0) & (u + v <= 1) & (dist > 1e-4) & (dist <= far)]
        return float(hit.min()) if hit.size else None


def _try(solid, e, side):
    """Climbing to edge point e from `side` (a flat unit vector from the edge towards the player): 'reach' when the
    floor is in range, 'high' when it is further down or missing, otherwise why the game would refuse."""
    x, y, z = e
    # The first thing under the edge's height, back where the player's body goes (a floor at the edge's height: no drop here).
    down = solid.ray((x + side[0] * STANCE, y + 0.05, z + side[1] * STANCE), (0, -1, 0), MAX_CLIMB + 0.05)
    if down is not None and down - 0.05 < MIN_CLIMB:
        return 'low'
    if solid.ray((x, y + 0.3, z), (side[0], 0, side[1]), STANCE):
        return 'wall'
    if solid.ray((x, y + CLEAR_AT, z), (-side[0], 0, -side[1]), CLEAR_AHEAD):
        return 'blocked'
    if solid.ray((x - side[0] * CLEAR_AHEAD / 2, y + 0.1, z - side[1] * CLEAR_AHEAD / 2), (0, 1, 0), CLEAR_UP - 0.1):
        return 'blocked'
    return 'reach' if down is not None else 'high'


def rate(solid, seg):
    """The best the segment does at the spots tried along it, from either side: see _try."""
    a, b = seg
    run = _run(a, b)
    side = ((b[2] - a[2]) / run, (a[0] - b[0]) / run)
    n = min(MAX_SAMPLES, 1 + int(run / SAMPLE_EVERY))
    best = 'low'
    order = ('low', 'wall', 'blocked', 'high', 'reach')
    for k in range(n):
        f = (k + 0.5) / n
        e = tuple(a[i] + (b[i] - a[i]) * f for i in range(3))
        for s in (1, -1):
            got = _try(solid, e, (side[0] * s, side[1] * s))
            if order.index(got) > order.index(best):
                best = got
            if best == 'reach':
                return best
    return best


def wanted_faces(items, mesh, log):
    """The solid faces of the objects marked climbable (the scene mesh's, numbered per object as the collision
    exclusions are), and how many objects have any."""
    fixed = {}
    for i, it in enumerate(items):
        if not it.get('climbable'):
            continue
        if it.get('native_prefab') or it.get('collision_disabled'):
            log(f'Climb ledges: "{it.get("name")}" is not fixed and solid, so it gets none.')
        else:
            fixed[i] = set(it.get('collision_excluded_faces') or ())
    faces, counters, objects = [], {}, set()
    for face in mesh['faces']:
        match = re.match(r'^obj(\d{3})_', str(face[3]))
        if not match:
            continue
        i = int(match.group(1))
        local = counters.get(i, 0)
        counters[i] = local + 1
        if i in fixed and local not in fixed[i]:
            faces.append(face)
            objects.add(i)
    return faces, len(objects)


def add_ledges(chunk_path, items, mesh, convert, log):
    """Writes ledges for the objects marked climbable into the map chunk. Returns how many it wrote.

    `convert` maps an editor-space point to game space, as the markers are converted."""
    if not any(it.get('climbable') for it in items):
        return 0
    faces, objects = wanted_faces(items, mesh, log)
    segs = segments(top_edges(mesh['verts'], faces, convert))
    path = Path(chunk_path)
    chunk = rc.read_chunk(path.read_bytes())
    solid = _Solid(interiors.solid_triangles(chunk)) if segs else None
    rated = {s: rate(solid, s) for s in segs}
    left = Counter(rated.values())
    keep, metres, short = usable([s for s in segs if rated[s] in ('reach', 'high')])
    if not keep:
        log('Climb ledges: nothing to write. A climbable object needs a flat top with an edge at least 0.7 m long, '
            '0.75 m or more above the floor beside it, with room above the top.')
        return 0
    high = sum(1 for s in keep if rated[s] == 'high')
    # Any the map has already stay.
    old = ledges.read(chunk)
    ledges.write(chunk, old + [(a, b, ledges.GRIP_TO_STAND, ledges.STATIC) for a, b in keep])
    out = rc.write_chunk(chunk)
    ledges.read(rc.read_chunk(out))
    path.write_bytes(out)
    out_of = left['low'] + left['wall'] + left['blocked'] + short
    log(f'Climb ledges: {len(keep)} on {objects} object(s), {metres:.1f} m to grab'
        + (f'; {high} higher than a climb from the floor (only a jump or a fall catches them)' if high else '')
        + (f'; left out: {left["low"]} too near the floor, {left["wall"]} behind a wall, {left["blocked"]} with no room above, {short} too short' if out_of else '')
        + '.')
    if len(keep) + len(old) > LOTS:
        log(f"Climb ledges: {len(keep) + len(old)} is far more than the game's own maps use (400 at most). Mark fewer objects if the map loads slowly.")
    return len(keep)

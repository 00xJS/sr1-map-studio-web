"""Physics props: collision shapes that fit the model, mass properties and the object budget.

The upstream exporter (studio-py) gives every movable or explosive prop one
fitted box. This module runs on its output and, for props that ask for it,
writes a better shape into the map's collision-shape bank and points the
prop's record at it:

- sphere: one ball around the model (balls roll and bounce),
- cylinder: a 16-sided round hull across the model's round side (tires, barrels),
- hull: the model's convex hull, simplified to at most 64 corners,
- parts: one hull per separate piece of the model (at most 15, like the
  game's own maps), so an L-shape or a table keeps its gaps.

Each shape also carries its mass properties (spread of mass per unit of mass
and centre of mass). That is the one physical property a map sets per object:
"bottom-heavy" moves the centre of mass down so the prop rights itself.
Weight, bounce, friction and health come from the stock object profile the
prop names; the game reads them from its own table.

Shape bank layout (big-endian), one record per shape:
    u32 1, u32 parts, u32 0 x3, parts x 12 zero bytes, then each part:
    u32 0, u32 type, then
      type 1 (ball):  f32 centre xyz, f32 radius
      type 2 (hull):  u16 corners, u16 0, corners x f32 xyz,
                      u32 planes, planes x f32 (nx, ny, nz, d) with n.p + d <= 0 inside,
                      u16 triangles, triangles x u16 (a, b, c), pad to 4,
                      u16 faces, faces x u16 (0, a, b, c), pad to 4
    then 48 bytes: f32 3x3 inertia per unit mass (row-major), f32 centre of mass xyz.
Several parts make a compound shape. Nothing here has been tried in game yet.
"""
from __future__ import annotations

import math
import struct
from pathlib import Path

import sr_reborn_core as rc
import sr1_native_limits as limits

# ------------------------------------------------------------- budget --

# The game allows about 300 moving objects in a multiplayer map; this
# exporter's map template has about 110 free object records. Glass panes,
# breakables and physics props all count.
OBJECT_BUDGET = 96
GAME_MOVER_CAP = 310


def raise_object_budget(n=OBJECT_BUDGET):
    """Lifts the exporter's conservative 32-object budget. Import this module before the studio-py exporter modules."""
    limits.MAX_NATIVE_OBJECTS = n
    import sys
    for name in ('sr1_native_glass', 'sr1_breakable_tools', 'web_api'):
        mod = sys.modules.get(name)
        if mod is not None:
            for attr in ('MAX_NATIVE_OBJECTS', 'MAX_PANES'):
                if hasattr(mod, attr):
                    setattr(mod, attr, n)


raise_object_budget()

# ------------------------------------------------------------- shapes --

SHAPES = ('box', 'sphere', 'cylinder', 'hull', 'parts')
SHAPE_LABELS = {'box': 'Box', 'sphere': 'Ball', 'cylinder': 'Cylinder', 'hull': 'Wrapped (convex hull)', 'parts': 'Separate parts'}
MAX_PARTS = 15
MAX_HULL_CORNERS = 64
CYLINDER_SIDES = 16
# The physics engine rounds hull corners by this much (game units), which
# would make a prop hover; hulls are shrunk by it so the surface matches the model.
CONVEX_RADIUS = 0.05
# How far "bottom-heavy" lowers the centre of mass, as a share of half the height.
BOTTOM_HEAVY = 0.6


def wants_shape(item):
    """True when the prop needs a shape other than the exporter's own fitted box."""
    if not item.get('native_prop_behavior'):
        return False
    shape = item.get('physics_shape') or 'box'
    if shape not in SHAPES:
        raise ValueError('Unknown physics shape: ' + str(shape))
    return shape != 'box' or bool(item.get('physics_bottom_heavy'))


def _sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def _cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def _len(a): return math.sqrt(_dot(a, a))


def _bounds(points):
    return [min(p[k] for p in points) for k in range(3)], [max(p[k] for p in points) for k in range(3)]


def _directions(n):
    """n directions spread evenly over the sphere."""
    out = []
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        y = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(max(0., 1 - y * y))
        out.append((math.cos(golden * i) * r, y, math.sin(golden * i) * r))
    return out


def _support_points(points, n):
    """The farthest point in each of n directions (plus the six axes): a small set whose hull is close to the full one."""
    dirs = _directions(n) + [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    return list(dict.fromkeys(max(points, key=lambda p, d=d: _dot(p, d)) for d in dirs))


def convex_hull(points):
    """Convex hull of 3D points: (corners, triangles) with triangles wound outward. None when the points are flat."""
    pts = list(dict.fromkeys(tuple(round(float(v), 6) for v in p) for p in points))
    if len(pts) > 400:
        pts = _support_points(pts, 256)
    if len(pts) < 4:
        return None
    lo, hi = _bounds(pts)
    eps = 1e-7 * max(1e-3, max(hi[k] - lo[k] for k in range(3)))
    # A starting tetrahedron from extreme points.
    a = min(pts, key=lambda p: p[0])
    b = max(pts, key=lambda p: _len(_sub(p, a)))
    ab = _sub(b, a)
    c = max(pts, key=lambda p: _len(_cross(ab, _sub(p, a))))
    n = _cross(ab, _sub(c, a))
    if _len(n) < eps:
        return None
    d = max(pts, key=lambda p: abs(_dot(n, _sub(p, a))))
    if abs(_dot(n, _sub(d, a))) < eps * _len(n) * 10:
        return None
    if _dot(n, _sub(d, a)) > 0:
        b, c = c, b
    idx = {a: 0, b: 1, c: 2, d: 3}
    corners = [a, b, c, d]
    faces = [(0, 1, 2), (0, 3, 1), (1, 3, 2), (2, 3, 0)]

    def plane(f):
        p0, p1, p2 = (corners[i] for i in f)
        nn = _cross(_sub(p1, p0), _sub(p2, p0))
        ln = _len(nn) or 1.
        nn = (nn[0] / ln, nn[1] / ln, nn[2] / ln)
        return nn, -_dot(nn, p0)

    planes = {f: plane(f) for f in faces}
    tol = 1e-6 * max(1e-3, max(hi[k] - lo[k] for k in range(3)))
    for p in pts:
        if p in idx:
            continue
        visible = [f for f in planes if _dot(planes[f][0], p) + planes[f][1] > tol]
        if not visible:
            continue
        edges = {}
        for f in visible:
            for e in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
                if (e[1], e[0]) in edges:
                    del edges[(e[1], e[0])]
                else:
                    edges[e] = True
        for f in visible:
            del planes[f]
        idx[p] = len(corners)
        corners.append(p)
        for e0, e1 in edges:
            f = (e0, e1, idx[p])
            planes[f] = plane(f)
    used = sorted({i for f in planes for i in f})
    remap = {old: new for new, old in enumerate(used)}
    return [corners[i] for i in used], [tuple(remap[i] for i in f) for f in planes]


def simplified_hull(points, max_corners=MAX_HULL_CORNERS):
    hull = convex_hull(points)
    if hull is None:
        return None
    n = 120
    while len(hull[0]) > max_corners and n >= 8:
        hull = convex_hull(_support_points(hull[0], n)) or hull
        n = int(n * 0.7)
    return hull if len(hull[0]) <= max_corners else None


def shrink(points, amount=CONVEX_RADIUS):
    """Pulls the points towards their centre so each side moves in by `amount` (but keeps at least 40% of the size)."""
    lo, hi = _bounds(points)
    c = [(lo[k] + hi[k]) / 2 for k in range(3)]
    f = []
    for k in range(3):
        half = (hi[k] - lo[k]) / 2
        f.append(max(0.4, (half - amount) / half) if half > 1e-9 else 1.)
    return [tuple(c[k] + (p[k] - c[k]) * f[k] for k in range(3)) for p in points]


def box_points(lo, hi):
    return [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]


def cylinder_axis(lo, hi):
    """The axis a cylinder fitted to this box runs along: the one whose cross-section is most nearly round."""
    size = [max(hi[k] - lo[k], 1e-9) for k in range(3)]

    def roundness(k):
        a, b = (size[j] for j in range(3) if j != k)
        return (abs(a - b) / max(a, b), size[k])
    return min(range(3), key=roundness)


def cylinder_points(lo, hi, sides=CYLINDER_SIDES):
    axis = cylinder_axis(lo, hi)
    u, v = (k for k in range(3) if k != axis)
    c = [(lo[k] + hi[k]) / 2 for k in range(3)]
    ru, rv = (hi[u] - lo[u]) / 2, (hi[v] - lo[v]) / 2
    out = []
    for end in (lo[axis], hi[axis]):
        for i in range(sides):
            a = 2 * math.pi * (i + 0.5) / sides
            p = [0., 0., 0.]
            p[axis] = end
            p[u] = c[u] + ru * math.cos(a)
            p[v] = c[v] + rv * math.sin(a)
            out.append(tuple(p))
    return out


def hull_planes(corners, tris):
    """One plane per flat side of the hull, plus the side of each triangle: [(n, d)], [plane per triangle]."""
    planes, which = [], []
    for t in tris:
        p0, p1, p2 = (corners[i] for i in t)
        n = _cross(_sub(p1, p0), _sub(p2, p0))
        ln = _len(n)
        n = (n[0] / ln, n[1] / ln, n[2] / ln)
        d = -max(_dot(n, p) for p in (p0, p1, p2))
        for i, (m, e) in enumerate(planes):
            if _dot(m, n) > 1 - 1e-5 and abs(e - d) < 1e-4:
                which.append(i)
                break
        else:
            which.append(len(planes))
            planes.append((n, d))
    return planes, which


def mass_properties(corners, tris):
    """(volume, centre of mass, inertia per unit mass about it) of a closed solid with outward triangles."""
    vol, com, cov = 0., [0., 0., 0.], [[0.] * 3 for _ in range(3)]
    for t in tris:
        a, b, c = (corners[i] for i in t)
        det = _dot(a, _cross(b, c))
        vol += det / 6
        for k in range(3):
            com[k] += det * (a[k] + b[k] + c[k]) / 24
        # Second moments of the tetrahedron (origin, a, b, c).
        for i in range(3):
            for j in range(3):
                cov[i][j] += det / 120 * (a[i] * a[j] + b[i] * b[j] + c[i] * c[j]
                                          + (a[i] + b[i] + c[i]) * (a[j] + b[j] + c[j]))
    if vol <= 1e-12:
        raise ValueError('Collision shape has no volume.')
    com = [x / vol for x in com]
    cov = [[cov[i][j] / vol - com[i] * com[j] for j in range(3)] for i in range(3)]
    tr = cov[0][0] + cov[1][1] + cov[2][2]
    inertia = [[(tr if i == j else 0.) - cov[i][j] for j in range(3)] for i in range(3)]
    return vol, com, inertia


def combine(parts):
    """Mass properties of several solids of the same density: [(volume, com, inertia)] -> one."""
    total = sum(p[0] for p in parts)
    com = [sum(p[0] * p[1][k] for p in parts) / total for k in range(3)]
    out = [[0.] * 3 for _ in range(3)]
    for v, c, inertia in parts:
        d = [c[k] - com[k] for k in range(3)]
        dd = _dot(d, d)
        for i in range(3):
            for j in range(3):
                out[i][j] += v * (inertia[i][j] + (dd if i == j else 0.) - d[i] * d[j]) / total
    return total, com, out


def _pad4(buf):
    buf += b'\0' * (-len(buf) % 4)


def hull_part(corners, tris):
    """Bytes of one hull part (from the part's type field on), checked convex."""
    if not 4 <= len(corners) <= 0xFFFF or len(tris) > 0xFFFF:
        raise ValueError('Collision hull is too large.')
    planes, which = hull_planes(corners, tris)
    for n, d in planes:
        if max(_dot(n, p) + d for p in corners) > 1e-3:
            raise ValueError('Collision hull is not convex.')
    out = bytearray(struct.pack('>IIHH', 0, 2, len(corners), 0))
    for p in corners:
        out += struct.pack('>3f', *p)
    out += struct.pack('>I', len(planes))
    for n, d in planes:
        out += struct.pack('>4f', *n, d)
    out += struct.pack('>H', len(tris))
    for t in tris:
        out += struct.pack('>3H', *t)
    _pad4(out)
    first = {}
    for t, w in zip(tris, which):
        first.setdefault(w, t)
    out += struct.pack('>H', len(first))
    for w in sorted(first):
        out += struct.pack('>4H', 0, *first[w])
    _pad4(out)
    return bytes(out)


def sphere_part(centre, radius):
    return struct.pack('>II4f', 0, 1, *centre, radius)


def shape_record(parts, mass):
    """One shape record: parts = [part bytes], mass = (volume, com, inertia per unit mass)."""
    _, com, inertia = mass
    out = bytearray(struct.pack('>5I', 1, len(parts), 0, 0, 0)) + b'\0' * (12 * len(parts))
    for p in parts:
        out += p
    out += struct.pack('>12f', *(inertia[i][j] for i in range(3) for j in range(3)), *com)
    return bytes(out)


def components(verts, faces):
    """Groups of vertex indices that form separate pieces (welded by position)."""
    key = {}
    parent = list(range(len(verts)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, v in enumerate(verts):
        k = tuple(round(float(x), 5) for x in v)
        if k in key:
            parent[find(i)] = find(key[k])
        else:
            key[k] = i
    for f in faces:
        a = find(f[0])
        for j in f[1:3]:
            b = find(j)
            if a != b:
                parent[b] = a
    groups = {}
    for f in faces:
        for j in f[:3]:
            groups.setdefault(find(j), set()).add(j)
    return [sorted(g) for g in groups.values()]


def _box_volume(points):
    lo, hi = _bounds(points)
    return max(1e-9, (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]))


def merge_pieces(pieces, limit=MAX_PARTS):
    """Merges the pieces whose joined box grows least until at most `limit` are left."""
    pieces = [list(p) for p in pieces]
    while len(pieces) > limit:
        best = None
        for i in range(len(pieces)):
            for j in range(i + 1, len(pieces)):
                grow = _box_volume(pieces[i] + pieces[j]) - _box_volume(pieces[i]) - _box_volume(pieces[j])
                if best is None or grow < best[0]:
                    best = (grow, i, j)
        _, i, j = best
        pieces[i] += pieces.pop(j)
    return pieces


def build_shape(kind, verts, faces, bottom_heavy=False):
    """(shape record bytes, description) for model vertices already in the prop's own game-space frame."""
    lo, hi = _bounds(verts)
    if kind == 'sphere':
        centre = [(lo[k] + hi[k]) / 2 for k in range(3)]
        r = max(_len(_sub(v, centre)) for v in verts)
        if not r > 0:
            raise ValueError('Model is too small for a ball shape.')
        mass = (4 / 3 * math.pi * r ** 3, centre, [[0.4 * r * r if i == j else 0. for j in range(3)] for i in range(3)])
        parts, what = [sphere_part(centre, r)], f'ball, radius {r:.2f}'
    else:
        if kind == 'parts':
            groups = components(verts, faces)
            pieces = merge_pieces([[verts[i] for i in g] for g in groups])
        elif kind == 'cylinder':
            pieces = [cylinder_points(lo, hi)]
        elif kind == 'hull':
            pieces = [verts]
        else:
            pieces = [box_points(lo, hi)]
        parts, masses = [], []
        for piece in pieces:
            hull = simplified_hull(shrink(piece)) or simplified_hull(shrink(box_points(*_bounds(piece))))
            if hull is None:
                # A flat piece (a sign, a plane): give it a thin box.
                plo, phi = _bounds(piece)
                plo = [min(plo[k], phi[k] - 0.02) for k in range(3)]
                phi = [max(phi[k], plo[k] + 0.02) for k in range(3)]
                hull = convex_hull(box_points(plo, phi))
            parts.append(hull_part(*hull))
            masses.append(mass_properties(*hull))
        mass = combine(masses)
        what = {'parts': f'{len(parts)} part(s)', 'cylinder': f'cylinder along {"XYZ"[cylinder_axis(lo, hi)]}',
                'hull': f'hull, {len(parse_hull_corners(parts[0]))} corners', 'box': 'box'}[kind]
    if bottom_heavy:
        com = list(mass[1])
        com[1] -= BOTTOM_HEAVY * (hi[1] - lo[1]) / 2
        mass = (mass[0], com, mass[2])
        what += ', bottom-heavy'
    return shape_record(parts, mass), what


def parse_hull_corners(part):
    n = rc.U16(part, 8)
    return [struct.unpack_from('>3f', part, 12 + 12 * i) for i in range(n)]


# --------------------------------------------------------- shape bank --

def parse_bank(bank):
    """[(offset, length, [part types])] for every record; raises if the bank does not parse to its exact end."""
    if bytes(bank[:4]) != b'HKCM' or rc.U32(bank, 4) != 3 or rc.U32(bank, 8) != len(bank):
        raise ValueError('Unexpected collision-shape bank header.')
    out, c = [], 16
    for _ in range(rc.U32(bank, 12)):
        start = c
        if rc.U32(bank, c) != 1:
            raise ValueError('Unexpected collision-shape record at %d.' % c)
        n = rc.U32(bank, c + 4)
        c += 20 + 12 * n
        types = []
        for _ in range(n):
            t = rc.U32(bank, c + 4)
            types.append(t)
            c += 8
            if t == 1:
                c += 16
            elif t in (0, 2):
                # A box (0) has its turn, offset and half size, then corners
                # but no planes; a hull (2) has corners and planes.
                if t == 0:
                    c += 40
                c += 4 + 12 * rc.U16(bank, c)
                if t == 2:
                    c += 4 + 16 * rc.U32(bank, c)
                c += 2 + 6 * rc.U16(bank, c)
                c += -c % 4
                c += 2 + 8 * rc.U16(bank, c)
                c += -c % 4
            else:
                raise ValueError('Unknown collision part type %d.' % t)
        c += 48
        out.append((start, c - start, types))
    if c != len(bank):
        raise ValueError('Collision-shape bank does not end where its records do.')
    return out


def append_shapes(bank, records):
    """Adds shape records to a bank; returns (new bank, their indices). Identical records share one index."""
    bank = bytearray(bank)
    existing = parse_bank(bank)
    first = len(existing)
    index, seen = [], {}
    for r in records:
        if r not in seen:
            seen[r] = first + len(seen)
            bank += r
        index.append(seen[r])
    rc.Wr32(bank, 8, len(bank))
    rc.Wr32(bank, 12, first + len(seen))
    if first + len(seen) >= 0xFFFF:
        raise ValueError('Too many collision shapes.')
    parse_bank(bank)
    return bytes(bank), index


# ------------------------------------------------------------- export --

def model_points(item, parse, world_scale, mirror_x):
    """The prop's vertices in its own game-space frame, the same frame its render mesh uses."""
    model = parse(item.get('native_mesh_obj') or item['path'])
    s = float(item.get('scale', 1)) * float(world_scale)
    verts = [((-float(v[0]) if mirror_x else float(v[0])) * s, float(v[1]) * s, float(v[2]) * s) for v in model['verts']]
    used = sorted({i for f in model['faces'] for i in f[:3]})
    remap = {old: new for new, old in enumerate(used)}
    return [verts[i] for i in used], [tuple(remap[i] for i in f[:3]) for f in model['faces']]


def apply_shapes(chunk_path, native_items, placements, parse, world_scale, mirror_x, log):
    """Gives each prop that asks for one its own collision shape. Returns the number of props changed."""
    jobs = [(j, it) for j, it in enumerate(native_items) if wants_shape(it)]
    if not jobs:
        return 0
    if len(placements) != len(native_items):
        raise RuntimeError('native placement count mismatch')
    path = Path(chunk_path)
    original = path.read_bytes()
    ch = rc.read_chunk(original)
    g = rc.chunk_geometry(ch)
    records, notes = [], []
    for j, it in jobs:
        p = placements[j]
        verts, faces = model_points(it, parse, world_scale, mirror_x)
        # The shape must sit exactly where the render mesh does: compare bounds.
        hdr = g.meshes[p['mesh']].hdr
        want = [rc.F32(hdr, a * 4) for a in range(3)] + [rc.F32(hdr, 12 + a * 4) for a in range(3)]
        lo, hi = _bounds(verts)
        size = max(hi[k] - lo[k] for k in range(3))
        if any(abs(a - b) > max(2e-3, 2e-3 * size) for a, b in zip(lo + hi, want)):
            raise RuntimeError(f'Physics shape for "{it.get("name")}" does not line up with its model.')
        kind = it.get('physics_shape') or 'box'
        rec, what = build_shape(kind, verts, faces, bool(it.get('physics_bottom_heavy')))
        records.append(rec)
        notes.append(f'"{it.get("name", "prop")}": {what}')
    bank, index = append_shapes(ch.get('block556').data, records)
    ch.get('block556').data = bytearray(bank)
    recs = ch.get('static_records').data
    for (j, _), k in zip(jobs, index):
        rc.Wr16(recs, placements[j]['source'] * 80 + 56, k)
    out = rc.write_chunk(ch)
    check = rc.read_chunk(out)
    first = rc.read_chunk(original)
    for s in check.secs:
        if s.name not in ('block556', 'static_records') and bytes(s.data) != bytes(first.get(s.name).data):
            raise RuntimeError('adding physics shapes changed another part of the map: ' + s.name)
    if bytes(check.get('block556').data) != bank:
        raise RuntimeError('physics shapes did not read back')
    for (j, _), k in zip(jobs, index):
        if rc.U16(check.get('static_records').data, placements[j]['source'] * 80 + 56) != k:
            raise RuntimeError('physics shape link did not read back')
    path.write_bytes(bytes(out))
    log(f'Physics props: {len(jobs)} prop(s) given fitted collision shapes: ' + '; '.join(notes))
    return len(jobs)

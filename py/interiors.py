"""Dry interiors: rain blockers worked out from the map itself.

The game fades the rain out while the camera is inside one of the map's
indoor regions (regions.py); a custom map has none, so it rains in every hall
and under every roof. This finds the floor that has a roof or ceiling over it
and covers it with a few boxes, which the export (web_api.py) and the quick
upgrade for finished maps (map_upgrade.py) write as rain blockers.

How, all in the game frame (metres) on the map's chunk as written:
  1. The solid triangles: each object's collision triangles, placed where the
     object stands (objects left out of collision are left out here too).
  2. A grid of columns over the map, as the editor's floor analysis does
     (src/lib/analysis/floor.ts): every triangle that crosses a column's centre
     is a hit at its height. Hits within a few centimetres are one surface.
  3. Covered floor: a hit flat enough to stand on, facing up, with room for a
     crouching player above it, under a ceiling (the next surface up, facing
     down) no higher than MAX_ROOF. Up a column through a solid block the
     next surface is the block's top, which faces up, so closed buildings
     without insides are not rooms.
  4. Covered columns that touch, at heights that overlap, are one covered area.
     Each area's box is split where it holds the least space until every box
     is mostly covered floor and mostly under its ceilings (not open air over a
     lower roof), the worst first, at most `budget` boxes over the map. Small
     areas (under a bench, a lintel, a tree) are left out.
  5. Boxes reach PAD past the covered floor's edge (the game tests the camera,
     which swings through doorways), from just under the floor to just over the
     ceiling, so a player on the roof is outside.

Nothing here has been tried in game yet.
"""
import heapq
import math

import numpy as np

import sr_reborn_core as rc

CELL = 1.0  # metres between columns
MAX_COLUMNS = 400_000  # the grid widens its cells on very big maps to stay under this
SAME = 0.05  # hits closer than this are one surface (two faces meeting, both sides of a sheet)
FLOOR_NY = 0.5  # flat enough to stand on (about 60 degrees), as floor.ts
ROOF_NY = 0.2  # a ceiling or roof: anything but a wall
CROUCH = 1.1  # metres of room a crouching player needs (floor.ts PLAYER.crouch at 2 editor units a metre)
MAX_ROOF = 40.0  # higher than this over the floor is sky, not a roof (a lid over the whole map)
MIN_AREA = 12.0  # square metres: smaller covered areas (a bench, a lintel, a tree) are left out
FILL = 0.8  # a box is good when this much of its floor is covered
FILL_HEIGHT = 0.6  # ... and this much of the space in it is under the ceilings (not open air over a lower roof)
PAD = 1.0  # metres past the covered floor's edge
BELOW, ABOVE = 1.0, 0.5  # metres under the lowest floor and over the highest ceiling of a box
NO_COLLISION_FLAGS = 0x4C7  # instance flags that leave an object out of collision (src/lib/city/collision.ts)
BUDGET = 40


def solid_triangles(ch, g=None):
    """(N, 3, 3) array of the map's solid triangles in the game frame, corners in the order they are drawn."""
    g = g or rc.chunk_geometry(ch)
    blocks = rc.parse_mopp_blocks(g.coll)
    if len(blocks) != len(g.meshes) + 1:
        raise RuntimeError("the map's collision could not be read")
    first_of_vb, canon = {}, []
    for k, m in enumerate(g.meshes):
        vb = rc.U32(m.subs[0].s16, 8) if m.subs else -1
        canon.append(first_of_vb.setdefault(vb, k))
    keys, local = {}, {}

    def mesh_local(k):
        """The mesh's solid triangles in its own frame, (n, 3, 3)."""
        if k in local:
            return local[k]
        c = canon[k]
        if c not in keys:
            keys[c] = np.array(sorted(set(rc.mopp_keys(blocks[c]['code']))), dtype=np.int64)
        solid = keys[c]
        out = []
        if solid.size:
            for S in g.meshes[k].subs:
                V = g.vbs[rc.U32(S.s16, 8)]
                stride = rc.U16(V.desc, 16)
                if stride < 12 or stride % 4:
                    continue
                verts = np.frombuffer(bytes(V.vd), dtype='>f4')
                verts = verts[:verts.size - verts.size % (stride // 4)].reshape(-1, stride // 4)[:, :3].astype(np.float64)
                ib = np.frombuffer(bytes(V.ib), dtype='>u2').astype(np.int64)
                for b in range(rc.U16(S.s16, 2)):
                    first, cnt = rc.U32(S.b16, 8 * b), rc.U16(S.b16, 8 * b + 4)
                    if cnt < 3 or first + cnt > ib.size:
                        continue
                    p = np.arange(cnt - 2)
                    a, b1, b2 = ib[first + p], ib[first + p + 1], ib[first + p + 2]
                    # Strips turn every other triangle round.
                    odd = (p & 1).astype(bool)
                    a, b1 = np.where(odd, b1, a), np.where(odd, a, b1)
                    ok = (a != b1) & (b1 != b2) & (a != b2) & np.isin((b << 16) | (first + p), solid)
                    ok &= np.maximum(np.maximum(a, b1), b2) < len(verts)
                    if ok.any():
                        out.append(np.stack([verts[a[ok]], verts[b1[ok]], verts[b2[ok]]], axis=1))
        local[k] = np.concatenate(out) if out else np.zeros((0, 3, 3))
        return local[k]

    inst = ch.get('instances').data
    placed = []
    for i in range(len(inst) // 112):
        o = 112 * i
        mesh, flags = rc.U32(inst, o + 104), rc.U32(inst, o + 108)
        if flags & NO_COLLISION_FLAGS or mesh >= len(g.meshes):
            continue
        tris = mesh_local(mesh)
        if not tris.size:
            continue
        pos = np.array([rc.F32(inst, o + 4 + 4 * a) for a in range(3)])
        rot = np.array([rc.F32(inst, o + 16 + 4 * a) for a in range(9)]).reshape(3, 3)
        placed.append(tris @ rot + pos)
    tris = np.concatenate(placed) if placed else np.zeros((0, 3, 3))
    return tris[np.isfinite(tris).all(axis=(1, 2)) & (np.abs(tris).max(axis=(1, 2)) < 1e5)]


def _hits(tris, x0, z0, cell, nx, nz):
    """Where each triangle crosses the column centres: (column, height, normal y) arrays."""
    e1, e2 = tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    n = np.cross(e1, e2)
    length = np.linalg.norm(n, axis=1)
    keep = length > 1e-9
    tris, n, length = tris[keep], n[keep], length[keep]
    ny = n[:, 1] / length
    keep = np.abs(ny) >= ROOF_NY
    tris, n, ny = tris[keep], n[keep], ny[keep]
    lo, hi = tris.min(axis=1), tris.max(axis=1)
    i0 = np.maximum(np.ceil((lo[:, 0] - x0) / cell - 0.5), 0).astype(np.int64)
    i1 = np.minimum(np.floor((hi[:, 0] - x0) / cell - 0.5), nx - 1).astype(np.int64)
    j0 = np.maximum(np.ceil((lo[:, 2] - z0) / cell - 0.5), 0).astype(np.int64)
    j1 = np.minimum(np.floor((hi[:, 2] - z0) / cell - 0.5), nz - 1).astype(np.int64)
    w, h = np.maximum(i1 - i0 + 1, 0), np.maximum(j1 - j0 + 1, 0)
    count = w * h
    cols, ys, nys = [], [], []
    order = np.flatnonzero(count)
    at = 0
    while at < order.size:
        # Batches of about two million candidate columns.
        csum = np.cumsum(count[order[at:]])
        end = at + max(1, int(np.searchsorted(csum, 2_000_000)))
        t = order[at:end]
        at = end
        # np.repeat takes its counts as the platform's index type: 32-bit in the browser's Python (Pyodide).
        c = count[t].astype(np.intp)
        idx = np.repeat(np.arange(t.size), c)
        k = np.arange(idx.size) - np.repeat(np.cumsum(c) - c, c)
        ti = t[idx]
        ci = i0[ti] + k % w[ti]
        cj = j0[ti] + k // w[ti]
        px, pz = x0 + (ci + 0.5) * cell, z0 + (cj + 0.5) * cell
        A, B, C = tris[ti, 0], tris[ti, 1], tris[ti, 2]
        # Inside the triangle's shadow on the ground (either winding), a hair of slack so seams leave no gaps.
        d1 = (B[:, 0] - A[:, 0]) * (pz - A[:, 2]) - (B[:, 2] - A[:, 2]) * (px - A[:, 0])
        d2 = (C[:, 0] - B[:, 0]) * (pz - B[:, 2]) - (C[:, 2] - B[:, 2]) * (px - B[:, 0])
        d3 = (A[:, 0] - C[:, 0]) * (pz - C[:, 2]) - (A[:, 2] - C[:, 2]) * (px - C[:, 0])
        eps = -1e-9
        inside = ((d1 >= eps) & (d2 >= eps) & (d3 >= eps)) | ((d1 <= -eps) & (d2 <= -eps) & (d3 <= -eps))
        nn = n[ti]
        y = A[:, 1] - (nn[:, 0] * (px - A[:, 0]) + nn[:, 2] * (pz - A[:, 2])) / nn[:, 1]
        cols.append((cj * nx + ci)[inside])
        ys.append(y[inside])
        nys.append(ny[ti][inside])
    if not cols:
        return np.zeros(0, np.int64), np.zeros(0), np.zeros(0)
    return np.concatenate(cols), np.concatenate(ys), np.concatenate(nys)


def covered_floor(tris, cell=CELL):
    """The grid and every covered spot on it: (grid, nodes) with grid = (x0, z0, cell, nx, nz) and nodes an
    (n, 4) array of column i, column j, floor height, ceiling height."""
    empty = (0.0, 0.0, cell, 0, 0), np.zeros((0, 4))
    if not len(tris):
        return empty
    lo, hi = tris.reshape(-1, 3).min(axis=0), tris.reshape(-1, 3).max(axis=0)
    while (hi[0] - lo[0]) * (hi[2] - lo[2]) / (cell * cell) > MAX_COLUMNS:
        cell *= 1.25
    x0, z0 = math.floor(lo[0] / cell) * cell, math.floor(lo[2] / cell) * cell
    nx, nz = max(1, math.ceil((hi[0] - x0) / cell)), max(1, math.ceil((hi[2] - z0) / cell))
    col, y, ny = _hits(tris, x0, z0, cell, nx, nz)
    grid = (x0, z0, cell, nx, nz)
    if not col.size:
        return grid, empty[1]
    s = np.lexsort((y, col))
    col, y, ny = col[s], y[s], ny[s]
    # One surface per cluster of hits a few centimetres apart: its top hit, facing up if any of it faces up (a
    # floor), facing down if any faces down (a ceiling).
    last = np.ones(col.size, bool)
    last[:-1] = (col[1:] != col[:-1]) | (y[1:] - y[:-1] >= SAME)
    group = np.concatenate([[0], np.cumsum(last)[:-1]])
    stand = np.zeros(int(group[-1]) + 1, bool)
    down = np.zeros_like(stand)
    np.logical_or.at(stand, group, ny >= FLOOR_NY)
    np.logical_or.at(down, group, ny < 0)
    col, y = col[last], y[last]
    # Floor: faces up; the next surface up the column is its ceiling.
    nxt = np.zeros(col.size, bool)
    nxt[:-1] = col[1:] == col[:-1]
    above = np.full(col.size, np.inf)
    above[:-1] = np.where(nxt[:-1], y[1:], np.inf)
    ceiling = np.zeros(col.size, bool)
    ceiling[:-1] = nxt[:-1] & down[1:]
    room = above - y
    # A ceiling faces down. Up a column from the ground through a solid block, the next surface is the block's top,
    # which faces up: the block's footprint is not a room.
    floor = stand & ceiling & (room >= CROUCH) & (room <= MAX_ROOF)
    c = col[floor]
    nodes = np.stack([c % nx, c // nx, y[floor], above[floor]], axis=1).astype(np.float64)
    return grid, nodes


def _areas(nodes, nx, nz):
    """Covered spots that touch (side by side, heights overlapping) grouped: a list of index arrays."""
    n = len(nodes)
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    by_col = {}
    for k in range(n):
        by_col.setdefault((int(nodes[k, 0]), int(nodes[k, 1])), []).append(k)
    for (i, j), ks in by_col.items():
        for di, dj in ((1, 0), (0, 1)):
            for m in by_col.get((i + di, j + dj), ()):
                for k in ks:
                    if min(nodes[k, 3], nodes[m, 3]) > max(nodes[k, 2], nodes[m, 2]):
                        a, b = find(k), find(m)
                        if a != b:
                            parent[a] = b
    groups = {}
    for k in range(n):
        groups.setdefault(find(k), []).append(k)
    return [np.array(v) for v in groups.values()]


class _Piece:
    """Part of a covered area being split: its covered columns (a mask over its rectangle) and their floor and
    ceiling heights."""
    __slots__ = ('i0', 'j0', 'mask', 'lo', 'hi', 'covered', 'area', 'room', 'volume', 'waste')

    def __init__(self, i0, j0, mask, lo, hi):
        rows, cols = np.flatnonzero(mask.any(axis=1)), np.flatnonzero(mask.any(axis=0))
        r0, r1, c0, c1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
        self.i0, self.j0 = i0 + c0, j0 + r0
        self.mask, self.lo, self.hi = mask[r0:r1, c0:c1], lo[r0:r1, c0:c1], hi[r0:r1, c0:c1]
        self.covered = int(self.mask.sum())
        self.area = self.mask.size
        self.room = float((self.hi - self.lo)[self.mask].sum())  # covered column-metres
        self.volume = self.area * float(self.hi[self.mask].max() - self.lo[self.mask].min())
        self.waste = self.volume - self.room

    def good(self):
        return self.covered >= FILL * self.area and self.room >= FILL_HEIGHT * self.volume

    @staticmethod
    def _sides(mask, lo, hi):
        """For every cut between columns: the bounding volume of the part left of it plus the part right of it."""
        h, w = mask.shape
        has = mask.any(axis=0)
        rows = np.arange(h)[:, None]
        r_first = np.where(mask, rows, h).min(axis=0)
        r_last = np.where(mask, rows, -1).max(axis=0)
        low = np.where(mask, lo, np.inf).min(axis=0)
        high = np.where(mask, hi, -np.inf).max(axis=0)
        c = np.arange(w)

        def run(cols, r_first, r_last, low, high, has):
            first = np.minimum.accumulate(np.where(has, cols, w + 1))
            last = np.maximum.accumulate(np.where(has, cols, -1))
            rf, rl = np.minimum.accumulate(r_first), np.maximum.accumulate(r_last)
            lo_, hi_ = np.minimum.accumulate(low), np.maximum.accumulate(high)
            vol = (np.abs(last - first) + 1) * (rl - rf + 1) * (hi_ - lo_)
            return np.where(np.maximum.accumulate(has), vol, np.nan)

        left = run(c, r_first, r_last, low, high, has)  # left[k]: columns 0..k
        right = run(c[::-1], r_first[::-1], r_last[::-1], low[::-1], high[::-1], has[::-1])[::-1]  # k..w-1
        return left[:-1] + right[1:]  # cut after column k, k = 0..w-2

    def split(self):
        """The two pieces whose boxes hold the least space, cutting across x or z."""
        best = None
        for axis, (m, lo, hi) in enumerate(((self.mask, self.lo, self.hi), (self.mask.T, self.lo.T, self.hi.T))):
            if m.shape[1] < 2:
                continue
            cost = self._sides(m, lo, hi)
            if np.isnan(cost).all():
                continue
            k = int(np.nanargmin(cost))
            if best is None or cost[k] < best[0]:
                best = (cost[k], axis, k + 1)
        if best is None:
            return None
        _, axis, cut = best
        if axis == 0:  # cut between columns (x)
            a = _Piece(self.i0, self.j0, self.mask[:, :cut], self.lo[:, :cut], self.hi[:, :cut])
            b = _Piece(self.i0 + cut, self.j0, self.mask[:, cut:], self.lo[:, cut:], self.hi[:, cut:])
        else:  # between rows (z)
            a = _Piece(self.i0, self.j0, self.mask[:cut], self.lo[:cut], self.hi[:cut])
            b = _Piece(self.i0, self.j0 + cut, self.mask[cut:], self.lo[cut:], self.hi[cut:])
        return a, b


def boxes(tris, budget=BUDGET, cell=CELL):
    """Rain-blocker boxes over the covered floor: a list of ((x0, y0, z0), (x1, y1, z1)), biggest first."""
    if budget <= 0:
        return []
    (gx, gz, cell, nx, nz), nodes = covered_floor(tris, cell)
    pieces = []
    for idx in _areas(nodes, nx, nz) if len(nodes) else []:
        sub = nodes[idx]
        ci, cj = sub[:, 0].astype(int), sub[:, 1].astype(int)
        if len(set(zip(ci.tolist(), cj.tolist()))) * cell * cell < MIN_AREA:
            continue
        i0, j0 = ci.min(), cj.min()
        shape = (cj.max() - j0 + 1, ci.max() - i0 + 1)
        mask = np.zeros(shape, bool)
        lo, hi = np.full(shape, np.inf), np.full(shape, -np.inf)
        mask[cj - j0, ci - i0] = True
        np.minimum.at(lo, (cj - j0, ci - i0), sub[:, 2])
        np.maximum.at(hi, (cj - j0, ci - i0), sub[:, 3])
        pieces.append(_Piece(i0, j0, mask, lo, hi))
    # The biggest areas first, so a small budget keeps them; then split the most wasteful box while there's room.
    pieces.sort(key=lambda p: -p.covered)
    pieces = pieces[:budget]
    heap = [(-p.waste, k, p) for k, p in enumerate(pieces)]
    heapq.heapify(heap)
    done, tick = [], len(pieces)
    while heap:
        _, _, p = heapq.heappop(heap)
        if p.good() or len(heap) + len(done) + 2 > budget:
            done.append(p)
            continue
        parts = p.split()
        if parts is None:
            done.append(p)
            continue
        for q in parts:
            if q.covered * cell * cell < MIN_AREA / 2 and not q.good():
                continue  # a sliver of floor at the edge of a split
            tick += 1
            heapq.heappush(heap, (-q.waste, tick, q))
    out = []
    for p in sorted(done, key=lambda p: -p.area):
        h, w = p.mask.shape
        out.append(((gx + p.i0 * cell - PAD, float(p.lo[p.mask].min()) - BELOW, gz + p.j0 * cell - PAD),
                    (gx + (p.i0 + w) * cell + PAD, float(p.hi[p.mask].max()) + ABOVE, gz + (p.j0 + h) * cell + PAD)))
    return out


def chunk_boxes(chunk_bytes, budget=BUDGET):
    """Rain-blocker boxes for a map chunk (game frame)."""
    ch = rc.read_chunk(chunk_bytes)
    return boxes(solid_triangles(ch), budget)


def volume(box):
    """A box as regions.py's volume (corner quad over x, z, then its bottom and top)."""
    (x0, y0, z0), (x1, y1, z1) = box
    return [(x0, z0), (x0, z1), (x1, z1), (x1, z0)], y0, y1

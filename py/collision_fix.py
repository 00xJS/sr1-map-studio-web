"""Invisible walls: sliver triangles taken out of a map's collision.

A sliver is a triangle whose corners lie (almost) in a straight line, so it has no area: it draws nothing and no
model viewer shows it, but the game's physics treats it as a wall through that line, reaching out into open air.
Players rub against nothing and the camera is pushed away from nothing, and because rescaling changes which
triangles come out flat, scaling a map moves the walls around. Converted maps carry many (Dust: 92, a rescaled
export of it 169). Found in game on Dust, 2026-10-24: the camera stopped against a plane through one, and with
them out of the collision the pushes were gone.

drop_slivers() rebuilds each mesh's collision tree (sr_reborn_core MOPP blocks) without them. The triangles stay
drawn (they draw nothing anyway); only the geometry section's collision changes. Used by the export (web_api.py)
and the "Remove invisible walls" quick upgrade (map_upgrade.py).
"""
import math
from pathlib import Path

import sr_reborn_core as rc

# Thinner than this (height over longest side, about 0.25 degrees) is a sliver.
THIN = 0.004


def is_sliver(pts):
    ab = [pts[1][a] - pts[0][a] for a in range(3)]
    ac = [pts[2][a] - pts[0][a] for a in range(3)]
    cr = (ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0])
    longest = max(math.dist(pts[a], pts[(a + 1) % 3]) for a in range(3))
    # |ab x ac| is twice the area; over the longest side it is the triangle's height across that side.
    return math.hypot(*cr) <= THIN * longest * longest


def _blocks(g):
    return rc.parse_mopp_blocks(g.coll)


def count_slivers(ch, g=None):
    """How many collision triangles of the chunk are slivers."""
    g = g or rc.chunk_geometry(ch)
    blocks = _blocks(g)
    n = 0
    for k, B in enumerate(blocks[:-1]):
        if k >= len(g.meshes):
            break
        keys = set(rc.mopp_keys(B['code']))
        if not keys:
            continue
        n += sum(1 for key, pts in rc.mesh_triangles(g, k) if key in keys and is_sliver(pts))
    return n


def drop_slivers(chunk_bytes):
    """(chunk bytes without slivers in its collision, how many were taken out). Unchanged bytes when there are none."""
    ch = rc.read_chunk(chunk_bytes)
    g = rc.chunk_geometry(ch)
    blocks = _blocks(g)
    out, removed, kept = [], 0, {}
    for k, B in enumerate(blocks):
        raw = bytes(B['header24']) + len(B['code']).to_bytes(4, 'big') + bytes(B['code'])
        keys = set(rc.mopp_keys(B['code'])) if k < len(g.meshes) and k < len(blocks) - 1 else set()
        if not keys:
            out.append(raw)
            continue
        items, drop = [], 0
        for key, pts in rc.mesh_triangles(g, k):
            if key not in keys:
                continue
            if is_sliver(pts):
                drop += 1
                continue
            items.append({'key': key, 'mn': [min(p[a] for p in pts) for a in range(3)], 'mx': [max(p[a] for p in pts) for a in range(3)]})
        if not drop or not items:
            out.append(raw)
            continue
        removed += drop
        kept[k] = {it['key'] for it in items}
        out.append(bytes(rc.build_mopp_block(items)))
    if not removed:
        return bytes(chunk_bytes), 0
    blob = bytearray()
    for i, b in enumerate(out):
        blob += b
        if i + 1 < len(out):
            rc.PadTo(blob, 64)
    before = {s.name: bytes(s.data) for s in ch.secs}
    g.coll = blob
    rc.set_geometry(ch, g)
    data = rc.write_chunk(ch)
    # Read back: only the geometry section changed, every mesh keeps its drawing, and each rebuilt block holds
    # exactly the triangles kept.
    check = rc.read_chunk(data)
    for s in check.secs:
        if s.name != 'geometry' and bytes(s.data) != before[s.name]:
            raise RuntimeError('removing invisible walls changed another part of the map: ' + s.name)
    g2 = rc.chunk_geometry(check)
    if [bytes(m.hdr) for m in g2.meshes] != [bytes(m.hdr) for m in g.meshes]:
        raise RuntimeError('removing invisible walls changed the map\'s meshes')
    b2 = _blocks(g2)
    for k, want in kept.items():
        if set(rc.mopp_keys(b2[k]['code'])) != want:
            raise RuntimeError('the collision did not read back on mesh %d' % k)
    return bytes(data), removed


def remove_invisible_walls(chunk_path, log):
    """Takes the slivers out of a chunk file's collision; returns how many."""
    path = Path(chunk_path)
    data, n = drop_slivers(path.read_bytes())
    if n:
        path.write_bytes(data)
        log(f'Invisible walls: {n} paper-thin triangle(s) left out of the collision (they draw nothing but blocked players and the camera).')
    return n

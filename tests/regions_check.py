"""Checks for py/regions.py (rain blockers and indoor rooms).

Run: py -3 tests/regions_check.py
With SR1_DATA_PACK set to an unpacked SR1 Map Studio desktop folder (the one
holding reference_beavercreek/), it also writes regions into the template map
chunk and reads them back.
"""
import math
import os
import struct
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
import sr_reborn_core as rc  # noqa: E402
import regions  # noqa: E402

failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


box = ([(0.0, 0.0), (0.0, 4.0), (6.0, 4.0), (6.0, 0.0)], 1.0, 5.0)

# One region: the count, an 88-byte record, then its planes (6) and a chain of 6 nodes: 240 bytes, as retail.
data = regions.section([(box, regions.FLAGS[regions.RAIN_BLOCKER], 0.35)])
check(len(data) == 240, f'one region is 240 bytes ({len(data)})')
check(struct.unpack_from('>I', data, 0)[0] == 1, 'count first')
lo = struct.unpack_from('>3f', data, 8)
hi = struct.unpack_from('>3f', data, 20)
check(lo == (0.0, 1.0, 0.0) and hi == (6.0, 5.0, 4.0), f'box min/max ({lo} {hi})')
flags = struct.unpack_from('>I', data, 4 + 32)[0]
check(flags == 0x8 and not flags & 0x4, 'a rain blocker is indoors only, never 0x4')
check(struct.unpack_from('>f', data, 4 + 84)[0] > 0, 'blend time is never 0')
room = regions.FLAGS[regions.INDOOR_ROOM]
check(room == 0x3B, f'an indoor room has the retail room flags ({room:#x})')
a, b = struct.unpack_from('>2I', data, 92)
check((a, b) == (6, 6), 'six planes, six nodes')

# Boxes stand on the marker, sized in metres, turned like the editor draws them, converted like the markers.
ident = lambda p: tuple(float(v) for v in p)
[(m, vol)] = regions.region_volumes([{'type': regions.RAIN_BLOCKER, 'position': [10, 2, 20], 'size': [8, 6, 4], 'yaw': 0}], 0.5, ident)
quad, y0, y1 = vol
xs, zs = [p[0] for p in quad], [p[1] for p in quad]
check((min(xs), max(xs), min(zs), max(zs)) == (2.0, 18.0, 16.0, 24.0), f'width and depth in metres become editor units ({min(xs)}..{max(xs)}, {min(zs)}..{max(zs)})')
check((y0, y1) == (2.0, 14.0), f'bottom at the marker, top its height up ({y0}, {y1})')
[(m, vol)] = regions.region_volumes([{'type': regions.INDOOR_ROOM, 'position': [0, 0, 0], 'size': [8, 4, 4], 'yaw': 90}], 0.5, ident)
xs, zs = [p[0] for p in vol[0]], [p[1] for p in vol[0]]
check(math.isclose(max(xs) - min(xs), 8, abs_tol=1e-6) and math.isclose(max(zs) - min(zs), 16, abs_tol=1e-6), 'turned a quarter, width and depth swap')
check(regions.region_volumes([{'type': 'Shared spawn', 'position': [0, 0, 0]}], 0.5, ident) == [], 'other markers are left alone')

pack = os.environ.get('SR1_DATA_PACK')
if pack:
    chunk = Path(pack) / 'reference_beavercreek' / 'beavercreek.bbchunk_xbox2'
    original = chunk.read_bytes()
    out = regions.write_regions(original, [(box, 0x8, 0.35), (([(10.0, 10.0), (10.0, 14.0), (16.0, 14.0), (16.0, 10.0)], 0.0, 4.0), 0x3B, 0.4)])
    got = regions.read_regions(out)
    check(len(got) == 2 and got[0][2] == 0x8 and got[1][2] == 0x3B, 'two regions written into the template and read back')
    before = {s.name: bytes(s.data) for s in rc.read_chunk(original).secs}
    after = {s.name: bytes(s.data) for s in rc.read_chunk(out).secs}
    check([n for n in before if before[n] != after[n]] == [regions.OCCLUDERS, regions.OCCLUDER_TREE, regions.SECTION], 'only the region and rain occluder sections changed')
    # The minimap's map-wide region goes in after the ones there, which stay byte for byte.
    wide = regions.with_map_region(out, -80, 80, -70, 90, -20, 60)
    got = regions.read_regions(wide)
    old_records, old_blocks = regions._split(bytes(rc.read_chunk(out).get(regions.SECTION).data))
    new_records, new_blocks = regions._split(bytes(rc.read_chunk(wide).get(regions.SECTION).data))
    check(len(got) == 3 and got[-1] == ((-80.0, -20.0, -70.0), (80.0, 60.0, 90.0), regions.MAP_REGION_FLAGS)
          and new_records[:2] == old_records and new_blocks[:2] == old_blocks, 'map region added last, the others kept')
    check(regions.covered(wide, -50, 50, -50, 50) and not regions.covered(out, -50, 50, -50, 50), 'covered: only the map region covers the map')
    # Its planes as retail stores a whole-map region (mp_bac_02's first): inside is n.p + d >= 0.
    planes = struct.unpack_from('>24f', new_blocks[2], 16)
    inside = all(planes[4 * k] * 0 + planes[4 * k + 1] * 10 + planes[4 * k + 2] * 0 + planes[4 * k + 3] >= 0 for k in range(6))
    check(inside and struct.unpack_from('>2I', new_blocks[2], 0) == (6, 6), 'map region: six planes, a point in the middle is inside')
    plain = regions.with_map_region(original, -80, 80, -70, 90, -20, 60)
    check(len(regions.read_regions(plain)) == 1, 'map region on a map without regions')
    # Edges that 32-bit floats can't hold exactly (59.52 reads back as 59.5199996): it still reads back as covering them.
    odd = (-109.52, 109.52, -101.03, 117.77, -50.0, 112.774)
    try:
        awkward = regions.with_map_region(original, *odd)
        ok = regions.covered(awkward, *odd[:4])
    except RuntimeError as exc:
        ok = False
        print('     ', exc)
    check(ok, 'map region with edges a 32-bit float rounds (the export failure Slime hit)')

    # Rain occluders (reported 2026-10-28: rain fell inside dry interiors exported without them). Every region that
    # keeps the rain out has a closed mesh with its box in rec40_360 and a collision tree over all of them, as every
    # region in the game's own MP maps does; the map-wide region has none.
    check(regions.occluder_bounds(original) == [], 'the template has no rain occluders')
    check(regions.occluder_bounds(out) == [(lo, hi) for lo, hi, f in regions.read_regions(out)],
          'write: a rain occluder with the box of each rain-keeping region, in their order')
    check(regions.occluder_bounds(wide) == regions.occluder_bounds(out) and regions.without_occluders(wide) == [],
          'the map-wide region gets no occluder (the whole map would be dry)')
    ch = rc.read_chunk(wide)
    rec, tree = bytes(ch.get(regions.OCCLUDERS).data), bytes(ch.get(regions.OCCLUDER_TREE).data)
    meshes = regions.read_occluders(ch)
    # Byte layout as retail (mp_crib): count, 40-byte headers (8 corners, 12 triangles, bounds), corners, u32 triangles.
    check(struct.unpack_from('>I', rec, 0)[0] == 2 and struct.unpack_from('>4I', rec, 4) == (8, 0, 12, 0)
          and len(rec) == 4 + 2 * 40 + 2 * (8 * 12 + 12 * 12), f'occluder section: retail layout ({len(rec)} B)')
    corners, tris = meshes[0]
    lo, hi = regions.occluder_bounds(wide)[0]
    faces = [(corners[a], corners[b], corners[c]) for a, b, c in tris]
    centre = [(lo[k] + hi[k]) / 2 for k in range(3)]

    def inward(t):
        n = [(t[1][(k + 1) % 3] - t[0][(k + 1) % 3]) * (t[2][(k + 2) % 3] - t[0][(k + 2) % 3])
             - (t[1][(k + 2) % 3] - t[0][(k + 2) % 3]) * (t[2][(k + 1) % 3] - t[0][(k + 1) % 3]) for k in range(3)]
        return sum(n[k] * (centre[k] - t[0][k]) for k in range(3)) > 0
    check(all(inward(t) for t in faces), 'occluder faces face into the box, as the game winds its own')
    check(any(all(p[1] == hi[1] for p in t) for t in faces), 'its top is a face the rain ray can stop at')
    size = struct.unpack_from('>I', tree, 0)[0]
    check(tree[4:8] == b'PPOM' and struct.unpack_from('>I', tree, 8)[0] == 300 and size == 0x1c + struct.unpack_from('>I', tree, 4 + 0x18)[0]
          and len(tree) == 4 + size, 'occluder tree: size word, then a v300 collision tree and nothing after it, as retail')
    keys = sorted(rc.mopp_keys(tree[4 + 0x1c:]))
    check(keys == sorted(i << 20 | k for i, (_, t) in enumerate(meshes) for k in range(len(t))),
          'the tree names every occluder triangle, as mesh << 20 | triangle')
    # A map exported before occluders were written: regions without them, then the repair the quick upgrade uses.
    bare = rc.read_chunk(wide)
    bare.get(regions.OCCLUDERS).data, bare.get(regions.OCCLUDER_TREE).data = bytearray(struct.pack('>I', 0)), bytearray(struct.pack('>I', 0))
    bare = bytes(rc.write_chunk(bare))
    check([i for i, _, _ in regions.without_occluders(bare)] == [0, 1], 'an old export: both rain-keeping regions without an occluder')
    fixed = regions.add_missing_occluders(bare)
    check(regions.without_occluders(fixed) == [] and regions.occluder_bounds(fixed) == regions.occluder_bounds(wide),
          'repaired: an occluder over each, the same boxes as a new export')
    check(regions.add_missing_occluders(fixed) == fixed, 'and repairing again changes nothing')
    # A blocker turned 45 degrees comes back from its planes as the same turned box, not the 11.3 m square round it.
    s = 4 / math.sqrt(2) * 2  # an 8 m square turned 45 degrees: corners 5.66 m from its middle
    turned = ([(0.0, -s), (-s, 0.0), (0.0, s), (s, 0.0)], 0.0, 6.0)
    tch = rc.read_chunk(regions.write_regions(original, [(turned, regions.FLAG_INDOOR, 0.0)]))
    want = regions.read_occluders(tch)
    tch.get(regions.OCCLUDERS).data, tch.get(regions.OCCLUDER_TREE).data = bytearray(4), bytearray(4)
    got = regions.read_occluders(regions.add_missing_occluders(bytes(rc.write_chunk(tch))))
    close = len(got) == 1 and all(math.dist(a, b) < 1e-3 for a, b in zip(got[0][0], want[0][0])) and got[0][1] == want[0][1]
    check(close, 'repair: a turned blocker gets the turned box from its planes')
    planes = regions._split(bytes(tch.get(regions.SECTION).data))[1][0]
    quad, y0, y1 = regions.block_volume(planes)
    check(all(math.dist(a, b) < 1e-3 for a, b in zip(quad, turned[0])) and (y0, y1) == (0.0, 6.0), 'block_volume: the quad and heights it was written with')
    # Weather always clear: no rain to stop, so the regions go in without occluders.
    clear = regions.write_regions(original, [(box, regions.FLAG_INDOOR, 0.35)], occluders=False)
    check(len(regions.read_regions(clear)) == 1 and regions.occluder_bounds(clear) == [], 'always clear: the region without an occluder')
    # A box inserted into the list later (the quick upgrade's dry interiors) gets its occluder after the others.
    more = regions.insert(wide, [(box, regions.FLAG_INDOOR, 0.0)], 0, 'a test box')
    check(len(regions.occluder_bounds(more)) == 3 and regions.without_occluders(more) == [], 'insert: the new box gets an occluder too')
else:
    print('skip template round trip (set SR1_DATA_PACK to run it)')

print(f'\n{len(failures)} failure(s)' if failures else '\nall regions checks passed')
sys.exit(1 if failures else 0)

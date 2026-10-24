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
    check([n for n in before if before[n] != after[n]] == [regions.SECTION], 'only the region section changed')
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
else:
    print('skip template round trip (set SR1_DATA_PACK to run it)')

print(f'\n{len(failures)} failure(s)' if failures else '\nall regions checks passed')
sys.exit(1 if failures else 0)

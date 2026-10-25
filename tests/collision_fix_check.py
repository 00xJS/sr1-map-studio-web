"""Checks for py/collision_fix.py (invisible walls: sliver triangles out of the collision).

Run: py -3 tests/collision_fix_check.py
With SR1_MAPS (or the default install) it also takes the slivers out of every installed map: the collision reads
back without them, only the geometry section changes, the meshes stay drawn, and a second run finds none.
"""
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
import sr_reborn_core as rc  # noqa: E402
import collision_fix as cf  # noqa: E402

failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


# The test itself: straight-line corners are a sliver, a long thin strip that still has width (a railing) is not.
check(cf.is_sliver([(0, 0, 0), (3, 0, 0), (6.83, 0.0001, 0)]), 'three corners in a line are a sliver')
check(cf.is_sliver([(0, 0, 0), (0, 0, 0), (1, 1, 1)]), 'two corners in one place are a sliver')
check(not cf.is_sliver([(0, 0, 0), (2, 0, 0), (0, 0.02, 0)]), 'a 2 m railing strip 2 cm wide is not')
check(not cf.is_sliver([(0, 0, 0), (1, 0, 0), (0, 1, 0)]), 'an ordinary triangle is not')

maps = Path(os.environ.get('SR1_MAPS') or 'C:/Games/SaintsReborn/dist/maps')
if maps.is_dir():
    for chunk in sorted(maps.rglob('*.bbchunk_xbox2')):
        d = chunk.read_bytes()
        try:
            n0 = cf.count_slivers(rc.read_chunk(d))
            out, n = cf.drop_slivers(d)
        except Exception as exc:  # noqa: BLE001
            check(False, f'{chunk.parent.parent.name}: {exc}')
            continue
        left = cf.count_slivers(rc.read_chunk(out))
        again = cf.drop_slivers(out)[1]
        check(n == n0 and left == 0 and again == 0 and (n or out == d), f'{chunk.parent.parent.name}: {n0} invisible wall(s) out, none left, a second run finds none')
else:
    print('skip installed maps (set SR1_MAPS)')

print(f'\n{len(failures)} failure(s)')
sys.exit(1 if failures else 0)

"""Print a map's regions and rain occluders, in the order the chunk has them (game frame, metres).

    py -3 scripts/dump-regions.py <map folder | .bbchunk_xbox2 | map .zip> ...

For each region: its place in the list, flags (0x8 rain blocker, 0x3b indoor room, 0 the minimap's map-wide
region), box min and max, and whether a rain occluder has the same box. Then the occluders. A region that keeps
the rain out (flags 0x8 or 0x20) but has no occluder lets the falling rain through in game (py/regions.py).
"""
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
import regions  # noqa: E402

NAMES = {0x8: 'rain blocker', 0x3B: 'indoor room', 0: 'map-wide (minimap)'}


def chunks(arg):
    p = Path(arg)
    if p.suffix.lower() == '.zip':
        with zipfile.ZipFile(p) as z:
            for name in z.namelist():
                if name.lower().endswith('.bbchunk_xbox2'):
                    yield f'{p.name}/{name}', z.read(name)
    elif p.is_dir():
        for f in sorted(p.rglob('*.bbchunk_xbox2')):
            yield str(f), f.read_bytes()
    else:
        yield str(p), p.read_bytes()


def fmt(v):
    return '(' + ', '.join(f'{x:8.2f}' for x in v) + ')'


def dump(name, data):
    rs = regions.read_regions(data)
    occ = regions.occluder_bounds(data)
    leaky = {i for i, _, _ in regions.without_occluders(data)}
    print(f'== {name}: {len(rs)} region(s), {len(occ)} rain occluder(s)')
    for i, (lo, hi, f) in enumerate(rs):
        mark = '  NO OCCLUDER: rain falls through' if i in leaky else ''
        print(f'  [{i:2}] flags {f:#07x} {NAMES.get(f, ""):18} min {fmt(lo)} max {fmt(hi)}{mark}')
    for i, (lo, hi) in enumerate(occ):
        print(f'  occluder {i:2}  min {fmt(lo)} max {fmt(hi)}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for a in sys.argv[1:]:
        for name, data in chunks(a):
            dump(name, data)

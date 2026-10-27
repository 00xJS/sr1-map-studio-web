"""Checks for py/interiors.py (dry interiors: rain blockers over the floor under roofs and ceilings).

Run from web/:  py -3 tests/interiors_check.py   (needs numpy and Pillow)

Without anything set it finds the covered floor of made-up maps: a roofed
room on open ground, a solid block, a table, a two-storey house, an L-shaped
hall. With SR1_DATA_PACK set to an unpacked SR1 Map Studio desktop folder it
also exports a map with a roofed room through web_api.py, weather changing
each match and a minimap, and reads the chunk's regions back: the room's
rain blocker first, the minimap's map-wide region last. Everything is
written to a temporary folder.
"""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
import sr_reborn_core as rc  # noqa: E402
import fast_dxt  # noqa: E402
import interiors  # noqa: E402
import regions  # noqa: E402

fast_dxt.install()
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def box(x0, y0, z0, x1, y1, z1, faces='xXyYzZ'):
    """Triangles of a box, faces outwards (counter-clockwise seen from outside, as the game's ground faces up).
    `faces` picks the sides: x/X the -x/+x side, y/Y bottom/top, z/Z -z/+z."""
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    quads = {'x': (0, 1, 3, 2), 'X': (4, 6, 7, 5), 'y': (0, 4, 5, 1), 'Y': (2, 3, 7, 6), 'z': (0, 2, 6, 4), 'Z': (1, 5, 7, 3)}
    out = []
    for f in faces:
        a, b, c, d = quads[f]
        out += [(v[a], v[b], v[c]), (v[a], v[c], v[d])]
    return out


def room(x0, z0, x1, z1, y0, y1, wall=0.3, roof=0.3):
    """Four walls and a roof slab over x0..x1, z0..z1 from y0 to y1 (the floor is the ground)."""
    w = wall
    return (box(x0, y0, z0, x0 + w, y1, z1) + box(x1 - w, y0, z0, x1, y1, z1) + box(x0, y0, z0, x1, y1, z0 + w)
            + box(x0, y0, z1 - w, x1, y1, z1) + box(x0, y1, z0, x1, y1 + roof, z1))


def tri(parts):
    return np.array(parts, dtype=np.float64)


def inside(b, p):
    return all(b[0][a] <= p[a] <= b[1][a] for a in range(3))


ground = box(-40, -1, -40, 40, 0, 40, 'Y')

# Top faces up, roof undersides down: the made-up maps are wound like the game's.
t = tri(box(0, 0, 0, 1, 1, 1, 'Yy'))
n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
check(list(np.sign(n[:, 1])) == [1, 1, -1, -1], 'box faces wind outwards (top up, bottom down)')

# 1. A 10 x 8 m room with a 4 m roof on open ground: one box over it, a metre past its walls, floor to roof.
bx = interiors.boxes(tri(ground + room(0, 0, 10, 8, 0, 4)))
check(len(bx) == 1, f'a roofed room: one box ({len(bx)})')
if bx:
    (x0, y0, z0), (x1, y1, z1) = bx[0]
    check(inside(bx[0], (5, 1.7, 4)) and inside(bx[0], (0.5, 3.5, 0.5)) and inside(bx[0], (9.5, 0.2, 7.5)), 'the room is inside it')
    check(x0 >= -1.6 and x1 <= 11.6 and z0 >= -1.6 and z1 <= 9.6, f'and not much more ({x0:.1f}..{x1:.1f}, {z0:.1f}..{z1:.1f})')
    check(-1.5 <= y0 <= -0.5 and 4.0 <= y1 <= 4.6, f'from under the floor to just over the ceiling ({y0:.1f}..{y1:.1f}): a player on the roof is outside')
    check(not inside(bx[0], (20, 1.7, 20)), 'open ground stays out')

# 2. Open ground only, a solid 6 m block, a table, a small canopy: nothing.
block = box(10, 0, 10, 16, 6, 16)  # closed, its bottom on the ground
table = box(-5, 0.8, -5, -3, 0.9, -3)
canopy = box(-20, 3, -20, -18, 3.2, -18)
check(interiors.boxes(tri(ground)) == [], 'open ground: no boxes')
check(interiors.boxes(tri(ground + block)) == [], 'a solid block is not a room')
check(interiors.boxes(tri(ground + box(10, 0, 10, 16, 6, 16, 'xXYzZ'))) == [], 'nor one without a bottom (its top faces up)')
check(interiors.boxes(tri(ground + table + canopy)) == [], 'no room under a table; a canopy smaller than a room is left out')
check(interiors.boxes(tri(ground + box(-20, 50, -20, 20, 51, 20))) == [], 'a lid high over the map is sky, not a roof')

# 3. Two storeys: ground floor under the first floor's slab, first floor under the roof. Two boxes, one over the other.
house = room(0, 0, 12, 12, 0, 3.5) + room(0, 0, 12, 12, 3.8, 7)
bx = interiors.boxes(tri(ground + house))
check(len(bx) >= 1 and any(inside(b, (6, 1.5, 6)) for b in bx) and any(inside(b, (6, 5.5, 6)) for b in bx),
      f'two storeys: both floors kept dry ({len(bx)} box(es))')
check(not any(inside(b, (6, 8.8, 6)) for b in bx), 'and a player on the roof is outside')

# 4. An L-shaped hall: two boxes, the open corner left out.
hall = (box(0, 0, 0, 30, 5, 0.3) + box(0, 0, 0, 0.3, 5, 30) + box(10, 0, 10, 30, 5, 10.3) + box(10, 0, 10, 10.3, 5, 30)
        + box(30, 0, 0, 30.3, 5, 10) + box(0, 0, 30, 10, 5, 30.3) + box(0, 5, 0, 30, 5.3, 10) + box(0, 5, 10, 10, 5.3, 30))
bx = interiors.boxes(tri(ground + hall))
check(len(bx) == 2 and all(any(inside(b, p) for b in bx) for p in ((25, 2, 5), (5, 2, 25), (5, 2, 5)))
      and not any(inside(b, (20, 2, 20)) for b in bx), f'an L-shaped hall: two boxes, the open corner outside ({len(bx)})')

# 5. A tall hall beside a low room with a terrace on its roof: the terrace's open air stays out of the hall's box.
tall = room(0, 0, 20, 20, 0, 25) + room(20, 0, 40, 20, 0, 3)
bx = interiors.boxes(tri(ground + tall))
check(any(inside(b, (10, 20, 10)) for b in bx) and any(inside(b, (30, 1.5, 10)) for b in bx) and not any(inside(b, (30, 6, 10)) for b in bx),
      f'a tall hall beside a low room: the air over the low roof is outside ({len(bx)} box(es))')

# 6. The budget: many separate huts, at most that many boxes, the biggest kept.
huts = [p for k in range(12) for p in room(-38 + 12 * (k % 6), -30 + 15 * (k // 6), -33 + 12 * (k % 6) + k % 3, -25 + 15 * (k // 6), 0, 3)]
area = lambda b: (b[1][0] - b[0][0]) * (b[1][2] - b[0][2])  # noqa: E731
every = interiors.boxes(tri(ground + huts))
bx = interiors.boxes(tri(ground + huts), budget=5)
check(len(every) == 12 and len(bx) == 5 and sorted(map(area, bx)) == sorted(map(area, every))[-5:],
      f'a budget of 5 over 12 huts: the 5 biggest ({len(every)}, {len(bx)})')

# 7. As regions: a box as a volume reads back the same.
vol = interiors.volume(((1.0, 2.0, 3.0), (4.0, 5.0, 6.0)))
from map_features import volume_box  # noqa: E402
check(volume_box(vol) == ((1.0, 2.0, 3.0), (4.0, 5.0, 6.0)), 'a box as a region volume')


def obj(work, name, tris_):
    lines, k = ['vt 0 0', 'usemtl m'], 0
    for t_ in tris_:
        lines += [f'v {x} {y} {z}' for x, y, z in t_]
        lines.append(f'f {k + 1}/1 {k + 2}/1 {k + 3}/1')
        k += 3
    p = work / name
    p.write_text('\n'.join(lines) + '\n')
    return str(p)


def full_export(pack, tmp):
    import web_api
    studio = tmp / 'studio'
    for name in ('reference_beavercreek', 'native_glass', 'native_props'):
        shutil.copytree(pack / name, studio / name)
    web_api.STUDIO, web_api.WORK = studio, tmp / 'work'
    import sr1_native_glass
    import sr1_native_props
    sr1_native_glass.ASSETS, sr1_native_props.ASSETS = studio / 'native_glass', studio / 'native_props'
    work = tmp / 'files'
    work.mkdir()

    def tex(name, color):
        p = work / name
        Image.new('RGB', (64, 64), color).save(p)
        return str(p)

    # Editor units (two to the metre): 80 m of ground, a 12 x 10 m room with a 4.5 m roof at 10..22, 10..20 m.
    base = dict(rotation=[0, 0, 0], scale=1, alpha={}, physics_intent='Static', position=[0, 0, 0])
    items = [dict(base, name='Ground', path=obj(work, 'ground.obj', box(-80, -2, -80, 80, 0, 80, 'Y')), textures={'m': tex('g.png', (90, 90, 90))}),
             dict(base, name='Room', path=obj(work, 'room.obj', room(20, 20, 44, 40, 0, 9, 0.6, 0.6)), textures={'m': tex('r.png', (160, 120, 90))})]
    markers = [dict(type='Shared spawn', position=[x, 0.1, -20], yaw=0, label='') for x in (-6, -2, 2, 6)]

    def export(job, **kw):
        logs = []
        spec = dict(job=job, scene_items=items, markers=markers, lights=[], base_name='drytest', world_scale=0.5, mirror_x=True,
                    flip_obj_v=True, double_sided=False, minimap_texture=tex('mm.png', (200, 180, 60)), minimap_rect=[-80, -80, 80, 80], **kw)
        r = json.loads(web_api.export_project(json.dumps(spec), logs.append))
        check(r['ok'], f'export {job}: runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
        if not r['ok']:
            return [], None, logs
        chunk = (Path(r['value']['out_dir']) / 'drytest.bbchunk_xbox2').read_bytes()
        return regions.read_regions(chunk), r['value']['summary'], logs

    rs, summary, logs = export('dry', always_clear_weather=False, dry_interiors=True)
    print('      regions:', [(tuple(round(v, 1) for v in lo), tuple(round(v, 1) for v in hi), hex(f)) for lo, hi, f in rs])
    dry = [r for r in rs if r[2] == regions.FLAG_INDOOR]
    # The room is at x 10..22 in the editor; mirrored into the game frame it is at x -22..-10.
    centre = (-16.0, 2.0, 15.0)
    check(len(dry) == 1 and inside(dry[0][:2], centre) and not inside(dry[0][:2], (0.0, 2.0, -10.0)),
          f'export: one rain blocker over the roofed room, open ground outside it ({len(dry)})')
    check(len(rs) == 2 and rs[-1][2] == regions.MAP_REGION_FLAGS and inside(rs[-1][:2], centre),
          "export: the minimap's map-wide region stays last")
    check(summary and summary.get('dry_boxes') == 1 and any(line.startswith('Dry interiors: 1 box') for line in logs), 'export: summary and log say so')
    rs, summary, logs = export('clear', always_clear_weather=True, dry_interiors=False)
    check([r[2] for r in rs] == [regions.MAP_REGION_FLAGS] and summary and not summary.get('dry_boxes'), 'export: switched off, only the map region')


pack = os.environ.get('SR1_DATA_PACK')
if pack:
    chunk = Path(pack) / 'reference_beavercreek' / 'beavercreek.bbchunk_xbox2'
    original = chunk.read_bytes()
    # The insert the quick upgrade uses: new regions go in at a place, the ones there stay byte for byte.
    two = regions.with_map_region(regions.write_regions(original, [(interiors.volume(((0, 0, 0), (6, 4, 6))), 0x3B, 0.4)]), -80, 80, -80, 80, -50, 100)
    out = regions.insert(two, [(interiors.volume(((10, 0, 10), (20, 5, 20))), regions.FLAG_INDOOR, 0.0)], 1, 'a test box')
    got = regions.read_regions(out)
    check([f for _, _, f in got] == [0x3B, 0x8, 0] and got[1][:2] == ((10, 0, 10), (20, 5, 20)), 'insert: the new box between a room and the map region')
    before = {s.name: bytes(s.data) for s in rc.read_chunk(two).secs}
    after = {s.name: bytes(s.data) for s in rc.read_chunk(out).secs}
    check([k for k in before if before[k] != after[k]] == [regions.SECTION], 'insert: only the region section changed')
    # A box over the whole floor plan but not the map's height does not stand in for the map region.
    low = regions.write_regions(original, [(interiors.volume(((-90, -1, -90), (90, 5, 90))), regions.FLAG_INDOOR, 0.0)])
    check(regions.covered(low, -80, 80, -80, 80) and not regions.covered(low, -80, 80, -80, 80, -50, 100), 'covered: a low box is not the whole map')
    with tempfile.TemporaryDirectory() as t:
        full_export(Path(pack), Path(t))
else:
    print('skip template and export checks (set SR1_DATA_PACK to run them)')

print(f'\n{len(failures)} failure(s)' if failures else '\nall interiors checks passed')
sys.exit(1 if failures else 0)

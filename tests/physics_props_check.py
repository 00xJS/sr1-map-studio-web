"""Checks py/physics_props.py: hulls, mass properties, shape records and a full export with physics props.

Run from web/:  py -3 tests/physics_props_check.py   (needs numpy and Pillow)

With SR1_DATA_PACK set to an unpacked SR1 Map Studio desktop folder (the one
holding reference_beavercreek/, native_glass/, native_props/), it also parses
the bundled collision-shape bank and runs a full export of a scene with more
than 32 physics props of every shape, then re-reads the map it wrote.
Nothing from the data pack is written outside a temporary folder.
"""
import json
import math
import os
import random
import shutil
import struct
import sys
import tempfile
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
import physics_props as pp  # noqa: E402  (first, like web_api)
import sr_reborn_core as rc  # noqa: E402
import fast_dxt  # noqa: E402

fast_dxt.install()
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def close(a, b, tol=1e-4):
    return abs(a - b) <= tol


def units():
    # A 2 x 4 x 6 box: 8 corners, 6 sides, the textbook spread of mass.
    corners, tris = pp.convex_hull(pp.box_points((-1, -2, -3), (1, 2, 3)))
    planes, _ = pp.hull_planes(corners, tris)
    check((len(corners), len(tris), len(planes)) == (8, 12, 6), 'box hull: 8 corners, 12 triangles, 6 sides')
    vol, com, inertia = pp.mass_properties(corners, tris)
    check(close(vol, 48) and all(close(c, 0) for c in com), 'box hull: volume 48 at the origin')
    want = [(4 + 9) / 3, (1 + 9) / 3, (1 + 4) / 3]
    check(all(close(inertia[i][i], want[i]) for i in range(3)) and close(inertia[0][1], 0), 'box hull: inertia per unit mass = (h1^2 + h2^2) / 3')

    # Random points on a ball: at most 64 corners, every point inside the hull.
    rnd = random.Random(1)
    pts = []
    for _ in range(3000):
        v = [rnd.gauss(0, 1) for _ in range(3)]
        n = math.sqrt(sum(x * x for x in v))
        pts.append(tuple(2 * x / n for x in v))
    hull = pp.simplified_hull(pts)
    full = pp.convex_hull(pts[:300])  # under 400 points: no simplifying
    check(hull is not None and len(hull[0]) <= 64, 'ball of 3000 points: simplified to %d corners' % len(hull[0]))
    planes, _ = pp.hull_planes(*full)
    check(all(max(pp._dot(n, p) + d for p in pts[:300]) < 1e-5 for n, d in planes), 'full hull holds every point')
    vol = pp.mass_properties(*hull)[0]
    check(0.8 * 4 / 3 * math.pi * 8 < vol < 4 / 3 * math.pi * 8, 'simplified ball hull keeps most of the volume (%.2f)' % vol)

    # Cylinder: round across the two equal sides.
    lo, hi = (-1, -0.4, -1), (1, 0.4, 1)
    check(pp.cylinder_axis(lo, hi) == 1, 'tire lying flat: cylinder runs along Y')
    check(pp.cylinder_axis((-0.3, -1, -1), (0.3, 1, 1)) == 0, 'tire standing up: cylinder runs along X')
    corners, tris = pp.convex_hull(pp.cylinder_points(lo, hi))
    planes, _ = pp.hull_planes(corners, tris)
    check(len(corners) == 32 and len(planes) == 18, 'cylinder hull: 32 corners, 16 sides and 2 caps')

    # Shrinking for the engine's rounded corners.
    s = pp.shrink(pp.box_points((0, 0, 0), (1, 1, 1)))
    lo2, hi2 = pp._bounds(s)
    check(close(lo2[0], 0.05) and close(hi2[1], 0.95), 'hull shrunk by 0.05 on every side')
    s = pp.shrink(pp.box_points((0, 0, 0), (0.06, 1, 1)))
    lo2, hi2 = pp._bounds(s)
    check(close(hi2[0] - lo2[0], 0.024), 'thin sides keep 40% of their size')

    # Records parse back.
    rec, what = pp.build_shape('sphere', pp.box_points((-1, -1, -1), (1, 1, 1)), [])
    check(len(rec) == 104 and 'radius 1.73' in what, 'ball record: 104 bytes, radius around the corners')
    verts = pp.box_points((0, 0, 0), (1, 1, 1)) + pp.box_points((3, 0, 0), (4, 1, 1))
    faces = [(a + o, b + o, c + o) for o in (0, 8) for a, b, c in ((0, 1, 2), (1, 3, 2), (4, 5, 6), (5, 7, 6), (0, 4, 1), (2, 6, 3))]
    check(len(pp.components(verts, faces)) == 2, 'two separate boxes are two pieces')
    rec2, what2 = pp.build_shape('parts', verts, faces, bottom_heavy=True)
    check('2 part(s)' in what2 and 'bottom-heavy' in what2, 'parts shape: ' + what2)
    com = struct.unpack_from('>3f', rec2, len(rec2) - 12)
    check(close(com[0], 2, 1e-3) and close(com[1], 0.5 - 0.6 * 0.5, 1e-3), 'parts: centre of mass between them, lowered %s' % (com,))
    bank = b'HKCM' + struct.pack('>3I', 3, 16, 0)
    bank2, index = pp.append_shapes(bank, [rec, rec2, rec])
    check(index == [0, 1, 0] and [r[2] for r in pp.parse_bank(bank2)] == [[1], [2, 2]], 'bank: identical shapes shared, records parse back')
    check(len(pp.merge_pieces([[(i, 0, 0), (i + .5, 1, 1)] for i in range(20)])) == 15, 'twenty pieces merged down to 15')


def obj_text(verts, faces, mat):
    lines = [f'v {x} {y} {z}' for x, y, z in verts] + ['vt 0 0', 'vt 1 0', 'vt 1 1', 'usemtl ' + mat]
    lines += [f'f {a + 1}/1 {b + 1}/2 {c + 1}/3' for a, b, c in faces]
    return '\n'.join(lines) + '\n'


def box_mesh(lo, hi, base=0):
    v = pp.box_points(lo, hi)
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (1, 5, 7, 3), (0, 2, 6, 4)]
    return v, [t for q in quads for t in ((q[0] + base, q[1] + base, q[2] + base), (q[0] + base, q[2] + base, q[3] + base))]


def ball_mesh(r, n=12):
    v = [(0, 2 * r, 0), (0, 0, 0)]
    for i in range(1, n):
        a = math.pi * i / n
        for j in range(2 * n):
            b = math.pi * j / n
            v.append((r * math.sin(a) * math.cos(b), r + r * math.cos(a), r * math.sin(a) * math.sin(b)))
    f = []
    for j in range(2 * n):
        f.append((0, 2 + (j + 1) % (2 * n), 2 + j))
    for i in range(n - 2):
        for j in range(2 * n):
            a, b = 2 + i * 2 * n + j, 2 + i * 2 * n + (j + 1) % (2 * n)
            f += [(a, b, b + 2 * n), (a, b + 2 * n, a + 2 * n)]
    last = 2 + (n - 2) * 2 * n
    for j in range(2 * n):
        f.append((1, last + j, last + (j + 1) % (2 * n)))
    return v, f


def full_export(pack, tmp):
    import web_api
    import sr1_native_glass
    import sr1_native_props
    studio = tmp / 'studio'
    for name in ('reference_beavercreek', 'native_glass', 'native_props'):
        shutil.copytree(pack / name, studio / name)
    web_api.STUDIO, web_api.WORK = studio, tmp / 'work'
    sr1_native_glass.ASSETS, sr1_native_props.ASSETS = studio / 'native_glass', studio / 'native_props'
    work = tmp / 'files'
    work.mkdir()

    donor = rc.read_chunk((studio / 'native_glass' / 'prefab.bbchunk_xbox2').read_bytes()).get('block556').data
    shapes = pp.parse_bank(donor)
    check(len(shapes) == 37, 'bundled glass shape bank parses to its exact end (%d shapes, types %s)' % (len(shapes), sorted({t for s in shapes for t in s[2]})))

    def obj(name, mesh, mat='m'):
        p = work / name
        p.write_text(obj_text(*mesh, mat))
        return str(p)

    tex = work / 't.png'
    Image.new('RGB', (64, 64), (150, 100, 50)).save(tex)
    base = dict(rotation=[0, 0, 0], scale=1, alpha={}, physics_intent='Static')
    ground = obj('ground.obj', box_mesh((-40, -2, -40), (40, 0, 40)), 'g')
    items = [dict(base, name='Ground', path=ground, position=[0, 0, 0], textures={'g': str(tex)})]

    def prop(name, path, behaviour, at, **extra):
        it = dict(base, name=name, path=path, position=at, textures={'m': str(tex)})
        r = json.loads(web_api.scene_op('native_prop', json.dumps({'item': it, 'behavior': behaviour, 'world_scale': 0.5, 'others': []})))
        check(r['ok'], 'make prop ' + name + ('' if r['ok'] else ': ' + r['error']))
        v = r['value']
        v.update(extra)
        items.append(v)

    lv, lf = box_mesh((0, 0, 0), (1, 1, 1))
    lv2, lf2 = box_mesh((2, 0, 0), (3, 1, 1), base=8)
    tire_v, tire_f = ball_mesh(1)  # any round mesh will do for the cylinder fit
    prop('Ball', obj('ball.obj', ball_mesh(0.6)), 'movable', [0, 0, 5], native_profile='Red Ball', physics_shape='sphere')
    prop('Tire', obj('tire.obj', ([(x, y * 0.4, z) for x, y, z in tire_v], tire_f)), 'movable', [4, 0, 5], native_profile='Tire', physics_shape='cylinder')
    prop('Rock', obj('rock.obj', ball_mesh(1.2, 20)), 'movable', [8, 0, 5], native_profile='Log Timber', physics_shape='hull')
    prop('Pair', obj('pair.obj', (lv + lv2, lf + lf2)), 'movable', [12, 0, 5], native_profile='CableSpool', physics_shape='parts')
    prop('Weeble', obj('weeble.obj', box_mesh((-0.5, 0, -0.5), (0.5, 2, 0.5))), 'movable', [16, 0, 5], physics_bottom_heavy=True)
    prop('Tank', obj('tank.obj', ([(x * 0.5, y, z * 0.5) for x, y, z in tire_v], tire_f)), 'explosive', [20, 0, 5], physics_shape='cylinder')
    crate = obj('crate.obj', box_mesh((-1, 0, -1), (1, 2, 1)))
    for i in range(34):
        prop(f'Crate {i}', crate, 'movable', [-30 + (i % 10) * 2.5, 0, -10 - (i // 10) * 2.5], native_profile='Can' if i == 0 else None)
    markers = [dict(type='Shared spawn', position=[x, 0.1, 0], yaw=0, label='') for x in (-4, -2, 2, 4)]
    spec = dict(job='p', scene_items=items, markers=markers, lights=[], base_name='pptest', world_scale=0.5, mirror_x=True,
                flip_obj_v=True, double_sided=False, ptp=False)
    logs = []
    r = json.loads(web_api.export_project(json.dumps(spec), logs.append))
    check(r['ok'], 'export with 40 physics props runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
    if not r['ok']:
        return
    check(r['value']['summary']['native_props'] == 40, 'export: 40 props, over the old 32-object budget')
    ch = rc.read_chunk((Path(r['value']['out_dir']) / 'pptest.bbchunk_xbox2').read_bytes())
    bank = ch.get('block556').data
    shapes = pp.parse_bank(bank)
    recs, db = ch.get('static_records').data, ch.get('rec_blob308').data
    count = rc.U32(ch.header, 868)
    names = bytes(recs[80 * count:]).split(b'\0')[:count]
    by_name = {}
    for i in range(count):
        if rc.U32(recs, i * 80 + 32) & 0x20000:
            start = 4 + rc.U32(recs, i * 80 + 64)
            by_name[names[i].decode()] = (bytes(db[start:db.index(0, start)]).decode(), rc.U16(recs, i * 80 + 56))
    props = [by_name[k] for k in sorted(by_name)]
    check(len(props) == 40, 'export: 40 prop records')
    kinds = [shapes[s][2] for _, s in props[:6]]
    profiles = [p for p, _ in props[:6]]
    check(kinds == [[1], [2], [2], [2, 2], [2], [2]], 'export: ball, cylinder, hull, two parts, box, cylinder shapes %s' % kinds)
    check(profiles == ['Red Ball', 'Tire', 'Log Timber', 'CableSpool', 'Crate Small', 'Propanesmall'], 'export: stock profiles %s' % profiles)
    off, size, _ = shapes[props[4][1]]
    com = struct.unpack_from('>3f', bank, off + size - 12)
    check(com[1] < 0.3, 'export: bottom-heavy prop has a low centre of mass %s' % (com,))
    tank = shapes[props[5][1]]
    corners = pp.parse_hull_corners(bank[tank[0] + 20 + 12:tank[0] + tank[1]])
    lo, hi = pp._bounds(corners)
    check(len(corners) == 32 and hi[1] - lo[1] > 0.85 and hi[0] - lo[0] < 0.55, 'export: propane tank cylinder stands up, %d corners' % len(corners))
    check(sum(1 for p, _ in props if p == 'Can') == 1, 'export: a crate with a breaking profile')
    print('\n'.join('     log: ' + l for l in logs if 'Physics props' in l))


units()
pack = os.environ.get('SR1_DATA_PACK')
if pack:
    with tempfile.TemporaryDirectory() as t:
        full_export(Path(pack), Path(t))
else:
    print('skip full export (set SR1_DATA_PACK to run it)')

print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)

"""Checks py/map_features.py: water volume bytes, the loading screen PEG, CTS includes.

Run from web/:  py -3 tests/map_features_check.py   (needs numpy and Pillow)

With SR1_DATA_PACK set to an unpacked SR1 Map Studio desktop folder (the one
holding reference_beavercreek/, native_glass/, native_props/), it also runs a
full export of a small test scene through web_api.py with water, a breakable,
a loading screen and a background sound, and re-reads the files it wrote.
Nothing from the data pack is written outside a temporary folder.
"""
import io
import json
import os
import shutil
import struct
import sys
import tempfile
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
import sr_reborn_core as rc  # noqa: E402
import peg_xbox2_beaver as peg  # noqa: E402
import fast_dxt  # noqa: E402
import map_features as mf  # noqa: E402

fast_dxt.install()
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def inside(planes, nodes, p):
    """The game's point-in-water walk over one volume's plane chain."""
    k = 0
    while True:
        plane, neg, pos = nodes[k]
        nx, ny, nz, d = planes[plane]
        positive = nx * p[0] + ny * p[1] + nz * p[2] + d >= -1e-4
        nxt = pos if positive else neg
        if nxt == 0:
            return positive
        k = nxt


def water_bytes():
    import math
    turn = math.radians(30)
    rect = [(-3, -2), (-3, 2), (3, 2), (3, -2)]
    turned = [(5 + x * math.cos(turn) - z * math.sin(turn), 8 + x * math.sin(turn) + z * math.cos(turn)) for x, z in rect]
    volumes = [mf.box_volume((-5.0, -2.0, 3.0), (7.5, 0.25, 9.0)), mf.box_volume((10.0, 1.0, -4.0), (12.0, 3.5, -1.0)),
               (turned, -1.0, 1.0), (turned[::-1], -1.0, 1.0)]
    n = len(volumes)
    tests, meshes, trees = mf.water_sections(volumes)
    check(struct.unpack_from('>II', tests, 0) == (4 + 148 * n, n), 'water: test section size and count')
    check(len(tests) == 8 + 148 * n, 'water: 148 bytes per volume')
    ch = rc.Chunk(bytearray(968), [rc.Section('list372', 64, bytearray(tests)), rc.Section('rec40_380', 64, bytearray(meshes)),
                                   rc.Section('blobs384', 64, bytearray(trees))])
    got = mf.read_water(ch)
    want = [mf.volume_box(v) for v in volumes]
    check(all(abs(a - b) < 1e-5 for (lo, hi), (glo, ghi) in zip(want, got) for a, b in zip(lo + hi, glo + ghi)), 'water: bounds read back')
    check(abs(got[0][1][1] - 0.25) < 1e-6, 'water: surface is the top of the volume')
    # Plane chains: the centre is inside; just past any side, above or below is outside.
    c = 8
    for quad, y0, y1 in volumes:
        npl, nn = struct.unpack_from('>II', tests, c)
        planes = [struct.unpack_from('>4f', tests, c + 16 + 16 * i) for i in range(npl)]
        nodes = [struct.unpack_from('>3H', tests, c + 16 + 16 * npl + 6 * i) for i in range(nn)]
        cx, cz = sum(p[0] for p in quad) / 4, sum(p[1] for p in quad) / 4
        ym = (y0 + y1) / 2
        check(inside(planes, nodes, (cx, ym, cz)), 'water: centre is inside')
        check(not inside(planes, nodes, (cx, y1 + 0.1, cz)) and not inside(planes, nodes, (cx, y0 - 0.1, cz)), 'water: above and below are outside')
        for i in range(4):
            (ax, az), (bx, bz) = quad[i], quad[(i + 1) % 4]
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            ox, oz = mx - cx, mz - cz
            k = 0.1 / math.hypot(ox, oz)
            check(inside(planes, nodes, (mx - ox * k, ym, mz - oz * k)) and not inside(planes, nodes, (mx + ox * k, ym, mz + oz * k)),
                  f'water: side {i} is the edge of the water')
        c += 16 + 16 * npl + 6 * nn
    # Mesh: 16-aligned corners, triangles wound like the game's own boxes.
    c = 4
    for _ in volumes:
        c = rc.Al(c, 4)
        nv, nt = rc.U16(meshes, c + 24), rc.U16(meshes, c + 32)
        v0 = rc.Al(c + 40, 16)
        V = [struct.unpack_from('>4f', meshes, v0 + 16 * i)[:3] for i in range(nv)]
        T = [struct.unpack_from('>3H', meshes, v0 + 16 * nv + 6 * i) for i in range(nt)]
        cen = [sum(p[a] for p in V) / nv for a in range(3)]
        inward = 0
        for t in T:
            A, B, C = (V[k] for k in t)
            u = [B[a] - A[a] for a in range(3)]; w = [C[a] - A[a] for a in range(3)]
            nrm = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
            o = [(A[a] + B[a] + C[a]) / 3 - cen[a] for a in range(3)]
            inward += sum(nrm[a] * o[a] for a in range(3)) < 0
        check((v0 % 16, nv, nt, inward) == (0, 8, 12, 12), 'water: 8 aligned corners, 12 triangles, all wound inward')
        c = v0 + 16 * nv + 6 * nt
    # Collision trees: one per volume, every triangle reachable.
    c = 0
    for _ in volumes:
        c = rc.Al(c, 4)
        size = rc.U32(trees, c)
        blob = trees[c + 4:c + 4 + size]
        code_len = rc.U32(blob, 24)
        check(blob[:4] == b'PPOM' and sorted(rc.mopp_keys(blob[28:28 + code_len])) == list(range(12)), 'water: collision tree has keys 0-11')
        c += 4 + size
    check(c == len(trees), 'water: collision trees fill their section')


def loading_screen(tmp):
    src = tmp / 'shot.png'
    Image.new('RGB', (1000, 1000), (40, 120, 200)).save(src)
    png = mf.fit_image(src, tmp / 'fit.png')
    with Image.open(png) as im:
        check(im.size == (1280, 720), 'loading: picture cropped and resized to 1280x720')
    data = mf.loading_peg(png, 'mymap')
    check(len(data) == 0x1000 + 491520, 'loading: file is 495,616 bytes like the game\'s own')
    out = tmp / 'ld.peg_xbox2'; out.write_bytes(data)
    _, h, entries = peg.parse_peg(out)
    e = entries[0]
    check((h.version, h.platform, h.dir_size, h.count, h.total_entries, h.alignment) == (8, 3, 0x60, 1, 1, 16), 'loading: header')
    check((e.data_offset, e.width, e.height, e.fmt, e.frame_size, e.name) == (0x1000, 1280, 720, 0x190, 0x78000, 'ld-mymap.tga'), 'loading: entry')
    check(mf.loading_name('abcdefghijklmnop') == 'ld-abcdefghijklm', 'loading: long names cut to what the game reads')


def includes():
    cts = '// -------\r\n#Includes\r\n// -------\r\n\r\n// -------\r\n#Groups\r\n// -------\r\n'
    out = mf.add_include(cts, 'amb_mp_arena')
    check(out.split('\r\n')[3] == '$Include: "amb_mp_arena.cts"', 'cts: include goes under the #Includes heading')
    check('\n' not in out.replace('\r\n', ''), 'cts: line endings kept')
    check(mf.add_include(out, 'amb_mp_arena') == out, 'cts: include not added twice')
    check(mf.add_include('#Groups\n', 'amb_mp_arena').startswith('// -------\n#Includes'), 'cts: #Includes block made when missing')


def full_export(pack, tmp):
    """A real export through web_api with every new feature switched on."""
    import web_api
    studio = tmp / 'studio'
    for name in ('reference_beavercreek', 'native_glass', 'native_props'):
        shutil.copytree(pack / name, studio / name)
    web_api.STUDIO, web_api.WORK = studio, tmp / 'work'
    import sr1_native_glass, sr1_native_props
    sr1_native_glass.ASSETS, sr1_native_props.ASSETS = studio / 'native_glass', studio / 'native_props'
    work = tmp / 'files'; work.mkdir()

    def obj_box(name, sx, sy, sz, mats):
        """A box OBJ; mats = material per face pair (6 sides)."""
        v = [(x * sx, y * sy, z * sz) for x in (-.5, .5) for y in (0, 1) for z in (-.5, .5)]
        quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (1, 5, 7, 3), (0, 2, 6, 4)]
        lines = [f'v {a} {b} {c}' for a, b, c in v] + ['vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1']
        for q, m in zip(quads, mats):
            lines += [f'usemtl {m}', f'f {q[0]+1}/1 {q[1]+1}/2 {q[2]+1}/3', f'f {q[0]+1}/1 {q[2]+1}/3 {q[3]+1}/4']
        p = work / name; p.write_text('\n'.join(lines) + '\n'); return str(p)

    def tex(name, color):
        p = work / name; Image.new('RGB', (64, 64), color).save(p); return str(p)

    ground = obj_box('ground.obj', 80, 2, 80, ['g'] * 6)
    pool = obj_box('pool.obj', 12, 3, 8, ['wall', 'wall', 'wall', 'water', 'wall', 'wall'])
    water = obj_box('water.obj', 6, 2, 6, ['w'] * 6)
    crate = obj_box('crate.obj', 2, 2, 2, ['c'] * 6)
    shot = tex('shot.png', (200, 80, 40))
    base = dict(rotation=[0, 0, 0], scale=1, alpha={}, physics_intent='Static')
    items = [
        dict(base, name='Ground', path=ground, position=[0, -2, 0], textures={'g': tex('g.png', (90, 90, 90))}),
        dict(base, name='Pool', path=pool, position=[20, 0, 0], textures={'wall': tex('wall.png', (200, 200, 200)), 'water': tex('pw.png', (30, 90, 160))},
             swimmable_water=True, water_materials=['water']),
        dict(base, name='Water', path=water, position=[-20, 0, 0], textures={'w': tex('w.png', (30, 90, 160))}, swimmable_water=True),
        dict(base, name='Turned water', path=water, position=[0, 0, -20], rotation=[0, 45, 0], textures={'w': tex('w.png', (30, 90, 160))}, swimmable_water=True),
    ]
    # A breakable-wood crate the way the editor's "convert_breakable" makes it.
    crate_item = dict(base, name='Crate', path=crate, position=[0, 0, 10], textures={'c': tex('c.png', (150, 100, 50))})
    wood = json.loads(web_api.scene_op('convert_breakable', json.dumps({'item': crate_item, 'render_mode': 'wood', 'world_scale': 0.5, 'others': []})))
    check(wood['ok'], 'export: breakable wood conversion')
    wood = wood['value']; wood['native_profile'] = 'SofaPillow'
    items.append(wood)
    markers = [dict(type='Shared spawn', position=[x, 0.1, 0], yaw=0, label='') for x in (-4, -2, 2, 4)]
    spec = dict(job='t', scene_items=items, markers=markers, lights=[], base_name='mftest', world_scale=0.5, mirror_x=True,
                flip_obj_v=True, double_sided=False, ambience='amb_mp_arena', loading_image=shot, ptp=False)
    logs = []
    r = json.loads(web_api.export_project(json.dumps(spec), logs.append))
    check(r['ok'], 'export: runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
    if not r['ok']:
        return
    out = Path(r['value']['out_dir'])
    ch = rc.read_chunk((out / 'mftest.bbchunk_xbox2').read_bytes())
    boxes = mf.read_water(ch)
    check(len(boxes) == 3 and r['value']['summary']['water_volumes'] == 3, 'export: three water volumes in the map chunk')
    turned = boxes[2]
    check(abs((turned[1][0] - turned[0][0]) - 3 * 2 ** 0.5) < 1e-3, 'export: water turned 45 degrees spans its diagonal')
    boxes = boxes[:2]
    # Heights are measured from the bottom of the base map (2 units below 0), 1 unit = 0.5 m:
    # the pool's water face is its top at 3 units, the water box's top is at 2 units.
    tops = sorted(round(hi[1], 3) for lo, hi in boxes)
    check(tops == [2.0, 2.5], 'export: water surfaces at the top of each water part ' + str(tops))
    depth = sorted(round(hi[1] - lo[1], 3) for lo, hi in boxes)
    check(depth == [2.0, 2.0], 'export: water at least 2 m deep ' + str(depth))
    # Ground 12 + pool walls 10 (its 2 water triangles excluded); the water box has none.
    check(r['value']['summary']['collision_triangles'] == 22, 'export: water has no collision, walls keep theirs')
    recs, db = ch.get('static_records').data, ch.get('rec_blob308').data
    names = [bytes(db[4 + rc.U32(recs, i * 80 + 64):db.index(0, 4 + rc.U32(recs, i * 80 + 64))]) for i in range(rc.U32(ch.header, 868))
             if rc.U32(recs, i * 80 + 32) & 0x20000]
    check(names == [b'SofaPillow'] and all(rc.U32(recs, i * 80 + 32) != 0x10021400 for i in range(rc.U32(ch.header, 868))),
          'export: breakable wood uses a non-glass record with its chosen profile ' + str(names))
    cts = (out / 'mftest.cts').read_bytes().decode()
    check('$Include: "amb_mp_arena.cts"' in cts and '\r\n' in cts, 'export: background sound include in the CTS')
    _, _, e = peg.parse_peg(out / 'ld-mftest.peg_xbox2')
    check((e[0].width, e[0].height, e[0].name) == (1280, 720, 'ld-mftest.tga'), 'export: loading screen written')
    _, _, pe = peg.parse_peg(out / 'mftest.peg_xbox2')
    check(rc.chunk_strings(ch) == [x.name for x in pe], 'export: chunk textures still match the PEG')
    check(any(x.name.endswith('_wa.tga') and x.fmt == peg.FMT_DXT5 for x in pe), 'export: see-through water texture with the water suffix')
    print('\n'.join('     log: ' + l for l in logs if any(k in l for k in ('Water', 'Breakables', 'Loading', 'Background'))))


with tempfile.TemporaryDirectory() as t:
    tmp = Path(t)
    water_bytes()
    loading_screen(tmp)
    includes()
    pack = os.environ.get('SR1_DATA_PACK')
    if pack:
        full_export(Path(pack), tmp)
    else:
        print('skip full export (set SR1_DATA_PACK to run it)')

print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)

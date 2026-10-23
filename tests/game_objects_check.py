"""Checks that an object from the "From my game" library survives the exporter: placed in a map, it comes out of
the Python exporter at the right place and size, with its triangles facing the same way as in the game.

Run from web/, after the vitest real-install test has written the object (no game file is kept in the repo):

    SR1_GAME_OBJECT_OUT=<tmp> npx vitest run tests/gameObjects.test.ts
    SR1_GAME_OBJECT_OUT=<tmp> SR1_DATA_PACK=<unpacked SR1 Map Studio folder> py -3 tests/game_objects_check.py

The object is the most used physics prop in the player's own city chunks, cut out and written as the OBJ the
editor stores (tests/gameObjects.test.ts). Everything else is written to a temporary folder.
"""
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
import sr1_cts  # noqa: E402
import fast_dxt  # noqa: E402

fast_dxt.install()
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def strips(ch):
    """Every triangle of an exported chunk as three rounded positions, wound as the game decodes them."""
    g = rc.chunk_geometry(ch)
    out = []
    for mesh in g.meshes:
        for sub in mesh.subs:
            if len(sub.s16) < 12:
                continue
            vb = g.vbs[rc.U32(sub.s16, 8)]
            stride, count = rc.U16(vb.desc, 16), rc.U16(vb.desc, 12)
            if stride < 12 or len(vb.vd) < stride * count:
                continue
            pos = [struct.unpack_from('>fff', vb.vd, i * stride) for i in range(count)]
            ids = [rc.U16(vb.ib, j) for j in range(0, len(vb.ib) - 1, 2)]
            for b in range(rc.U16(sub.s16, 2)):
                first, num = rc.U32(sub.b16, 8 * b), rc.U16(sub.b16, 8 * b + 4)
                for k in range(num - 2):
                    a, bb, c = ids[first + k:first + k + 3]
                    if len({a, bb, c}) < 3 or max(a, bb, c) >= count:
                        continue
                    if k & 1:
                        a, bb = bb, a
                    out.append(tuple(tuple(round(v, 2) for v in pos[i]) for i in (a, bb, c)))
    return out


def run(pack, obj_dir, tmp):
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
    info = json.loads((obj_dir / 'object.json').read_text())
    ws = info['ws']
    shutil.copy(obj_dir / 'object.obj', work / 'object.obj')
    textures = {}
    for i, m in enumerate(info['materials']):
        Image.new('RGB', (32, 32), (40 * i % 255, 120, 90)).save(work / f'{m}.png')
        textures[m] = str(work / f'{m}.png')
    Image.new('RGB', (32, 32), (90, 90, 90)).save(work / 'g.png')
    ground = work / 'ground.obj'
    ground.write_text('v -40 -2 -40\nv 40 -2 -40\nv 40 -2 40\nv -40 -2 40\nvt 0 0\nusemtl g\nf 1/1 3/1 2/1\nf 1/1 4/1 3/1\n')
    base = dict(rotation=[0, 0, 0], scale=1, alpha={}, physics_intent='Static')
    at = [10.0, -2.0, 5.0]
    items = [dict(base, name='Ground', path=str(ground), position=[0, 0, 0], textures={'g': str(work / 'g.png')}),
             dict(base, name='From the game', path=str(work / 'object.obj'), position=at, textures=textures,
                  game_object=dict(source='game', pack='p', chunk='c', record=0, id='x', ws=ws))]
    markers = [dict(type='Shared spawn', position=[0, 0, 0], yaw=0, label=''),
               dict(type='Item prop', position=[3, 0, 3], yaw=45, label='', item='some_item')]
    spec = dict(job='go', scene_items=items, markers=markers, lights=[], base_name='gotest', world_scale=ws, mirror_x=True, flip_obj_v=True, double_sided=False)
    logs = []
    r = json.loads(web_api.export_project(json.dumps(spec), logs.append))
    check(r['ok'], 'export runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
    if not r['ok']:
        return
    out = Path(r['value']['out_dir'])
    ch = rc.read_chunk((out / 'gotest.bbchunk_xbox2').read_bytes())
    tris = strips(ch)
    origin = web_api._base_origin(items)
    p, t = info['positions'], info['triangles']

    def game(i):
        # Where the editor puts vertex i (as place.ts writes it), converted the way the exporter converts.
        editor = (-p[3 * i] / ws + at[0], p[3 * i + 1] / ws + at[1], p[3 * i + 2] / ws + at[2])
        return tuple(round(v, 2) for v in sr1_cts.convert_xyz(editor, ws, True, origin))

    exported = {}
    for tri in tris:
        for k in range(3):
            exported[tri[k:] + tri[:k]] = True
    same = flipped = missing = 0
    for j in range(0, len(t), 3):
        a, b, c = game(t[j]), game(t[j + 1]), game(t[j + 2])
        if (a, b, c) in exported:
            same += 1
        elif (a, c, b) in exported:
            flipped += 1
        else:
            missing += 1
    n = len(t) // 3
    print(f'   {n} triangles: {same} as in the game, {flipped} turned over, {missing} not found')
    check(same >= 0.95 * n, 'the object\'s triangles come out where and as the game has them')
    check(flipped == 0, 'no triangle is turned over')
    # Size: the object's height in game metres equals its height in the library.
    ys = [p[3 * i + 1] for i in range(len(p) // 3)]
    gy = [game(i)[1] for i in range(len(p) // 3)]
    check(abs((max(gy) - min(gy)) - (max(ys) - min(ys))) < 0.02, 'exported at the game\'s own size')
    cts = (out / 'gotest.cts').read_bytes().decode('utf-8-sig')
    check('$Item type:\t"some_item"' in cts, 'the item prop marker is written to the CTS #Items')
    check(cts.count('$Navpoint:') >= 2, 'the item prop has its navpoint')


pack = os.environ.get('SR1_DATA_PACK')
obj_dir = os.environ.get('SR1_GAME_OBJECT_OUT')
if not pack or not obj_dir or not (Path(obj_dir) / 'object.json').is_file():
    print('skip (set SR1_DATA_PACK, and SR1_GAME_OBJECT_OUT to a folder the vitest real-install test wrote)')
    sys.exit(0)
with tempfile.TemporaryDirectory() as d:
    run(Path(pack), Path(obj_dir), Path(d))
print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)

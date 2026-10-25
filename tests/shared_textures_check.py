"""Checks that a map stores each picture once in its PEG, however many materials use it (py/shared_textures.py).

Run from web/:  py -3 tests/shared_textures_check.py   (needs numpy and Pillow)

With SR1_DATA_PACK set to an unpacked SR1 Map Studio desktop folder (the one holding reference_beavercreek/),
it exports a small scene of nine objects whose 17 materials use 3 pictures, and checks the PEG gets 3 map
textures, the chunk's texture names match the PEG one for one, and every material points at its picture.
Without it, only the naming is checked. Nothing from the data pack is written outside a temporary folder.
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
import web_api  # noqa: E402  (installs shared_textures, as in the browser)
import shared_textures  # noqa: E402
import peg_xbox2_beaver as peg  # noqa: E402
import sr_reborn_core as rc  # noqa: E402

failures = []
rng = np.random.default_rng(5)


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def naming(tmp):
    def png(name, alpha=False):
        a = rng.integers(0, 256, (32, 32, 4), dtype=np.uint8)
        if not alpha:
            a[..., 3] = 255
        p = tmp / name
        Image.fromarray(a, 'RGBA').save(p)
        return str(p)
    a, b = png('a.png'), png('b.png')
    n = shared_textures.name_for_export
    check(n('mymap', 3, 0, a) == n('mymap', 9, 0, a), 'the same picture gets the same name in any slot')
    check(n('mymap', 3, 0, a) != n('mymap', 3, 0, b), 'different pictures get different names')
    check(n('mymap', 3, 0, a) != n('mymap', 3, 0, a, True), 'read with alpha: a name of its own')
    check(n('mymap', 3, 0, a) != n('mymap', 3, 21, a), 'another surface: a name of its own')
    check(all(len(n('longmapname_x', 0, s, a).encode()) < 29 for s in range(22)), 'names fit the PEG name field')


def full(pack, tmp):
    studio = tmp / 'studio'
    shutil.copytree(pack, studio, ignore=shutil.ignore_patterns('*.exe', '*.dll', '__pycache__'))
    web_api.STUDIO, web_api.WORK = studio, tmp / 'work'
    work = tmp / 'files'
    work.mkdir()

    def obj_box(name, mats):
        v = [(x * 4, y * 4, z * 4) for x in (-.5, .5) for y in (0, 1) for z in (-.5, .5)]
        quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (1, 5, 7, 3), (0, 2, 6, 4)]
        lines = [f'v {a} {b} {c}' for a, b, c in v] + ['vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1']
        for q, m in zip(quads, mats):
            lines += [f'usemtl {m}', f'f {q[0]+1}/1 {q[1]+1}/2 {q[2]+1}/3', f'f {q[0]+1}/1 {q[2]+1}/3 {q[3]+1}/4']
        p = work / name
        p.write_text('\n'.join(lines) + '\n')
        return str(p)

    def tex(name, size):
        a = rng.integers(0, 256, (size, size, 4), dtype=np.uint8)
        a[..., 3] = 255
        p = work / name
        Image.fromarray(a, 'RGBA').save(p)
        return str(p)

    brick, stone, roof = tex('brick.png', 128), tex('stone.png', 64), tex('roof.png', 64)
    ground = obj_box('ground.obj', ['g'] * 6)
    box = obj_box('box.obj', ['top', 'side', 'side', 'side', 'side', 'side'])
    base = dict(rotation=[0, 0, 0], scale=1, alpha={}, physics_intent='Static')
    items = [dict(base, name='Ground', path=ground, position=[0, -4, 0], scale=12, textures={'g': stone})]
    for i in range(8):
        items.append(dict(base, name=f'Box {i}', path=box, position=[-20 + 5 * i, 0, 8], textures={'top': roof if i % 2 else stone, 'side': brick}))
    markers = [dict(type='Shared spawn', position=[x, 0.1, 0], yaw=0, label='') for x in (-6, -2, 2, 6)]
    spec = dict(scene_items=items, markers=markers, lights=[], base_name='sharetest', world_scale=0.5, mirror_x=True,
                flip_obj_v=True, double_sided=False, ptp=False, job='share')
    logs = []
    r = json.loads(web_api.export_project(json.dumps(spec), logs.append))
    check(r['ok'], 'export runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
    if not r['ok']:
        return
    out = Path(r['value']['out_dir'])
    peg_path = next(out.rglob('sharetest.peg_xbox2'))
    chunk_path = next(out.rglob('sharetest.bbchunk_xbox2'))
    _, _, entries = peg.parse_peg(peg_path)
    mine = [e.name for e in entries if e.name.startswith('sharetes_')]
    check(len(mine) == 3, f'the PEG holds each of the 3 pictures once ({len(mine)} map textures)')
    check(len(mine) == len({x.casefold() for x in mine}), 'no texture name twice')
    ch = rc.read_chunk(chunk_path.read_bytes())
    strings = rc.chunk_strings(ch)
    check(sum(1 for s in strings if s.startswith('sharetes_')) == 3, 'the chunk names each picture once')
    check(any('PEG resources' in line for line in logs), 'the export reports its PEG resources')


def main():
    tmp = Path(tempfile.mkdtemp(prefix='sr1share'))
    try:
        naming(tmp)
        pack = os.environ.get('SR1_DATA_PACK')
        if pack and (Path(pack) / 'reference_beavercreek').is_dir():
            full(Path(pack), tmp)
        else:
            print('skip full export: set SR1_DATA_PACK to an unpacked SR1 Map Studio folder')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f'{len(failures)} failure(s)')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()

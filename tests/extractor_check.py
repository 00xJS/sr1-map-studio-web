"""Checks that the BBChunk to OBJ tool gives back the V a map was exported with (studio-py/sr1_bbchunk_to_obj.py).

Run from web/:  py -3 tests/extractor_check.py   (needs numpy and Pillow)

Needs SR1_DATA_PACK set to an unpacked SR1 Map Studio desktop folder for the export; without it, it says so and
checks nothing. Everything is written to a temporary folder.
"""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def box(path, sx, sy, sz, mat):
    """A box whose UVs use only V 0.25 and 0.5, so a flip shows as 0.75."""
    v = [(x * sx, y * sy, z * sz) for x in (-.5, .5) for y in (0, 1) for z in (-.5, .5)]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (1, 5, 7, 3), (0, 2, 6, 4)]
    lines = [f'v {a} {b} {c}' for a, b, c in v] + ['vt 0.1 0.25', 'vt 0.4 0.25', 'vt 0.4 0.5', 'vt 0.1 0.5', f'usemtl {mat}']
    for q in quads:
        lines += [f'f {q[0]+1}/1 {q[1]+1}/2 {q[2]+1}/3', f'f {q[0]+1}/1 {q[2]+1}/3 {q[3]+1}/4']
    path.write_text('\n'.join(lines) + '\n')
    return str(path)


def round_trip(pack, tmp):
    import web_api
    import sr1_native_glass
    import sr1_native_props
    import sr1_bbchunk_to_obj as extractor
    studio = tmp / 'studio'
    for name in ('reference_beavercreek', 'native_glass', 'native_props'):
        shutil.copytree(pack / name, studio / name)
    web_api.STUDIO, web_api.WORK = studio, tmp / 'work'
    sr1_native_glass.ASSETS, sr1_native_props.ASSETS = studio / 'native_glass', studio / 'native_props'
    files = tmp / 'files'
    files.mkdir()
    Image.new('RGB', (64, 64), (90, 90, 90)).save(files / 'g.png')
    ground = dict(name='Ground', path=box(files / 'ground.obj', 80, 2, 80, 'g'), position=[0, -2, 0], rotation=[0, 0, 0], scale=1,
                  alpha={}, physics_intent='Static', textures={'g': str(files / 'g.png')})
    spawns = [dict(type='Shared spawn', position=[x, 0.1, 0], yaw=0, label='') for x in (-6, -2, 2, 6)]
    spec = dict(job='uv', scene_items=[ground], markers=spawns, lights=[], base_name='uvtest', world_scale=0.5, mirror_x=True,
                flip_obj_v=True, double_sided=False, sky_texture=None)
    result = json.loads(web_api.export_project(json.dumps(spec), lambda _: None))
    check(result['ok'], 'the map exports' + ('' if result['ok'] else ': ' + result['error'][:300]))
    if not result['ok']:
        return
    out = Path(result['value']['out_dir'])
    report = extractor.export_bbchunk_obj(out / 'uvtest.bbchunk_xbox2', tmp / 'x' / 'uvtest.obj', peg_path=out / 'uvtest.peg_xbox2')
    check(report['uv_vertices'] > 0, 'the extractor recovers UVs')
    text = (tmp / 'x' / 'uvtest.obj').read_text()
    vs = {round(float(line.split()[2]), 3) for line in text.splitlines() if line.startswith('vt ')}
    check(0.25 in vs and 0.5 in vs, f'V comes back as it went in (0.25 and 0.5 in {sorted(vs)[:8]})')
    check(0.75 not in vs, 'V is not upside down (no 0.75)')


pack = os.environ.get('SR1_DATA_PACK')
if not pack:
    print('SR1_DATA_PACK not set: nothing checked.')
else:
    tmp = Path(tempfile.mkdtemp(prefix='extractor_'))
    try:
        round_trip(Path(pack), tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
print(f'{len(failures)} failure(s)')
sys.exit(1 if failures else 0)

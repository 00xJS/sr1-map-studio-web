"""Checks that the export speed-ups (py/export_cache.py, py/fast_geometry.py,
py/export_runner.py) write exactly the same files as the plain exporter.

Run from web/:  py -3 tests/export_cache_check.py   (needs numpy and Pillow)

Always: the numpy tiling and byte swap against the originals.
With SR1_DATA_PACK set to an unpacked SR1 Map Studio desktop folder (the one
holding reference_beavercreek/, native_glass/, native_props/), it also exports
a small scene with shared textures, a see-through texture and two custom
breakables, plain and then through the caches (cold, nothing changed, a
marker moved, a fresh runtime reading the disk cache), and compares every
file. Nothing from the data pack is written outside a temporary folder.
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
import peg_xbox2_beaver as peg  # noqa: E402
import web_api  # noqa: E402  (installs fast_dxt, as in the browser)
import export_cache  # noqa: E402
import export_runner  # noqa: E402
import fast_geometry  # noqa: E402

failures = []
rng = np.random.default_rng(11)


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def tiling():
    orig = (peg.tile_x360, peg.untile_x360, peg.swap16)
    for w, h in ((4, 4), (64, 64), (128, 32), (36, 20), (256, 256), (1024, 512)):
        for kind in ('DXT1', 'DXT5'):
            pitch, bw, bh, aw, ah = peg._block_geometry(w, h, kind)
            linear = rng.integers(0, 256, bw * bh * pitch, dtype=np.uint8).tobytes()
            tiled = orig[0](linear, w, h, kind)
            check(export_cache.tile_x360(linear, w, h, kind) == tiled, f'tile {w}x{h} {kind}')
            check(export_cache.untile_x360(tiled, w, h, kind) == orig[1](tiled, w, h, kind), f'untile {w}x{h} {kind}')
    for n in (0, 1, 2, 7, 4096, 4097):
        data = rng.integers(0, 256, n, dtype=np.uint8).tobytes()
        check(export_cache.swap16(data) == orig[2](data), f'swap16 {n} bytes')


def collision_trees():
    import sr_reborn_core as rc
    fast_geometry.install()
    orig = fast_geometry._original['mopp']
    for n in (1, 2, 5, 47, 48, 49, 300, 5000):
        # Boxes with many equal extents and sort keys, the case that tests the ordering.
        p = rng.integers(0, 40, (n, 3)).astype(float) * (0.5 if n % 2 else 1.37)
        s = rng.integers(0, 3, (n, 3)) * 0.25
        keys = rng.permutation(n * 3)[:n]
        items = [{'key': int(k), 'mn': list(a), 'mx': list(a + b)} for k, a, b in zip(keys, p, s)]
        check(fast_geometry.build_mopp_block(items) == orig(items), f'collision tree, {n} triangles')
        check(sorted(rc.mopp_keys(bytes(fast_geometry.build_mopp_block(items)[28:]))) == sorted(int(k) for k in keys),
              f'collision tree, {n} triangles: every key reachable')
    fast_geometry.uninstall()


def files(out):
    return {p.relative_to(out).as_posix(): p.read_bytes() for p in sorted(Path(out).rglob('*')) if p.is_file()}


def same(a, b, what):
    diff = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
    check(not diff and len(a) > 0, what + (': differs in ' + ', '.join(diff) if diff else f' ({len(a)} files)'))


def scene(pack, tmp):
    studio = tmp / 'studio'
    for name in ('reference_beavercreek', 'native_glass', 'native_props'):
        shutil.copytree(pack / name, studio / name)
    web_api.STUDIO, web_api.WORK = studio, tmp / 'work'
    import sr1_native_glass
    import sr1_native_props
    sr1_native_glass.ASSETS, sr1_native_props.ASSETS = studio / 'native_glass', studio / 'native_props'
    work = tmp / 'files'
    work.mkdir()

    def obj_box(name, sx, sy, sz, mats):
        v = [(x * sx, y * sy, z * sz) for x in (-.5, .5) for y in (0, 1) for z in (-.5, .5)]
        quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (1, 5, 7, 3), (0, 2, 6, 4)]
        lines = [f'v {a} {b} {c}' for a, b, c in v] + ['vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1']
        for q, m in zip(quads, mats):
            lines += [f'usemtl {m}', f'f {q[0]+1}/1 {q[1]+1}/2 {q[2]+1}/3', f'f {q[0]+1}/1 {q[2]+1}/3 {q[3]+1}/4']
        p = work / name
        p.write_text('\n'.join(lines) + '\n')
        return str(p)

    def tex(name, size, alpha=False):
        a = rng.integers(0, 256, (size, size, 4), dtype=np.uint8)
        if not alpha:
            a[..., 3] = 255
        p = work / name
        Image.fromarray(a, 'RGBA').save(p)
        return str(p)

    brick, stone, glass = tex('brick.png', 256), tex('stone.png', 100), tex('glass.png', 64, alpha=True)
    ground = obj_box('ground.obj', 60, 2, 60, ['g'] * 6)
    box = obj_box('box.obj', 4, 4, 4, ['top', 'side', 'side', 'side', 'side', 'side'])
    base = dict(rotation=[0, 0, 0], scale=1, alpha={}, physics_intent='Static')
    items = [dict(base, name='Ground', path=ground, position=[0, -2, 0], textures={'g': stone})]
    # Many objects sharing two textures: the case the texture cache is for.
    for i in range(8):
        items.append(dict(base, name=f'Box {i}', path=box, position=[-20 + 5 * i, 0, 8], rotation=[0, 15 * i, 0],
                          textures={'top': stone, 'side': brick}))
    items.append(dict(base, name='Window', path=box, position=[0, 0, -10], textures={'top': glass, 'side': glass},
                      alpha={'top': True, 'side': True}))

    def breakable(name, at, mode, texture, **extra):
        it = dict(base, name=name, path=obj_box(name + '.obj', 2, 2, 2, ['c'] * 6), position=at, textures={'c': texture})
        r = json.loads(web_api.scene_op('convert_breakable', json.dumps({'item': it, 'render_mode': mode, 'world_scale': 0.5, 'others': []})))
        check(r['ok'], 'scene: ' + mode + ' breakable conversion' + ('' if r['ok'] else ': ' + r['error']))
        return dict(r['value'], **extra)
    items.append(breakable('crate', [10, 0, -15], 'wood', brick))
    # See-through custom glass: the exporter changes its image's alpha in place.
    items.append(breakable('pane', [-10, 0, -15], 'glass', glass, native_opacity=60, native_use_alpha=True))
    markers = [dict(type='Shared spawn', position=[x, 0.1, 0], yaw=0, label='') for x in (-6, -2, 2, 6)]
    lights = [dict(name='Lamp', enabled=True, position=[0, 6, 0], color=[1, .9, .7], intensity=1, inner_range=2, range=8)]
    return dict(scene_items=items, markers=markers, lights=lights, base_name='cachetest', world_scale=0.5, mirror_x=True,
                flip_obj_v=True, double_sided=False, ptp=False)


def export(spec, job, cached, logs=None):
    spec = dict(spec, job=job)
    logs = [] if logs is None else logs
    events = []
    if cached:
        raw = export_runner.export_project(json.dumps(spec), logs.append, events.append)
    else:
        raw = web_api.export_project(json.dumps(spec), logs.append)
    r = json.loads(raw)
    check(r['ok'], f'export {job} runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
    return (files(r['value']['out_dir']) if r['ok'] else {}), logs, [json.loads(e) for e in events]


def full(pack, tmp):
    spec = scene(pack, tmp)
    moved = json.loads(json.dumps(spec))
    moved['markers'][0]['position'] = [-8, 0.1, 3]
    moved['lights'][0]['position'] = [3, 7, 1]

    plain = export(spec, 'plain', False)[0]
    plain_moved = export(moved, 'plain_moved', False)[0]
    check(plain != plain_moved, 'moving a marker and a light changes the map files')

    export_runner.install(tmp / 'cache')
    cold, logs, events = export(spec, 'cold', True)
    same(plain, cold, 'cold cache: same files as without the cache')
    s = dict(export_cache.stats)
    check(s.get('compressed', 0) >= 3 and s.get('payload_hits', 0) > 0, 'cold cache: each texture encoded once ' + str(s))
    check(s.get('tga_skipped', 0) > 0, 'cold cache: unused TGA copies skipped')
    stages = [e['stage'] for e in events]
    check([x for i, x in enumerate(stages) if i == 0 or stages[i - 1] != x] == [x for x, _ in export_runner.STAGES],
          'progress: every stage in order ' + str(sorted(set(stages), key=stages.index)))
    tex = [e for e in events if e['stage'] == 'textures' and e['done']]
    check(tex and tex[-1]['done'] == tex[-1]['total'], 'progress: texture count reaches its total')

    again, logs, _ = export(spec, 'again', True)
    same(plain, again, 'nothing changed: same files')
    check(any('Nothing changed' in l for l in logs), 'nothing changed: last build reused')

    moved_cached, logs, _ = export(moved, 'moved', True)
    same(plain_moved, moved_cached, 'marker and light moved: same files as without the cache')
    s = dict(export_cache.stats)
    check(s.get('compressed', 0) == 0 and s.get('geometry_reused') == 1, 'marker moved: geometry and textures reused ' + str(s))
    check(not (Path(web_api.WORK) / 'jobs' / 'cold').exists(), 'old job folders removed')

    # A new page load: memory caches gone, the disk cache still there.
    export_cache.reset(memory=True)
    export_runner._geometry.clear()
    export_runner._last_export.clear()
    fresh, logs, _ = export(spec, 'fresh', True)
    same(plain, fresh, 'fresh runtime with the disk cache: same files')
    s = dict(export_cache.stats)
    check(s.get('compressed', 0) == 0 and s.get('disk_hits', 0) >= 3, 'fresh runtime: textures read from disk ' + str(s))

    # Fast geometry helpers against the originals on a real chunk.
    import sr_reborn_core as rc
    ch = rc.read_chunk((Path(web_api.WORK) / 'jobs' / 'fresh' / 'out' / 'cachetest.bbchunk_xbox2').read_bytes())
    g = rc.chunk_geometry(ch)
    orig = fast_geometry._original['mesh_triangles']
    check(all(fast_geometry.mesh_triangles(g, k) == orig(g, k) for k in range(len(g.meshes))), 'mesh_triangles matches on every mesh')
    meshes = [k for k, M in enumerate(g.meshes) if M.subs]
    check(fast_geometry.generic_normal_alignment(g, meshes) == fast_geometry._original['alignment'](g, meshes),
          'normal alignment check matches')
    export_runner.uninstall()
    check(peg.tile_x360 is not export_cache.tile_x360, 'uninstall puts the originals back')


tiling()
collision_trees()
pack =os.environ.get('SR1_DATA_PACK')
if pack:
    with tempfile.TemporaryDirectory() as t:
        full(Path(pack), Path(t))
else:
    print('skip full export (set SR1_DATA_PACK to run it)')

print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)

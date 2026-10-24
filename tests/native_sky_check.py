"""Checks the game's own sky at export (py/native_sky.py).

Run from web/:  py -3 tests/native_sky_check.py   (needs numpy and Pillow)

Without anything set it checks the record-tree edit on made-up data. With
SR1_GAME_PACKFILES set to the game's packfiles folder it copies the sky out of
the player's own mp_bac_01 (from mp_city_stream.vpp_xbox2), as the editor does
in the browser; with SR1_GAME_SKY_OUT pointing at the folder the vitest game
test wrote (SR1_GAME_SKY_OUT=<dir> npx vitest run --mode game tests/gameSky.test.ts)
it uses the browser's files instead and checks they match. With SR1_DATA_PACK
also set to an unpacked SR1 Map Studio desktop folder it runs full exports
through web_api.py: with the game's sky, without it, and with a sky that does
not fit. Everything is written to a temporary folder.
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
import sr_reborn_core as rc  # noqa: E402
import peg_xbox2_beaver as peg  # noqa: E402
import fast_dxt  # noqa: E402
import native_sky  # noqa: E402

fast_dxt.install()
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def tree_bytes(lists):
    """A record tree: node count, 44-byte nodes from 64 (count at +12), then the nodes' record lists."""
    out = bytearray(rc.Al(4, 64) + 44 * len(lists))
    rc.Wr32(out, 0, len(lists))
    for i, items in enumerate(lists):
        rc.WrF(out, 64 + 44 * i, -1.0)
        rc.Wr32(out, 64 + 44 * i + 12, len(items))
        rc.WrF(out, 64 + 44 * i + 16, 1.0)
        rc.Wr32(out, 64 + 44 * i + 36, 0xffffffff)
    for items in lists:
        for r in items:
            rc.Put16(out, r)
    return out


def tree_edit():
    sec = tree_bytes([[0, 5, 2], [], [7, 1, 3, 9], [4]])
    out = native_sky.drop_from_tree(sec, {5, 1, 4})
    n, at, lists = native_sky.tree_lists(out)
    check(n == 4 and lists == [[0, 2], [], [7, 3, 9], []], 'tree: sky records left out, the rest in order ' + str(lists))
    check(out[:at + 44 * n][:12] == sec[:12] and rc.F32(out, 64 + 44 * 2 + 16) == 1.0, 'tree: node bounds untouched')
    check(len(out) == at + 44 * n + 2 * 5, 'tree: section shrinks with the lists')
    check(native_sky.drop_from_tree(sec, set()) == sec, 'tree: nothing to drop, same bytes')


def browser_files(game, folder):
    """mp_bac_01's chunk and the sky's pictures, laid out as the editor hands them over (src/lib/gameSky.ts)."""
    pack = rc.Packfile(Path(game) / 'mp_city_stream.vpp_xbox2')
    folder.mkdir(parents=True)
    chunk = folder / 'mp_bac_01.bbchunk_xbox2'
    chunk.write_bytes(pack.read('mp_bac_01.bbchunk_xbox2'))
    (folder / 'mp_bac_01.peg_xbox2').write_bytes(pack.read('mp_bac_01.peg_xbox2'))
    pack.close()
    probe = folder / 'probe'
    names = native_sky.extract(chunk, probe)['textures']
    _, _, entries = peg.parse_peg(folder / 'mp_bac_01.peg_xbox2')
    by = {}
    for e in entries:
        if e.payload and e.name.lower() not in by:
            by[e.name.lower()] = e
    donor, tex = folder / 'native_sky', []
    donor.mkdir()
    for n in names:
        e = by.get(n.lower())
        if e is None:
            continue
        f = f'texture_{len(tex):02d}.bin'
        (donor / f).write_bytes(bytes(e.payload))
        tex.append({'name': e.name, 'entry': bytes(e.raw).hex(), 'file': f, 'bytes': len(e.payload)})
    shared = [n for n in names if n.lower() not in by]
    (donor / 'textures.json').write_text(json.dumps({'source': 'mp_bac_01', 'textures': tex, 'shared': shared}))
    shutil.rmtree(probe)
    return folder


def game_files(game, tmp):
    folder = browser_files(game, tmp / 'py_game')
    summary = native_sky.extract(folder / 'mp_bac_01.bbchunk_xbox2', tmp / 'probe')
    check(sorted(summary['objects']) == sorted(native_sky.NAMES) and summary['meshes'] == 5 and summary['materials'] == 9,
          'game: mp_bac_01 has the five sky objects, five meshes, nine materials ' + str(summary))
    sky = json.loads((tmp / 'probe' / 'sky.json').read_text())
    check(len(sky['vbs']) == 4 and len(json.dumps(sky)) < 100_000, 'game: four vertex buffers, a small copy (%d bytes)' % len(json.dumps(sky)))
    listed = json.loads((folder / 'native_sky' / 'textures.json').read_text())
    check(len(listed['textures']) == 10 and listed['shared'] == ['ds_grad_blk.tga'], 'game: ten pictures in mp_bac_01, ds_grad_blk.tga always loaded')
    browser = os.environ.get('SR1_GAME_SKY_OUT')
    if browser:
        b = Path(browser)
        theirs = json.loads((b / 'native_sky' / 'textures.json').read_text())

        def pictures(where, listing):
            return {t['name'].lower(): (t['entry'], (where / 'native_sky' / t['file']).read_bytes()) for t in listing['textures']}
        same = pictures(b, theirs) == pictures(folder, listed) and theirs['shared'] == listed['shared']
        check(same and (b / 'mp_bac_01.bbchunk_xbox2').read_bytes() == (folder / 'mp_bac_01.bbchunk_xbox2').read_bytes(),
              "game: the browser's files match the packfile read here")
        return b
    return folder


def obj_box(work, name, sx, sy, sz, mat):
    v = [(x * sx, y * sy, z * sz) for x in (-.5, .5) for y in (0, 1) for z in (-.5, .5)]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (1, 5, 7, 3), (0, 2, 6, 4)]
    lines = [f'v {a} {b} {c}' for a, b, c in v] + ['vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', f'usemtl {mat}']
    for q in quads:
        lines += [f'f {q[0]+1}/1 {q[1]+1}/2 {q[2]+1}/3', f'f {q[0]+1}/1 {q[2]+1}/3 {q[3]+1}/4']
    p = work / name
    p.write_text('\n'.join(lines) + '\n')
    return str(p)


def full_export(pack, tmp, source):
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

    ground = dict(name='Ground', path=obj_box(work, 'ground.obj', 80, 2, 80, 'g'), position=[0, -2, 0], rotation=[0, 0, 0], scale=1,
                  alpha={}, physics_intent='Static', textures={'g': tex('g.png', (90, 90, 90))})
    sky_picture = tex('sky.png', (120, 160, 220))
    markers = [dict(type='Shared spawn', position=[x, 0.1, 0], yaw=0, label='') for x in (-6, -2, 2, 6)]

    def export(job, sky_source, sky_texture):
        logs = []
        spec = dict(job=job, scene_items=[ground], markers=markers, lights=[], base_name='skytest', world_scale=0.5, mirror_x=True,
                    flip_obj_v=True, double_sided=False, sky_texture=sky_texture, native_sky_source=sky_source)
        r = json.loads(web_api.export_project(json.dumps(spec), logs.append))
        check(r['ok'], f'export {job}: runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
        return r.get('value'), logs

    def read(v):
        out = Path(v['out_dir'])
        ch = rc.read_chunk((out / 'skytest.bbchunk_xbox2').read_bytes())
        _, _, pe = peg.parse_peg(out / 'skytest.peg_xbox2')
        return out, ch, pe

    def fake_sky_draws(ch):
        g = rc.chunk_geometry(ch)
        return bool(native_sky._fake_sky_meshes(g, rc.chunk_strings(ch)))

    # 1. No game files: the fake sky image, as before.
    v, logs = export('plain', None, sky_picture)
    if v:
        _, ch, _ = read(v)
        check(v['summary']['game_sky'] == 0 and not native_sky.sky_list(ch) and fake_sky_draws(ch), 'export: without game files the fake sky stays')
        plain = (Path(v['out_dir']) / 'skytest.bbchunk_xbox2').read_bytes()

    # 2. A sky that does not fit: the map is left as it was, with the fake sky.
    big = tmp / 'big_sky'
    shutil.copytree(source / 'native_sky', big)
    probe = tmp / 'probe_big'
    native_sky.extract(source / 'mp_bac_01.bbchunk_xbox2', probe)
    sky = json.loads((probe / 'sky.json').read_text())
    sky['objects'] = sky['objects'] * 30
    (big / 'sky.json').write_text(json.dumps(sky))
    v, logs = export('nofit', {'dir': str(big)}, sky_picture)
    if v:
        _, ch, _ = read(v)
        same = (Path(v['out_dir']) / 'skytest.bbchunk_xbox2').read_bytes() == plain
        check(v['summary']['game_sky'] == 0 and same and any('no room left' in l for l in logs), 'export: a sky that does not fit leaves the map unchanged, and says so')

    # 3. The game's sky from the player's files, the fake sky image as the fallback.
    real = tmp / 'game'
    shutil.copytree(source, real, ignore=shutil.ignore_patterns('*.peg_xbox2', 'probe*'))
    spec = {'dir': str(real / 'native_sky'), 'chunk': str(real / 'mp_bac_01.bbchunk_xbox2')}
    v, logs = export('sky', spec, sky_picture)
    if v:
        out, ch, pe = read(v)
        ids = native_sky.sky_list(ch)
        names = native_sky.record_names(ch)
        check(v['summary']['game_sky'] == 1 and len(ids) == 5 and rc.U32(ch.header, native_sky.LIST_COUNT) == 5, 'export: five sky objects listed')
        check(sorted(names[r] for r in ids) == sorted(native_sky.NAMES), 'export: they are named like the game\'s ' + str([names[r] for r in ids]))
        in_tree = {r for items in native_sky.tree_lists(ch.get('tree236').data)[2] for r in items}
        check(not in_tree & set(ids) and len(in_tree) == rc.U32(ch.header, 868) - 5, 'export: the sky is out of the record tree, everything else in it')
        g = rc.chunk_geometry(ch)
        inst, recs = ch.get('instances').data, ch.get('static_records').data
        tris = sum(len(rc.mesh_triangles(g, rc.U32(inst, 112 * rc.U32(recs, 80 * r + 60) + 104))) for r in ids)
        check(tris == 160 + 4 + 160 + 4 + 614, 'export: the sky meshes draw the game\'s triangles (%d)' % tris)
        check(not fake_sky_draws(ch), 'export: the fake sky box is turned off')
        strings, peg_names = rc.chunk_strings(ch), [e.name for e in pe]
        check(len(peg_names) == len(strings) - 1 and 'ds_grad_blk.tga' in strings and 'ds_grad_blk.tga' not in peg_names,
              'export: ten pictures added, the always-loaded one only by name')
        check(not (real / 'mp_bac_01.bbchunk_xbox2').exists() and native_sky.have_donor(real / 'native_sky'), 'export: the big chunk is removed, the small sky copy kept')
        check(any("game's own sky" in l for l in logs), 'export: the log says so')
        # A second export reuses the copy.
        v2, _ = export('again', {'dir': str(real / 'native_sky')}, sky_picture)
        if v2:
            check((Path(v2['out_dir']) / 'skytest.bbchunk_xbox2').read_bytes() == (out / 'skytest.bbchunk_xbox2').read_bytes(), 'export: the same map again from the kept copy')

    # 4. No fake sky picture: the game's sky alone.
    v, logs = export('only', {'dir': str(real / 'native_sky')}, '')
    if v:
        _, ch, _ = read(v)
        check(v['summary']['game_sky'] == 1 and len(native_sky.sky_list(ch)) == 5 and not any('turned off' in l for l in logs), 'export: the game\'s sky without a fake sky picture')
    print('\n'.join('     log: ' + l for l in logs if 'Sky' in l))


with tempfile.TemporaryDirectory() as t:
    tmp = Path(t)
    tree_edit()
    game = os.environ.get('SR1_GAME_PACKFILES')
    if game:
        source = game_files(game, tmp)
        pack = os.environ.get('SR1_DATA_PACK')
        if pack:
            full_export(Path(pack), tmp, source)
        else:
            print('skip full export (set SR1_DATA_PACK to run it)')
    else:
        print('skip game checks (set SR1_GAME_PACKFILES, and SR1_DATA_PACK for the full exports)')

print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)

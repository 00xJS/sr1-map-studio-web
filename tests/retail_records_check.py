"""Checks py/retail_records.py: exported materials and records set the way retail maps set them.

Run from web/:  py -3 tests/retail_records_check.py   (needs numpy and Pillow)

Without anything set it checks the helpers on made-up data. With
SR1_DATA_PACK set to an unpacked SR1 Map Studio desktop folder (the one
holding reference_beavercreek/, native_glass/, native_props/) it runs a full
export through web_api.py of a scene with an opaque floor, an alpha fence, a
glass pane, a movable prop and a breakable wood crate, and re-reads the map
it wrote. With SR1_GAME_PACKFILES set to the game's packfiles folder it also
reads the retail multiplayer maps (mp_city_stream.vpp_xbox2) and checks the
values copied here are the ones retail uses. Everything is written to a
temporary folder; nothing from the game or the data pack is kept.
"""
import collections
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
import physics_props  # noqa: E402,F401  (first, like web_api)
import sr_reborn_core as rc  # noqa: E402
import peg_xbox2_beaver as peg  # noqa: E402
import fast_dxt  # noqa: E402
import retail_records as rr  # noqa: E402

fast_dxt.install()
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


class _G:
    def __init__(self, mats):
        self.mats = mats


def material(shader, flags, si):
    m = bytearray(56)
    struct.pack_into('>I', m, 0, shader)
    struct.pack_into('>H', m, 0x12, flags)
    consts = bytearray(48)
    struct.pack_into('>IHH4f', consts, 0, 0x12345678, 25, 0, 1, 0, 0, 0)
    struct.pack_into('>IHH4f', consts, 24, rr.SELF_ILLUMINATION, 29, 0, si, 0, 0, 0)
    return rc.Material(m, [bytearray(), bytearray(), bytearray(), bytearray(), consts, bytearray(), bytearray()])


def units():
    check(rr.volition_hash('Self_Illumination') == rr.SELF_ILLUMINATION, 'materials: Self_Illumination constant hash')
    g = _G([material(0x1111, 3, 0.12), material(rr.K_BASE_SHADER, 11, 0.35), material(rr.K_BASE_SHADER, 3, 0.12),
            material(rr.K_BASE_SHADER, 27, 1.0)])
    check(rr.plain_template(g, 2) == 2, 'materials: a plain template is cloned as it is')
    check(rr.plain_template(g, 1) == 2 and rr.plain_template(g, 3) == 2,
          'materials: a glowing template is swapped for the first plain one with the same shader')
    M = g.mats[2]
    check(rr.self_illumination(M) is not None and abs(rr.self_illumination(M) - 0.12) < 1e-6, 'materials: Self_Illumination read')
    rr.set_self_illumination(M, 0.0)
    check(rr.self_illumination(M) == 0.0 and struct.unpack_from('>f', M.parts[4], 8)[0] == 1.0,
          'materials: Self_Illumination set to 0, other constants kept')


def obj_box(path, size, mat, at=(0, 0, 0)):
    sx, sy, sz = size
    v = [(at[0] + x * sx, at[1] + y * sy, at[2] + z * sz) for x in (-.5, .5) for y in (0, 1) for z in (-.5, .5)]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (1, 5, 7, 3), (0, 2, 6, 4)]
    lines = [f'v {a} {b} {c}' for a, b, c in v] + ['vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', f'usemtl {mat}']
    for q in quads:
        lines += [f'f {q[0]+1}/1 {q[1]+1}/2 {q[2]+1}/3', f'f {q[0]+1}/1 {q[2]+1}/3 {q[3]+1}/4']
    path.write_text('\n'.join(lines) + '\n')
    return str(path)


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

    def tex(name, color, alpha=None):
        p = work / name
        im = Image.new('RGBA', (64, 64), color + (255,))
        if alpha is not None:
            im.putalpha(Image.new('L', (64, 64), alpha))
            im.paste((0, 0, 0, 0), (0, 0, 32, 64))
        im.save(p)
        return str(p)

    base = dict(rotation=[0, 0, 0], scale=1, alpha={}, physics_intent='Static')
    items = [
        dict(base, name='Ground', path=obj_box(work / 'ground.obj', (80, 2, 80), 'g'), position=[0, -2, 0], textures={'g': tex('g.png', (90, 90, 90))}),
        dict(base, name='Fence', path=obj_box(work / 'fence.obj', (10, 4, 0.2), 'f'), position=[0, 0, 12], textures={'f': tex('f.png', (160, 160, 160), 255)},
             alpha={'f': True}),
    ]
    glass = json.loads(web_api.scene_op('create_glass', json.dumps({'position': [6, 0, -6], 'world_scale': 0.5, 'style_label': 'Tinted glass', 'others': []})))
    check(glass['ok'], 'export: glass pane made' + ('' if glass['ok'] else ': ' + glass['error']))
    items.append(glass['value'])
    crate = dict(base, name='Crate', path=obj_box(work / 'crate.obj', (2, 2, 2), 'c'), position=[-6, 0, 6], textures={'c': tex('c.png', (150, 100, 50))})
    prop = json.loads(web_api.scene_op('native_prop', json.dumps({'item': dict(crate, name='Box'), 'behavior': 'movable', 'world_scale': 0.5, 'others': []})))
    check(prop['ok'], 'export: movable prop made' + ('' if prop['ok'] else ': ' + prop['error']))
    items.append(prop['value'])
    wood = json.loads(web_api.scene_op('convert_breakable', json.dumps({'item': dict(crate, position=[-12, 0, 6]), 'render_mode': 'wood', 'world_scale': 0.5, 'others': []})))
    check(wood['ok'], 'export: breakable wood made' + ('' if wood['ok'] else ': ' + wood['error']))
    items.append(wood['value'])
    markers = [dict(type='Shared spawn', position=[x, 0.1, 0], yaw=0, label='') for x in (-4, -2, 2, 4)]
    spec = dict(job='r', scene_items=items, markers=markers, lights=[], base_name='rrtest', world_scale=0.5, mirror_x=True,
                flip_obj_v=True, double_sided=False, ptp=False)
    logs = []
    r = json.loads(web_api.export_project(json.dumps(spec), logs.append))
    check(r['ok'], 'export: runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
    if not r['ok']:
        return None
    out = Path(r['value']['out_dir'])
    ch = rc.read_chunk((out / 'rrtest.bbchunk_xbox2').read_bytes())
    return dict(out=out, ch=ch, logs=logs, summary=r['value']['summary'], studio=studio)


def drawn_materials(ch):
    """Material index -> number of batches drawing it, over every mesh an instance uses."""
    g = rc.chunk_geometry(ch)
    inst = ch.get('instances').data
    used = collections.Counter()
    meshes = {rc.U32(inst, 112 * i + 104) for i in range(len(inst) // 112)}
    for k in meshes:
        if k >= len(g.meshes):
            continue
        for S in g.meshes[k].subs:
            for b in range(rc.U16(S.s16, 2)):
                used[rc.U16(S.b16, 8 * b + 6)] += 1
    return g, used


def export_materials(x):
    g, used = drawn_materials(x['ch'])
    template = rc.chunk_geometry(rc.read_chunk((x['studio'] / 'reference_beavercreek' / 'beavercreek.bbchunk_xbox2').read_bytes()))
    first_glow = next(i for i, M in enumerate(template.mats) if rc.U32(M.m, 0) == rr.K_BASE_SHADER and rc.U16(M.m, 0x12) in (11, 27))
    check(rr.self_illumination(template.mats[0]) > 0.1 and rc.U16(template.mats[first_glow].m, 0x12) & rr.GLOW,
          'template: plain materials self-lit, the old alpha template glows (what this fixes)')
    ours = [i for i in used if i >= len(template.mats) and rc.U32(g.mats[i].m, 0) == rr.K_BASE_SHADER]
    strings = rc.chunk_strings(x['ch'])
    _, _, pe = peg.parse_peg(x['out'] / 'rrtest.peg_xbox2')
    fmt = {e.name: e.fmt for e in pe}
    alpha = [i for i in ours if fmt.get(strings[rc.U32(g.mats[i].parts[0], 4)]) == peg.FMT_DXT5]
    check(len(ours) >= 4 and alpha, f'export: {len(ours)} drawn bb-simple1 materials of ours, {len(alpha)} with an alpha texture')
    glass = [i for i in ours if strings[rc.U32(g.mats[i].parts[0], 4)].startswith('ng_') and rc.U16(g.mats[i].m, 0x12) == 27]
    check(len(glass) == 1, 'export: the tinted glass pane keeps its own prefab material (flags 27)')
    check(all(rc.U16(g.mats[i].m, 0x12) == rr.PLAIN for i in ours if i not in glass),
          'export: every other drawn material of ours is plain (flags 3), the alpha fence too')
    check(all(rr.self_illumination(g.mats[i]) == 0.0 for i in ours), 'export: Self_Illumination 0 on every drawn material of ours, glass, prop and wood included')
    keys = {rc.U32(g.mats[i].m, 4) for i in alpha}
    tags = collections.defaultdict(set)
    for e in g.ents:
        tags[rc.U32(e.e, 4)].add(rc.U32(e.e, 0))
    plain_tags = tags[rc.U32(template.mats[0].m, 4)]
    check(all(tags[k] == plain_tags for k in keys), 'export: alpha materials carry the plain template\'s resource links')
    glow = [i for i in used if rc.U32(g.mats[i].m, 0) == rr.K_BASE_SHADER and (rr.self_illumination(g.mats[i]) or 0.0) > 0]
    check(not glow, 'export: nothing drawn is self-lit')
    check(any(l.startswith('Materials: Self_Illumination 0') for l in x['logs']), 'export: logs the material change')


def retail_materials(packfiles, tmp):
    """Retail bb-simple1: alpha (DXT5) and opaque materials alike are mostly flags 3 with Self_Illumination 0."""
    pk = rc.Packfile(Path(packfiles) / 'mp_city_stream.vpp_xbox2')
    stats = collections.Counter()
    maps = sorted({e.name[:-14] for e in pk.entries if e.name.endswith('.bbchunk_xbox2')})
    for m in maps:
        if not pk.has(m + '.peg_xbox2'):
            continue
        ch = rc.read_chunk(pk.read(m + '.bbchunk_xbox2'))
        g = rc.chunk_geometry(ch)
        p = tmp / 'retail.peg'
        p.write_bytes(pk.read(m + '.peg_xbox2'))
        fmt = {}
        for e in peg.parse_peg(p)[2]:
            fmt.setdefault(e.name.lower(), e.fmt)
        strings = rc.chunk_strings(ch)
        diffuse = rr.volition_hash('diffuse_map')
        for M in g.mats:
            if rc.U32(M.m, 0) != rr.K_BASE_SHADER:
                continue
            names = [strings[rc.U32(M.parts[0], 12 * k + 4)] for k in range(rc.U16(M.m, 10)) if rc.U32(M.parts[0], 12 * k) == diffuse]
            kind = 'alpha' if names and fmt.get(names[0].lower()) == peg.FMT_DXT5 else 'opaque'
            si = rr.self_illumination(M) or 0.0
            stats[(kind, rc.U16(M.m, 0x12) == rr.PLAIN and si == 0.0)] += 1
    pk.close()
    for kind in ('alpha', 'opaque'):
        n = stats[(kind, True)] + stats[(kind, False)]
        share = stats[(kind, True)] / max(1, n)
        check(n > 50 and share > 0.8, f'retail: {share:.0%} of {n} {kind} bb-simple1 materials are flags 3 with Self_Illumination 0')


with tempfile.TemporaryDirectory() as t:
    tmp = Path(t)
    units()
    pack = os.environ.get('SR1_DATA_PACK')
    if pack:
        x = full_export(Path(pack), tmp)
        if x:
            export_materials(x)
    else:
        print('skip full export (set SR1_DATA_PACK to run it)')
    game = os.environ.get('SR1_GAME_PACKFILES')
    if game:
        retail_materials(game, tmp)
    else:
        print('skip retail comparison (set SR1_GAME_PACKFILES to run it)')

print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)

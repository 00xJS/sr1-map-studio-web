"""Checks py/retail_records.py: exported materials and records set the way retail maps set them.

Run from web/:  py -3 tests/retail_records_check.py   (needs numpy and Pillow)

Without anything set it checks the helpers on made-up data. With
SR1_DATA_PACK set to an unpacked SR1 Map Studio desktop folder (the one
holding reference_beavercreek/, native_glass/, native_props/) it runs a full
export through web_api.py of a scene with an opaque floor, an alpha fence, a
glass pane, a movable prop and a breakable wood crate, and re-reads the map
it wrote: materials, fade distances, lights, height map, decals. With SR1_GAME_PACKFILES set to the game's packfiles folder it also
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


def unit_fades():
    check([rr.record_kind(f) for f in (0x10000000, 0x10021400, 0x10020000, 0x10008000, 0x8000, 0)] == ['world', 'glass', 'prop', None, None, None],
          'fades: world, glass and prop records told apart; the sky and undrawn records left alone')
    check(rr.FADE_WORLD >= 1000 and 100 <= rr.FADE_PROP <= 200 and 100 <= rr.FADE_GLASS <= 200, 'fades: world never fades, props and glass at 150 m')


def unit_decals():
    check([rr.record_kind(f) for f in (0x10000402, 0x10000404, 0x10000002)] == ['decal'] * 3, 'decals: decal-layer records told apart')
    sticker = dict(collision_disabled=True, group='Decal@1,2,3#abcdef')
    check(rr.is_decal(sticker, [8, 3, 0.04]) and rr.is_decal(dict(collision_disabled=True), [6, 0.02, 0.5]),
          'decals: a stuck-on tag and a flat sheet without collision are overlays')
    check(not rr.is_decal(dict(collision_disabled=True), [2, 2, 2]) and not rr.is_decal(dict(sticker, collision_disabled=False), [8, 3, 0.04])
          and not rr.is_decal(dict(collision_disabled=True, swimmable_water=True), [6, 0.02, 6])
          and not rr.is_decal(dict(collision_disabled=True, native_prop_behavior='movable'), [1, 0.05, 1]),
          'decals: solid items, thick look-only items, water and props are not')


def unit_hmap(tmp):
    import sr1_sidecars
    p = tmp / 'h.hmap_xbox2'
    sr1_sidecars.build_hmap(p, dict(verts=[(0, 0, 0), (50, 3, 0), (0, 0, 50)], faces=[(0, 1, 2, 'g')]))
    before = p.read_bytes()
    check(struct.unpack_from('>I', before, 16)[0] == 0, 'hmap: upstream writes 0 after the size')
    rr.fix_hmap(p)
    after = p.read_bytes()
    check(struct.unpack_from('>I', after, 16)[0] == 4 and after[:16] == before[:16] and after[20:] == before[20:],
          'hmap: the field is 4, nothing else changes')


def unit_lights():
    check([rr.light_fade(m) for m in (1, 3, 6, 17, 100)] == [20, 20, 24, 68, 75], 'lights: fade distance follows the outer range, 20-75 m')
    import sr1_lighting
    rr.install()
    light = sr1_lighting.new_light()
    check((light['inner_range'], light['range']) == (2.0, 6.0), 'lights: the exporter\'s new light is 1 / 3 m at world scale 0.5')
    b = sr1_lighting._record(dict(light, color=[1, 1, 1]), (0.0, 0.0, 0.0), 0.5)
    check((rc.F32(b, 104), rc.F32(b, 108), rc.F32(b, 112)) == (1.0, 3.0, 20.0), 'lights: record ranges are the light\'s own times the world scale')


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
    # Look-only: a bush (not an overlay), then a tag stuck on the fence and a road marking (overlays).
    items += [
        dict(base, name='Bush', path=obj_box(work / 'bush.obj', (2, 2, 2), 'b'), position=[-20, 0, -20], textures={'b': tex('b.png', (40, 120, 40))},
             collision_disabled=True),
        dict(base, name='Tag', path=obj_box(work / 'tag.obj', (4, 2, 0.04), 't'), position=[0, 1, 11.88], textures={'t': tex('t.png', (220, 40, 160), 255)},
             alpha={'t': True}, collision_disabled=True, group='Decal@0,1,11.88#123456'),
        dict(base, name='Line', path=obj_box(work / 'line.obj', (6, 0.02, 0.5), 'l'), position=[0, 0.01, -8], textures={'l': tex('l.png', (240, 240, 240))},
             collision_disabled=True),
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
    lights = [dict(name='Room', enabled=True, position=[0, 3, 0], color=[1, 0.9, 0.8], intensity=0.5, inner_range=2, range=6),
              dict(name='Lamp', enabled=True, position=[10, 9, 0], color=[1, 0.89, 0.8], intensity=1, inner_range=22, range=34),
              dict(name='Odd', enabled=True, position=[-10, 4, 0], color=[0.2, 0.4, 1], intensity=2, inner_range=0.5, range=13)]
    spec = dict(job='r', scene_items=items, markers=markers, lights=lights, base_name='rrtest', world_scale=0.5, mirror_x=True,
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


def records(ch):
    recs = ch.get('static_records').data
    n = rc.U32(ch.header, 868)
    names = bytes(recs[80 * n:]).split(b'\0')[:n]
    inst = ch.get('instances').data
    out = []
    for r in range(n):
        ii = rc.I32(recs, 80 * r + 60)
        mesh = rc.U32(inst, 112 * ii + 104) if 0 <= ii < len(inst) // 112 else None
        out.append(dict(name=names[r].decode('latin1'), flags=rc.U32(recs, 80 * r + 32), fade=rc.F32(recs, 80 * r + 28) ** 0.5, mesh=mesh))
    return out


def export_fades(x):
    g = rc.chunk_geometry(x['ch'])
    drawn = lambda k: k is not None and k < len(g.meshes) and any(rc.U16(S.s16, 2) for S in g.meshes[k].subs)
    rs = [r for r in records(x['ch']) if drawn(r['mesh'])]
    world = [r for r in rs if rr.record_kind(r['flags']) == 'world']
    glass = [r for r in rs if r['name'].endswith('native_glass_000')]
    props = [r for r in rs if rr.record_kind(r['flags']) == 'prop']
    close = lambda a, b: abs(a - b) < 0.01
    check(world and all(close(r['fade'], rr.FADE_WORLD) for r in world), f'export: {len(world)} world record(s) fade at {rr.FADE_WORLD:g} m (was the donor\'s 1000 m)')
    check(len(glass) == 1 and close(glass[0]['fade'], rr.FADE_GLASS), f'export: the glass pane fades at {rr.FADE_GLASS:g} m (was 20 m)')
    check(len(props) >= 2 and all(close(r['fade'], rr.FADE_PROP) for r in props), f'export: {len(props)} prop/breakable record(s) fade at {rr.FADE_PROP:g} m (was 75 m)')
    check(any(l.startswith('Fade distances: ') for l in x['logs']), 'export: logs the fade distances')


def export_decals(x):
    ch = x['ch']
    g = rc.chunk_geometry(ch)
    recs = records(ch)
    inst = ch.get('instances').data
    strings = rc.chunk_strings(ch)
    blocks = rc.parse_mopp_blocks(g.coll)

    def batch_textures(k):
        S = g.meshes[k].subs[0]
        return sorted(strings[rc.U32(g.mats[rc.U16(S.b16, 8 * b + 6)].parts[0], 4)].split('_')[1] for b in range(rc.U16(S.s16, 2)))
    decal = [(i, r) for i, r in enumerate(recs) if (r['flags'] >> 1) & 3]
    check(len(decal) == 1, f'export: one decal-layer record ({len(decal)})')
    if len(decal) != 1:
        return
    i, r = decal[0]
    k = r['mesh']
    ii = rc.I32(ch.get('static_records').data, 80 * i + 60)
    S = g.meshes[k].subs[0]
    mats = {rc.U16(S.b16, 8 * b + 6) for b in range(rc.U16(S.s16, 2))}
    names = sorted(strings[rc.U32(g.mats[m].parts[0], 4)] for m in mats)
    check(r['flags'] == 0x10000402 and abs(r['fade'] - rr.FADE_DECAL) < 0.01, f'export: record flags 0x{r["flags"]:08X} (retail decals 0x10000402), fade {r["fade"]:.0f} m')
    check(rc.U32(inst, 112 * ii + 108) == 0x1001 and not blocks[k]['code'], 'export: decal instance 0x1001 (out of the instance collision, as retail), no collision mesh')
    check(len(mats) == 2, 'export: the decal record draws the tag and the road marking only ' + str(names))
    bush = [q for q in recs if q['mesh'] is not None and q['mesh'] < len(g.meshes) and q['flags'] == 0x10000000
            and any(rc.U16(s.s16, 2) for s in g.meshes[q['mesh']].subs) and not blocks[q['mesh']]['code']]
    check(len(bush) == 1 and len({rc.U16(g.meshes[bush[0]['mesh']].subs[0].b16, 8 * b + 6) for b in range(rc.U16(g.meshes[bush[0]['mesh']].subs[0].s16, 2))}) == 1,
          'export: the bush stays on its own look-only, base-layer record')
    # Every drawn strip still indexes inside its own vertex buffer, and nothing was lost.
    total = 0
    ok = True
    static = {q['mesh'] for q in recs if rr.record_kind(q['flags']) in ('world', 'decal') and q['mesh'] is not None and q['mesh'] < len(g.meshes)}
    for k_, M in enumerate(g.meshes):
        for s in M.subs:
            V = g.vbs[rc.U32(s.s16, 8)]
            nv = rc.U16(V.desc, 12)
            for b in range(rc.U16(s.s16, 2)):
                f, c = rc.U32(s.b16, 8 * b), rc.U16(s.b16, 8 * b + 4)
                idx = [rc.U16(V.ib, 2 * q) for q in range(f, f + c)]
                ok = ok and f + c <= len(V.ib) // 2 and all(q < nv for q in idx)
                total += rr._strip_triangles(idx) if k_ in static else 0
    check(ok and total == x['summary']['render_triangles'], f'export: every strip indexes inside its vertex buffer; {total} map triangles drawn, as built')
    import native_sky
    _, _, lists = native_sky.tree_lists(ch.get('tree236').data)
    check(any(i in l for l in lists), 'export: the decal record is in the record tree the game culls with')
    check(any(l.startswith('Decals: 1 look-only overlay record(s) on decal layer 1, no collision (1 moved to a mesh of their own)') for l in x['logs']),
          'export: logs the decal layer')


def retail_decals(packfiles):
    """Retail decal-layer records: mostly 0x10000402 without collision, like ours."""
    pk = rc.Packfile(Path(packfiles) / 'mp_city_stream.vpp_xbox2')
    kinds = collections.Counter()
    for m in sorted({e.name[:-14] for e in pk.entries if e.name.endswith('.bbchunk_xbox2')}):
        ch = rc.read_chunk(pk.read(m + '.bbchunk_xbox2'))
        g = rc.chunk_geometry(ch)
        blocks = rc.parse_mopp_blocks(g.coll)
        for q in records(ch):
            if rr.record_kind(q['flags']) == 'decal' and q['mesh'] is not None and q['mesh'] < len(blocks):
                kinds[(q['flags'], bool(blocks[q['mesh']]['code']))] += 1
    pk.close()
    top = kinds.most_common(1)[0][0] if kinds else None
    check(top == (0x10000402, False), f'retail: the commonest decal record is 0x10000402 without collision ({kinds[(0x10000402, False)]} of {sum(kinds.values())})')


def lights(ch):
    n = rc.U32(ch.header, 884)
    d = ch.get('rec136_260').data
    names = bytes(d[136 * n:]).split(b'\0')[:n]
    return [dict(name=names[i].decode('latin1'), flags=rc.U16(d, 136 * i), near=rc.F32(d, 136 * i + 104), far=rc.F32(d, 136 * i + 108),
                 fade=rc.F32(d, 136 * i + 112)) for i in range(n)]


def export_lights(x):
    got = [(round(l['near'], 3), round(l['far'], 3), round(l['fade'], 3)) for l in lights(x['ch'])]
    check(got == [(1.0, 3.0, 20.0), (11.0, 17.0, 68.0), (0.25, 6.5, 26.0)],
          'export: each light\'s own ranges (units x 0.5) and a fade to match ' + str(got))
    check(x['summary']['lights'] == 3, 'export: three lights')


def export_hmap(x):
    d = (x['out'] / 'rrtest.hmap_xbox2').read_bytes()
    ox, oz, w, h, field = struct.unpack_from('>iiIII', d, 0)
    check(field == 4 and len(d) == 20 + 2 * w * h, f'export: height map {w}x{h} with +16 = {field}')


def retail_hmaps(packfiles):
    """Every retail height map (misc.vpp_xbox2) has 4 at +16."""
    pk = rc.Packfile(Path(packfiles) / 'misc.vpp_xbox2')
    fields = collections.Counter()
    mp = 0
    for e in pk.entries:
        if e.name.lower().endswith('.hmap_xbox2'):
            d = pk.read(e.name)
            ox, oz, w, h, field = struct.unpack_from('>iiIII', d, 0)
            fields[field] += 1
            mp += e.name.lower().startswith('mp')
    pk.close()
    check(mp >= 15 and list(fields) == [4], f'retail: all {sum(fields.values())} height maps ({mp} multiplayer) have +16 = 4 ' + str(dict(fields)))


def retail_lights(packfiles):
    """The game's interior omni lights are 1 / 3 m with a 20 m fade, its street lamps 11 / 17 m."""
    pk = rc.Packfile(Path(packfiles) / 'mp_city_stream.vpp_xbox2')
    kinds = collections.defaultdict(collections.Counter)
    for m in ('mp_bac_01', 'mp_bac_03', 'mp_ptp_01', 'mp_arena', 'mp_bor_01', 'mp_crib'):
        if not pk.has(m + '.bbchunk_xbox2'):
            continue
        for l in lights(rc.read_chunk(pk.read(m + '.bbchunk_xbox2'))):
            kind = l['name'].rstrip('0123456789')
            kinds[kind][(l['flags'], round(l['near'], 1), round(l['far'], 1), round(l['fade'], 1))] += 1
    pk.close()
    omni = kinds['BB Omni']
    ours = collections.Counter({k: n for k, n in omni.items() if k[0] == 0x0390})
    check(ours and ours.most_common(1)[0][0] == (0x0390, 1.0, 3.0, 20.0),
          f'retail: interior omni lights with the flags we write (0x0390) are mostly 1 / 3 m, fade 20 m ({ours[(0x0390, 1.0, 3.0, 20.0)]} of {sum(ours.values())})')
    lamp = kinds['lampPostStLightA']
    check(lamp and all(k[1:3] == (11.0, 17.0) for k in lamp), f'retail: every street lamp (lampPostStLightA, {sum(lamp.values())}) is 11 / 17 m')
    capped = [k[3] for c in kinds.values() for k in c if k[0] & 0x80 and k[0] & 0x10]
    check(capped and all(f <= 75 for f in capped), f'retail: lights with their own fade under the 75 m cap (flags 0x90, as ours) fade at {min(capped):g}-{max(capped):g} m')


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
    unit_fades()
    unit_lights()
    unit_hmap(tmp)
    unit_decals()
    pack = os.environ.get('SR1_DATA_PACK')
    if pack:
        x = full_export(Path(pack), tmp)
        if x:
            export_materials(x)
            export_fades(x)
            export_lights(x)
            export_hmap(x)
            export_decals(x)
    else:
        print('skip full export (set SR1_DATA_PACK to run it)')
    game = os.environ.get('SR1_GAME_PACKFILES')
    if game:
        retail_materials(game, tmp)
        retail_lights(game)
        retail_hmaps(game)
        retail_decals(game)
    else:
        print('skip retail comparison (set SR1_GAME_PACKFILES to run it)')

print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)

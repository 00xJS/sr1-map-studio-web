"""Checks early surface registration (py/surface_registration.py) and v1.15's stock object library (py/prop_library.py).

Run from web/:  SR1_DATA_PACK=<unpacked SR1 Map Studio v1.15 folder> py -3 tests/surface_registration_check.py

Without SR1_DATA_PACK only the library stand-in is checked. With it, real exports go through web_api.py: the
checks of v1.15's own test_surface_materials_v115.py (all 22 surfaces, native prop surfaces from their profiles,
exact texture copies, every environment record and byte kept, the city file pointing at the pair, v1.15's export
check), plus the web's own steps (a map texture changed after the export builds the pair again, the texture-memory
note, the switch off). With a v1.13 folder the library checks run against the stand-in. Written to a temporary folder.
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
import web_api  # noqa: E402
import prop_library  # noqa: E402
import peg_xbox2_beaver as peg  # noqa: E402
import sr_reborn_core as rc  # noqa: E402
import sr1_native_glass  # noqa: E402
import sr1_native_props as props  # noqa: E402
import sr1_physical_materials as physical  # noqa: E402
import sr1_safe_export as safe  # noqa: E402
import surface_registration as sreg  # noqa: E402

failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def standin():
    """No library in the data pack: v1.13's two behaviours and surfaces, upstream still imports."""
    props.ASSETS = Path(tempfile.gettempdir()) / 'no_such_pack' / 'native_props'
    check(prop_library.refresh() is False and not prop_library.loaded(), 'library: stand-in without the data pack')
    check(sorted(props.PRESETS) == ['explosive', 'movable'], 'library: only the crate and the propane without it')
    check('Loose physics prop' in props.PRESETS['movable']['description'], 'library: v1.13 descriptions kept')
    check(prop_library.stock_key('Tire') is None, 'library: no stock keys without it')
    check(physical.native_surface_id({'native_prop_behavior': 'movable', 'native_breakable_kind': 'wood'}) == 21
          and physical.native_surface_id({'native_prefab': 'sr1_native_glass_3x3'}) == 8,
          'library: v1.13 surfaces (wood props, heavy-glass panes) without it')


def pack_studio(pack, tmp, library=True):
    studio = tmp / ('studio' if library else 'studio113')
    for name in ('reference_beavercreek', 'native_glass', 'native_props', 'surface_preload_presets'):
        if (pack / name).is_dir():
            shutil.copytree(pack / name, studio / name, ignore=None if library else shutil.ignore_patterns('expanded_v114'))
    (studio / 'native_sky_presets').mkdir(parents=True)
    for ext in ('bbchunk_xbox2', 'peg_xbox2'):
        shutil.copy2(pack / 'native_sky_presets' / f'sr_custom000001.{ext}', studio / 'native_sky_presets')
    return studio


def use(studio, tmp):
    web_api.STUDIO, web_api.WORK = studio, tmp / 'work'
    sr1_native_glass.ASSETS, props.ASSETS = studio / 'native_glass', studio / 'native_props'


def library(studio, tmp):
    use(studio, tmp)
    have = prop_library.refresh()
    check(have and prop_library.loaded(), 'library: loaded from the data pack')
    check(len(props.PRESETS) == 39, f'library: 39 stock behaviours ({len(props.PRESETS)})')
    check(prop_library.stock_key('Tire') == 'stock_tire' and prop_library.stock_key('Crate Small') is None,
          "library: stock keys by profile (the crate stays upstream's 'movable')")
    check(physical.native_surface_id({'native_prop_behavior': 'stock_construction_barrel'}) == physical.NAMES.index('Plastic'),
          "library: a library behaviour's surface is its profile's material")
    rubber = prop_library.material_surface('Red Ball')
    check(rubber is None or physical.native_surface_id({'native_prop_behavior': 'movable', 'native_profile': 'Red Ball'}) == rubber,
          "library: a web profile on the crate record wears its profile's material")
    check(prop_library.refresh() is True and len(props.PRESETS) == 39, 'library: refreshing again changes nothing')


def scene(tmp, name='surf'):
    """22 floor tiles, one per surface, all one picture; a crate, a propane tank, a construction barrel and a glass pane."""
    work = tmp / ('files_' + name)
    work.mkdir()
    lines = ['vt 0 0', 'vt 0 1', 'vt 1 1', 'vt 1 0']
    textures, surfaces = {}, {}
    tex = work / 'surface.png'
    Image.new('RGBA', (32, 32), (120, 140, 160, 255)).save(tex)
    for sid in range(22):
        x, z, v = (sid % 6) * 6., (sid // 6) * 6., sid * 4 + 1
        lines += [f'v {x} 0 {z}', f'v {x} 0 {z + 6}', f'v {x + 6} 0 {z + 6}', f'v {x + 6} 0 {z}',
                  f'usemtl Surface{sid:02}', f'f {v}/1 {v + 1}/2 {v + 2}/3', f'f {v}/1 {v + 2}/3 {v + 3}/4']
        textures[f'Surface{sid:02}'] = str(tex)
        surfaces[f'Surface{sid:02}'] = sid
    floor = work / 'floor.obj'
    floor.write_text('\n'.join(lines) + '\n')
    box = work / 'box.obj'
    v = [(x, y, z) for x in (-.5, .5) for y in (0, 1) for z in (-.5, .5)]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (1, 5, 7, 3), (0, 2, 6, 4)]
    box.write_text('\n'.join([f'v {a} {b} {c}' for a, b, c in v] + ['vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'usemtl m']
                             + [f'f {q[0] + 1}/1 {q[1] + 1}/2 {q[2] + 1}/3\nf {q[0] + 1}/1 {q[2] + 1}/3 {q[3] + 1}/4' for q in quads]) + '\n')
    crate_tex = work / 'crate.png'
    Image.new('RGB', (32, 32), (150, 100, 50)).save(crate_tex)
    base = dict(rotation=[0, 0, 0], scale=1, alpha={}, physics_intent='Static')
    items = [dict(base, name='Floor', path=str(floor), position=[0, 0, 0], textures=textures, surface_ids=surfaces)]

    def prop(label, behaviour, at, **extra):
        it = dict(base, name=label, path=str(box), position=at, textures={'m': str(crate_tex)})
        r = json.loads(web_api.scene_op('native_prop', json.dumps({'item': it, 'behavior': behaviour, 'world_scale': 0.5, 'others': []})))
        check(r['ok'], 'scene: make ' + label + ('' if r['ok'] else ': ' + r['error']))
        items.append({**r['value'], **extra})
    prop('Crate', 'movable', [3, 0, 3])
    prop('Tank', 'explosive', [9, 0, 3])
    prop('Barrel', 'movable', [15, 0, 3], native_profile='Construction Barrel')
    glass = json.loads(web_api.scene_op('create_glass', json.dumps({'position': [21, 0, 3], 'style_label': next(iter(web_api.native.STYLES)), 'world_scale': 0.5, 'others': []})))
    check(glass['ok'], 'scene: glass pane')
    items.append(glass['value'])
    markers = [dict(type='Shared spawn', position=[x, 0.1, 1], yaw=0, label='') for x in (2, 8, 14, 20)]
    return dict(job=name, scene_items=items, markers=markers, lights=[], base_name=name, world_scale=0.5, mirror_x=True,
                flip_obj_v=True, double_sided=False, ptp=False, surface_preload=True), surfaces


def export(spec):
    logs = []
    r = json.loads(web_api.export_project(json.dumps(spec), logs.append))
    return r, logs


def full(studio, tmp, sky):
    use(studio, tmp)
    spec, surfaces = scene(tmp, 'surfcheck')
    r, logs = export(spec)
    check(r['ok'], 'export: runs with early surface registration' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
    if not r['ok']:
        return
    out = Path(r['value']['out_dir'])
    city = (out / 'surfcheck.bbcity_xbox2').read_bytes()
    stem = city[0x3ec:0x3fc].split(b'\0')[0].decode()
    pair = [out / f'{stem}.{ext}' for ext in ('bbchunk_xbox2', 'peg_xbox2')]
    check(len(city) == 3060416 and stem.startswith('sf_') and len(stem) == 15, 'export: full-size city names a 15-character sf_ environment ' + stem)
    check(all(p.is_file() for p in pair) and str(pair[0]) in r['value']['files'] and str(pair[1]) in r['value']['files'],
          'export: both sf_ files are among the map files')
    check(pair[0].read_bytes() == (sky / 'sr_custom000001.bbchunk_xbox2').read_bytes(), 'export: the environment chunk is the stock one, unchanged')
    source, sh, se = peg.parse_peg(sky / 'sr_custom000001.peg_xbox2', include_frames=True)
    actual, ah, ae = peg.parse_peg(pair[1], include_frames=True)
    _, _, main = peg.parse_peg(out / 'surfcheck.peg_xbox2')
    added = ah.total_entries - sh.total_entries
    check((sh.count, sh.total_entries) == (2128, 2154), 'environment: stock directory has 2,128 names in 2,154 records')
    check(ah.count - sh.count == added and added == r['value']['summary']['surface_textures'], f'environment: {added} textures added, as the summary says')
    delta = ae[0].data_offset - se[0].data_offset
    start = min(e.data_offset for e in se)
    check(actual[start + delta:start + delta + len(source) - start] == source[start:], 'environment: the stock payload is kept byte for byte')
    check(all(a.raw[4:] == b.raw[4:] and b.data_offset == a.data_offset + delta for a, b in zip(se, ae)), 'environment: every stock record kept, animated frames too')
    check(ah.data_size == len(actual) - (24 + ah.total_entries * 72), 'environment: data size field as retail PEGs')
    lookup = {e.name: e for e in ae}
    # Texture names start with the first 8 characters of the map name (shared_textures.py).
    statics = [e for e in main if e.name.startswith('surfchec_')]
    check(sorted(physical.classify_bitmap_name(e.name) for e in statics) == list(range(22)),
          'textures: 22 floor textures, one per surface (one picture shared, so only the suffix differs)')
    check(all(e.name in lookup and lookup[e.name].raw[4:] == e.raw[4:] and lookup[e.name].payload == e.payload
              and struct.unpack_from('>H', e.raw, 10)[0] == 0 for e in statics),
          'textures: each one copied exactly into the environment, reserved field zero')
    ch = rc.read_chunk((out / 'surfcheck.bbchunk_xbox2').read_bytes())
    names = rc.chunk_strings(ch)
    native_items = [it for it in spec['scene_items'] if web_api.native.is_glass(it)]
    ng = [n for n in names if n.startswith('ng_')]
    want = {physical.SUFFIXES[physical.NAMES.index(m)] for m in ('Wood', 'Metal Solid', 'Plastic', 'Glass Heavy')}
    check({n.rsplit('_', 1)[1][:2] for n in ng if physical.classify_bitmap_name(n) != 0} >= want,
          'native objects: crate wood, propane metal, construction barrel plastic, glass heavy glass ' + str(sorted(ng)))
    check(all(n in lookup for n in ng if n.rsplit('_', 1)[1][:2] in want), 'native objects: their surface textures are registered early')
    check(len(native_items) == 4, 'native objects: four in the scene')
    try:
        safe.validate_map(out, 'surfcheck')
        check(True, "export: passes v1.15's own export check")
    except ValueError as exc:
        check(False, "export: passes v1.15's own export check: " + str(exc))
    note = [line for line in logs if line.startswith('Surface registration:')]
    check(note and stem in note[-1] and 'not yet tried in game' in note[-1], 'log: the pair named, untested in game')

    # A web step after the export changes a surface texture: finish() notices and builds the pair again.
    data = bytearray((out / 'surfcheck.peg_xbox2').read_bytes())
    first = statics[0]
    data[first.data_offset] ^= 0xFF
    (out / 'surfcheck.peg_xbox2').write_bytes(data)
    report = {'surface_preload': {'enabled': True, 'resource_name': stem, 'added': [e.name for e in ae[sh.total_entries:]],
                                  'donor_total_entries': sh.total_entries}}
    lines = []
    facts = sreg.finish(out, 'surfcheck', report, {'surface_preload': True}, studio, lines.append)
    city = (out / 'surfcheck.bbcity_xbox2').read_bytes()
    new = city[0x3ec:0x3fc].split(b'\0')[0].decode()
    check(new != stem and new == facts['resource_name'] and not (out / f'{stem}.peg_xbox2').exists(),
          'rebuild: a changed texture gets a new pair, the old one removed')
    safe.validate_map(out, 'surfcheck')
    check(any('Building the pair again' in line for line in lines), 'rebuild: logged')
    check(facts['copied_bytes'] > 0, 'memory: the copies counted for the texture-memory warning')
    warned = []
    import shared_textures
    shared_textures.check_size(out / 'surfcheck.peg_xbox2', warned.append, 40e6)
    check(warned and 'copies for early surface registration' in warned[0], 'memory: warning counts the copies')

    # The limits.
    spec2 = dict(spec, job='long', base_name='surfacechk1')
    r2, _ = export(spec2)
    check(not r2['ok'] and '10 characters' in r2['error'], 'name: 11 characters refused with the setting on')
    spec3 = dict(spec, job='compact', bbcity_donor=str(studio / 'reference_beavercreek' / 'beavercreek.bbcity_xbox2'))
    r3, _ = export(spec3)
    check(not r3['ok'] and 'compatible full BBCity' in r3['error'], 'city: a compact city donor is refused, not silently replaced')
    spec4 = dict(spec, job='off', surface_preload=False)
    r4, _ = export(spec4)
    off = Path(r4['value']['out_dir']) if r4['ok'] else None
    check(r4['ok'] and len((off / 'surfcheck.bbcity_xbox2').read_bytes()) == 960 and not list(off.glob('sf_*'))
          and r4['value']['summary']['surface_textures'] == 0, 'off: compact city, no sf_ files')


def v113(pack, tmp):
    """A v1.13-style data pack (no library): exports still run, props keep v1.13 surfaces."""
    studio = pack_studio(pack, tmp, library=False)
    use(studio, tmp)
    check(prop_library.refresh() is False, 'v1.13 pack: stand-in again')
    spec, _ = scene(tmp, 'oldpack')
    spec['scene_items'] = [it for it in spec['scene_items'] if it.get('native_profile') != 'Construction Barrel']
    r, logs = export(spec)
    check(r['ok'], 'v1.13 pack: export with early registration runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))


with tempfile.TemporaryDirectory() as t:
    tmp = Path(t)
    standin()
    pack = os.environ.get('SR1_DATA_PACK')
    if not pack:
        print('skip exports (set SR1_DATA_PACK to run them)')
    else:
        pack = Path(pack)
        if (pack / 'native_props' / 'expanded_v114').is_dir():
            studio = pack_studio(pack, tmp)
            library(studio, tmp)
            full(studio, tmp, pack / 'native_sky_presets')
        else:
            print('skip v1.15 checks (the data pack has no stock object library)')
        v113(pack, tmp)
print(f'\n{len(failures)} failure(s)')
sys.exit(1 if failures else 0)

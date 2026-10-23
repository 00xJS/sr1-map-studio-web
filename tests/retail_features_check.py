"""Checks the retail-map features: Blinged Out Ride files, sound zones, smashing crates.

Run from web/:  py -3 tests/retail_features_check.py   (needs numpy and Pillow)

With SR1_DATA_PACK set to an unpacked SR1 Map Studio desktop folder it also
runs a full export through web_api.py with a Blinged Out Ride setup, sound
zones and a smashing crate (its effect made up for the test). With
SR1_GAME_PACKFILES also set to the game's packfiles folder, the crate effect
is read from the game's own city chunk, as the editor does in the browser.
Everything is written to a temporary folder.
"""
import json
import os
import re
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
import bor_mode  # noqa: E402
import sound_zones  # noqa: E402
import crate_debris  # noqa: E402
import map_features as mf  # noqa: E402

fast_dxt.install()
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def M(t, pos, **kw):
    return dict(type=t, position=list(pos), yaw=kw.pop('yaw', 0), label='', **kw)


BOR_MARKERS = [
    M('Red team spawn', (-10, 0, 0)), M('Blue team spawn', (10, 0, 0)), M('Shared spawn', (0, 0, 5)),
    M(bor_mode.CAR_RED, (-12, 0, 2)), M(bor_mode.CAR_RED, (-12, 0, 6), vehicle='sp_forklift01'),
    M(bor_mode.CAR_BLUE, (12, 0, 2)), M(bor_mode.CAR_BLUE, (12, 0, 6), vehicle='not_a_car'),
    M(bor_mode.GARAGE_RED, (-20, 0, 0), size=[6, 4, 10]), M(bor_mode.GARAGE_BLUE, (20, 0, 0)),
    M(bor_mode.CHOP_SHOP, (0, 0, -20), yaw=90), M(bor_mode.ENTRANCE, (0, 0, -12)), M(bor_mode.DOOR, (6, 0, -12)),
    M(bor_mode.VICTORY, (0, 0, 20)), M('Chains drop-off', (0, 0, 0), radius=0.7, disabled=True),
    M(bor_mode.CASH, (3, 0, 3)), M(bor_mode.CASH, (-3, 0, -3)),
]


def bor_text():
    check(bor_mode.missing(BOR_MARKERS) == [], 'bor: complete setup needs nothing')
    need = bor_mode.missing([m for m in BOR_MARKERS if m['type'] not in (bor_mode.VICTORY, bor_mode.CASH)])
    check(need == ['the victory garage', 'cash spawns'], 'bor: missing parts named ' + str(need))
    navs, triggers, respawns, table = bor_mode.records('mymap', BOR_MARKERS, 0.5, True, (0., 0., 0.), 'scene')
    check(table['victory'] == 'mymap_$bor_victory0' and table['chops'] == ['mymap_$bor_chop0'], 'bor: victory and chop shop named')
    check(table['garages'] == {1: 'mymap_$bor_garage10', 2: 'mymap_$bor_garage20'}, 'bor: a garage per team')
    check(table['rides'] == {1: 'mymap_$bor_car1_0', 2: 'mymap_$bor_car2_0'}, 'bor: first car of each team is its ride')
    check(table['extra'] == [('sp_forklift01', 'mymap_$bor_car1_1', 1), (bor_mode.DEFAULT_EXTRA_CAR, 'mymap_$bor_car2_1', 2)],
          'bor: further cars are extra cars, unknown models replaced ' + str(table['extra']))
    check(respawns.count('+Vehicle') == 4 and respawns.count('+MPTeam1') == 2 and respawns.count('+MPTeam2') == 2, 'bor: car respawns')
    check(triggers.count('"bounding box"') == 7, "bor: seven box triggers (with the door and the shop's inside box)")
    door = re.search(r'"mymap_\$bor_chopdoor0".*?\n\n', triggers, re.S).group(0)
    check('"garage enter"' in door and '+Disabled' in door and '-1.000000 0.000000 -1.000000 1.000000 2.000000 1.000000' in door,
          'bor: on-foot door is a small disabled garage-enter box')
    inside = re.search(r'"mymap_\$bor_chopint0".*?\n\n', triggers, re.S).group(0)
    check('"garage interior"' in inside and '+Disabled' in inside and '$Navpoint:\t"mymap_$bor_chopint0"' in navs,
          'bor: chop shop gets a small inside box at its middle')
    garage = re.search(r'"mymap_\$bor_garage10".*?\n\n', triggers, re.S).group(0)
    check('+Disabled' in garage and '$Box size:\t\t\t\t-3.000000 0.000000 -5.000000 3.000000 4.000000 5.000000' in garage,
          'bor: garage box from its size, starting disabled')
    chop = re.search(r'"mymap_\$bor_chop0".*?\n\n', triggers, re.S).group(0)
    check('+Disabled' not in chop and '"multiplayer chop shop"' in chop, 'bor: chop shop enabled')
    # Positions are converted like every other marker (scale 0.5, x mirrored); yaw too.
    nav = re.search(r'\$Navpoint:\t"mymap_\$bor_chop0"\n.*?\n\n', navs, re.S).group(0)
    check('<-0.000000 0.000000 -10.000000>' in nav and '[-1.570796]' in nav, 'bor: navpoint converted ' + nav.split('\n')[2])
    x = bor_mode.mode_xtbl('mymap BOR', table)
    check('<ID>' not in x and x.count('<CarEntry>') == 2 and x.count('<SpawnNav>') == 2 and '\r\n' in x, 'bor: mode table')
    check('<TeamOne>mymap_$bor_car1_0</TeamOne>' in x and '<Team>Team Two</Team>' in x, 'bor: table names the respawns')
    main = ('// -------\n#Includes\n// -------\n\n// -------\n#Navpoints\n// -------\n\n$Navpoint:\t"a"\n\n'
            '// -------\n#Triggers\n// -------\n\n$Trigger:\t"d"\n$Trigger action:\t"chains drop off"\n+Disabled\n$Sphere radius:\t0.7\n\n'
            '// -------\n#Respawns\n// -------\n\n$Respawn:\t"s"\n$Start nav:\t"a"\n\n$Respawn:\t"r"\n$Start nav:\t"a"\n+MPTeam1\n\n'
            '// -------\n#Humans\n// -------\n')
    text, dropped = bor_mode.bor_cts(main, navs, triggers, respawns)
    check(dropped == 1 and '"s"' not in text and '"r"' in text, 'bor cts: shared spawns left out, team spawns kept')
    check('+Disabled\n$Sphere' not in text, 'bor cts: drop-off starts enabled')
    check(text.index('mymap_$bor_victory0') > text.index('#Navpoints') and text.index('"blinged victory"') > text.index('#Triggers')
          and text.index('+Vehicle') > text.index('#Respawns') and text.index('+Vehicle') < text.index('#Humans'), 'bor cts: records in their sections')


def sound_text():
    log = []
    zones = sound_zones.collect([
        M('Sound zone', (2, 0, 4), sound='AMB_TEST_BIRDS_1', radius=10, volume=0.5),
        M('Sound zone', (0, 0, 0), sound='amb_test_room tone.wav', shape='box', size=[20, 6, 10], sound_random=True, delay_min_s=8, delay_max_s=3),
        M('Sound zone', (0, 0, 0), sound=''), M('Sound zone', (0, 0, 0), sound='bad"name'),
        M('Shared spawn', (0, 0, 0)),
    ], 0.5, True, (0., 0., 0.), 'scene', log.append)
    check(len(zones) == 2 and len(log) == 2, 'sound: zones without a usable sound skipped')
    check(zones[0][0] == (-1.0, 0.0, 2.0), 'sound: position converted like markers')
    text = sound_zones.ambience_cts('mymap', zones)
    check('+File:\t"amb_test_birds_1.wav"' in text and '+File:\t"amb_test_room tone.wav"' in text, 'sound: names written as the game\'s files')
    check('$Outer Radius:\t10.00' in text and '$Inner Radius:\t8.50' in text, 'sound: sphere fades in over its edge')
    check('$Outer Dimensions:\t<20.000000 6.000000 10.000000>' in text and '$Inner Dimensions:\t<18.000000 4.000000 8.000000>' in text,
          'sound: box with a smaller inner box')
    check('$Play Type:\t"Random"' in text and '$Min Delay:\t3000' in text and '$Max Delay:\t8000' in text, 'sound: random with delays in ms')
    check(text.count('$Navpoint:\t"amb_mymap_z0') == 4 and text.rstrip().endswith('#End') and '\r\n' in text, 'sound: navpoints, end marker')
    check(text.index('#Navpoints') < text.index('$Navpoint:') < text.index('#Cameras') and text.index('#Ambients') < text.index('$Ambient:'),
          'sound: records under their headings')


def crate_bytes():
    payload = b'WB17' + b'\0' * 12 + b'boards_wo.tga\0x\0ds_shard.tga\0boards_wo.tga\0glow.tgn\0' + b'\0' * 7
    check(crate_debris.texture_names(payload) == ['boards_wo.tga', 'ds_shard.tga', 'glow.tgn'], 'crate: picture names in an effect')
    rows = [(1, b'abc'), (crate_debris.key('dth_crate'), payload)]
    bank = crate_debris.build_effects(rows)
    check(crate_debris.effects(bank) == rows and len(bank) % 64 == 0, 'crate: effect bank round trip')
    check(crate_debris.key('dth_crate') == 0x4C2E1ADA, 'crate: effect key')
    check(crate_debris.effects(crate_debris.build_effects([])) == [], 'crate: empty bank')


def obj_box(work, name, sx, sy, sz, mat):
    v = [(x * sx, y * sy, z * sz) for x in (-.5, .5) for y in (0, 1) for z in (-.5, .5)]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (1, 5, 7, 3), (0, 2, 6, 4)]
    lines = [f'v {a} {b} {c}' for a, b, c in v] + ['vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', f'usemtl {mat}']
    for q in quads:
        lines += [f'f {q[0]+1}/1 {q[1]+1}/2 {q[2]+1}/3', f'f {q[0]+1}/1 {q[2]+1}/3 {q[3]+1}/4']
    p = work / name
    p.write_text('\n'.join(lines) + '\n')
    return str(p)


def made_up_donor(pack, folder):
    """A stand-in crate effect naming two pictures copied from Beaver Creek's texture file."""
    _, _, entries = peg.parse_peg(pack / 'reference_beavercreek' / 'beavercreek.peg_xbox2')
    picks = [e for e in entries if e.payload][:2]
    folder.mkdir(parents=True)
    names = [('dbg_' + e.name) for e in picks]
    payload = b'WB17' + b'\0' * 28 + b''.join(n.encode() + b'\0' for n in names + ['always_there.tga']) + b'\0' * 9
    (folder / 'effect.bin').write_bytes(payload)
    tex = []
    for i, (e, n) in enumerate(zip(picks, names)):
        raw = bytearray(e.raw)
        raw[peg.NAME_OFF:peg.NAME_OFF + peg.NAME_LEN] = n.encode().ljust(peg.NAME_LEN, b'\0')[:peg.NAME_LEN]
        (folder / f'texture_{i:02d}.bin').write_bytes(bytes(e.payload))
        tex.append({'name': n, 'entry': bytes(raw).hex(), 'file': f'texture_{i:02d}.bin', 'bytes': len(e.payload)})
    (folder / 'textures.json').write_text(json.dumps({'effect': 'dth_crate', 'source': 'test', 'textures': tex, 'shared': ['always_there.tga']}))
    return payload, names


def full_export(pack, tmp, game):
    import web_api
    studio = tmp / 'studio'
    for name in ('reference_beavercreek', 'native_glass', 'native_props'):
        shutil.copytree(pack / name, studio / name)
    web_api.STUDIO, web_api.WORK = studio, tmp / 'work'
    import sr1_native_glass, sr1_native_props
    sr1_native_glass.ASSETS, sr1_native_props.ASSETS = studio / 'native_glass', studio / 'native_props'
    work = tmp / 'files'
    work.mkdir()

    def tex(name, color):
        p = work / name
        Image.new('RGB', (64, 64), color).save(p)
        return str(p)

    base = dict(rotation=[0, 0, 0], scale=1, alpha={}, physics_intent='Static')
    ground = dict(base, name='Ground', path=obj_box(work, 'ground.obj', 80, 2, 80, 'g'), position=[0, -2, 0], textures={'g': tex('g.png', (90, 90, 90))})
    crate = dict(base, name='Crate', path=obj_box(work, 'crate.obj', 2, 2, 2, 'c'), position=[0, 0, 10], textures={'c': tex('c.png', (150, 100, 50))})
    wood = json.loads(web_api.scene_op('convert_breakable', json.dumps({'item': crate, 'render_mode': 'wood', 'world_scale': 0.5, 'others': []})))['value']
    wood['native_profile'] = 'CrateFruit'
    markers = BOR_MARKERS + [M('Shared spawn', (x, 0.1, 0)) for x in (-4, 4)] + [M('Pimp entrance', (0, 0, -30), radius=1, disabled=False),
        M('Sound zone', (0, 2, 0), sound='AMB_TEST_BIRDS_1', radius=30), M('Sound zone', (5, 2, 5), sound='')]

    def export(job, donor_spec, items):
        logs = []
        spec = dict(job=job, scene_items=items, markers=markers, lights=[], base_name='rftest', world_scale=0.5, mirror_x=True,
                    flip_obj_v=True, double_sided=False, ambience='amb_mp_arena', ptp=True, bor=True, bor_level_name='rftest BOR',
                    crate_debris_source=donor_spec)
        r = json.loads(web_api.export_project(json.dumps(spec), logs.append))
        check(r['ok'], f'export {job}: runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
        return r.get('value'), logs

    def profiles(out):
        ch = rc.read_chunk((out / 'rftest.bbchunk_xbox2').read_bytes())
        recs, db = ch.get('static_records').data, ch.get('rec_blob308').data
        return ch, [bytes(db[4 + rc.U32(recs, i * 80 + 64):db.index(0, 4 + rc.U32(recs, i * 80 + 64))]).decode()
                    for i in range(rc.U32(ch.header, 868)) if rc.U32(recs, i * 80 + 32) & 0x20000]

    # 1. No game files: the crate falls back to today's breaking profile.
    v, logs = export('nogame', {'dir': str(tmp / 'none')}, [ground, wood])
    if v:
        out = Path(v['out_dir'])
        ch, names = profiles(out)
        check(names == ['Can'], 'export: without game files the crate keeps the fallback profile ' + str(names))
        check(not any(k == crate_debris.key('dth_crate') for k, _ in crate_debris.effects(ch.get('skip388').data)), 'export: no crate effect then')
        check(any('need the debris effect' in l for l in logs), 'export: fallback explained in the log')
        main = (out / 'rftest.cts').read_bytes().decode()
        bor = (out / 'rftest_bor.cts').read_bytes().decode()
        ptp = (out / 'rftest_ptp.cts').read_bytes().decode()
        check('$bor_' not in main and 'blinged' not in main and '+Vehicle' not in main, 'export: main CTS has no BOR records')
        check(bor.count('+Vehicle') == 4 and '"blinged victory"' in bor and bor.count('"garage interior"') == 3 and '"garage enter"' in bor, 'export: BOR CTS has the BOR records')
        check('$Include: "amb_rftest.cts"' in bor and '$Include: "amb_mp_arena.cts"' in bor, 'export: BOR CTS keeps both sound includes')
        for name, text in (('main', main), ('ptp', ptp)):
            check('$Include: "amb_rftest.cts"' in text, f'export: {name} CTS includes the sound zones')
        respawns = re.search(r'(?ms)^#Respawns\s*$(.*?)(?=^#[A-Za-z])', bor).group(1)
        check(all('+MPTeam' in b for b in respawns.split('$Respawn:')[1:]), 'export: BOR CTS respawns all have a team')
        navs = set(re.findall(r'(?m)^\$Navpoint:\s*"([^"]+)"', bor))
        refs = re.findall(r'(?m)^\$Start nav:\s*"([^"]+)"', bor)
        check(all(r in navs for r in refs), 'export: every BOR CTS record has its navpoint')
        table = (out / 'rftest_mode.xtbl').read_text()
        named = re.findall(r'<(?:VictoryTrigger|ChopTrigger|TeamOne|TeamTwo|Respawn|SpawnNav)>([^<]+)<', table)
        records = set(re.findall(r'(?m)^\$(?:Trigger|Respawn):\s*"([^"]+)"', bor))
        check(len(named) == 10 and all(n in records or n in navs for n in named), 'export: every name in the mode table is in the BOR CTS')
        amb = (out / 'amb_rftest.cts').read_bytes().decode()
        check(amb.count('$Ambient:') == 1 and v['summary'].get('sound_zones') == 1, 'export: one sound zone (the one without a sound skipped)')
        check(v['summary'].get('bor_records') == 12, 'export: summary counts BOR markers')

    # 2. A made-up crate effect: added to the effect bank, its pictures to the map's texture file.
    donor = tmp / 'donor'
    payload, pics = made_up_donor(pack, donor)
    v, logs = export('donor', {'dir': str(donor)}, [ground, wood])
    if v:
        out = Path(v['out_dir'])
        ch, names = profiles(out)
        check(names == ['CrateFruit'], 'export: with the effect the crate smashes ' + str(names))
        check(any(k == crate_debris.key('dth_crate') and p == payload for k, p in crate_debris.effects(ch.get('skip388').data)), 'export: crate effect in the bank')
        check(rc.U32(ch.header, 204) == len(ch.get('skip388').data), 'export: bank length in the header')
        _, _, pe = peg.parse_peg(out / 'rftest.peg_xbox2')
        check(rc.chunk_strings(ch) == [x.name for x in pe] and all(p in rc.chunk_strings(ch) for p in pics), 'export: effect pictures added, names in step')
        check(not any(x.name == 'always_there.tga' for x in pe), 'export: always-loaded pictures not copied')

    # 3. The real thing, from the player's own game files.
    if game:
        sys.path.insert(0, str(root / 'tests'))
        chunk, pegf = read_city_chunk(game, tmp / 'game')
        v, logs = export('game', {'dir': str(tmp / 'real_donor'), 'chunk': str(chunk), 'peg': str(pegf)}, [ground, wood])
        if v:
            out = Path(v['out_dir'])
            ch, names = profiles(out)
            summary = json.loads((tmp / 'real_donor' / 'textures.json').read_text())
            check(names == ['CrateFruit'] and len(summary['textures']) >= 4, 'export (game files): crate effect and %d pictures from %s'
                  % (len(summary['textures']), summary['source']))
            check(not chunk.exists() and not pegf.exists(), 'export (game files): the big game files are removed after use')
            print('     shared pictures:', ', '.join(summary['shared']))
    print('\n'.join('     log: ' + l for l in logs if any(k in l for k in ('Blinged', 'Sound', 'Crates', 'Breakables'))))


def read_city_chunk(packfiles, folder):
    """sr_chunk12's chunk and texture file from sr_city_stream.vpp_xbox2 (zlib per entry), as the browser reads them."""
    import zlib
    path = Path(packfiles) / 'sr_city_stream.vpp_xbox2'
    folder.mkdir(parents=True, exist_ok=True)
    up = lambda x: (x + 2047) & ~2047
    with open(path, 'rb') as f:
        head = f.read(0x800)
        u = lambda d, o: struct.unpack_from('>I', d, o)[0]
        n, names_at = u(head, 0x154), up(0x800 + u(head, 0x15C))
        data_at = up(names_at + u(head, 0x160))
        f.seek(0)
        d = f.read(data_at)
        stored, want, out = data_at, {'sr_chunk12.bbchunk_xbox2', 'sr_chunk12.peg_xbox2'}, []
        for i in range(n):
            e = 0x800 + 28 * i
            na = names_at + u(d, e)
            name = d[na:d.index(b'\0', na)].decode('latin1')
            ss = u(d, e + 20)
            if name.lower() in want:
                f.seek(stored)
                raw = f.read(ss)
                p = folder / name
                p.write_bytes(zlib.decompressobj(-15).decompress(raw[2:]))
                out.append(p)
            stored = up(stored + ss)
    return sorted(out, key=lambda p: p.suffix != '.bbchunk_xbox2')


with tempfile.TemporaryDirectory() as t:
    tmp = Path(t)
    bor_text()
    sound_text()
    crate_bytes()
    pack = os.environ.get('SR1_DATA_PACK')
    if pack:
        full_export(Path(pack), tmp, os.environ.get('SR1_GAME_PACKFILES'))
    else:
        print('skip full export (set SR1_DATA_PACK to run it)')

print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)

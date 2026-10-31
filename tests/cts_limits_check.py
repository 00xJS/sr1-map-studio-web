"""Checks the game's CTS limits in studio-py/sr1_cts.py and py/item_props.py (report BC, sections 2, 5 and 6).

Run from web/:  py -3 tests/cts_limits_check.py   (standard library only)

With SR1_DATA_PACK set to an unpacked SR1 Map Studio desktop folder it also runs a full export through web_api.py
(needs numpy and Pillow) and reads its log and CTS files. Everything is written to a temporary folder. Nothing here
has been tried in game.
"""
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
import item_props  # noqa: E402
import map_features  # noqa: E402
import sr1_cts  # noqa: E402

failures = []
SKELETON = ''.join(f'{h}\n\n' for h in sr1_cts.REQUIRED_HEADINGS)


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def M(kind, **kw):
    return {'type': kind, 'position': (0, 0, 0), **kw}


def cts(*markers):
    return sr1_cts.build_cts(SKELETON, list(markers), 'm', coordinate_space='game')


def fires(text):
    return [int(v) for v in re.findall(r'\$Trigger max fires:\s*(-?\d+)', text)]


# Pimp exit
try:
    cts(M('Pimp exit (experimental)'))
    check(False, 'pimp exit: refused')
except ValueError as e:
    check('Unsupported marker category' in str(e), 'pimp exit: refused')
check('Pimp exit (experimental)' not in sr1_cts.TRIGGER_KINDS, 'pimp exit: not a trigger kind')
check(len(sr1_cts.TRIGGER_ACTIONS) == 41 and sr1_cts.TRIGGER_ACTIONS[0] == 'execute lua script', 'actions: 41 names, index 0 first')
check('pimp enter' in sr1_cts.TRIGGER_ACTIONS and 'pimp exit' not in sr1_cts.TRIGGER_ACTIONS, 'actions: pimp enter only')
text, report = cts(M('Sphere trigger (custom)', trigger_action='pimp exit'))
check(any('"pimp exit"' in x for x in report['limits']), 'actions: a typed pimp exit is reported')
text, report = cts(M('Sphere trigger (custom)', trigger_action='Save Spot'))
check(not report['limits'] and '"Save Spot"' in text, 'actions: known name passes, ignoring case as the game does')

# Max fires
for value, want in ((0, 0), (255, 255), (256, 255), (1000000, 255), (2000000, 255)):
    text, report = cts(M('Chains drop-off', max_fires=value))
    check(fires(text) == [want] and bool(report['limits']) == (value > 255), f'max fires: {value} writes {want}')
try:
    cts(M('Chains drop-off', max_fires=-1))
    check(False, 'max fires: negative refused')
except ValueError:
    check(True, 'max fires: negative refused')

# Starts switched off
text, report = cts(M('Chains drop-off'))
check('+Disabled' not in text and not report['limits'], 'chains: no +Disabled unless asked')
text, report = cts(M('Chains drop-off', disabled=True), M('Chains drop-off', disabled=False))
check(text.count('+Disabled') == 1 and not report['limits'], 'chains: some off is written, as on mp_bac_03')
text, report = cts(M('Chains drop-off', disabled=True), M('Chains drop-off', disabled=True))
check(text.count('+Disabled') == 2 and not report['limits'], 'chains: all off is written; only a Chains mode warns about it')
text, report = cts(M('Pimp entrance'), M('Sphere trigger (custom)', trigger_action='save spot'))
check(text.count('+Disabled') == 2, 'other triggers keep their default')

# Which files each mode loads, and the messages that follow them. Same mode names and rules as src/lib/levels.ts.
for modes, ptp, bor, want in ((['Gangsta Brawl'], 0, 0, ['']), (['Team Big Ass Chains'], 0, 0, ['']), (['Protect Tha Pimp'], 1, 0, ['_ptp']),
                              (['Blinged Out Ride'], 0, 1, ['_bor']), (['Team Gangsta Brawl', 'Protect Tha Pimp', 'Blinged Out Ride'], 1, 1, ['', '_ptp', '_bor']),
                              ([], 0, 0, [''])):
    check(map_features.loaded_cts(dict(modes=modes, ptp=ptp, bor=bor)) == want, f'loaded files: {modes} load {want}')
check(map_features.loaded_cts({}) == [''], 'loaded files: a spec with no modes counts as loading the main file')


def chains_log(modes, *flags):
    logged = []
    map_features.check_chains_on(dict(modes=modes), [M('Chains drop-off', disabled=f) for f in flags], logged.append)
    return '\n'.join(logged)


check('every Chains drop-off' in chains_log(['Big Ass Chains'], True, True), 'chains: all off warns in Big Ass Chains')
check('every Chains drop-off' in chains_log(['Team Big Ass Chains', 'Blinged Out Ride'], True), 'chains: and when Blinged Out Ride is on beside it')
check(not chains_log(['Big Ass Chains'], True, False), 'chains: some on is fine')
check(not chains_log(['Big Ass Chains']), 'chains: no drop-offs, nothing to say')
for modes in (['Gangsta Brawl'], ['Blinged Out Ride'], ['Protect Tha Pimp']):
    check(not chains_log(modes, True, True), f'chains: no warning on {modes}')

# Item props: distinct types, not how many
with tempfile.TemporaryDirectory() as tmp:
    def export(weapons, props):
        """Writes a map CTS with these weapon pickups and props. Returns its $Item types, the count and the log."""
        text, _ = cts(*[M('Weapon pickup', label=w) for w in weapons])
        Path(tmp, 'm.cts').write_text(text, encoding='utf-8')
        logged = []
        placed = item_props.collect([M('Item prop', item=p) for p in props], 1.0, False, (0, 0, 0), 'game', logged.append)
        count = item_props.write(tmp, 'm', placed, logged.append)
        out = Path(tmp, 'm.cts').read_text(encoding='utf-8')
        return re.findall(r'\$Item type:\s*"([^"]*)"', out), count, '\n'.join(logged)

    types, count, log = export(['ak47'], ['Chair_Office'] * 64)
    check(count == 64 and len(set(types)) == 2, 'props: 64 of one type stay')
    check('turns placed items into those weapons' in log, 'props: the log says lobby weapons replace them')

    types, count, log = export([f'w{i}' for i in range(5)], [f'p{i}' for i in range(30)])
    check(count == 15 and len(set(types)) == item_props.MAX_ITEM_TYPES, 'props: stops at 20 types, counting pickups')
    check('15 left out' in log, 'props: the log says how many were left out')

    types, count, log = export([f'w{i}' for i in range(5)], [f'p{i}' for i in range(15)] + ['P0', 'p16', 'w1'])
    check(count == 17 and types.count('p16') == 0, 'props: a type already in the map still fits at the limit')

    def type_log(*suffixes):
        logged = []
        item_props.check_type_limit(tmp, 'm', suffixes, logged.append)
        return '\n'.join(logged)

    types, count, log = export([f'w{i}' for i in range(21)], ['w1', 'p1'])
    check(len(set(types)) == 21 and count == 1, 'props: never adds a type past the limit; pickups are kept')
    check('m.cts has 21 different item types' in type_log(''), 'pickups: past the limit is a warning')
    check(type_log('_ptp') == '', 'pickups: not warned about when no selected mode loads the main file')
    Path(tmp, 'm_bor.cts').write_text(Path(tmp, 'm.cts').read_text(encoding='utf-8'), encoding='utf-8')
    check('m_bor.cts has 21' in type_log('_bor') and 'm.cts' not in type_log('_bor'), "pickups: Blinged Out Ride's copy is checked on its own")
    Path(tmp, 'm_bor.cts').unlink()

    types, count, log = export([f'w{i}' for i in range(21)], [])
    check(count == 0 and 'has 21' in type_log(''), 'pickups: warned about with no props too')

    types, count, log = export(['ak47'], [])
    check(count == 0 and not log and not type_log(''), 'no props, within the limit: nothing to say')


# Spawns: per CTS file, and the log line about team spawns
with tempfile.TemporaryDirectory() as tmp:
    def respawns(team, n):
        return ''.join(f'$Respawn:\t"{team}{i}"\n$Start nav:\t"{team}{i}"\n' + (f'+MPTeam{team}\n' if team else '') + '\n' for i in range(n))

    def spawn_cts(name, body):
        Path(tmp, name).write_text(SKELETON.replace('#Respawns\n', '#Respawns\n' + body), encoding='utf-8')

    def spawn_log(step):
        logged = []
        step(tmp, 'm', logged.append)
        return '\n'.join(logged)

    def limit_log(*suffixes):
        logged = []
        map_features.check_spawn_limit(tmp, 'm', suffixes, logged.append)
        return '\n'.join(logged)

    spawn_cts('m.cts', respawns('', 64))
    check(limit_log('') == '', 'spawns: 64 in a file is fine')
    spawn_cts('m_ptp.cts', respawns('1', 40) + respawns('2', 40))
    log = limit_log('', '_ptp')
    check('m_ptp.cts has 80 spawns' in log and 'Remove 16' in log and 'm.cts' not in log, 'spawns: only the file over the limit is named')
    spawn_cts('m.cts', respawns('', 65))
    spawn_cts('m_bor.cts', respawns('1', 65))
    log = limit_log('', '_ptp', '_bor')
    check(all(f'{n} has' in log for n in ('m.cts', 'm_ptp.cts', 'm_bor.cts')), 'spawns: each file is checked on its own')
    check('m.cts' not in limit_log('_ptp'), 'spawns: a main file no selected mode loads is not warned about')

    for f in ('m_ptp.cts', 'm_bor.cts'):
        Path(tmp, f).unlink()
    spawn_cts('m.cts', respawns('', 8) + respawns('1', 40))
    log = spawn_log(map_features.write_brawl_spawns)
    check('not in this export' in log and 'neither is on' in log and 'kept for' not in log, 'team spawns: with neither mode on, the log says so')
    spawn_cts('m.cts', respawns('', 8) + respawns('1', 40))
    spawn_cts('m_ptp.cts', respawns('1', 40))
    log = spawn_log(map_features.write_brawl_spawns)
    check('kept for Protect Tha Pimp.' in log, 'team spawns: kept for the mode that is on')
    spawn_cts('m.cts', respawns('', 8) + respawns('1', 40))
    spawn_cts('m_bor.cts', respawns('1', 40))
    log = spawn_log(map_features.write_brawl_spawns)
    check('kept for Protect Tha Pimp and Blinged Out Ride.' in log, 'team spawns: kept for both')


def full_export(pack, tmp):
    """A small map through web_api.py: what the creator reads in the export log, and the files it wrote."""
    from PIL import Image
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
    Image.new('RGB', (64, 64), (90, 90, 90)).save(work / 'g.png')
    verts = [(x, y, z) for x in (-40, 40) for y in (-2, 0) for z in (-40, 40)]
    faces = [(1, 2, 4), (1, 4, 3), (5, 7, 8), (5, 8, 6), (1, 5, 6), (1, 6, 2), (3, 4, 8), (3, 8, 7), (1, 3, 7), (1, 7, 5), (2, 6, 8), (2, 8, 4)]
    (work / 'g.obj').write_text('usemtl g\n' + ''.join(f'v {x} {y} {z}\n' for x, y, z in verts)
                                + ''.join(f'f {a} {b} {c}\n' for a, b, c in faces), encoding='ascii')
    ground = dict(name='Ground', path=str(work / 'g.obj'), position=[0, 0, 0], rotation=[0, 0, 0], scale=1, alpha={},
                  physics_intent='Static', textures={'g': str(work / 'g.png')})

    def P(kind, x, **kw):
        return {'type': kind, 'position': (x, 0.1, 0), 'yaw': 0, 'label': '', **kw}

    markers = ([P('Shared spawn', x) for x in (-4, 4)] + [P('Red team spawn', -8), P('Blue team spawn', 8)]
               + [P('Weapon pickup', i, label=f'w{i}') for i in range(5)] + [P('Item prop', i, item=f'p{i}') for i in range(30)]
               + [P('Chains drop-off', 10, disabled=True), P('Chains drop-off', 12, disabled=True)]
               + [P('Sphere trigger (custom)', 14, trigger_action='pimp exit', max_fires=300), P('Pimp entrance', 16, max_fires=999)])

    def export(job, marks, ptp=True, **modes):
        logs = []
        spec = dict(job=job, scene_items=[ground], markers=marks, lights=[], base_name='limits', world_scale=0.5, mirror_x=True,
                    flip_obj_v=True, double_sided=False, ptp=ptp, **modes)
        return json.loads(web_api.export_project(json.dumps(spec), logs.append)), '\n'.join(logs)

    r, log = export('limits', markers)
    check(r['ok'], 'export: runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
    if r['ok']:
        out = Path(r['value']['out_dir'])
        main = (out / 'limits.cts').read_bytes().decode()
        ptp = (out / 'limits_ptp.cts').read_bytes().decode()
        check(len(item_props.item_types(main)) == 20, 'export: 20 item types in the main CTS')
        check('15 left out' in log and 'turns placed items into those weapons' in log, 'export log: props left out and lobby weapons')
        check(fires(main).count(255) == 1 and fires(ptp).count(255) == 1, 'export: max fires lowered in both CTS files')
        check('max fires 300' in log and 'max fires 999' in log, 'export log: max fires lowered, main and Protect Tha Pimp')
        check('no "pimp exit" trigger action' in log and 'pimp exit' not in main.replace('"pimp exit"', '', 1), 'export log: unknown action')
        check('every Chains drop-off starts switched off' in log, 'export log: every drop-off off, with no modes given')
    r, log = export('exit', markers + [P('Pimp exit (experimental)', 18)])
    check(not r['ok'] and 'pimp exit' in r['error'], 'export: a pimp exit marker stops it')

    teams = [P('Red team spawn', i) for i in range(40)] + [P('Blue team spawn', i) for i in range(40)] + [P('Pimp entrance', 16)]
    r, log = export('many', [P('Shared spawn', i) for i in range(40)] + teams)
    check(r['ok'] and 'limits_ptp.cts has 80 spawns' in log and 'limits.cts has' not in log, 'export log: 40 shared, 80 team warns about the PTP file only')
    r, log = export('off', [P('Shared spawn', i) for i in range(8)] + teams[:-1], ptp=False)
    check(r['ok'] and 'not in this export' in log and 'kept for' not in log and not list(Path(r['value']['out_dir']).glob('*_ptp.cts')), 'export log: 8 shared, 80 team, PTP off says they are not exported')

    # What each mode's file really receives, with the modes the editor sends.
    pair = [P('Red team spawn', -8), P('Blue team spawn', 8)]
    main_only = ([P('Shared spawn', i) for i in range(70)] + [P('Weapon pickup', i, label=f'w{i}') for i in range(21)] + [P('Item prop', i, item=f'p{i}') for i in range(3)]
                 + [P('Chains drop-off', 10, disabled=True), P('Sphere trigger (custom)', 14, trigger_action='pimp exit', max_fires=300)])
    r, log = export('ptponly', main_only + pair + [P('Pimp entrance', 16, max_fires=999)], modes=['Protect Tha Pimp'])
    check(r['ok'], 'mode export: Protect Tha Pimp only runs')
    check('limits.cts has' not in log and 'different item types' not in log, 'mode export: Protect Tha Pimp only says nothing about the main file spawns or item types')
    check('max fires 300' not in log and 'pimp exit' not in log and 'every Chains drop-off' not in log, 'mode export: nor its triggers')
    check('max fires 999' in log, "mode export: the pimp entrance is in Protect Tha Pimp's file, so its max fires are logged")
    check('Item props left out' in log and 'turns placed items' not in log, 'mode export: item props are said to go unused')

    gb = ([P('Shared spawn', i) for i in range(70)] + [P('Weapon pickup', i, label=f'w{i}') for i in range(21)]
          + [P('Chains drop-off', 10, disabled=True), P('Sphere trigger (custom)', 14, trigger_action='pimp exit', max_fires=300), P('Pimp entrance', 16, max_fires=999)])
    r, log = export('gb', gb, ptp=False, modes=['Gangsta Brawl'])
    check(r['ok'] and 'limits.cts has 70 spawns' in log and 'limits.cts has 21 different item types' in log, 'mode export: Gangsta Brawl warns about the main file')
    check('max fires 300' in log and 'pimp exit' in log, 'mode export: and its triggers')
    check('max fires 999' not in log, 'mode export: not the pimp entrance, which is not exported')
    check('every Chains drop-off' not in log, 'mode export: Gangsta Brawl does not use drop-offs')
    r, log = export('bac', gb, ptp=False, modes=['Big Ass Chains'])
    check(r['ok'] and 'every Chains drop-off' in log, 'mode export: Big Ass Chains warns about them all off')

    import bor_mode
    bor = ([P('Red team spawn', -10), P('Blue team spawn', 10), P('Shared spawn', 0)]
           + [P(k, i) for i, k in enumerate((bor_mode.CAR_RED, bor_mode.CAR_BLUE, bor_mode.GARAGE_RED, bor_mode.GARAGE_BLUE, bor_mode.CHOP_SHOP, bor_mode.ENTRANCE, bor_mode.DOOR, bor_mode.VICTORY, bor_mode.CASH, bor_mode.CASH))]
           + [P('Chains drop-off', 12, disabled=True), P('Sphere trigger (custom)', 14, trigger_action='pimp exit', max_fires=300)])
    r, log = export('boronly', bor + [P('Weapon pickup', i, label=f'w{i}') for i in range(10)] + [P('Item prop', i, item=f'p{i}') for i in range(11)], ptp=False, bor=True, modes=['Blinged Out Ride'])
    check(r['ok'], 'mode export: Blinged Out Ride only runs' + ('' if r['ok'] else ': ' + r['error']))
    if r['ok']:
        text = (Path(r['value']['out_dir']) / 'limits_bor.cts').read_bytes().decode()
        check(len(item_props.item_types(text)) == 10, "mode export: Blinged Out Ride's file gets weapon pickups only")
        check('different item types' not in log and 'every Chains drop-off' not in log, 'mode export: so 21 with props says nothing, nor do drop-offs it switches on')
        check('max fires 300' in log and 'pimp exit' in log, 'mode export: its copy holds the custom trigger, which is logged')
    r, log = export('borover', bor + [P('Weapon pickup', i, label=f'w{i}') for i in range(21)], ptp=False, bor=True, modes=['Blinged Out Ride'])
    check(r['ok'] and 'limits_bor.cts has 21 different item types' in log and 'limits.cts has' not in log, 'mode export: 21 pickups warn about the Blinged Out Ride file only')


pack = os.environ.get('SR1_DATA_PACK')
if pack:
    with tempfile.TemporaryDirectory() as tmp:
        full_export(Path(pack), Path(tmp))
else:
    print('skip full export (set SR1_DATA_PACK to run it)')

print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)

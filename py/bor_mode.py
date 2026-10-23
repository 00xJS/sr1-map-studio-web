"""Blinged Out Ride: the mode's own CTS and its <map>_mode.xtbl.

Blinged Out Ride loads a CTS like any other mode, plus a small table named
after the map (levels/<map>_mode.xtbl) that tells the mode which of the CTS's
triggers and respawns play which part:

- the victory garage (a box trigger, "blinged victory"),
- one or two chop shops ("multiplayer chop shop") with their drive-in
  entrances ("blinged chop shop entrance"),
- a garage per team ("garage interior", the team's safe zone),
- a respawn per team where the team's ride appears (+Vehicle), and further
  team cars of chosen models,
- the spots where cash appears (ground navpoints),
- the cash drop-off (a "chains drop off" trigger, from the Chains drop-off
  markers).

The map gets a copy of its main CTS with these records added, <map>_bor.cts,
so the other modes never see vehicle respawns or BOR triggers. Nothing here
has been tried in game yet.
"""
from __future__ import annotations

import math
import re
from pathlib import Path

import sr1_cts

VICTORY = 'BOR victory zone'
CHOP_SHOP = 'BOR chop shop'
ENTRANCE = 'BOR chop shop entrance'
GARAGE_RED = 'BOR red team garage'
GARAGE_BLUE = 'BOR blue team garage'
CAR_RED = 'BOR red team car'
CAR_BLUE = 'BOR blue team car'
CASH = 'BOR cash spawn'
TYPES = (VICTORY, CHOP_SHOP, ENTRANCE, GARAGE_RED, GARAGE_BLUE, CAR_RED, CAR_BLUE, CASH)

# Box triggers: (trigger action, starts disabled, default size w h d in metres).
BOXES = {
    VICTORY: ('blinged victory', True, (12.0, 6.0, 14.0)),
    CHOP_SHOP: ('multiplayer chop shop', False, (5.5, 3.25, 9.5)),
    ENTRANCE: ('blinged chop shop entrance', False, (12.0, 2.0, 6.5)),
    GARAGE_RED: ('garage interior', True, (7.0, 5.0, 11.0)),
    GARAGE_BLUE: ('garage interior', True, (7.0, 5.0, 11.0)),
}
# Models the mode has settings for (its list of extra cars).
EXTRA_CAR_MODELS = ('car_4dr_lowrider01', 'sp_metermaid01', 'sp_forklift01', 'SUV_4dr_03', 'car_4dr_luxury01',
                    'car_2dr_exoticsports01', 'car_2dr_muscle03', 'car_2dr_compact03', 'car_4dr_luxury04',
                    'car_2dr_sports04', 'car_2dr_standard02')
DEFAULT_EXTRA_CAR = 'car_2dr_compact03'
MAX_CHOP_SHOPS = 2
MAX_EXTRA_CARS = 8
MAX_CASH_SPAWNS = 16
MAX_SIDE = 200.0
MIN_SIDE = 0.25


def missing(markers):
    """What the mode still needs, as plain phrases ([] when the map is ready for it)."""
    count = lambda t: sum(1 for m in markers if m.get('type') == t)
    need = []
    for what, ok in (('red team spawns', count('Red team spawn')), ('blue team spawns', count('Blue team spawn')),
                     ('a red team car', count(CAR_RED)), ('a blue team car', count(CAR_BLUE)),
                     ('a red team garage', count(GARAGE_RED)), ('a blue team garage', count(GARAGE_BLUE)),
                     ('a chop shop', count(CHOP_SHOP)), ('a chop shop entrance', count(ENTRANCE)),
                     ('the victory garage', count(VICTORY)), ('a cash drop-off', count('Chains drop-off')),
                     ('cash spawns', count(CASH))):
        if not ok:
            need.append(what)
    return need


def _size(m):
    default = BOXES[m['type']][2]
    size = m.get('size') or default
    out = []
    for v, d in zip(size, default):
        v = float(v)
        if not math.isfinite(v):
            v = d
        out.append(min(MAX_SIDE, max(MIN_SIDE, v)))
    return out


def names(base, markers):
    """CTS name of each BOR marker, in marker order: {marker index: name}."""
    short = {VICTORY: 'victory', CHOP_SHOP: 'chop', ENTRANCE: 'chopin', GARAGE_RED: 'garage1', GARAGE_BLUE: 'garage2',
             CAR_RED: 'car1_', CAR_BLUE: 'car2_', CASH: 'cash'}
    seen, out = {}, {}
    for i, m in enumerate(markers):
        t = m.get('type')
        if t in short:
            k = seen.get(t, 0)
            seen[t] = k + 1
            out[i] = f'{base}_$bor_{short[t]}{k}'
    return out


def _vec(v):
    return ' '.join(f'{x:.6f}' for x in v)


def records(base, markers, world_scale, mirror_x, origin, space):
    """(navpoints, triggers, respawns, table) for the BOR markers: CTS text blocks and the table's contents."""
    named = names(base, markers)
    navs, triggers, respawns = [], [], []
    table = {'victory': None, 'chops': [], 'garages': {1: None, 2: None}, 'rides': {1: None, 2: None}, 'extra': [], 'cash': []}
    for i, name in named.items():
        m = markers[i]
        t = m['type']
        pos = sr1_cts.convert_xyz(m['position'], world_scale, mirror_x, origin, space)
        yaw = sr1_cts.convert_yaw(m.get('yaw', 0), mirror_x, space)
        navs.append(f'$Navpoint:\t"{name}"\n$Type:\t\t"ground"\n$Pos:\t\t\t<{_vec(pos)}>\n'
                    f'$Orient:\t\t[{yaw:.6f}]\n+Chunk:\t\t"{base}"\n\n')
        if t in BOXES:
            action, disabled, _ = BOXES[t]
            w, h, d = _size(m)
            triggers.append(f'$Trigger:\t\t\t\t"{name}"\n$Trigger type:\t\t\t"bounding box"\n'
                            f'$Trigger action:\t\t"{action}"\n$Trigger max fires:\t0\n$Trigger delay:\t\t10000\n'
                            f'$Start nav:\t\t\t\t"{name}"\n' + ('+Disabled\n' if disabled else '')
                            + f'$Box size:\t\t\t\t{_vec((-w / 2, 0, -d / 2, w / 2, h, d / 2))}\n\n')
            if t == VICTORY and table['victory'] is None:
                table['victory'] = name
            elif t == CHOP_SHOP and len(table['chops']) < MAX_CHOP_SHOPS:
                table['chops'].append(name)
            elif t in (GARAGE_RED, GARAGE_BLUE):
                team = 1 if t == GARAGE_RED else 2
                table['garages'][team] = table['garages'][team] or name
        elif t in (CAR_RED, CAR_BLUE):
            team = 1 if t == CAR_RED else 2
            respawns.append(f'$Respawn:\t\t"{name}"\n$Start nav:\t\t"{name}"\n'
                            f'$Box size:\t\t-2.000000 0.000000 -2.000000 2.000000 2.000000 2.000000\n+Vehicle\n+MPTeam{team}\n\n')
            if table['rides'][team] is None:
                table['rides'][team] = name
            else:
                model = str(m.get('vehicle') or '')
                if model not in EXTRA_CAR_MODELS:
                    model = DEFAULT_EXTRA_CAR
                table['extra'].append((model, name, team))
        elif t == CASH and len(table['cash']) < MAX_CASH_SPAWNS:
            table['cash'].append(name)
    per_team = [sum(1 for e in table['extra'] if e[2] == team) for team in (1, 2)]
    if max(per_team) > MAX_EXTRA_CARS:
        raise ValueError(f'Blinged Out Ride: at most {MAX_EXTRA_CARS} extra cars per team.')
    return ''.join(navs), ''.join(triggers), ''.join(respawns), table


def mode_xtbl(level_name, table):
    """levels/<map>_mode.xtbl. No <ID> in it, so it cannot clash with another pack's level IDs."""
    t = '\t'
    lines = ['<root>', '<Table>', t + '<BORLevel>', t * 2 + f'<Name>{level_name}</Name>',
             t * 2 + '<_Editor>', t * 3 + '<Category>Entries</Category>', t * 3 + '</_Editor>',
             t * 2 + f'<VictoryTrigger>{table["victory"]}</VictoryTrigger>', t * 2 + '<ChopShops>']
    lines += [t * 3 + f'<ChopTrigger>{c}</ChopTrigger>' for c in table['chops']]
    lines += [t * 3 + '</ChopShops>', t * 2 + '<SafeZones>',
              t * 3 + f'<TeamOne>{table["garages"][1]}</TeamOne>', t * 3 + f'<TeamTwo>{table["garages"][2]}</TeamTwo>',
              t * 3 + '</SafeZones>', t * 2 + '<TeamCarRespawns>',
              t * 3 + f'<TeamOne>{table["rides"][1]}</TeamOne>', t * 3 + f'<TeamTwo>{table["rides"][2]}</TeamTwo>',
              t * 3 + '</TeamCarRespawns>']
    if table['extra']:
        lines.append(t * 2 + '<ExtraCarRespawns>')
        for model, name, team in table['extra']:
            lines += [t * 3 + '<CarEntry>', t * 4 + f'<Model>{model}</Model>', t * 4 + f'<Respawn>{name}</Respawn>',
                      t * 4 + f'<Team>{"Team One" if team == 1 else "Team Two"}</Team>', t * 4 + '</CarEntry>']
        lines.append(t * 3 + '</ExtraCarRespawns>')
    else:
        lines.append(t * 2 + '<ExtraCarRespawns></ExtraCarRespawns>')
    lines.append(t * 2 + '<ChainSpawns>')
    lines += [t * 3 + f'<SpawnNav>{c}</SpawnNav>' for c in table['cash']]
    lines += [t * 3 + '</ChainSpawns>', t * 2 + '</BORLevel>', t + '</Table>', '</root>', '']
    return '\r\n'.join(lines)


def _section(text, header):
    """(start, end) of the body of a #Section heading in a CTS text."""
    match = re.search(r'(?m)^' + re.escape(header) + r'\s*$', text)
    if not match:
        raise ValueError('CTS is missing ' + header)
    nxt = re.search(r'(?m)^#[A-Za-z][A-Za-z0-9 ]*\s*$', text[match.end():])
    return match.end(), match.end() + nxt.start() if nxt else len(text)


def _blocks(body, keyword):
    """Splits a section body into its leading text and its records starting with `keyword`."""
    parts = re.split(r'(?m)(?=^' + re.escape(keyword) + r')', body)
    return parts[0], parts[1:]


def bor_cts(main_text, navs, triggers, respawns):
    """The BOR CTS: the main CTS with the BOR records added.

    Respawns without a team are dropped (the mode is played in teams), and the
    cash drop-offs start enabled, as in the game's own Blinged Out Ride maps.
    """
    text = main_text.replace('\r\n', '\n')
    a, b = _section(text, '#Respawns')
    head, blocks = _blocks(text[a:b], '$Respawn:')
    kept = [blk for blk in blocks if re.search(r'(?m)^\+MPTeam[12]\s*$', blk)]
    dropped = len(blocks) - len(kept)
    text = text[:a] + head + ''.join(kept) + text[b:]
    a, b = _section(text, '#Triggers')
    head, blocks = _blocks(text[a:b], '$Trigger:')
    blocks = [re.sub(r'(?m)^\+Disabled\s*\n', '', blk) if re.search(r'(?m)^\$Trigger action:\s*"chains drop off"', blk) else blk
              for blk in blocks]
    text = text[:a] + head + ''.join(blocks) + text[b:]
    for header, body in (('#Respawns', respawns), ('#Triggers', triggers), ('#Navpoints', navs)):
        a, b = _section(text, header)
        text = text[:b].rstrip() + '\n\n' + body + text[b:]
    return text, dropped


def write(out_dir, base, level_name, markers, world_scale, mirror_x, origin, space, log):
    """Writes <base>_bor.cts and <base>_mode.xtbl. Returns the number of BOR records, or 0 when there are none."""
    if not any(m.get('type') in TYPES for m in markers):
        return 0
    need = missing(markers)
    if need:
        raise ValueError('Blinged Out Ride needs ' + ', '.join(need) + '.')
    out = Path(out_dir)
    main = out / (base + '.cts')
    navs, triggers, respawns, table = records(base, markers, world_scale, mirror_x, origin, space)
    text, dropped = bor_cts(main.read_bytes().decode('utf-8-sig'), navs, triggers, respawns)
    (out / (base + '_bor.cts')).write_bytes(text.replace('\n', '\r\n').encode('utf-8'))
    (out / (base + '_mode.xtbl')).write_bytes(mode_xtbl(level_name, table).encode('utf-8'))
    log(f'Blinged Out Ride: {base}_bor.cts and {base}_mode.xtbl, {len(table["chops"])} chop shop(s), '
        f'{len(table["extra"])} extra car(s), {len(table["cash"])} cash spawn(s)'
        + (f'; {dropped} spawn(s) without a team left out of this mode' if dropped else '') + '.')
    return sum(1 for m in markers if m.get('type') in TYPES)

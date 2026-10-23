"""Sound zones: the map's own ambience file, amb_<map>.cts.

Each "Sound zone" marker becomes an ambient zone (a sphere or a box) that
plays one sound from the game's ambience bank, picked by name. The editor
reads the names from the player's own game files; only the names are
written, so no sound is shipped with the map. The main CTS (and the other
mode CTS files) include the file, the same way they can borrow a retail
map's ambience. Nothing here has been tried in game yet.
"""
from __future__ import annotations

import math
import re
from pathlib import Path

import sr1_cts

TYPE = 'Sound zone'
MAX_ZONES = 64
MIN_SIZE = 1.0
MAX_SIZE = 2000.0
DEFAULT_RADIUS = 15.0
DEFAULT_BOX = (20.0, 8.0, 20.0)
DEFAULT_VOLUME = 0.4
# Sound names in the bank: letters, digits, underscores and (in a few) spaces.
CUE = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9_ ]{0,59}$')

# Headings of an ambience file, in the order the game's own files use.
HEADINGS = ('#Groups', '#Navpoints', '#Cameras', '#Items', '#Triggers', '#Vehicles', '#Respawns', '#Humans',
            '#Spawn NPC Regions', '#Racing', '#Strongholds', '#Special Spawns', '#Parking',
            '#Chunk Streaming Test Cases', '#Ambients', '#Negative Regions', '#DSP Regions', '#Audio Cluders', '#Nodes')


def include_name(base):
    return 'amb_' + base


def fade(outer):
    """How far inside the zone's edge the sound reaches full volume (metres)."""
    return min(20.0, max(1.0, outer * 0.15))


def _clamp(v, lo, hi, default):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return min(hi, max(lo, v)) if math.isfinite(v) else default


def zone(m):
    """A sound zone marker's settings, checked and with defaults: None when it has no usable sound."""
    cue = str(m.get('sound') or '').strip()
    if cue.lower().endswith('.wav'):
        cue = cue[:-4]
    if not CUE.match(cue):
        return None
    box = m.get('shape') == 'box'
    size = [_clamp(v, MIN_SIZE, MAX_SIZE, d) for v, d in zip(m.get('size') or DEFAULT_BOX, DEFAULT_BOX)]
    radius = _clamp(m.get('radius'), MIN_SIZE, MAX_SIZE, DEFAULT_RADIUS)
    lo = _clamp(m.get('delay_min_s'), 0, 600, 5)
    hi = _clamp(m.get('delay_max_s'), 0, 600, 20)
    return {'file': cue.lower() + '.wav', 'box': box, 'size': size, 'radius': radius,
            'volume': _clamp(m.get('volume'), 0.01, 1.0, DEFAULT_VOLUME), 'random': bool(m.get('sound_random')),
            'delay': (int(min(lo, hi) * 1000), int(max(lo, hi) * 1000))}


def _vec(v):
    return ' '.join(f'{x:.6f}' for x in v)


def ambient_block(name, z):
    """One $Ambient record."""
    lines = [f'$Ambient:\t"{name}"', f'\t$Navpoint:\t"{name}"']
    if z['box']:
        f = fade(min(z['size']))
        inner = [max(MIN_SIZE / 2, s - 2 * f) for s in z['size']]
        lines += ['\t$Shape:\t"Box"', f'\t\t$Inner Dimensions:\t<{_vec(inner)}>', f'\t\t$Outer Dimensions:\t<{_vec(z["size"])}>']
    else:
        r = z['radius']
        lines += ['\t$Shape:\t"Sphere"', f'\t\t$Inner Radius:\t{max(MIN_SIZE / 2, r - fade(r)):.2f}', f'\t\t$Outer Radius:\t{r:.2f}']
    lo, hi = z['delay'] if z['random'] else (0, 0)
    lines += ['\t$Inner Offset:\t<0 0 0>', '\t$Emitter:\t"e0"', f'\t\t$Volume:\t{z["volume"]:.4f}',
              f'\t\t$Min Delay:\t{lo}', f'\t\t$Max Delay:\t{hi}',
              # Time of day 0..0 plays at every hour.
              '\t\t$Min ToD:\t0', '\t\t$Max ToD:\t0', '\t\t$ToD Fade In:\t0', '\t\t$ToD Fade Out:\t0',
              f'\t\t$Play Type:\t"{"Random" if z["random"] else "In Order"}"', f'\t\t+File:\t"{z["file"]}"', '']
    return '\n'.join(lines) + '\n'


def ambience_cts(base, zones):
    """amb_<base>.cts for [(navpoint position, yaw, zone)] in game coordinates."""
    prefix = include_name(base)
    navs, ambients = [], []
    for i, (pos, yaw, z) in enumerate(zones):
        name = f'{prefix}_z{i:02d}'
        navs.append(f'$Navpoint:\t"{name}"\n$Type:\t\t"floating"\n$Pos:\t\t\t<{_vec(pos)}>\n'
                    f'$Orient:\t\t[{yaw:.6f}]\n+Chunk:\t\t"{base}"\n\n')
        ambients.append(ambient_block(name, z))
    body = {'#Navpoints': ''.join(navs), '#Ambients': ''.join(ambients)}
    parts = []
    for h in HEADINGS:
        rule = '// ' + '-' * max(7, len(h) - 1)
        parts += [rule, h, rule, '', body.get(h, '')]
    parts += ['', '#End', '']
    return '\r\n'.join('\n'.join(parts).split('\n'))


def collect(markers, world_scale, mirror_x, origin, space, log):
    """[(position, yaw, zone)] for the usable sound zones, in game coordinates."""
    out = []
    for m in markers:
        if m.get('type') != TYPE:
            continue
        z = zone(m)
        if z is None:
            log(f'Sound zone "{m.get("label") or "unnamed"}" has no sound chosen. Skipped.')
            continue
        out.append((sr1_cts.convert_xyz(m['position'], world_scale, mirror_x, origin, space),
                    sr1_cts.convert_yaw(m.get('yaw', 0), mirror_x, space), z))
    if len(out) > MAX_ZONES:
        log(f'Sound zones: only the first {MAX_ZONES} are written ({len(out)} placed).')
        out = out[:MAX_ZONES]
    return out


def write(out_dir, base, zones, add_include, log):
    """Writes amb_<base>.cts and includes it from the map's CTS files. Returns the number of zones."""
    if not zones:
        return 0
    out = Path(out_dir)
    name = include_name(base)
    (out / (name + '.cts')).write_bytes(ambience_cts(base, zones).encode('utf-8'))
    done = []
    for cts in sorted(out.glob(base + '*.cts')):
        if cts.name == name + '.cts':
            continue
        text = cts.read_bytes().decode('utf-8-sig')
        cts.write_bytes(add_include(text, name).encode('utf-8'))
        done.append(cts.name)
    log(f'Sound zones: {len(zones)} in {name}.cts, included by ' + ', '.join(done) + ' (sounds play from your game, nothing shipped).')
    return len(zones)

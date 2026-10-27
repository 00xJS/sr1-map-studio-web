"""Retail-derived BBChunk profile catalog. No game table or runtime edits."""
import hashlib
import json
from pathlib import Path

ASSETS = Path(__file__).resolve().parent / 'native_props' / 'expanded_v114'
CATALOG = json.loads((ASSETS / 'catalog.json').read_text(encoding='utf-8'))
ROWS = {row['name']: row for row in CATALOG['profiles']}


def summary(name):
    row = ROWS[name]
    p = row['properties']
    text = (f"Stock {name}: {p.get('Hitpoints', '?')} health, weight {p.get('Weight', '?')}; "
            f"{p.get('Material', '?')}; " + ('anchored' if p.get('Anchored') else 'unanchored') + '.')
    ex = row['explosion']
    if ex:
        text += f" Blast radius {ex.get('Radius', '?')}, fire radius {ex.get('FireRadius', '0')}, impulse {ex.get('Impulse', '?')}."
    if name == 'CrateFruit':
        text += ' Stock wood debris replaces the model on death; debris keeps its retail appearance and size.'
    text += ' Profile values apply together. Fitted box collision; gameplay test pending.'
    return text


def extra_presets():
    return {key: {**preset, 'description': summary(preset['profile'])}
            for key, preset in CATALOG['presets'].items()}


def _readable(value, depth=0):
    lines = []
    for key, child in value.items():
        label = key.replace('_', ' ')
        if isinstance(child, dict):
            lines.append('  ' * depth + label + ':')
            lines.extend(_readable(child, depth + 1))
        else:
            if isinstance(child, list):
                child = ', '.join(str(v) for v in child)
            lines.append('  ' * depth + label + ': ' + (str(child) if child else '(not specified)'))
    return lines


def details(name):
    row = ROWS[name]
    status = ('Available in the behavior picker (experimental).' if row['key'] else
              'Research only: additional native records, effects or behavior integration have not been validated.')
    return (summary(name) + '\n\n' + status +
            f"\nRetail references found: {row['retail_count']}; simple source records: {row['simple_count']}.\n\n" +
            'Health, weight, damage filters, anchoring, friction, bounce, lifetime and blast values come from stock game tables. '
            'BBChunk chooses the whole profile; these are not independent numeric overrides. '
            'A custom mesh does not inherit a donor’s doors, lights, pickups, scripted behavior or authored broken mesh.\n\n' +
            'OBJECT PROFILE\n' + '\n'.join(_readable(row['properties'])) +
            ('\n\nEXPLOSION PROFILE\n' + '\n'.join(_readable(row['explosion'])) if row['explosion'] else ''))


def checked_asset(meta):
    path = (ASSETS / meta['file']).resolve()
    if path.parent != ASSETS.resolve():
        raise ValueError('Invalid native effect asset path.')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != meta['sha256']:
        raise ValueError('Native effect asset changed: ' + meta['file'])
    return data


def resources(keys):
    """Return verified effect banks and their full texture payload spans."""
    manifest = json.loads((ASSETS / 'resources.json').read_text(encoding='utf-8'))
    effects = []; textures = {}; seen = set()
    for key in keys:
        for name in CATALOG['presets'].get(key, {}).get('effects', []):
            if name in seen:
                continue
            seen.add(name)
            meta = manifest['effects'][name]
            payload = checked_asset(meta)
            if payload[:4] != b'WB17':
                raise ValueError('Invalid native effect bank: ' + name)
            effects.append((meta['key'], payload))
            for texname in meta['texture_names']:
                t = manifest['textures'][texname.lower()]
                textures[texname.lower()] = (t, checked_asset(t))
    return effects, list(textures.values())

"""Item props: small objects the game places by name in a map's CTS (#Items), like its weapon pickups.

Each "Item prop" marker becomes a navpoint and an $Item record in the map's main CTS, naming an item from the
game's own item table (the editor reads the names from the player's game files; only the name is written, no
model). The game streams the item's model itself. Nothing here has been tried in game yet: which items show up
in multiplayer, and whether they can be picked up, is untested.

With lobby weapons on in a custom match, the $Item parser (0x824BBE30) swaps each distinct $Item type for one of
the chosen weapons whatever the type is, so item props become weapons too. It remembers MAX_ITEM_TYPES of them
(0x823DBF50); the next distinct type gets a null item, which the parser then reads through. So the limit that
matters is distinct types across the whole CTS, weapon pickups included, not how many props there are.
"""
from __future__ import annotations

import re
from pathlib import Path

import sr1_cts

TYPE = 'Item prop'
MAX_PROPS = 64
MAX_ITEM_TYPES = 20
NAME = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,47}$')


def collect(markers, world_scale, mirror_x, origin, space, log):
    """[(position, yaw, item name)] in game coordinates for the item prop markers that name an item."""
    out = []
    for m in markers:
        if m.get('type') != TYPE:
            continue
        name = str(m.get('item') or '').strip()
        if not NAME.match(name):
            log(f'Item prop "{m.get("label") or "unnamed"}" has no item chosen. Skipped.')
            continue
        out.append((sr1_cts.convert_xyz(m['position'], world_scale, mirror_x, origin, space),
                    sr1_cts.convert_yaw(m.get('yaw', 0), mirror_x, space), name))
    if len(out) > MAX_PROPS:
        log(f'Item props: only the first {MAX_PROPS} are written ({len(out)} placed).')
        out = out[:MAX_PROPS]
    return out


def _insert(text, heading, block, nl):
    """Puts block right under a CTS section heading (after the "// ----" rule under it, if any)."""
    lines = text.split(nl)
    for i, l in enumerate(lines):
        if l.strip().lower() == heading.lower():
            at = i + 1
            if at < len(lines) and lines[at].strip().startswith('//'):
                at += 1
            lines[at:at] = block.rstrip('\n').split('\n') + ['']
            return nl.join(lines)
    raise ValueError(f'the map CTS has no {heading} section')


def item_types(text):
    """The distinct $Item types a CTS names, ignoring case as the game's name lookup does."""
    return {t.strip().lower() for t in re.findall(r'(?m)^\$Item type:\s*"([^"\n]*)"', text) if t.strip()}


def _within_type_limit(props, types, log):
    """The props that keep the map within MAX_ITEM_TYPES, given the types already in its CTS (types is updated)."""
    kept, left_out = [], set()
    for prop in props:
        key = prop[2].lower()
        if key not in types and len(types) >= MAX_ITEM_TYPES:
            left_out.add(prop[2])
            continue
        types.add(key)
        kept.append(prop)
    if left_out:
        log(f'Item props: {len(props) - len(kept)} left out ({", ".join(sorted(left_out))}): a map can use {MAX_ITEM_TYPES} different '
            'item types, counting weapon pickups, or a custom match with lobby weapons on gets a missing item.')
    return kept


def write(out_dir, base, props, log):
    """Adds the props to <base>.cts, within the map's item type limit. Returns how many were written."""
    path = Path(out_dir) / (base + '.cts')
    if not props and not path.is_file():
        return 0
    text = path.read_bytes().decode('utf-8-sig')
    types = item_types(text)
    if len(types) > MAX_ITEM_TYPES:
        log(f'WARNING: {len(types)} different weapon pickup types. A custom match with lobby weapons on gets a missing item past '
            f'{MAX_ITEM_TYPES}, which may crash it: use {MAX_ITEM_TYPES} or fewer.')
    props = _within_type_limit(props, types, log)
    if not props:
        return 0
    nl = '\r\n' if '\r\n' in text else '\n'
    used = set(re.findall(r'"([^"\n]+)"', text))
    navs, items = [], []
    n = 0
    for pos, yaw, item in props:
        while True:
            name = f'{base}__studio_$prop{n:03d}'
            n += 1
            if name not in used:
                break
        used.add(name)
        navs.append(f'$Navpoint:\t"{name}"\n$Type:\t\t"ground"\n$Pos:\t\t\t<{pos[0]:.6f} {pos[1]:.6f} {pos[2]:.6f}>\n'
                    f'$Orient:\t\t[{yaw:.6f}]\n+Chunk:\t\t"{base}"\n\n')
        items.append(f'$Item:\t\t"{name}"\n$Item type:\t"{item}"\n$Start nav:\t"{name}"\n\n')
    text = _insert(text, '#Navpoints', ''.join(navs), nl)
    text = _insert(text, '#Items', ''.join(items), nl)
    path.write_bytes(text.encode('utf-8'))
    log(f'Item props: {len(props)} placed by name in {path.name} (untested in game).')
    log('Item props: in a custom match with lobby weapons on, the game turns placed items into those weapons, item props too.')
    return len(props)

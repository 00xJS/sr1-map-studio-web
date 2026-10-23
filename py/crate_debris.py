"""Wooden crates that smash into debris.

The game's wooden crate profile (CrateFruit) breaks into boards and dust
through a death effect named dth_crate. A map can only show that effect when
the effect itself and the pictures it names are in the map's own files, so
at export the editor reads them from the player's own game (a city chunk and
its texture file, passed in here; nothing from the game is stored or
shipped with the site) and this module copies them into the exported map.

Without the player's game files the crate keeps today's behaviour: the
breaking "Can" profile, which makes it disappear without debris.
Nothing here has been tried in game yet.
"""
from __future__ import annotations

import json
import re
import zlib
from pathlib import Path

import sr_reborn_core as rc
import peg_xbox2_beaver as peg

PROFILE = 'CrateFruit'
FALLBACK = 'Can'
EFFECT = 'dth_crate'
# Texture names inside an effect: <name>.tga or <name>.tgn.
TEXTURE_NAME = re.compile(rb'[A-Za-z0-9_\-]{1,40}\.t[gn][an]')


def key(name):
    """The game's lookup key for an effect or object name."""
    return zlib.crc32(name.lower().encode('ascii'), 0xffffffff) ^ 0xffffffff


def effects(data):
    """[(key, payload)] of a chunk's effect bank."""
    n = rc.U32(data, 0)
    rows = []
    for i in range(n):
        at, size = 4 + rc.U32(data, 4 + 20 * i + 12), rc.U32(data, 4 + 20 * i + 8)
        if at < 4 + 20 * n or at + size > len(data):
            raise ValueError('Malformed effect bank.')
        rows.append((rc.U32(data, 4 + 20 * i), bytes(data[at:at + size])))
    return rows


def build_effects(rows):
    """An effect bank: count, 20-byte rows (key, 0, size, offset - 4, 0), payloads 64-aligned."""
    out = bytearray(4 + 20 * len(rows))
    rc.Wr32(out, 0, len(rows))
    if not rows:
        return out
    for i, (k, payload) in enumerate(rows):
        rc.PadTo(out, 64)
        rc.Wr32(out, 4 + 20 * i, k)
        rc.Wr32(out, 4 + 20 * i + 8, len(payload))
        rc.Wr32(out, 4 + 20 * i + 12, len(out) - 4)
        out += payload
    rc.PadTo(out, 64)
    return out


def texture_names(payload):
    """Picture names an effect refers to, in first-seen order."""
    seen = []
    for m in TEXTURE_NAME.findall(payload):
        name = m.decode('ascii')
        if name.lower() not in (s.lower() for s in seen):
            seen.append(name)
    return seen


def extract(chunk_path, peg_path, out_dir):
    """Copies dth_crate and the pictures it names out of one of the player's city chunks.

    Writes effect.bin, the pictures (texture_NN.bin) and textures.json into
    out_dir. Pictures the chunk's texture file lacks are listed as `shared`:
    the game keeps those loaded all the time, so the map does not need them.
    Returns the summary written to textures.json.
    """
    ch = rc.read_chunk(Path(chunk_path).read_bytes())
    found = [p for k, p in effects(ch.get('skip388').data) if k == key(EFFECT)]
    if not found:
        raise ValueError(f'{Path(chunk_path).name} has no {EFFECT} effect.')
    payload = found[0]
    if payload[:4] != b'WB17':
        raise ValueError('Unexpected crate effect format.')
    raw, _, entries = peg.parse_peg(peg_path)
    by_name = {e.name.lower(): e for e in entries}
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    textures, shared = [], []
    for name in texture_names(payload):
        e = by_name.get(name.lower())
        if e is None or not e.payload:
            shared.append(name)
            continue
        file = f'texture_{len(textures):02d}.bin'
        (out / file).write_bytes(bytes(e.payload))
        textures.append({'name': e.name, 'entry': bytes(e.raw).hex(), 'file': file, 'bytes': len(e.payload)})
    (out / 'effect.bin').write_bytes(payload)
    summary = {'effect': EFFECT, 'source': Path(chunk_path).name, 'textures': textures, 'shared': shared}
    (out / 'textures.json').write_text(json.dumps(summary, indent=1))
    return summary


def have_donor(donor_dir):
    d = Path(donor_dir) if donor_dir else None
    return bool(d and (d / 'effect.bin').is_file() and (d / 'textures.json').is_file())


def choose(items, wanted, is_native, donor_dir, log):
    """Gives wooden crates the CrateFruit profile when the effect is at hand, else today's fallback.

    `wanted` is {native object index: profile} from map_features.prepare_breakables
    (which already routed breakable wood through the movable-prop path) and is
    changed in place. Returns how many crates got the smashing profile.
    """
    crates = []
    j = 0
    for it in items:
        if not is_native(it):
            continue
        if it.get('native_profile') == PROFILE and j in wanted:
            crates.append(j)
        j += 1
    if not crates:
        return 0
    if have_donor(donor_dir):
        for j in crates:
            wanted[j] = PROFILE
        return len(crates)
    for j in crates:
        wanted[j] = FALLBACK
    log(f'Crates: {len(crates)} smashing crate(s) need the debris effect from your game files, which were not available; '
        'they break without debris instead (choose your Saints Reborn folder before exporting to fix this).')
    return 0


def add_debris(chunk_path, peg_path, donor_dir, log):
    """Adds dth_crate and its pictures to the exported map's effect bank and texture file."""
    import sr1_native_glass as glass  # PEG append helper of the upstream exporter

    donor = Path(donor_dir)
    summary = json.loads((donor / 'textures.json').read_text())
    payload = (donor / 'effect.bin').read_bytes()
    chunk_path, peg_path = Path(chunk_path), Path(peg_path)
    original = chunk_path.read_bytes()
    ch = rc.read_chunk(original)
    geometry = rc.chunk_geometry(ch)
    rows = effects(ch.get('skip388').data)
    k = key(EFFECT)
    if any(r[0] == k and r[1] != payload for r in rows):
        raise ValueError('The map already has a different crate effect.')
    if not any(r[0] == k for r in rows):
        rows.append((k, payload))
    raw, _, existing = peg.parse_peg(peg_path)
    if rc.chunk_strings(ch) != [x.name for x in existing]:
        raise ValueError('Map texture table is out of sync.')
    have = {x.name.lower() for x in existing}
    additions, added = [], []
    for t in summary['textures']:
        if t['name'].lower() in have:
            continue
        data = (donor / t['file']).read_bytes()
        if len(data) != t['bytes']:
            raise ValueError('Crate effect picture changed: ' + t['name'])
        rc.add_strings(ch, [t['name']])
        additions.append((bytearray.fromhex(t['entry']), data))
        added.append(t['name'])
        have.add(t['name'].lower())
    ch.get('skip388').data = build_effects(rows)
    rc.Wr32(ch.header, 204, len(ch.get('skip388').data))
    rc.set_geometry(ch, geometry)  # added names can move the 4096-aligned vertex data
    output = rc.write_chunk(ch)
    check = rc.read_chunk(output)
    if rc.write_geometry(rc.chunk_geometry(check), 0) != rc.write_geometry(geometry, 0):
        raise RuntimeError('Adding the crate effect changed the map geometry.')
    first = rc.read_chunk(original)
    for section in ('block556', 'tree236', 'tree192', 'static_records', 'rec_blob308'):
        if check.get(section).data != first.get(section).data:
            raise RuntimeError('Adding the crate effect changed another part of the map: ' + section)
    if not any(r[0] == k and r[1] == payload for r in effects(check.get('skip388').data)):
        raise RuntimeError('Crate effect did not read back.')
    new_peg = glass._append_peg(peg_path, additions) if additions else peg_path.read_bytes()
    staged = peg_path.with_name(peg_path.name + '.crate.tmp')
    try:
        staged.write_bytes(new_peg)
        _, _, entries = peg.parse_peg(staged)
        if rc.chunk_strings(check) != [x.name for x in entries]:
            raise RuntimeError('Crate effect pictures did not link up.')
        before = peg_path.read_bytes()
        staged.replace(peg_path)
        try:
            chunk_path.write_bytes(bytes(output))
        except Exception:
            peg_path.write_bytes(before)
            raise
    finally:
        if staged.exists():
            staged.unlink()
    log(f'Crates: smashing-crate debris ({EFFECT}) from your {summary["source"]}, {len(added)} picture(s) added'
        + (f'; {len(summary["shared"])} come from the game\'s always-loaded pictures' if summary['shared'] else '') + '.')
    return len(added)

"""One texture per picture: materials that use the same picture share it in the map's PEG.

Upstream names each material's texture after its slot (map_<slot>_<hash>_<surface>.tga) and appends one
PEG entry and one chunk string per material, so a picture used by 10 materials is stored 10 times. A map
cut from the city (thousands of materials, a few hundred pictures) came out at 136 MB of textures; the game
reads a level's PEG into its chunk's fixed memory pool ("Failed to allocate memory for chunk peg") and,
when it doesn't fit, loads none of it: players spawn into a black, empty map they can still stand on. The
retail maps are 10 to 25 MB.

Installed over upstream (studio-py/ is not edited):

- names leave the slot out: <map>_<hash>_<surface>.tga, the hash covering the picture's bytes and its alpha,
  so the same name is always the same picture, read the same way, and different pictures never share one;
- the chunk gets each name once (materials with the same name point at the same string);
- the PEG gets each picture once.

tests/shared_textures_check.py checks a map whose materials share pictures.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import sr1_physical_materials as physical
import sr_reborn_bridge as bridge
import sr_reborn_core as rc

_original = {}


def name_for_export(map_name, index, surface_id, source_path=None, use_alpha=False):
    """The texture's name: the map, the picture's hash and its surface suffix (the slot left out)."""
    base = re.sub('[^a-zA-Z0-9_]', '_', map_name).lower()[:8]
    suffix = physical.suffix_for_id(surface_id)
    if source_path is None:
        raise ValueError('Texture source is required for collision-safe resource naming')
    h = hashlib.sha256()
    with Path(source_path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    h.update(b'\x01' if use_alpha else b'\x00')
    name = '%s_%s_%s.tga' % (base, h.hexdigest()[:11], suffix)
    if len(name.encode('ascii')) >= 29:
        raise ValueError('Export texture name too long: ' + name)
    return name


def add_strings(ch, names):
    """Adds each distinct name once; every name's index, the repeats pointing at their first."""
    first = {}
    unique = []
    for n in names:
        if n not in first:
            first[n] = len(unique)
            unique.append(n)
    idx = _original['add_strings'](ch, unique)
    return [idx[first[n]] for n in names]


def append_dynamic_textures(reference_peg, output_peg, items, replace_special=None):
    """Appends each picture once (items with a name already appended are the same picture)."""
    seen = set()
    unique = []
    for it in items:
        key = str(it['name'])
        if key in seen:
            continue
        seen.add(key)
        unique.append(it)
    report = _original['append'](reference_peg, output_peg, unique, replace_special)
    report['shared'] = len(items) - len(unique)
    return report


# The biggest texture file a working map is known to have (retail Industrial: 25.3 MB), with a little room.
SAFE_PEG_MB = 28


def check_size(peg_path, log, copies_bytes=0):
    """Warns when the map's texture file is bigger than any map known to load (it may come out black in game).

    copies_bytes: the map's textures loaded a second time, in the environment file of early surface registration
    (surface_registration.py). They count too; the stock environment around them is what retail maps load anyway.
    """
    mb = (Path(peg_path).stat().st_size if Path(peg_path).is_file() else 0) / 1e6 + copies_bytes / 1e6
    if mb > SAFE_PEG_MB:
        log(f'WARNING: the textures of this map come to {mb:.0f} MB'
            + (' (with their copies for early surface registration)' if copies_bytes else '')
            + '. The biggest map known to load has about 25 MB; '
            'past that the game may not load them at all, and players spawn into a black, empty map. '
            'Use fewer different textures, or smaller ones.')
    return mb


def install():
    """Installs the sharing (after peg_mips, whose PEG writer it wraps)."""
    if _original:
        return
    _original.update(name=physical.name_for_export, add_strings=rc.add_strings, append=bridge.append_dynamic_textures)
    physical.name_for_export = name_for_export
    rc.add_strings = add_strings
    bridge.append_dynamic_textures = append_dynamic_textures


def uninstall():
    if _original:
        physical.name_for_export = _original['name']
        rc.add_strings = _original['add_strings']
        bridge.append_dynamic_textures = _original['append']
        _original.clear()

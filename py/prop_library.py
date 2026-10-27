"""The stock object library of the v1.15 package (native_props/expanded_v114), used when the data pack has it.

Upstream reads native_props/expanded_v114/catalog.json the moment sr1_prop_catalog is imported, and
sr1_native_props imports it at its top. In the browser the data pack is copied into /studio after the exporter
modules are imported, and a v1.13 package has no library at all. So (studio-py/ is not edited):

- install(), before the exporter modules are imported, puts a stand-in sr1_prop_catalog in place: no extra
  behaviours, and the crate and propane keep their v1.13 descriptions and texture surfaces;
- refresh(), before each export or catalog read, runs the real module once the data pack has the library and adds
  its behaviours to sr1_native_props.PRESETS as upstream does at import (and takes them out again if the library
  has gone);
- stock_key(profile): the library behaviour that uses a stock profile. A physics prop with that profile then gets
  the object record the library copied for it from a retail map (map_features.prepare_breakables), not the crate's
  record renamed;
- a native object's texture surface follows its stock profile's material, as upstream does for its own behaviours,
  also for the web's profiles outside the library's behaviour list (any profile the library's table knows).

tests/prop_library_check.py checks both packages.
"""
from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import sr1_physical_materials as physical

NAME = 'sr1_prop_catalog'
LIBRARY = 'expanded_v114'
_state = {'real': None, 'source': None, 'standin': None, 'v113': {}, 'surface': None}


def _props():
    return sys.modules.get('sr1_native_props')


class _NoRows(dict):
    """No profile table: the export report's stock values for the crate and the propane are left empty."""
    def __missing__(self, name):
        return {'name': name, 'properties': {}, 'explosion': None, 'key': None}


def _standin():
    """No library: nothing extra, and summary() keeps the description a behaviour already has."""
    mod = types.ModuleType(NAME)
    mod.__doc__ = 'Stand-in while the data pack has no stock object library (see prop_library.py).'
    mod.CATALOG = {'profiles': [], 'presets': {}}
    mod.ROWS = _NoRows()
    mod.LOADED = False

    def summary(name):
        props = _props()
        for preset in getattr(props, 'PRESETS', {}).values():
            if preset.get('profile') == name:
                return preset.get('description', '')
        return ''

    def missing(*_):
        raise ValueError('The stock object library is not in your data pack (it comes with the SR1 Map Studio v1.15 package).')
    mod.summary = summary
    mod.extra_presets = lambda: {}
    mod.details = missing
    mod.checked_asset = missing
    mod.resources = lambda keys: ([], [])
    return mod


def install():
    """Before sr1_native_props is imported: the stand-in (unless the real module is already imported)."""
    if _state['standin'] is not None:
        return
    spec = importlib.util.find_spec(NAME)
    _state['source'] = Path(spec.origin) if spec and spec.origin else None
    _state['standin'] = _standin()
    _state['surface'] = physical.native_surface_id
    physical.native_surface_id = native_surface_id
    sys.modules.setdefault(NAME, _state['standin'])


def _catalog_file():
    props = _props()
    root = Path(props.ASSETS) if props is not None else (_state['source'].parent / 'native_props' if _state['source'] else None)
    return root / LIBRARY / 'catalog.json' if root else None


def _load_real(catalog):
    """Runs the unmodified upstream module as if it sat next to this data pack's native_props folder."""
    mod = types.ModuleType(NAME)
    mod.__file__ = str(catalog.parent.parent.parent / (NAME + '.py'))
    code = compile(_state['source'].read_text(encoding='utf-8'), str(_state['source']), 'exec')
    exec(code, mod.__dict__)
    mod.LOADED = True
    return mod


def refresh():
    """Uses the library when the data pack has it (True), else the stand-in. Cheap when nothing changed."""
    install()
    props = _props()
    catalog = _catalog_file()
    have = bool(catalog and catalog.is_file() and _state['source'])
    current = sys.modules.get(NAME)
    if have and _state['real'] is not None and current is _state['real'] and Path(_state['real'].ASSETS).resolve() == catalog.parent.resolve():
        return True
    if not have and current is _state['standin']:
        return False
    mod = _load_real(catalog) if have else _state['standin']
    sys.modules[NAME] = mod
    _state['real'] = mod if have else None
    if props is not None:
        props.catalog = mod
        presets = props.PRESETS
        if not _state['v113']:
            _state['v113'] = {k: dict(v) for k, v in presets.items() if k in ('movable', 'explosive')}
        for key in [k for k in presets if k not in ('movable', 'explosive')]:
            del presets[key]
        for key, original in _state['v113'].items():
            presets[key] = dict(original)
        if have:
            presets.update(mod.extra_presets())
            for key in ('movable', 'explosive'):
                presets[key]['description'] = mod.summary(presets[key]['profile'])
    return have


def loaded():
    return _state['real'] is not None and sys.modules.get(NAME) is _state['real']


def stock_key(profile):
    """The library behaviour (e.g. 'stock_tire') whose stock profile is `profile`, or None."""
    if not loaded():
        return None
    for key, preset in _state['real'].CATALOG['presets'].items():
        if preset.get('profile') == profile:
            return key
    return None


def material_surface(profile):
    """The surface id of a stock profile's material in the library's table, or None."""
    if not loaded():
        return None
    row = _state['real'].ROWS.get(profile)
    material = row and row['properties'].get('Material')
    if not material:
        return None
    name = material.replace(' - ', ' ')
    return physical.NAMES.index(name) if name in physical.NAMES else None


def native_surface_id(item):
    """Upstream's rule with the library, the v1.13 one without it; a web profile on a crate record counts as its own."""
    if not loaded():
        # v1.13: wood breakables wear wood, everything else the heavy-glass surface of the glass prefab.
        return 21 if item.get('native_breakable_kind') == 'wood' else 8
    if item.get('native_prop_behavior') == 'movable' and item.get('native_profile'):
        sid = material_surface(item['native_profile'])
        if sid is not None:
            return sid
    return _state['surface'](item)

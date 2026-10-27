"""Early surface registration (v1.15's "Register surface impacts early (experimental)").

The game works out a texture's surface (wood, metal, grass...) from the suffix of its name the first time the
name is used. A map's chunk asks for its textures before its PEG has registered them, so they all stay Concrete.
v1.15 (studio-py/sr1_surface_preload.py) puts an exact copy of the map's surface textures into a map-specific
environment pair, sf_<hash>.bbchunk_xbox2 / .peg_xbox2: a stock environment (sky, by default the Seafood one,
sr_custom000001) with the copies appended. A full-size city file, built from the bundled surface template
(surface_preload_presets/surftest.bbcity_xbox2), names that pair as the map's always-loaded environment, so the
textures are registered before the map asks for them. Map names are 10 characters at most.

Upstream finds the template and the stock pair next to its own file; here they are passed in from the data pack
folder (web_api.STUDIO) instead. After the web's own changes to the map's PEG (crate debris and the like), finish()
checks the pair against the final PEG the way v1.15's export check does, and builds it again if a surface texture
no longer matches. Nothing here has been tried in game.
"""
from __future__ import annotations

from pathlib import Path

import peg_xbox2_beaver as peg
import sr1_safe_export
import sr1_sidecars
import sr1_surface_preload as preload

MAX_NAME = 10
TEMPLATE = Path('surface_preload_presets') / 'surftest.bbcity_xbox2'
SKIES = Path('native_sky_presets')
# The template names the pair it was tested with; the bundled stock pair it was made from.
TESTED_PAIR = {'sf_probe0000001': 'sr_custom000001'}


def wanted(s):
    return bool(s.get('surface_preload'))


def export_args(s, studio, base):
    """export_map arguments for the setting: the template city and stock pair from the data pack, unless the
    project names its own city donor or native sky."""
    if not wanted(s):
        return {}
    if len(base) > MAX_NAME:
        raise ValueError(f'Early surface registration needs a map file name of {MAX_NAME} characters or fewer ("{base}" has {len(base)}).')
    studio = Path(studio)
    city = s.get('bbcity_donor') or str(studio / TEMPLATE)
    if not Path(city).is_file():
        raise ValueError('Early surface registration needs the surface template from your data pack '
                         '(surface_preload_presets/surftest.bbcity_xbox2). Add your SR1 Map Studio package again on the Data pack page.')
    chunk, peg_path = s.get('native_sky_chunk') or '', s.get('native_sky_peg') or ''
    if not chunk and not peg_path:
        env = sr1_sidecars._read_full_bbcity_envref(Path(city).read_bytes())
        env = TESTED_PAIR.get(env, env)
        if env in ('sr_custom000001', 'sr_alwayshwyf01'):
            chunk, peg_path = (str(studio / SKIES / (env + ext)) for ext in ('.bbchunk_xbox2', '.peg_xbox2'))
            if not (Path(chunk).is_file() and Path(peg_path).is_file()):
                raise ValueError('Early surface registration needs the native sky presets from your data pack (' + env + ').')
    return dict(surface_preload=True, bbcity_donor=city, native_sky_chunk=chunk or None, native_sky_peg=peg_path or None)


def _check(out, base):
    try:
        sr1_safe_export.validate_map(out, base)
        return None
    except ValueError as exc:
        return str(exc)


def finish(out, base, report, s, studio, log):
    """After the web's last change to the map's PEG: the pair still matches it (rebuilt if not). Returns facts for
    the texture-memory note, or None when the setting is off."""
    info = (report or {}).get('surface_preload') or {}
    if not info.get('enabled'):
        return None
    out = Path(out)
    problem = _check(out, base)
    if problem:
        log('Surface registration: ' + problem + ' Building the pair again from the final textures.')
        for ext in ('bbchunk_xbox2', 'peg_xbox2'):
            (out / f"{info['resource_name']}.{ext}").unlink(missing_ok=True)
        args = export_args(s, studio, base)
        sources = (args['native_sky_chunk'], args['native_sky_peg'])
        names = list(info['added'])
        stem = preload.content_resource_name(base, *sources, out / f'{base}.peg_xbox2', names)
        info = {**info, **preload.build_pair(*sources, out / f'{base}.peg_xbox2', names, out, stem)}
        info['city_reference'] = preload.patch_bbcity_reference(out / f'{base}.bbcity_xbox2', stem)
        problem = _check(out, base)
        if problem:
            raise RuntimeError('Surface registration: ' + problem)
    stem = info['resource_name']
    sf_peg = out / f'{stem}.peg_xbox2'
    _, _, entries = peg.parse_peg(sf_peg, include_frames=True)
    copies = entries[info['donor_total_entries']:]
    copied = sum(len(e.payload) for e in copies)
    log(f'Surface registration: {len(copies)} surface textures copied into {stem}.peg_xbox2 '
        f"({sf_peg.stat().st_size / 1e6:.0f} MB: the stock environment and {copied / 1e6:.1f} MB of this map's textures). "
        f'Install {stem}.bbchunk_xbox2 and {stem}.peg_xbox2 with the map. Experimental; not yet tried in game.')
    return {'resource_name': stem, 'textures': len(copies), 'copied_bytes': copied, 'peg_bytes': sf_peg.stat().st_size}

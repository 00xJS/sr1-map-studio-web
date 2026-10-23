"""Retail-map features added after the main export (see bor_mode, sound_zones, crate_debris).

web_api.py calls three things from here:
- extra_marker(m): marker types the upstream CTS writer does not know; they
  are kept out of the main CTS and written by these modules instead.
- crates(...): picks the smashing-crate profile or its fallback before the
  object profiles are written, and adds the crate effect afterwards.
- finish(...): the Blinged Out Ride CTS and table, then the sound zones.
"""
from __future__ import annotations

from pathlib import Path

import bor_mode
import crate_debris
import sound_zones
import map_features

EXTRA_TYPES = set(bor_mode.TYPES) | {sound_zones.TYPE}
CRATE_DONOR = Path('/work/game/crate_debris')


def extra_marker(m):
    return m.get('type') in EXTRA_TYPES


def prepare_crate_donor(spec, log):
    """The folder holding the crate effect, extracted once per session from the game files the editor passed in."""
    src = spec.get('crate_debris_source') or {}
    donor = Path(src.get('dir') or CRATE_DONOR)
    if crate_debris.have_donor(donor):
        return donor
    chunk, peg = src.get('chunk'), src.get('peg')
    if not chunk or not peg or not Path(chunk).is_file() or not Path(peg).is_file():
        return None
    try:
        crate_debris.extract(chunk, peg, donor)
        return donor
    except Exception as exc:  # a game file we cannot read should not stop the export
        log('Crates: could not read the crate effect from your game files: ' + str(exc))
        return None
    finally:
        # The big chunk and texture files are only needed for the extraction.
        for p in (chunk, peg):
            try:
                Path(p).unlink()
            except OSError:
                pass


def choose_crates(spec, items, wanted, log):
    """Returns the crate effect folder when crates will smash with debris, else None."""
    if not any(it.get('native_profile') == crate_debris.PROFILE for it in items):
        return None
    donor = prepare_crate_donor(spec, log)
    n = crate_debris.choose(items, wanted, map_features._is_native, donor, log)
    return donor if n else None


def finish(spec, out_dir, base, markers, world_scale, mirror_x, origin, space, log):
    """BOR files and sound zones, after every other CTS edit. Returns summary counts."""
    out = {}
    if spec.get('bor'):
        out['bor_records'] = bor_mode.write(out_dir, base, spec.get('bor_level_name') or base + ' BOR', markers,
                                            world_scale, mirror_x, origin, space, log)
    elif any(m.get('type') in bor_mode.TYPES for m in markers):
        log('Blinged Out Ride markers are only used when the Blinged Out Ride mode is selected.')
    zones = sound_zones.collect(markers, world_scale, mirror_x, origin, space, log)
    out['sound_zones'] = sound_zones.write(out_dir, base, zones, map_features.add_include, log)
    return out

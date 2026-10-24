"""Quick upgrades for a finished map, without rebuilding it.

A map someone made a while ago (with this editor, the desktop SR1 Map Studio
or another converter) is a folder of game files. The editor can open it to
edit and export again, but some improvements can go straight into the files
it already has: the map's chunk and texture file are changed in place and the
rest of the folder is handed back as it was.

Each upgrade is one entry in UPGRADES: what it is called, whether the map
already has it or has room for it (status), and the change itself (apply).
They run in ORDER; the game's sky goes last, since it leaves the chunk's
picture names one ahead of the texture file (see native_sky.py). To add one,
write a class like GameSky and add it to UPGRADES; the editor lists whatever
status() reports (src/lib/mapFolder/upgrades.ts names them for the page).

inspect() also reads what the editor needs when it opens a map and that its
own chunk reader does not walk: the point lights.

Nothing here has been tried in game yet.
"""
from __future__ import annotations

import struct
from pathlib import Path

import sr_reborn_core as rc
import native_sky

LIGHT_COUNT = 884  # header offset of the light count (rec136_260 holds the records)


def _chunk(path):
    ch = rc.read_chunk(Path(path).read_bytes())
    return ch, rc.chunk_geometry(ch)


# ------------------------------------------------------------- lights --

def lights(ch):
    """The map's point lights, game frame: position, colour (0-1), intensity and near/far range in metres."""
    n = rc.U32(ch.header, LIGHT_COUNT)
    if not n:
        return []
    d = ch.get('rec136_260').data
    out, at = [], 136 * n
    names = bytes(d[at:]).split(b'\0')[:n]
    at += sum(len(x) + 1 for x in names)
    at = rc.Al(at, 64)
    for i in range(n):
        r = 136 * i
        count = rc.U32(d, r + 20)
        intensity = struct.unpack_from('>f', d, at)[0] if count and at + 4 <= len(d) else 1.0
        at += 4 * count
        out.append({
            'name': names[i].decode('latin1') if i < len(names) else 'Light %d' % i,
            'kind': rc.U16(d, r),
            'color': list(struct.unpack_from('>3f', d, r + 8)),
            'position': list(struct.unpack_from('>3f', d, r + 48)),
            'near': struct.unpack_from('>f', d, r + 104)[0],
            'far': struct.unpack_from('>f', d, r + 108)[0],
            'intensity': intensity,
        })
    return out


# ----------------------------------------------------------- upgrades --

class GameSky:
    key = 'game_sky'
    order = 100  # last: see the module notes

    def status(self, ch, g, ctx):
        if native_sky.sky_list(ch):
            return 'done', "The map already has the game's sky."
        records, meshes, vbs = native_sky._free_slots(ch, g)
        need = ctx.get('game_sky_need') or (5, 5, 4)
        if len(records) < need[0] or len(meshes) < need[1] or len(vbs) < need[2]:
            return 'unavailable', (f'No room left in the map for the five sky objects (it has {len(records)} free object slots, '
                                   f'{len(meshes)} meshes and {len(vbs)} vertex buffers; the sky needs {need[0]}, {need[1]} and {need[2]}). '
                                   'Open it in the editor and export it again instead.')
        return 'available', ''

    def apply(self, chunk, peg, ctx, log):
        donor = native_sky.prepare({'native_sky_source': ctx.get('game_sky') or {}}, log)
        if donor is None:
            raise ValueError("The game's sky needs your Saints Reborn folder (the sky is read from mp_bac_01 in your game files).")
        if not native_sky.add(chunk, peg, donor, log):
            raise ValueError("The sky did not fit in this map.")
        return True


class RetailMaterials:
    """The game's own material and fade values (retail_records.py) on a map exported before the exporter used
    them. Only the Beaver Creek template's leftovers change: a material's Self_Illumination of 0.12 (plain) or
    0.35 (the glow-class alpha one) becomes 0, and a record's donor fade distance (1000 m world, 20 m glass,
    75 m props) the retail one. Values a map set on purpose, and retail maps', stay as they are."""
    key = 'retail_materials'
    order = 50
    LEFTOVER = (0.12, 0.35)

    def _todo(self, ch, g):
        import retail_records as rr
        mats = [M for M in g.mats if rc.U32(M.m, 0) == rr.K_BASE_SHADER
                and any(abs((rr.self_illumination(M) or 0.0) - v) < 1e-3 for v in self.LEFTOVER)]
        donor = {'world': 1000.0, 'glass': 20.0, 'prop': 75.0}
        want = {'world': rr.FADE_WORLD, 'glass': rr.FADE_GLASS, 'prop': rr.FADE_PROP}
        recs, fades = ch.get('static_records').data, []
        for r in range(rc.U32(ch.header, 868)):
            kind = rr.record_kind(rc.U32(recs, 80 * r + rr.FLAGS))
            if kind in donor and abs(rc.F32(recs, 80 * r + rr.FADE) ** 0.5 - donor[kind]) < 0.5:
                fades.append((r, want[kind]))
        return mats, fades

    def status(self, ch, g, ctx):
        mats, fades = self._todo(ch, g)
        if not mats and not fades:
            return 'done', "The map's materials and fade distances are already like the game's own maps."
        return 'available', ''

    def apply(self, chunk, peg, ctx, log):
        import retail_records as rr
        ch, g = _chunk(chunk)
        mats, fades = self._todo(ch, g)
        for M in mats:
            rr.set_self_illumination(M, 0.0)
        recs = ch.get('static_records').data
        for r, metres in fades:
            rc.WrF(recs, 80 * r + rr.FADE, metres ** 2)
        rc.set_geometry(ch, g)
        Path(chunk).write_bytes(rc.write_chunk(ch))
        log(f'Materials: {len(mats)} lit like the game\'s own (Self_Illumination 0); fade distances set on {len(fades)} object(s).')
        return True


UPGRADES = [RetailMaterials(), GameSky()]
ORDER = sorted(UPGRADES, key=lambda u: u.order)


def inspect(spec, log):
    """What the map has: its lights, and each upgrade's state ('available', 'done' or 'unavailable', and why)."""
    ch, g = _chunk(spec['chunk'])
    out = {'lights': lights(ch), 'sky': len(native_sky.sky_list(ch)), 'upgrades': {}}
    for u in ORDER:
        try:
            state, why = u.status(ch, g, spec)
        except Exception as exc:  # an upgrade that cannot read this map is just not offered
            state, why = 'unavailable', 'Could not read this part of the map: ' + str(exc)
        out['upgrades'][u.key] = {'state': state, 'why': why}
    return out


def upgrade(spec, log):
    """Applies the upgrades asked for, in order, to spec['chunk'] and spec['peg'] in place. Returns which went in."""
    chunk, peg = Path(spec['chunk']), Path(spec['peg'])
    wanted = set(spec.get('upgrades') or [])
    unknown = wanted - {u.key for u in UPGRADES}
    if unknown:
        raise ValueError('Unknown upgrade: ' + ', '.join(sorted(unknown)))
    applied, skipped = [], {}
    for u in ORDER:
        if u.key not in wanted:
            continue
        ch, g = _chunk(chunk)
        state, why = u.status(ch, g, spec)
        if state != 'available':
            skipped[u.key] = why
            log(why)
            continue
        before = (chunk.read_bytes(), peg.read_bytes())
        try:
            u.apply(chunk, peg, spec, log)
            rc.read_chunk(chunk.read_bytes())  # still a chunk the reader understands
            applied.append(u.key)
        except Exception as exc:
            chunk.write_bytes(before[0])
            peg.write_bytes(before[1])
            skipped[u.key] = str(exc)
            log(f'{u.key}: not applied, the map is unchanged by it: {exc}')
    return {'applied': applied, 'skipped': skipped}

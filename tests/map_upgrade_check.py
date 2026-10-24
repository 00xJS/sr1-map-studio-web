"""Checks the quick upgrades for finished maps (py/map_upgrade.py).

Run from web/:  py -3 tests/map_upgrade_check.py   (needs numpy and Pillow)

Without anything set it checks the light reader on made-up records. With the
game's packfiles (SR1_GAME_PACKFILES, or the default install) and its maps
folder (SR1_MAPS, or dist/maps beside the packfiles) it copies each installed
map to a temporary folder, reads it, adds the game's sky (from the player's
own mp_bac_01) and reads it back: the sky is listed, the map is otherwise
unchanged, a second try says it's done, and a map without room is left as it
was; the template's material glow and fade distances are cleared; and a map
still naming the template's minimap gets a picture of its own, pointed at the
drawn area. Nothing from the game or the maps is kept.
"""
import json
import os
import shutil
import struct
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
import sr_reborn_core as rc  # noqa: E402
import peg_xbox2_beaver as peg  # noqa: E402
import fast_dxt  # noqa: E402
import native_sky  # noqa: E402
import map_upgrade  # noqa: E402
import minimap_region  # noqa: E402
from PIL import Image  # noqa: E402

fast_dxt.install()
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


class Section:
    def __init__(self, data):
        self.data = data


class FakeChunk:
    """Just what lights() reads: the header's light count and the light records."""
    def __init__(self, n, data):
        self.header = bytearray(968)
        rc.Wr32(self.header, map_upgrade.LIGHT_COUNT, n)
        self.sections = {'rec136_260': Section(data)}

    def get(self, name):
        return self.sections[name]


def light_records():
    recs = bytearray()
    for i, (pos, color, near, far) in enumerate([((1, 2, 3), (1, .5, .25), 1.5, 8), ((-4, 0, 9), (0, 0, 1), 0, 20)]):
        b = bytearray(136)
        struct.pack_into('>HH', b, 0, 0x0390, 0)
        struct.pack_into('>3f', b, 8, *color)
        rc.Wr32(b, 20, 1)
        struct.pack_into('>3f', b, 48, *pos)
        struct.pack_into('>2f', b, 104, near, far)
        recs += b
    recs += b'Studio_Point_000\0Studio_Point_001\0'
    rc.PadTo(recs, 64)
    for v in (0.75, 2.0):
        rc.PutF(recs, v)
    return recs


def lights():
    got = map_upgrade.lights(FakeChunk(2, light_records()))
    check([l['name'] for l in got] == ['Studio_Point_000', 'Studio_Point_001'], 'lights: names')
    check(got[0]['position'] == [1.0, 2.0, 3.0] and got[0]['color'] == [1.0, .5, .25] and got[0]['far'] == 8.0 and got[0]['near'] == 1.5, 'lights: place, colour, range')
    check([l['intensity'] for l in got] == [0.75, 2.0], 'lights: brightness after the names')
    check(map_upgrade.lights(FakeChunk(0, bytearray())) == [], 'lights: none')


def donor(game, tmp):
    """mp_bac_01's chunk and the sky's pictures, laid out as the editor hands them over (src/lib/gameSky.ts)."""
    pack = rc.Packfile(Path(game) / 'mp_city_stream.vpp_xbox2')
    folder = tmp / 'game'
    folder.mkdir()
    (folder / 'mp_bac_01.bbchunk_xbox2').write_bytes(pack.read('mp_bac_01.bbchunk_xbox2'))
    (folder / 'mp_bac_01.peg_xbox2').write_bytes(pack.read('mp_bac_01.peg_xbox2'))
    pack.close()
    names = native_sky.extract(folder / 'mp_bac_01.bbchunk_xbox2', tmp / 'probe')['textures']
    _, _, entries = peg.parse_peg(folder / 'mp_bac_01.peg_xbox2')
    by = {}
    for e in entries:
        if e.payload and e.name.lower() not in by:
            by[e.name.lower()] = e
    d, tex = folder / 'native_sky', []
    d.mkdir()
    for n in names:
        e = by.get(n.lower())
        if e is None:
            continue
        f = f'texture_{len(tex):02d}.bin'
        (d / f).write_bytes(bytes(e.payload))
        tex.append({'name': e.name, 'entry': bytes(e.raw).hex(), 'file': f, 'bytes': len(e.payload)})
    (d / 'textures.json').write_text(json.dumps({'source': 'mp_bac_01', 'textures': tex, 'shared': [n for n in names if n.lower() not in by]}))
    (folder / 'mp_bac_01.peg_xbox2').unlink()
    return folder


def installed_maps(game, maps, tmp):
    later_done = []
    source = donor(game, tmp)
    for d in sorted(p for p in Path(maps).iterdir() if p.is_dir()):
        for c in (d / 'levels').glob('*.bbchunk_xbox2'):
            p = c.with_suffix('.peg_xbox2')
            if not p.is_file():
                continue
            w = tmp / ('map_' + d.name.replace(' ', '_'))
            w.mkdir()
            chunk, texfile = w / c.name, w / p.name
            shutil.copy(c, chunk)
            shutil.copy(p, texfile)
            logs = []
            before = map_upgrade.inspect({'chunk': str(chunk)}, logs.append)
            state = before['upgrades']['game_sky']['state']
            retail = before['upgrades']['retail_materials']['state']
            mm = before['upgrades']['minimap']['state']
            # A fresh copy of mp_bac_01's chunk each time: the sky is read from it, then it is deleted.
            spare = w / 'mp_bac_01.bbchunk_xbox2'
            shutil.copy(source / 'mp_bac_01.bbchunk_xbox2', spare)
            if (source / 'native_sky' / 'sky.json').exists():
                (source / 'native_sky' / 'sky.json').unlink()
            # The picture the editor draws from above (src/lib/mapFolder/minimap.ts), over a 60 m square.
            picture = w / 'minimap.png'
            Image.new('RGBA', (1024, 1024), (40, 120, 200, 255)).save(picture)
            spec = {'chunk': str(chunk), 'peg': str(texfile), 'upgrades': ['game_sky', 'minimap', 'retail_materials'],
                    'game_sky': {'dir': str(source / 'native_sky'), 'chunk': str(spare)},
                    'minimap_png': str(picture), 'minimap_box': [-30.0, -20.0, 30.0, 40.0]}
            old = (chunk.read_bytes(), texfile.read_bytes())
            r = map_upgrade.upgrade(spec, logs.append)
            ch = rc.read_chunk(chunk.read_bytes())
            after = map_upgrade.inspect({'chunk': str(chunk)}, logs.append)
            want = [k for k, st in (('retail_materials', retail), ('minimap', mm), ('game_sky', state)) if st == 'available']
            check(r['applied'] == want, f'{d.name}: applied {r["applied"]}, in order (materials first, the sky last)')
            name = map_upgrade.Minimap.picture_name(c.stem)
            if mm == 'available':
                d2 = chunk.read_bytes()
                at = minimap_region.find(d2, name)
                centre, size, pause = minimap_region.floor(d2, at) if at >= 0 else ((0, 0, 0), (0, 0, 0), 0)
                _, _, ents = peg.parse_peg(texfile)
                slot = [e.name for e in ents].index(name) if name in [e.name for e in ents] else -1
                old_slot = [e.name.lower() for e in peg.parse_peg(p)[2]].index(minimap_region.DONOR)
                check(at >= 0 and pause and (centre[0], centre[2], size[0], size[2]) == (0.0, 10.0, 60.0, 60.0),
                      f'{d.name}: the minimap region names {name} over the drawn area, pause map on')
                check(slot == old_slot and name in rc.chunk_strings(ch) and minimap_region.DONOR not in rc.chunk_strings(ch)
                      and bytes(ch.header[0x10:0x50]).split(b'\0')[0] == name.encode(), f'{d.name}: the picture takes the template slot ({slot}), named in the chunk and its header')
                if state == 'available' and not later_done:
                    # A map someone already gave the game's sky gets its minimap later, in a second go.
                    later_done.append(d.name)
                    shutil.copy(c, chunk)
                    shutil.copy(p, texfile)
                    shutil.copy(source / 'mp_bac_01.bbchunk_xbox2', spare)
                    first = map_upgrade.upgrade({**spec, 'upgrades': ['game_sky', 'retail_materials']}, logs.append)
                    then = map_upgrade.upgrade({**spec, 'upgrades': ['minimap']}, logs.append)
                    ch2 = rc.read_chunk(chunk.read_bytes())
                    check(first['applied'][-1:] == ['game_sky'] and then['applied'] == ['minimap'] and len(native_sky.sky_list(ch2)) == 5
                          and minimap_region.find(chunk.read_bytes(), name) >= 0, f'{d.name}: the minimap goes in after the sky, the sky kept')
            elif mm == 'unavailable':
                check(minimap_region.find(chunk.read_bytes()) < 0, f'{d.name}: no minimap area to point ({before["upgrades"]["minimap"]["why"][:40]}...)')
            check(after['lights'] == before['lights'] and all(u['state'] != 'available' for u in after['upgrades'].values()), f'{d.name}: lights kept, nothing left to do')
            if retail == 'available':
                mats, fades = map_upgrade.RetailMaterials()._todo(ch, rc.chunk_geometry(ch))
                check(not mats and not fades, f'{d.name}: no template glow or donor fade distance left')
            if state == 'available':
                _, _, entries = peg.parse_peg(texfile)
                check(len(native_sky.sky_list(ch)) == 5 and len(entries) == len(peg.parse_peg(p)[2]) + 10, f'{d.name}: the game\'s sky goes in, ten pictures added')
                again = map_upgrade.upgrade({**spec, 'game_sky': {'dir': str(source / 'native_sky')}}, logs.append)
                check(again['applied'] == [] and 'already' in again['skipped'].get('game_sky', ''), f'{d.name}: a second time it says it is done')
            else:
                check(texfile.read_bytes() == old[1] and not native_sky.sky_list(ch), f'{d.name}: no room for the sky ({state}), its texture file left as it was')
            shutil.rmtree(w)


with tempfile.TemporaryDirectory() as t:
    tmp = Path(t)
    lights()
    game = os.environ.get('SR1_GAME_PACKFILES') or 'C:/Games/SaintsReborn/dist/game/packfiles'
    maps = os.environ.get('SR1_MAPS') or str(Path(game).parent.parent / 'maps')
    if Path(game, 'mp_city_stream.vpp_xbox2').is_file() and Path(maps).is_dir():
        installed_maps(game, maps, tmp)
    else:
        print('skip installed maps (set SR1_GAME_PACKFILES and SR1_MAPS)')

print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)

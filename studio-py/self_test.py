#!/usr/bin/env python3
"""Fast structural regression for v0.20 OBJ Orientation Fix.

`stress_test.py` contains the slower 5,455-triangle Blood Gulch-sized regression.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import struct
from PIL import Image

import sr1_export
import sr_reborn_core as rc
import peg_xbox2_beaver as peg


def assert_chunk_peg_links(chunk_path, peg_path):
    ch = rc.read_chunk(Path(chunk_path).read_bytes())
    strings = rc.chunk_strings(ch)
    _, _, entries = peg.parse_peg(peg_path)
    names = [e.name for e in entries]
    if strings != names:
        raise RuntimeError('chunk string table != PEG resource names')
    return ch, rc.chunk_geometry(ch), entries


def main():
    here = Path(__file__).resolve().parent
    ref = here / 'reference_beavercreek'
    raw = (ref / 'beavercreek.bbchunk_xbox2').read_bytes()
    if struct.unpack_from('>I', raw, 0)[0] != 0xBBCACA12:
        raise RuntimeError('bad Beaver reference')

    # Generic source-derived parser/writer must be stable after the intentional
    # refresh of the four stale offset words in the stock/template header.
    ch = rc.read_chunk(raw)
    once = rc.write_chunk(ch)
    twice = rc.write_chunk(rc.read_chunk(once))
    if once != twice or len(once) != len(raw):
        raise RuntimeError('Reborn chunk round-trip is not stable')
    if len(rc.chunk_geometry(ch).mats) != 29:
        raise RuntimeError('Beaver material table parse failed')

    with TemporaryDirectory(prefix='sr1_v016_quick_') as t:
        td = Path(t)
        obj = td / 'simple.obj'
        tex = td / 'ground.png'
        out = td / 'out'
        obj.write_text(
            'v -10 0 -10\n'
            'v 10 0 -10\n'
            'v 10 0 10\n'
            'v -10 0 10\n'
            'vt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\n'
            'vn 0 1 0\n'
            'usemtl ground\n'
            'f 1/1/1 3/3/1 2/2/1\n'
            'f 1/1/1 4/4/1 3/3/1\n',
            encoding='ascii',
        )
        Image.new('RGBA', (64, 64), (90, 120, 70, 96)).save(tex)
        r = sr1_export.export_map(
            obj, {'ground': str(tex)}, out, 'testmap', alpha_mapping={'ground': True}, surface_mapping={'ground': 15},
            markers=[{'type':'Shared spawn','position':[0,1,0],'yaw':0,'label':''}]
        )
        _, g, entries = assert_chunk_peg_links(
            out / 'testmap.bbchunk_xbox2', out / 'testmap.peg_xbox2'
        )
        if r['bbchunk']['collision_triangles'] != 2 or not r['bbchunk']['collision_full_coverage']:
            raise RuntimeError('simple collision failed')
        if len(g.mats) != 30 or len(entries) != 33:
            raise RuntimeError('dynamic material/PEG append failed')
        if struct.unpack_from('>H',entries[-1].raw,0x0A)[0] != 0:
            raise RuntimeError('Nonzero PEG disk directory +0x0A; expected retail-compatible zero')
        if entries[-1].fmt != peg.FMT_DXT5:
            raise RuntimeError('Use Alpha did not append DXT5')
        # v1.06+ safe exporter publishes validated map files directly; it no
        # longer creates a READY_TO_INSTALL ZIP as older self-tests expected.
        for extension in ('bbchunk_xbox2','peg_xbox2','bbcity_xbox2','hmap_xbox2','pvsv_xbox2','cts'):
            if not (out / ('testmap.'+extension)).is_file():
                raise RuntimeError('missing validated map output: '+extension)

        # Cross the old 24-added-texture boundary and ensure PEG payloads relocate.
        import sr_reborn_bridge
        items=[{'name':f'q{i:02d}.tga','source_path':str(tex),'use_alpha':False,'material':f'q{i:02d}'} for i in range(25)]
        bigpeg=td/'expanded.peg_xbox2'
        pr=sr_reborn_bridge.append_dynamic_textures(ref/'beavercreek.peg_xbox2',bigpeg,items)
        _,hh,ee=peg.parse_peg(bigpeg)
        if hh.count!=57 or len(ee)!=57 or pr['data_start']!=0x2000 or not pr['payload_relocated']:
            raise RuntimeError('expanded PEG >24-resource regression failed')

    print('SELF TEST OK: v0.53 material registry integrity')
    print('  generic BBChunk parser/writer stable')
    print('  named BBChunk material -> PEG resource linkage validated')
    print('  source-derived MOPP collision validated')
    print('  alpha DXT5 path validated')
    print('  six directly published map files validated')
    print('  >24 imported textures validated with automatic PEG payload relocation')
    print('Run stress_test.py for the slower 5,455-triangle Blood Gulch regression.')


if __name__ == '__main__':
    main()

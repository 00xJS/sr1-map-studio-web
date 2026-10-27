#!/usr/bin/env python3
"""Experimental map-only early surface registration through always-loaded PEG.

Ground truth: sf_probe0000001.peg_xbox2 from user-tested Surface Test adds
four map textures to the sr_custom000001 environment PEG; its native BBChunk
is byte-identical to sr_custom000001.bbchunk_xbox2. The Surface Test BBCity
references sf_probe0000001 in its 16-byte environment slot. No Lua required.

The map's exact encoded texture entries are copied to the environment PEG,
never recompressed. Surface ID resides in runtime name classification, not
PEG directory +0x0A. This is a controlled experimental generalization, NOT
a guarantee that every arbitrary map's load ordering matches Surface Test.
"""
from __future__ import annotations
from pathlib import Path
import struct, hashlib, shutil
import peg_xbox2_beaver as peg

KNOWN_SURFACE_SUFFIXES={
    'co','cb','ca','ce','dt','dw','fl','lv','gh','gm','gl','gs',
    'gv','ma','fm','me','tm','pl','rb','sa','wa','wo',
}

def resource_name(map_name):
    """An independent reproducible 15-char asset stem fitting BBCity's fixed slot."""
    data=map_name.lower().encode('ascii','strict')
    return 'sf_'+map_name.lower()[:8].ljust(8,'0')+hashlib.sha256(data).hexdigest()[:4]

def _suffix(name):
    stem=name.lower().removesuffix('.tga')
    return stem.rsplit('_',1)[-1]

def patch_bbcity_reference(path,stem):
    """Modify only full retail BBCity's fixed always-loaded environment name."""
    path=Path(path)
    data=bytearray(path.read_bytes())
    if len(data)!=3060416 or data[:8]!=bytes.fromhex('bbc17eee00000021'):
        raise RuntimeError('Map-only early surface preload requires full-size retail BBCity')
    if struct.unpack_from('>I',data,0x3e8)[0]!=16:
        raise RuntimeError('Unexpected BBCity environment-name length; not modifying')
    old=bytes(data[0x3ec:0x3fc])
    if old[-1]!=0 or any(ch<32 or ch>126 for ch in old[:-1]):
        raise RuntimeError('Unexpected BBCity original environment-name encoding; not modifying')
    if len(stem)!=15 or not stem.isascii() or not all(ch.isalnum() or ch=='_' for ch in stem):
        raise ValueError('Environment resource name must be exactly 15 ASCII letters/digits/underscores')
    data[0x3ec:0x3fc]=stem.encode('ascii')+b'\0'
    path.write_bytes(data)
    check=path.read_bytes()
    if check[0x3ec:0x3fc]!=stem.encode('ascii')+b'\0':
        raise RuntimeError('BBCity environment name failed to serialize')
    return {'old':old.rstrip(b'\0').decode('ascii'),'new':stem,'file':str(path)}

def build_pair(sky_chunk,sky_peg,map_peg,map_names,output_dir,stem):
    """Append map textures while preserving every retail frame, alias and byte.

    PEG count is UNIQUE names; total_entries is the physical directory length.
    The old writer truncated 26 frame-related entries and reassembled incomplete
    payloads. Retain the full directory and the entire original data region.
    """
    sky_chunk,sky_peg,map_peg=map(Path,(sky_chunk,sky_peg,map_peg))
    out=Path(output_dir);out.mkdir(parents=True,exist_ok=True)
    data,sh,sky_entries=peg.parse_peg(sky_peg,include_frames=True)
    map_data,mh,map_entries=peg.parse_peg(map_peg,include_frames=True)
    if (sh.version,sh.platform,mh.version,mh.platform)!=(8,3,8,3):
        raise RuntimeError('Expected SR1 Xbox2 PEG v8 platform 3')
    chunk_bytes=sky_chunk.read_bytes()
    if chunk_bytes[:8]!=bytes.fromhex('bbcaca1200000055'):
        raise RuntimeError('Expected a version-85 environment BBChunk')
    if not sky_entries:raise RuntimeError('Empty sky PEG')
    unique_sky={e.name.lower() for e in sky_entries}
    if len(unique_sky)!=sh.count:
        raise RuntimeError('Sky unique-name count disagrees with its header')
    map_lookup={}
    for entry in map_entries:map_lookup.setdefault(entry.name.lower(),[]).append(entry)
    added=[];known=set(unique_sky)
    for target in dict.fromkeys(str(s) for s in map_names):
        low=target.lower()
        if low not in map_lookup or len(map_lookup[low])!=1:
            raise RuntimeError('Missing or ambiguous map surface texture: '+target)
        if _suffix(target) not in KNOWN_SURFACE_SUFFIXES:
            raise RuntimeError('Unsupported physical-surface suffix: '+target)
        if low in known:raise RuntimeError('Surface conflicts with an environment texture: '+target)
        entry=map_lookup[low][0]
        if not entry.payload or entry.frame_size!=len(entry.payload):
            raise RuntimeError('Invalid map texture payload: '+target)
        if struct.unpack_from('>H',entry.raw,0x0a)[0]!=0:
            raise RuntimeError('Nonzero reserved PEG field: '+target)
        added.append(entry);known.add(low)
    if not added:raise RuntimeError('No surface textures selected for early registration')
    count=sh.count+len(added);total=sh.total_entries+len(added)
    if total>=65536:raise RuntimeError('Too many environment texture entries')
    old_start=min(e.data_offset for e in sky_entries)
    old_end=peg.HEADER_SIZE+sh.total_entries*peg.ENTRY_SIZE
    if old_start<sh.dir_size or any(data[old_end:old_start]):
        raise RuntimeError('Unrecognized nonzero data between sky directory and payload')
    directory=peg.align(peg.HEADER_SIZE+total*peg.ENTRY_SIZE,16)
    data_start=max(old_start,peg.align(directory,4096))
    delta=data_start-old_start
    result=bytearray(data_start)
    result.extend(data[old_start:])
    # Retain ALL original directory entries in their original order. Aliased
    # offsets and animated .mov entries remain untouched except relocation.
    for i,entry in enumerate(sky_entries):
        row=bytearray(entry.raw)
        struct.pack_into('>I',row,0,entry.data_offset+delta)
        result[24+i*72:96+i*72]=row
    map_offsets=sorted({e.data_offset for e in map_entries}|{len(map_data)})
    copied=[]
    for i,entry in enumerate(added,sh.total_entries):
        result.extend(b'\0'*((-len(result))%4096))
        offset=len(result);row=bytearray(entry.raw)
        struct.pack_into('>I',row,0,offset)
        result[24+i*72:96+i*72]=row
        end=min(x for x in map_offsets if x>entry.data_offset)
        span=map_data[entry.data_offset:end]
        result.extend(span);copied.append((offset,span))
    result.extend(b'\0'*((-len(result))%4096))
    # Retail data_size starts after the physical entries (including padding).
    struct.pack_into('>IHHIIHHHH',result,0,sh.signature,sh.version,sh.platform,
                     directory,len(result)-(peg.HEADER_SIZE+total*peg.ENTRY_SIZE),count,
                     sh.flags,total,sh.alignment)
    peg_out=out/(stem+'.peg_xbox2');chunk_out=out/(stem+'.bbchunk_xbox2')
    peg_out.write_bytes(result);chunk_out.write_bytes(chunk_bytes)
    new_data,new_header,new_entries=peg.parse_peg(peg_out,include_frames=True)
    if (new_header.count,new_header.total_entries)!=(count,total):raise RuntimeError('Preload counts failed')
    if new_data[data_start:data_start+len(data)-old_start]!=data[old_start:]:
        raise RuntimeError('Environment payload region changed')
    for old,new in zip(sky_entries,new_entries):
        if new.raw[4:]!=old.raw[4:] or new.data_offset!=old.data_offset+delta:
            raise RuntimeError('Environment directory changed: '+old.name)
    for old,new,(offset,span) in zip(added,new_entries[sh.total_entries:],copied):
        if old.raw[4:]!=new.raw[4:] or new_data[offset:offset+len(span)]!=span:
            raise RuntimeError('Surface preload bytes changed: '+old.name)
    return dict(resource_name=stem,donor_count=sh.count,donor_total_entries=sh.total_entries,
                count=count,total_entries=total,added=[e.name for e in added],
                copied_exact_payload=True,preserved_all_donor_bytes=True,
                bbchunk=str(chunk_out),peg=str(peg_out),peg_bytes=len(result),
                experimental=True,gameplay_verified=False)


def content_resource_name(map_name,sky_chunk,sky_peg,map_peg,names):
    """Avoid reusing cached environment resources after material changes."""
    h=hashlib.sha256(map_name.encode('ascii'))
    for path in (sky_chunk,sky_peg,map_peg):
        with Path(path).open('rb') as stream:
            for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    h.update('\0'.join(names).encode('ascii'))
    return 'sf_'+h.hexdigest()[:12]


def resolve_inputs(city,sky_chunk,sky_peg):
    """Resolve the bundled tested recipe; never silently replace an explicit donor."""
    from sr1_sidecars import _read_full_bbcity_envref
    here=Path(__file__).resolve().parent
    city=Path(city) if city else here/'surface_preload_presets/surftest.bbcity_xbox2'
    data=city.read_bytes();env=_read_full_bbcity_envref(data)
    if not env or data[0x3fc:0x400]!=(11).to_bytes(4,'big'):
        raise ValueError('Surface preload requires a compatible full BBCity. Clear the BBCity donor to use the bundled surface-test template.')
    if not sky_chunk and not sky_peg:
        if env=='sf_probe0000001':env='sr_custom000001'
        if env not in ('sr_custom000001','sr_alwayshwyf01'):
            raise ValueError('Select the original environment BBChunk and PEG for this BBCity.')
        sky_chunk=here/'native_sky_presets'/(env+'.bbchunk_xbox2')
        sky_peg=here/'native_sky_presets'/(env+'.peg_xbox2')
    if not sky_chunk or not sky_peg:raise ValueError('Surface preload needs both sky resources.')
    for path in (sky_chunk,sky_peg):
        if not Path(path).is_file():raise ValueError('Missing surface-preload resource: '+str(path))
    return str(city),str(sky_chunk),str(sky_peg)

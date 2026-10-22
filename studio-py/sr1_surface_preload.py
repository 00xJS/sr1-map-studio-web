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
    """Build an environment pair from donor + exact packed map texture entries.

    Existing entries and their payloads are preserved, with offsets rewritten
    because the directory grows. All new entries are complete copies (except
    physical payload offset) from the already-final map PEG.
    """
    sky_chunk=Path(sky_chunk);sky_peg=Path(sky_peg);map_peg=Path(map_peg)
    out=Path(output_dir);out.mkdir(parents=True,exist_ok=True)
    name=stem
    chunk_out=out/(name+'.bbchunk_xbox2')
    peg_out=out/(name+'.peg_xbox2')
    data,sh,sky_entries=peg.parse_peg(sky_peg)
    _,mh,map_entries=peg.parse_peg(map_peg)
    if sh.version!=8 or sh.platform!=3 or mh.version!=8 or mh.platform!=3:
        raise RuntimeError('Expected SR1 Xbox2 PEG v8 platform 3')
    if sky_chunk.open('rb').read(4)!=bytes.fromhex('bbcaca12'):
        raise RuntimeError('Environment donor BBChunk signature invalid')
    if sh.dir_size<peg.HEADER_SIZE+sh.count*peg.ENTRY_SIZE:
        raise RuntimeError('Environment PEG directory inconsistent')
    map_lookup={}
    for e in map_entries:
        map_lookup.setdefault(e.name.lower(),e)
    known={e.name.lower() for e in sky_entries}
    added=[]
    for target in dict.fromkeys(str(s) for s in map_names):
        low=target.lower()
        if low not in map_lookup:
            raise RuntimeError('Map texture missing from final map PEG: '+target)
        if _suffix(target) not in KNOWN_SURFACE_SUFFIXES:
            raise RuntimeError('Map texture does not have a supported physical-surface suffix: '+target)
        if low in known:
            raise RuntimeError('Map surface texture already exists in environment PEG; avoid conflicting registrations: '+target)
        entry=map_lookup[low]
        if not entry.payload or entry.frame_size!=len(entry.payload):
            raise RuntimeError('Map surface texture has invalid/empty texture payload: '+target)
        if struct.unpack_from('>H',entry.raw,0x0a)[0]!=0:
            raise RuntimeError('PEG serialized reserved field is not zero for: '+target)
        added.append(entry)
        known.add(low)
    if not added:
        raise RuntimeError('No surface textures selected for early registration')
    built=[(bytearray(e.raw),e.payload) for e in sky_entries]
    built.extend((bytearray(e.raw),e.payload) for e in added)
    count=len(built)
    if count>=65536: raise RuntimeError('Environment PEG resource count too large')
    dir_size=peg.HEADER_SIZE+count*peg.ENTRY_SIZE
    # Same relocation/alignment as v1.07 dynamic PEG writer and Astra's probe.
    data_start=max(min(e.data_offset for e in sky_entries),peg.align(dir_size,0x1000))
    blob=bytearray();offsets=[]
    # Some native sky PEGs contain important UNINDEXED trailing data after the
    # last named texture. Astra's confirmed sf_probe preserves these bytes
    # verbatim before appending custom surfaces (1,630,208 bytes in donor).
    end_of_named_data=max(e.data_offset+len(e.payload) for e in sky_entries)
    if end_of_named_data>len(data):
        raise RuntimeError('Environment PEG resources exceed donor file')
    donor_tail=data[end_of_named_data:]
    for slot,(raw,payload) in enumerate(built):
        if slot==len(sky_entries):
            blob.extend(donor_tail)
        padding=(-len(blob))%0x1000
        if padding:blob.extend(b'\0'*padding)
        offsets.append(data_start+len(blob))
        blob.extend(payload)
    blob.extend(b'\0'*((-len(blob))%0x1000))
    result=bytearray(data_start+len(blob))
    struct.pack_into('>IHHIIHHHH',result,0,sh.signature,sh.version,sh.platform,
                     dir_size,len(blob),count,sh.flags,count,sh.alignment)
    for i,((raw,payload),offset) in enumerate(zip(built,offsets)):
        struct.pack_into('>I',raw,0,offset)
        result[peg.HEADER_SIZE+i*peg.ENTRY_SIZE:peg.HEADER_SIZE+(i+1)*peg.ENTRY_SIZE]=raw
    result[data_start:]=blob
    peg_out.write_bytes(result)
    shutil.copy2(sky_chunk,chunk_out)
    # Compare the new directory and full encoded payload with final map PEG.
    _,new_header,new_entries=peg.parse_peg(peg_out)
    if new_header.count!=count or len(new_entries)!=count:
        raise RuntimeError('Generated surface preload PEG count mismatch')
    for i,source in enumerate(added):
        new=new_entries[len(sky_entries)+i]
        if new.name!=source.name or new.raw[4:]!=source.raw[4:] or new.payload!=source.payload:
            raise RuntimeError('Surface preload texture does not match main map PEG: '+source.name)
    for i,source in enumerate(sky_entries):
        new=new_entries[i]
        if new.name!=source.name or new.payload!=source.payload or new.raw[4:]!=source.raw[4:]:
            raise RuntimeError('Sky donor texture changed while building preload PEG: '+source.name)
    if chunk_out.read_bytes()!=sky_chunk.read_bytes():
        raise RuntimeError('Original sky BBChunk was modified')
    return {'resource_name':name,'donor_count':len(sky_entries),'count':count,
            'added':[x.name for x in added], 'copied_exact_payload':True,
            'bbchunk':str(chunk_out),'peg':str(peg_out),'peg_bytes':peg_out.stat().st_size}

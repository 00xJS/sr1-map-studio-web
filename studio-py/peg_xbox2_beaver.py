#!/usr/bin/env python3
"""Saints Row 1 Xbox 360 .peg_xbox2 reader/writer for the Beaver Creek layout.

Recovered from the user's known-working custom Beaver Creek map and checked
against the retail mplobby_01 PEG:

  0x18-byte big-endian header
  N * 0x48-byte directory entries
  directory ends exactly at 0x18 + N*0x48
  texture payload starts on a 0x1000 boundary
  entry filenames are inline at +0x17 (29-byte field)
  frame size is at +0x34

The texture payload is BC1/DXT1 (fmt 0x190) or BC3/DXT5 (fmt 0x192), Xbox 360
2D tiled, then 16-bit endian swapped.  Surface storage is padded to at least a
32x32 block macro-tile. v0.7 uses the direct Xenos tiled-offset formula and
validates it against the working Beaver Creek payloads.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import struct
from PIL import Image

MAGIC = 0x564B4547  # 'VKEG'
HEADER_SIZE = 0x18
ENTRY_SIZE = 0x48
NAME_OFF = 0x17
NAME_LEN = 0x1D  # bytes through +0x33 inclusive
FMT_DXT1 = 0x0190
FMT_DXT3 = 0x0191
FMT_DXT5 = 0x0192


def align(x:int,a:int)->int:
    return ((x+a-1)//a)*a

@dataclass
class PegHeader:
    signature:int
    version:int
    platform:int
    dir_size:int
    data_size:int
    count:int
    flags:int
    total_entries:int
    alignment:int

@dataclass
class PegEntry:
    index:int
    raw:bytearray
    data_offset:int
    width:int
    height:int
    fmt:int
    flags_byte:int
    one_byte:int
    mip_levels:int
    name:str
    frame_size:int
    payload:bytes


def parse_peg(path):
    data=Path(path).read_bytes()
    if len(data)<HEADER_SIZE:
        raise RuntimeError('PEG too small')
    sig,ver,plat,dirsz,datasz,n,flags,total,al=struct.unpack_from('>IHHIIHHHH',data,0)
    if sig!=MAGIC:
        raise RuntimeError(f'not an SR1 Xbox2 PEG: 0x{sig:08X}')
    if HEADER_SIZE+n*ENTRY_SIZE>len(data):
        raise RuntimeError('PEG entry table exceeds file')
    h=PegHeader(sig,ver,plat,dirsz,datasz,n,flags,total,al)
    out=[]
    for i in range(n):
        o=HEADER_SIZE+i*ENTRY_SIZE
        raw=bytearray(data[o:o+ENTRY_SIZE])
        doff=struct.unpack_from('>I',raw,0)[0]
        w,hgt,fmt=struct.unpack_from('>HHH',raw,4)
        name=bytes(raw[NAME_OFF:NAME_OFF+NAME_LEN]).split(b'\0',1)[0].decode('latin1','replace')
        frame=struct.unpack_from('>I',raw,0x34)[0]
        if doff>len(data):
            raise RuntimeError(f'entry {i} data offset outside PEG')
        if frame and doff+frame<=len(data):
            payload=data[doff:doff+frame]
        else:
            # Beaver reference has nonzero frame sizes.  This fallback keeps the
            # parser usable on retail files containing aliases/zero-size frames.
            next_off=len(data)
            for j in range(i+1,n):
                q=struct.unpack_from('>I',data,HEADER_SIZE+j*ENTRY_SIZE)[0]
                if q>doff:
                    next_off=q; break
            payload=data[doff:next_off] if next_off>=doff else b''
        out.append(PegEntry(i,raw,doff,w,hgt,fmt,raw[0x14],raw[0x15],raw[0x16],name,frame,payload))
    return data,h,out


def rgb565(rgb):
    r,g,b=rgb
    return ((r>>3)<<11)|((g>>2)<<5)|(b>>3)

def un565(v):
    return (((v>>11)&31)*255//31,((v>>5)&63)*255//63,(v&31)*255//31)

def _dist(a,b):
    return sum((a[i]-b[i])**2 for i in range(3))

def _bc1_palette(c0, c1):
    p0=un565(c0); p1=un565(c1)
    return (p0,p1,
            tuple((2*p0[k]+p1[k])//3 for k in range(3)),
            tuple((p0[k]+2*p1[k])//3 for k in range(3)))


def _bc1_score(rgbs, c0, c1):
    palette=_bc1_palette(c0,c1)
    bits=0; error=0
    for i,p in enumerate(rgbs):
        choices=[_dist(p,q) for q in palette]
        j=min(range(4),key=choices.__getitem__)
        bits |= j << (2*i)
        error += choices[j]
    return error,bits


def compress_dxt1_block(px):
    """Choose BC1 endpoints by actual reconstruction error, not just RGB extrema.

    The older bounding-box compressor picks channel minima/maxima independently:
    those corners may not describe any color in the image (especially textures
    with correlated RGB colors). Test a diagonal-extreme pair too, score both
    after 565 quantization, and keep whichever reconstructs the block best.
    """
    rgbs=[p[:3] for p in px]
    lo=tuple(min(p[i] for p in rgbs) for i in range(3))
    hi=tuple(max(p[i] for p in rgbs) for i in range(3))
    candidates=[(hi,lo)]
    # Project onto the block's dominant color direction, using the farthest
    # endpoint pair as an inexpensive principal-axis approximation.
    unique=list(dict.fromkeys(rgbs))
    if len(unique)>1:
        a=max(unique,key=lambda p:_dist(p,lo))
        b=max(unique,key=lambda p:_dist(p,a))
        a=max(unique,key=lambda p:_dist(p,b))
        candidates.append((a,b))
    best=None
    for rgb0,rgb1 in candidates:
        c0,c1=rgb565(rgb0),rgb565(rgb1)
        if c0==c1:
            if c0<65535: c0+=1
            else: c1-=1
        if c0<c1: c0,c1=c1,c0
        err,bits=_bc1_score(rgbs,c0,c1)
        if best is None or err<best[0]:
            best=(err,c0,c1,bits)
    _,c0,c1,bits=best
    return struct.pack('<HHI',c0,c1,bits)

def _alpha_palette(a0,a1):
    if a0>a1:
        return [a0,a1]+[((7-i)*a0+(i-1)*a1)//7 for i in range(2,8)]
    return [a0,a1]+[((5-i)*a0+(i-1)*a1)//5 for i in range(2,6)]+[0,255]

def compress_dxt5_block(px):
    al=[p[3] for p in px]
    a0=max(al); a1=min(al)
    if a0==a1:
        a1=0 if a0 else 255
    if a0<a1: a0,a1=a1,a0
    pal=_alpha_palette(a0,a1)
    bits=0
    for i,a in enumerate(al):
        q=min(range(8),key=lambda x:abs(a-pal[x]))
        bits|=q<<(3*i)
    return bytes((a0,a1))+int(bits).to_bytes(6,'little')+compress_dxt1_block(px)

def compress_image(img,kind):
    img=img.convert('RGBA')
    w,h=img.size; pix=img.load()
    bw=max(1,(w+3)//4); bh=max(1,(h+3)//4)
    fn=compress_dxt1_block if kind=='DXT1' else compress_dxt5_block
    out=bytearray()
    for by in range(bh):
        for bx in range(bw):
            block=[]
            for yy in range(4):
                y=min(h-1,by*4+yy)
                for xx in range(4):
                    x=min(w-1,bx*4+xx)
                    block.append(pix[x,y])
            out+=fn(block)
    return bytes(out)

# Xbox 360 Xenos tiled-surface addressing.
#
# v0.6 used the XGAddress2DTiledX/Y coordinate form and then reconstructed a
# byte offset from those coordinates. That is subtly wrong for these SR1 PEG
# surfaces and produces the striped/checkerboard corruption seen in game.
# The direct offset form below is the same address model used by known Xbox 360
# texture tools and, critically, it round-trips the working Beaver Creek PEG.
def XGAddress2DTiledOffset(x,y,width_elements,texel_pitch):
    aligned_width=(width_elements+31)&~31
    log_bpp=(texel_pitch>>2)+((texel_pitch>>1)>>(texel_pitch>>2))
    macro=((x>>5)+(y>>5)*(aligned_width>>5)) << (log_bpp+7)
    micro=(((x&7)+((y&6)<<2)) << log_bpp)
    offset=(macro + ((micro & ~15)<<1) + (micro & 15)
            + ((y&8) << (3+log_bpp)) + ((y&1)<<4))
    return (((offset & ~511)<<3) + ((offset & 448)<<2) + (offset & 63)
            + ((y&16)<<7) + (((((y&8)>>2)+(x>>3))&3)<<6)) >> log_bpp

def _block_geometry(width,height,kind):
    pitch=8 if kind=='DXT1' else 16
    bw=max(1,(int(width)+3)//4); bh=max(1,(int(height)+3)//4)
    aw=max(32,(bw+31)&~31); ah=max(32,(bh+31)&~31)
    return pitch,bw,bh,aw,ah

def tile_x360(linear,width,height,kind):
    pitch,bw,bh,aw,ah=_block_geometry(width,height,kind)
    if len(linear)!=bw*bh*pitch:
        raise RuntimeError('linear BC payload size mismatch')
    out=bytearray(aw*ah*pitch)
    for y in range(bh):
        for x in range(bw):
            src=(y*bw+x)*pitch
            dst=XGAddress2DTiledOffset(x,y,bw,pitch)*pitch
            if dst+pitch>len(out):
                raise RuntimeError(f'Xbox tiled address overflow ({x},{y}) -> 0x{dst:X}')
            out[dst:dst+pitch]=linear[src:src+pitch]
    return bytes(out)

def untile_x360(tiled,width,height,kind):
    """Inverse used by validation; returns only the active BC blocks."""
    pitch,bw,bh,aw,ah=_block_geometry(width,height,kind)
    if len(tiled)<aw*ah*pitch:
        raise RuntimeError('tiled BC payload is smaller than the recovered surface extent')
    out=bytearray(bw*bh*pitch)
    for y in range(bh):
        for x in range(bw):
            src=XGAddress2DTiledOffset(x,y,bw,pitch)*pitch
            dst=(y*bw+x)*pitch
            out[dst:dst+pitch]=tiled[src:src+pitch]
    return bytes(out)

def swap16(data):
    out=bytearray(data)
    for i in range(0,len(out)-1,2):
        out[i],out[i+1]=out[i+1],out[i]
    return bytes(out)

def _has_alpha(img):
    lo,hi=img.convert('RGBA').getchannel('A').getextrema()
    return lo<255

def encode_texture(path,use_alpha=False):
    img=Image.open(path).convert('RGBA')
    source_has_alpha=_has_alpha(img)
    alpha=bool(use_alpha and source_has_alpha)
    if not alpha:
        # Halo diffuse bitmaps frequently carry masks in alpha. Treat those
        # channels as metadata unless the material explicitly opts into opacity.
        img.putalpha(255)
    kind='DXT5' if alpha else 'DXT1'
    fmt=FMT_DXT5 if alpha else FMT_DXT1
    linear=compress_image(img,kind)
    tiled=tile_x360(linear,img.width,img.height,kind)
    return {
        'width':img.width,'height':img.height,'fmt':fmt,
        'flags_byte':1 if alpha else 0,'mip_levels':1,
        'payload':swap16(tiled),'kind':kind,
        'source_has_alpha':source_has_alpha,'use_alpha':bool(use_alpha),
    }

def _write_name(raw:bytearray,name:str):
    b=name.encode('ascii','strict')
    if len(b)>=NAME_LEN:
        raise RuntimeError(f'PEG resource name too long ({len(b)} >= {NAME_LEN}): {name}')
    raw[NAME_OFF:NAME_OFF+NAME_LEN]=b'\0'*NAME_LEN
    raw[NAME_OFF:NAME_OFF+len(b)]=b

def build_from_reference(reference_path,output_path,replacements):
    """Rebuild a Beaver-style PEG.

    replacements maps PEG entry index -> {'source_path':..., 'peg_name':...}.
    Unreplaced entries and payloads are copied from the known-working reference.
    """
    _,h,entries=parse_peg(reference_path)
    if h.version!=8 or h.platform!=3 or h.count<=0:
        raise RuntimeError('reference PEG is not the expected SR1 Xbox2 layout')
    if h.dir_size!=HEADER_SIZE+h.count*ENTRY_SIZE:
        raise RuntimeError('reference PEG does not use the recovered inline-name 0x48 entry layout')

    built=[]
    encoded_cache={}
    for e in entries:
        raw=bytearray(e.raw)
        if e.index in replacements:
            rec=replacements[e.index]
            ck=(str(Path(rec['source_path']).resolve()),bool(rec.get('use_alpha',False)))
            if ck not in encoded_cache:
                encoded_cache[ck]=encode_texture(rec['source_path'],rec.get('use_alpha',False))
            enc=encoded_cache[ck]
            name=str(rec['peg_name'])
            _write_name(raw,name)
            struct.pack_into('>HH',raw,0x04,enc['width'],enc['height'])
            struct.pack_into('>H',raw,0x08,enc['fmt'])
            struct.pack_into('>H',raw,0x0A,0)
            # Preserve the known-working anim/layout fields at 0x0C..0x13.
            raw[0x14]=enc['flags_byte']
            raw[0x15]=1
            raw[0x16]=1
            struct.pack_into('>I',raw,0x34,len(enc['payload']))
            raw[0x38:0x48]=b'\0'*0x10
            payload=enc['payload']
            info={**enc,'payload':None,'name':name,'source':str(rec['source_path'])}
        else:
            payload=e.payload
            # normalize frame_size to the bytes copied from the reference
            struct.pack_into('>I',raw,0x34,len(payload))
            info={'name':e.name,'source':'reference','width':e.width,'height':e.height,'fmt':e.fmt,'kind':'reference'}
        built.append((raw,payload,info))

    data_start=align(h.dir_size,0x1000)
    data_blob=bytearray()
    offsets=[]
    for raw,payload,info in built:
        pad=align(len(data_blob),0x1000)-len(data_blob)
        if pad: data_blob+=b'\0'*pad
        offsets.append(data_start+len(data_blob))
        data_blob+=payload

    out=bytearray(data_start+len(data_blob))
    struct.pack_into('>IHHIIHHHH',out,0,h.signature,h.version,h.platform,h.dir_size,len(data_blob),h.count,h.flags,h.total_entries,h.alignment)
    for i,(raw,payload,info) in enumerate(built):
        struct.pack_into('>I',raw,0,offsets[i])
        out[HEADER_SIZE+i*ENTRY_SIZE:HEADER_SIZE+(i+1)*ENTRY_SIZE]=raw
    out[data_start:data_start+len(data_blob)]=data_blob
    Path(output_path).write_bytes(out)
    return {
        'output':str(output_path),'count':h.count,'directory_size':h.dir_size,
        'data_start':data_start,'data_size':len(data_blob),
        'replaced':{str(k):v for k,v in replacements.items()},
        'entries':[x[2] for x in built],
    }

if __name__=='__main__':
    import argparse,json
    ap=argparse.ArgumentParser()
    ap.add_argument('reference'); ap.add_argument('mapping_json'); ap.add_argument('output')
    a=ap.parse_args()
    mapping=json.loads(Path(a.mapping_json).read_text())
    mapping={int(k):v for k,v in mapping.items()}
    print(json.dumps(build_from_reference(a.reference,a.output,mapping),indent=2,default=str))

# v0.10 fixed-layout PEG mode -------------------------------------------------
def compress_dxt3_block(px):
    # BC2/DXT3: explicit 4-bit alpha values followed by DXT1 color block.
    abits=0
    for i,p in enumerate(px):
        a=(int(p[3])+8)//17
        a=max(0,min(15,a))
        abits |= a << (4*i)
    return int(abits).to_bytes(8,'little') + compress_dxt1_block(px)

def compress_image_for_format(img,fmt):
    img=img.convert('RGBA'); w,h=img.size; pix=img.load()
    bw=max(1,(w+3)//4); bh=max(1,(h+3)//4)
    if fmt==FMT_DXT1: fn=compress_dxt1_block; kind='DXT1'
    elif fmt==FMT_DXT3: fn=compress_dxt3_block; kind='DXT3'
    elif fmt==FMT_DXT5: fn=compress_dxt5_block; kind='DXT5'
    else: raise RuntimeError(f'unsupported fixed Beaver texture format 0x{fmt:04X}')
    out=bytearray()
    for by in range(bh):
        for bx in range(bw):
            block=[]
            for yy in range(4):
                y=min(h-1,by*4+yy)
                for xx in range(4):
                    x=min(w-1,bx*4+xx)
                    block.append(pix[x,y])
            out+=fn(block)
    return bytes(out),kind

def plan_fixed_slots(reference_path, material_paths, alpha_mapping=None, allowed=range(1,30)):
    """Choose stable Beaver PEG slots without changing PEG physical layout.

    Cost favors matching aspect ratio first, then source/donor pixel area. Alpha
    materials may only use BC2/BC3 slots. Opaque materials can use any BC slot
    because their alpha is forced to 255 before compression.
    """
    import math
    alpha_mapping=dict(alpha_mapping or {})
    _,_,entries=parse_peg(reference_path)
    slots={e.index:e for e in entries if e.index in set(allowed) and e.fmt in (FMT_DXT1,FMT_DXT3,FMT_DXT5)}
    mats=[]
    for mat,path in material_paths.items():
        im=Image.open(path)
        sw,sh=im.size
        mats.append((str(mat),str(path),sw,sh,bool(alpha_mapping.get(mat,False))))
    if len(mats)>len(slots): raise RuntimeError('not enough fixed Beaver texture slots')
    # Hard cases first: alpha, extreme aspect ratios, large source textures.
    mats.sort(key=lambda x:(not x[4], -abs(math.log(max(x[2],1)/max(x[3],1))), -(x[2]*x[3])))
    free=set(slots)
    plan={}
    details={}
    for mat,path,sw,sh,use_alpha in mats:
        best=None
        sar=max(sw,1)/max(sh,1)
        for idx in free:
            e=slots[idx]
            if use_alpha and e.fmt==FMT_DXT1: continue
            dar=max(e.width,1)/max(e.height,1)
            aspect=abs(math.log(sar/dar))
            area=abs(math.log(max(sw*sh,1)/max(e.width*e.height,1)))
            # Prefer BC3 over BC2 for explicit alpha when otherwise similar.
            alpha_pen=0.0 if not use_alpha else (0.0 if e.fmt==FMT_DXT5 else 0.15)
            # Avoid very tiny slots unless the source is also tiny.
            tiny_pen=1.5 if min(e.width,e.height)<64 and min(sw,sh)>=64 else 0.0
            cost=4.0*aspect + 0.35*area + alpha_pen + tiny_pen
            cand=(cost,idx,e)
            if best is None or cand[0:2] < best[0:2]: best=cand
        if best is None:
            raise RuntimeError(f'no compatible fixed Beaver texture slot for {mat!r} (alpha={use_alpha})')
        cost,idx,e=best; free.remove(idx); plan[mat]=idx
        details[mat]={'slot':idx,'source_size':[sw,sh],'slot_size':[e.width,e.height],
                      'format':e.fmt,'frame_size':e.frame_size,'cost':cost,'old_name':e.name}
    return plan,details

def encode_fixed_entry_payload(entry, source_path, use_alpha=False, opacity_percent=None):
    """Encode one source image into an existing Beaver PEG resource exactly.

    Dimensions, GPU format, frame size and tiled payload geometry all come from
    the proven reference entry.  This helper is shared by both the writer and
    the post-export validator so the two paths cannot silently disagree.
    """
    if entry.fmt not in (FMT_DXT1,FMT_DXT3,FMT_DXT5):
        raise RuntimeError(f'entry {entry.index} has unsupported fixed format 0x{entry.fmt:04X}')
    img=Image.open(source_path).convert('RGBA')
    src_size=img.size
    if opacity_percent is not None:
        opacity_percent=int(opacity_percent)
        if not 0 <= opacity_percent <= 100:
            raise ValueError('Opacity percent must be in 0..100')
        if opacity_percent == 100:
            img.putalpha(255)
            use_alpha=False
        else:
            if entry.fmt == FMT_DXT1:
                raise ValueError('Partial opacity requires a DXT5 texture entry')
            alpha=img.getchannel('A').point(lambda a: int(round(a * opacity_percent / 100.0)))
            img.putalpha(alpha)
            use_alpha=True
    if not bool(use_alpha):
        img.putalpha(255)
    if img.size != (entry.width,entry.height):
        img=img.resize((entry.width,entry.height),Image.Resampling.LANCZOS)
    linear,kind=compress_image_for_format(img,entry.fmt)
    tiled=tile_x360(linear,entry.width,entry.height,kind)
    payload=swap16(tiled)
    if len(payload)!=entry.frame_size:
        raise RuntimeError(f'fixed slot {entry.index} payload mismatch: generated 0x{len(payload):X}, Beaver frame 0x{entry.frame_size:X}')
    return payload, {
        'source_size':list(src_size),'slot_size':[entry.width,entry.height],
        'fmt':entry.fmt,'kind':kind,'offset':entry.data_offset,
        'frame_size':entry.frame_size,'use_alpha':bool(use_alpha)
    }

def validate_fixed_replacements(reference_path, output_path, replacements):
    """Byte-validate PEG payload routing after export.

    Every requested replacement must contain the exact payload obtained by
    encoding its source into that reference resource. Every unrequested resource
    must remain byte-for-byte identical to Caboose's PEG. This catches the exact
    mixed-build/one-off slot failure that was observed in game.
    """
    _,_,ref_entries=parse_peg(reference_path)
    _,_,out_entries=parse_peg(output_path)
    if len(ref_entries)!=len(out_entries):
        raise RuntimeError('PEG replacement validation: resource count changed')
    expected={int(k) for k in replacements}
    details={}
    changed=[]
    for i,(r,o) in enumerate(zip(ref_entries,out_entries)):
        meta=('data_offset','frame_size','width','height','fmt')
        if any(getattr(r,k)!=getattr(o,k) for k in meta):
            raise RuntimeError(f'PEG replacement validation: native resource metadata changed at slot {i}')
        if i in expected:
            rec=replacements[i]
            expected_name=str(rec.get('peg_name',r.name))
            if o.name!=expected_name:
                raise RuntimeError(f'PEG replacement validation: slot {i} resource name {o.name!r} != expected {expected_name!r}')
            want,info=encode_fixed_entry_payload(r,rec['source_path'],rec.get('use_alpha',False))
            if o.payload!=want:
                raise RuntimeError(f'PEG replacement validation: slot {i} payload does not match {rec.get("material", rec["source_path"])}')
            details[str(i)]={**info,'material':rec.get('material'),'source':str(rec['source_path'])}
        else:
            if o.name!=r.name:
                raise RuntimeError(f'PEG replacement validation: unexpected resource name changed at slot {i}')
            if o.payload!=r.payload:
                raise RuntimeError(f'PEG replacement validation: unexpected payload changed at slot {i}')
        if o.payload!=r.payload:
            changed.append(i)
    return {
        'expected_slots':sorted(expected),
        'changed_slots':changed,
        'verified_slots':sorted(expected),
        'details':details
    }

def build_fixed_from_reference(reference_path,output_path,replacements):
    """Overwrite texture payloads in-place while preserving Caboose PEG layout.

    Unlike build_from_reference(), this never changes entry dimensions, format,
    frame size, data offsets, directory size, data size, or payload positions.
    Source images are resampled to the chosen donor slot's native dimensions.
    """
    ref,h,entries=parse_peg(reference_path)
    out=bytearray(ref)
    report={}
    for idx,rec in replacements.items():
        idx=int(idx); e=entries[idx]
        if e.fmt not in (FMT_DXT1,FMT_DXT3,FMT_DXT5):
            raise RuntimeError(f'entry {idx} has unsupported fixed format 0x{e.fmt:04X}')
        payload,encinfo=encode_fixed_entry_payload(e,rec['source_path'],rec.get('use_alpha',False))
        src_size=tuple(encinfo['source_size'])
        kind=encinfo['kind']
        out[e.data_offset:e.data_offset+e.frame_size]=payload
        eo=HEADER_SIZE+idx*ENTRY_SIZE
        raw=bytearray(out[eo:eo+ENTRY_SIZE])
        _write_name(raw,str(rec['peg_name']))
        # Preserve every other directory byte exactly, including dimensions,
        # format, flags, frame size and unknown runtime/resource fields.
        out[eo:eo+ENTRY_SIZE]=raw
        report[str(idx)]={'name':str(rec['peg_name']),'source':str(rec['source_path']),
                          'source_size':list(src_size),'slot_size':[e.width,e.height],
                          'fmt':e.fmt,'kind':kind,'offset':e.data_offset,
                          'frame_size':e.frame_size,'use_alpha':bool(rec.get('use_alpha',False))}
    Path(output_path).write_bytes(out)
    return {'output':str(output_path),'mode':'fixed_beaver_layout','count':h.count,
            'directory_size':h.dir_size,'data_size':h.data_size,'replaced':report}

# v0.11 real Beaver material indirection -------------------------------------
def plan_fixed_materials(reference_path, material_paths, material_records, alpha_mapping=None, reserved_materials=(28,)):
    """Choose Beaver MATERIAL records, not PEG slots.

    A draw selector indexes the E3B0 material table.  Each material record has
    its own diffuse texture resource index (Caboose: material N -> texture N+2).
    This planner scores the native diffuse resource dimensions/format but
    returns the material id.  Material 28 is reserved for the reference sky.
    """
    import math
    alpha_mapping=dict(alpha_mapping or {})
    _,_,entries=parse_peg(reference_path)
    reserved=set(int(x) for x in reserved_materials)
    recs=[]
    for r in material_records:
        mid=int(r['material_id']); tid=int(r['texture_slot'])
        if mid in reserved or not (0 <= tid < len(entries)):
            continue
        e=entries[tid]
        if e.fmt not in (FMT_DXT1,FMT_DXT3,FMT_DXT5):
            continue
        q=dict(r); q['entry']=e
        recs.append(q)
    mats=[]
    for mat,path in material_paths.items():
        im=Image.open(path); sw,sh=im.size
        mats.append((str(mat),str(path),sw,sh,bool(alpha_mapping.get(mat,False))))
    if len(mats)>len(recs):
        raise RuntimeError('not enough Beaver material records for imported materials')
    # Hardest first: explicit alpha and extreme aspect ratios.
    mats.sort(key=lambda x:(not x[4], -abs(math.log(max(x[2],1)/max(x[3],1))), -(x[2]*x[3])))
    free={r['material_id']:r for r in recs}
    plan={}; details={}
    for mat,path,sw,sh,use_alpha in mats:
        best=None; sar=max(sw,1)/max(sh,1)
        for mid,r in free.items():
            e=r['entry']; flags=int(r.get('shader_flags',0))
            # Explicit alpha requires an alpha-capable GPU format and prefers
            # Beaver's blend-style material records (11 first, then 27).
            if use_alpha and e.fmt==FMT_DXT1:
                continue
            dar=max(e.width,1)/max(e.height,1)
            aspect=abs(math.log(sar/dar))
            area=abs(math.log(max(sw*sh,1)/max(e.width*e.height,1)))
            if use_alpha:
                shader_pen=0.0 if flags==11 else (2.0 if flags==27 else 100.0)
                fmt_pen=0.0 if e.fmt==FMT_DXT5 else 0.2
            else:
                shader_pen=0.0 if flags==3 else 100.0
                fmt_pen=0.0
            tiny_pen=1.5 if min(e.width,e.height)<64 and min(sw,sh)>=64 else 0.0
            cost=4.0*aspect + 0.35*area + shader_pen + fmt_pen + tiny_pen
            cand=(cost,mid,r)
            if best is None or cand[:2] < best[:2]: best=cand
        if best is None:
            raise RuntimeError(f'no compatible Beaver material record for {mat!r} (alpha={use_alpha})')
        cost,mid,r=best; del free[mid]; e=r['entry']
        plan[mat]=mid
        details[mat]={
            'material_id':mid,'texture_slot':int(r['texture_slot']),
            'source_size':[sw,sh],'slot_size':[e.width,e.height],
            'format':e.fmt,'frame_size':e.frame_size,'cost':cost,
            'old_name':e.name,'shader_flags':int(r.get('shader_flags',0)),
            'record_hash':int(r.get('record_hash',0))
        }
    return plan,details

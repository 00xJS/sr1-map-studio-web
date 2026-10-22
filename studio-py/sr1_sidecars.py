#!/usr/bin/env python3
"""Generate SR1 .bbcity_xbox2, .hmap_xbox2, .pvsv_xbox2 and .cts sidecars.

The offsets and HMAP layout are derived from a known-working Beaver Creek map.
BBCity can use an optional native donor and preserves unknown fields verbatim.
Native time-of-day/weather behavior is not inferred from this limited format.
"""
from __future__ import annotations
from pathlib import Path
import math, struct

BBCITY_MAGIC=0xBBC17EEE
BBCITY_VERSION=33
HMAP_STEP=20.0


def _read_full_bbcity_envref(data):
    """Read the fixed, padded always-loaded name in known 3,060,416-byte donors."""
    if len(data) != 3060416:
        return None
    if struct.unpack_from('>I',data,0)[0] != BBCITY_MAGIC or struct.unpack_from('>I',data,4)[0] != BBCITY_VERSION:
        return None
    name_len=struct.unpack_from('>I',data,0x3E8)[0]
    if name_len != 16:
        return None
    raw=bytes(data[0x3EC:0x3FC])
    if not raw.endswith(b'\0') or b'\0' in raw[:-1]:
        return None
    try:
        name=raw[:-1].decode('ascii')
    except UnicodeDecodeError:
        return None
    return name if name in ('sr_alwayshwyf01','sr_custom000001') else None

SKIP_COLLISION_WORDS=('sky','cloud','decal','water','glass','lightbeam','flare')


def _bounds(verts):
    if not verts: raise RuntimeError('no vertices')
    mn=tuple(min(v[a] for v in verts) for a in range(3))
    mx=tuple(max(v[a] for v in verts) for a in range(3))
    return mn,mx

def _tri_metrics(verts,face):
    a,b,c=(verts[face[i]] for i in range(3))
    ux,uy,uz=b[0]-a[0],b[1]-a[1],b[2]-a[2]
    vx,vy,vz=c[0]-a[0],c[1]-a[1],c[2]-a[2]
    nx=uy*vz-uz*vy; ny=uz*vx-ux*vz; nz=ux*vy-uy*vx
    L=math.sqrt(nx*nx+ny*ny+nz*nz)
    area=L*0.5
    up=(ny/L) if L>1e-12 else 0.0
    cen=((a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3)
    return area,up,cen

def choose_spawn_points(obj,count=16):
    verts=obj['verts']; faces=obj['faces']
    mn,mx=_bounds(verts)
    cx=(mn[0]+mx[0])*0.5; cz=(mn[2]+mx[2])*0.5
    cand=[]
    for fi,f in enumerate(faces):
        mat=str(f[3]).lower()
        if any(w in mat for w in ('sky','cloud','decal','water','glass','flare')):
            continue
        area,up,c=_tri_metrics(verts,f)
        if area<1e-5 or up<0.45:
            continue
        # Large, upward-facing surfaces are safer spawn candidates.
        score=area*(0.5+up)
        cand.append((score,fi,c))
    if not cand:
        y=mn[1]+1.0
        return [(cx,y,cz,0.0)]*count

    # Keep a broad pool, then farthest-point sample in XZ for multiplayer spread.
    cand.sort(reverse=True,key=lambda x:x[0])
    pool=cand[:max(256,count*16)]
    first=min(pool,key=lambda x:(x[2][0]-cx)**2+(x[2][2]-cz)**2)
    chosen=[first]
    while len(chosen)<min(count,len(pool)):
        def mind2(item):
            p=item[2]
            return min((p[0]-q[2][0])**2+(p[2]-q[2][2])**2 for q in chosen)
        nxt=max((x for x in pool if x not in chosen),key=mind2,default=None)
        if nxt is None: break
        chosen.append(nxt)
    pts=[]
    for _,_,c in chosen:
        # A small lift keeps the player from spawning exactly coplanar with floor.
        yaw=math.atan2(cx-c[0],cz-c[2])
        pts.append((c[0],c[1]+0.20,c[2],yaw))
    while len(pts)<count: pts.append(pts[len(pts)%max(1,len(pts))])
    return pts[:count]


def build_bbcity(reference_path,output_path,map_name,bounds,spawn):
    """Patch the established compact layout, or preserve an experimental retail donor.

    Full-size native city files have not had their mutable record offsets
    established from the available donor pair. Never apply compact offsets
    to that unrelated layout: doing so can silently corrupt the native data.
    """
    data=bytearray(Path(reference_path).read_bytes())
    if len(data) not in (960, 3060416):
        raise RuntimeError('Unsupported BBCity donor length %d: expected 960 or 3,060,416 bytes' % len(data))
    if struct.unpack_from('>I',data,0)[0]!=BBCITY_MAGIC or struct.unpack_from('>I',data,4)[0]!=BBCITY_VERSION:
        raise RuntimeError('unexpected BBCity reference header')
    if len(data)==3060416:
        # Dust-compatible experiment: Dust differs from mp_factory only in the
        # inline map-name bytes, while retaining the retail always-load list.
        # The runtime loader reads serialized inline name from 0x400; its
        # length field at 0x3FC is 11 in the examined retail/Dust donors.
        if len(map_name.encode('ascii','strict')) > 10:
            raise RuntimeError('Dust-style retail BBCity map name must fit 10 ASCII bytes plus NUL')
        envref=_read_full_bbcity_envref(data)
        if not envref:
            raise RuntimeError('Full BBCity donor does not contain a readable always-loaded environment reference')
        if struct.unpack_from('>I', data, 0x3FC)[0] != 11:
            raise RuntimeError('Unexpected full BBCity map-name slot; need a verified Dust-compatible donor')
        raw=map_name.encode('ascii')+b'\0'
        data[0x400:0x40B]=raw.ljust(11,b'\0')
        # Crucial: do NOT apply compact BBCity bounds/player-start offsets.
        # Dust's full city world data is retained exactly, including original
        # streaming records. CTS and BBChunk continue to own custom spawn/collision.
        Path(output_path).write_bytes(data)
        return {'output':str(output_path),'donor':str(reference_path),
                'format':'full-retail-dust-style-experimental','size':len(data),
                'map_name_patched':True,'always_loaded_chunk':envref,
                'world_data_preserved':True,'bounds_patched':False,
                'player_start_patched':False,'player_start_from_cts':spawn[:3],
                "warning":"Experimental full retail BBCity donor. Native sky compatibility now follows the donor's always-loaded environment reference; world data is retained from the donor."}
    if len(map_name.encode('ascii','strict'))>11:
        raise RuntimeError('SR1 Beaver-style BBCity map name must be 11 ASCII characters or fewer')
    mn,mx=bounds
    city_bounds=(math.floor(mn[0])-3.0,math.floor(mn[2])-3.0,math.ceil(mx[0])+3.0,math.ceil(mx[2])+3.0)
    struct.pack_into('>4f',data,0x78,*city_bounds)
    raw=map_name.encode('ascii')+b'\0'
    struct.pack_into('>I',data,0xB8,len(raw))
    data[0xBC:0xC8]=b'\0'*12
    data[0xBC:0xBC+len(raw)]=raw
    struct.pack_into('>3f',data,0x1E0,float(spawn[0]),float(spawn[1]),float(spawn[2]))
    Path(output_path).write_bytes(data)
    return {'output':str(output_path),'city_bounds':city_bounds,'player_start':spawn[:3],
            'donor':str(reference_path),'format':'compact-960','size':len(data),
            'unknown_fields_preserved':True,'map_name_patched':True,
            'bounds_patched':True,'player_start_patched':True,
            'note':'Compact BBCity patched; native weather/time-of-day support is not verified.'}


def build_hmap(output_path,obj):
    verts=obj['verts']; faces=obj['faces']; mn,mx=_bounds(verts)
    ox=int(math.floor(mn[0]/HMAP_STEP)*HMAP_STEP)
    oz=int(math.floor(mn[2]/HMAP_STEP)*HMAP_STEP)
    ex=int(math.ceil(mx[0]/HMAP_STEP)*HMAP_STEP)
    ez=int(math.ceil(mx[2]/HMAP_STEP)*HMAP_STEP)
    w=int(round((ex-ox)/HMAP_STEP))+1
    h=int(round((ez-oz)/HMAP_STEP))+1
    if w<=0 or h<=0 or w*h>2_000_000:
        raise RuntimeError(f'unreasonable HMAP dimensions {w}x{h}')
    vals=[0x8000]*(w*h)

    # Conservative height coverage: each non-sky triangle marks every 20-unit
    # sample point touched by its XZ AABB.  Store ceil(maxY), matching the 0x0036
    # (=54) values seen in Beaver Creek whose geometry maxes at ~53.28.
    for f in faces:
        mat=str(f[3]).lower()
        if any(x in mat for x in ('sky','cloud','flare')):
            continue
        ps=[verts[f[i]] for i in range(3)]
        minx=min(p[0] for p in ps); maxx=max(p[0] for p in ps)
        minz=min(p[2] for p in ps); maxz=max(p[2] for p in ps)
        top=int(math.ceil(max(p[1] for p in ps)))
        top=max(0,min(0x7fff,top))
        ix0=max(0,int(math.floor((minx-ox)/HMAP_STEP))-1)
        ix1=min(w-1,int(math.ceil((maxx-ox)/HMAP_STEP))+1)
        iz0=max(0,int(math.floor((minz-oz)/HMAP_STEP))-1)
        iz1=min(h-1,int(math.ceil((maxz-oz)/HMAP_STEP))+1)
        for iz in range(iz0,iz1+1):
            for ix in range(ix0,ix1+1):
                k=iz*w+ix
                if vals[k]==0x8000 or top>vals[k]: vals[k]=top

    # If sparse geometry left the grid entirely empty, use a safe conservative height.
    if all(v==0x8000 for v in vals):
        q=max(0,min(0x7fff,int(math.ceil(mx[1]))))
        vals=[q]*(w*h)

    out=bytearray(20+2*w*h)
    struct.pack_into('>iiIII',out,0,ox,oz,w,h,0)
    struct.pack_into('>'+str(w*h)+'H',out,20,*vals)
    Path(output_path).write_bytes(out)
    return {'output':str(output_path),'origin':[ox,oz],'width':w,'height':h,'active_samples':sum(v!=0x8000 for v in vals)}


def build_pvsv(reference_path,output_path):
    data=Path(reference_path).read_bytes()
    if len(data)!=80:
        raise RuntimeError('expected 80-byte working PVSV reference')
    Path(output_path).write_bytes(data)
    return {'output':str(output_path),'bytes':len(data)}


def build_cts(output_path,map_name,spawn_points):
    lines=[
        '// -------','#Includes','// -------','',
        '// -------','#Groups','// -------','',
        '// -------','#Navpoints','// -------',''
    ]
    for i,(x,y,z,yaw) in enumerate(spawn_points):
        n=f'{map_name}_$r{i:03d}'
        lines += [
            f'$Navpoint:\t"{n}"',
            '$Type:\t\t"ground"',
            f'$Pos:\t\t\t<{x:.6f} {y:.6f} {z:.6f}>',
            f'$Orient:\t\t[{yaw:.6f}]',
            f'+Chunk:\t\t"{map_name}"',''
        ]
    lines += [
        '// -------','#Cameras','// -------','',
        '// -------','#Items','// -------','',
        '// -------','#Triggers','// -------','',
        '// -------','#Vehicles','// -------','',
        '// -------','#Respawns','// -------',''
    ]
    for i,_ in enumerate(spawn_points):
        n=f'{map_name}_$r{i:03d}'
        lines += [
            f'$Respawn:\t\t"{n}"',
            f'$Start nav:\t\t"{n}"',
            '$Box size:\t\t-2.000000 0.000000 -2.000000 2.000000 2.000000 2.000000',''
        ]
    for heading in ['Humans','Spawn NPC Regions','Racing','Strongholds','Special Spawns','Parking','Chunk Streaming Test Cases','Ambients','Negative Regions','DSP Regions','Audio Cluders','Nodes']:
        lines += ['// -------',f'#{heading}','// -------','']
    lines += ['// -------','#End','']
    text='\r\n'.join(lines)
    Path(output_path).write_text(text,encoding='ascii',newline='')
    return {'output':str(output_path),'spawn_count':len(spawn_points)}


def generate_all(reference_dir,output_dir,map_name,obj,bounds=None,spawn_points=None,bbcity_donor=None):
    reference_dir=Path(reference_dir); output_dir=Path(output_dir); output_dir.mkdir(parents=True,exist_ok=True)
    bounds=bounds or _bounds(obj['verts'])
    # An explicitly supplied empty list must NOT fall back to random spawns.
    if spawn_points is None:
        spawn_points=[]
    selected=Path(bbcity_donor) if bbcity_donor else reference_dir/'beavercreek.bbcity_xbox2'
    full_donor=None
    # Accept verified full retail BBCity donors that expose an always-loaded
    # environment reference and the standard 11-byte map-name slot used by
    # Factory, Downtown, Seafood, and Dust-style custom maps.
    if selected.stat().st_size == 3060416:
        raw=selected.read_bytes()
        envref=_read_full_bbcity_envref(raw)
        if (not envref or raw[0x3FC:0x400] != (11).to_bytes(4,'big')):
            full_donor=str(selected)
            selected=reference_dir/'beavercreek.bbcity_xbox2'
    city=build_bbcity(selected,output_dir/f'{map_name}.bbcity_xbox2',map_name,bounds,spawn_points[0] if spawn_points else (0.,0.,0.,0.))
    if full_donor:
        city['requested_full_native_donor']=full_donor
        city['safe_fallback_used']=True
        city['warning']='Full native BBCity donor is incompatible with the current custom-map constraints. Exported a patched 960-byte Beaver Creek BBCity instead; native sky/weather are not enabled.'
    return {
        'bbcity':city,
        'hmap':build_hmap(output_dir/f'{map_name}.hmap_xbox2',obj),
        'pvsv':build_pvsv(reference_dir/'beavercreek.pvsv_xbox2',output_dir/f'{map_name}.pvsv_xbox2'),
        'cts':build_cts(output_dir/f'{map_name}.cts',map_name,spawn_points),
        'spawns':spawn_points,
    }

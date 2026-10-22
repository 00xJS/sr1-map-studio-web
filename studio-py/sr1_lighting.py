"""Native SR1 point lights, recovered from mp_bac_01 and the retail loader.

rec136_260: flags/type +0/+2, RGB +8, intensity count +20, object filter
count +28, direction +36, XYZ +48, basis +60, near/far +104/+108,
owner source +120. No texture/effect dependency. Gameplay validation pending.
"""
import copy
import math
import struct
from pathlib import Path
import sr_reborn_core as c
import sr1_cts

MAX_LIGHTS=64  # Editor budget, not an asserted engine limit.

def new_light(position=(0,3,0)):
    return dict(name='Point light',enabled=True,position=list(map(float,position)),
                color=[1.,.85,.65],intensity=1.,inner_range=1.,range=8.)

def validate(lights):
    if not isinstance(lights,list) or len(lights)>MAX_LIGHTS:
        raise ValueError(f'Use at most {MAX_LIGHTS} point lights per map.')
    result=copy.deepcopy(lights)
    for light in result:
        if not isinstance(light,dict):raise ValueError('Invalid light entry.')
        if not isinstance(light.get('enabled',True),bool):raise ValueError('Light enabled must be true or false.')
        name=light.get('name','Point light')
        if not isinstance(name,str) or '\0' in name or len(name)>80:raise ValueError('Light names must be at most 80 characters without NUL.')
        for key,size in (('position',3),('color',3)):
            values=light.get(key,[])
            if not isinstance(values,(list,tuple)) or len(values)!=size:raise ValueError('Light '+key+' needs three values.')
            if not all(isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x) for x in values):raise ValueError('Light '+key+' must be finite numbers.')
        if any(abs(x)>100000 for x in light['position']):raise ValueError('Light position is outside the supported editing range.')
        if any(x<0 or x>1 for x in light['color']):raise ValueError('Light RGB values must be between 0 and 1.')
        for key,lo,hi in (('intensity',0,10),('inner_range',0,1000),('range',.01,1000)):
            value=light.get(key)
            if not isinstance(value,(int,float)) or isinstance(value,bool) or not math.isfinite(value) or not lo<=value<=hi:
                raise ValueError(f'Light {key} must be between {lo} and {hi}.')
        if light['inner_range']>=light['range']:raise ValueError('Full-bright range must be smaller than outer range.')
    return result

def _record(light,position,scale):
    # Free, unparented BB Omni32 record, with runtime pointers/handles cleared.
    b=bytearray(136)
    struct.pack_into('>HH',b,0,0x0390,0)
    struct.pack_into('>3f',b,8,*light['color'])
    c.Wr32(b,20,1)  # one brightness multiplier follows all names
    struct.pack_into('>3f',b,36,0.,-1.,0.)
    struct.pack_into('>3f',b,48,*position)
    struct.pack_into('>9f',b,60,1.,0.,0.,0.,1.,0.,0.,0.,1.)
    c.WrF(b,104,light['inner_range']*scale)
    c.WrF(b,108,light['range']*scale)
    c.WrF(b,112,20.)  # preserved retail free-point field; meaning not exposed
    c.Wr32(b,120,0xffffffff)  # not attached to a destructible source record
    return b

def apply_to_map(path,lights,world_scale,origin,mirror_x):
    lights=validate(lights or [])
    report=dict(requested=len(lights),exported=0,placements=[],gameplay_verified=False)
    # No authored lights means exactly the previous exporter behavior.
    if not lights:return report
    scale=float(world_scale)
    if not math.isfinite(scale) or not .01<=scale<=10:raise ValueError('Invalid light world scale.')
    path=Path(path);original=path.read_bytes();ch=c.read_chunk(original)
    if c.U32(ch.header,884)!=0:
        raise ValueError('This lighting exporter requires a reference with no existing lights; use the bundled Beaver Creek reference.')
    active=[x for x in lights if x.get('enabled',True)]
    if not active:return report
    records=bytearray();names=bytearray();positions=[]
    for i,light in enumerate(active):
        pos=sr1_cts.convert_xyz(light['position'],scale,mirror_x,origin,'scene')
        records+=_record(light,pos,scale)
        names+=('Studio_Point_%03d'%i).encode('ascii')+b'\0'
        positions.append(pos)
        report['placements'].append(dict(name=light['name'],position=list(pos),color=light['color'],
            intensity=light['intensity'],inner_range=light['inner_range']*scale,range=light['range']*scale))
    records+=names;c.PadTo(records,64)
    for light in active:c.PutF(records,light['intensity'])
    c.PadTo(records,64) # start of zero-length per-light object-filter lists
    ch.get('rec136_260').data=records
    c.Wr32(ch.header,884,len(active))
    # One leaf, indexed by the same u16 light selectors used by native culling.
    # The loader takes the final node as root and fixes indices/pointers itself.
    lo=[min(p[a]-l['range']*scale for p,l in zip(positions,active)) for a in range(3)]
    hi=[max(p[a]+l['range']*scale for p,l in zip(positions,active)) for a in range(3)]
    tree=bytearray(108)
    c.Wr32(tree,0,1)
    struct.pack_into('>3fI3f',tree,64,*lo,len(active),*hi)
    c.Wr32(tree,100,0xffffffff);c.Wr32(tree,104,0xffffffff)
    for i in range(len(active)):tree+=struct.pack('>H',i)
    ch.get('tree192').data=tree
    # No lights are attached to movable props, so the separate moving-light list is empty.
    c.Wr32(ch.header,888,0);ch.get('u16_196').data=bytearray()
    output=c.write_chunk(ch);check=c.read_chunk(output)
    if c.U32(check.header,884)!=len(active) or check.get('rec136_260').data!=records:
        raise RuntimeError('Native light records did not round-trip.')
    before=c.read_chunk(original)
    for s in before.secs:
        if s.name not in ('rec136_260','tree192','u16_196') and s.data!=check.get(s.name).data:
            raise RuntimeError('Lighting unexpectedly changed '+s.name)
    tmp=path.with_name(path.name+'.lighting.tmp')
    try:tmp.write_bytes(output);tmp.replace(path)
    finally:
        if tmp.exists():tmp.unlink()
    report['exported']=len(active)
    return report

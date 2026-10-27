"""Stock movable/explosive profiles on Studio custom-mesh native objects.

Builds on the existing mesh/hull exporter, then applies mp_bac_01 source and
instance templates. No global table changes or runtime scripts. Gameplay tests
are still required for movement, explosion response and multiplayer replication.
"""
import copy,hashlib,json,struct,zlib
from pathlib import Path
import sr_reborn_core as c
import peg_xbox2_beaver as peg
import sr1_prop_catalog as catalog
from sr1_native_limits import MAX_NATIVE_TRIANGLES

ASSETS=Path(__file__).resolve().parent/'native_props'
PRESETS={
    'movable':dict(label='Movable crate',profile='Crate Small',health=50,weight=20,
        description='Loose physics prop. Stock crate profile: 50 health, weight 20; no blast. Fitted box collision; first gameplay test pending.'),
    'explosive':dict(label='Explosive propane',profile='Propanesmall',health=75,weight=10,
        description='Loose explosive prop. Stock propane profile: 75 health, weight 10; blast radius 5 with fire and force. Fitted box collision; first gameplay test pending.'),
}
PRESETS.update(catalog.extra_presets())
for _key in ('movable', 'explosive'):
    PRESETS[_key]['description'] = catalog.summary(PRESETS[_key]['profile'])

def is_prop(item):return bool(item.get('native_prop_behavior'))

def validate(items):
    for item in items:
        key=item.get('native_prop_behavior')
        if key is None:continue
        if key not in PRESETS:raise ValueError('Unknown native prop behavior: '+str(key))
        if item.get('native_prefab')!='sr1_native_custom_mesh_glass_experiment':
            raise ValueError('Movable/explosive behavior requires a custom-mesh native prop.')
        if item.get('native_breakable_kind')!='wood' or item.get('native_opacity',100)!=100:
            raise ValueError('Movable/explosive props require the solid scenery render mode and 100% opacity.')

def configure(old,behavior,model,texture):
    if behavior not in PRESETS:raise ValueError('Choose an available native behavior profile.')
    if not model['verts'] or not 1<=len(model['faces'])<=MAX_NATIVE_TRIANGLES:
        raise ValueError(f'Native props support 1–{MAX_NATIVE_TRIANGLES:,} triangles per object.')
    if len({f[3] or 'default' for f in model['faces']})!=1:
        raise ValueError('Native props currently support one material per object.')
    if not texture or not Path(texture).is_file():raise ValueError('Assign an image texture to the object first.')
    item=copy.deepcopy(old)
    item.update(native_prefab='sr1_native_custom_mesh_glass_experiment',
        native_prop_behavior=behavior,native_breakable_kind='wood',native_opacity=100,
        native_use_alpha=False,native_mesh_obj=str(Path(old['path']).resolve()),
        glass_custom_texture=str(Path(texture).resolve()),glass_style='blue',
        physics_intent=PRESETS[behavior]['label'],triangles=len(model['faces']))
    return item

def _effects(data):
    n=c.U32(data,0);rows=[]
    for i in range(n):
        e=bytearray(data[4+20*i:24+20*i]);at=4+c.U32(e,12);size=c.U32(e,8)
        if at<4+20*n or at+size>len(data):raise ValueError('Malformed effect bank.')
        rows.append((c.U32(e,0),bytes(data[at:at+size])))
    return rows

def _build_effects(rows):
    if not rows:return bytearray(struct.pack('>I',0))
    out=bytearray(4+20*len(rows));c.Wr32(out,0,len(rows));c.PadTo(out,64)
    for i,(key,payload) in enumerate(rows):
        c.PadTo(out,64)
        struct.pack_into('>5I',out,4+20*i,key,0,len(payload),len(out)-4,0)
        out+=payload
    c.PadTo(out,64);return out

def apply_behaviors(chunk_path,peg_path,items,placements,map_name):
    validate(items)
    if len(items)!=len(placements):raise ValueError('Native placement count mismatch.')
    props=[(item,p) for item,p in zip(items,placements) if is_prop(item)]
    report=dict(created=0,placements=[],gameplay_verified=False)
    if not props:return report
    if len(items)!=len(placements):raise ValueError('Native placement count mismatch.')
    import sr1_native_glass as ng
    chunk_path,peg_path=Path(chunk_path),Path(peg_path)
    original=chunk_path.read_bytes();ch=c.read_chunk(original);geometry=c.chunk_geometry(ch)
    templates=json.loads((ASSETS/'templates.json').read_text())
    recs=ch.get('static_records').data;insts=ch.get('instances').data
    count=c.U32(ch.header,868);names=bytes(recs[80*count:]).split(b'\0')[:count]
    damage=ch.get('rec_blob308').data;offsets={}
    for item,p in props:
        key=item['native_prop_behavior'];preset=PRESETS[key];template=preset.get('template') or templates[key]
        at=p['source']*80;ia=p['instance']*112;old=bytes(recs[at:at+80]);oldi=bytes(insts[ia:ia+112])
        record=bytearray.fromhex(template['source']);instance=bytearray.fromhex(template['instance'])
        if len(record)!=80 or len(instance)!=112 or c.U32(record,32)!=0x10020000 or any(c.U32(record,o)!=0xffffffff for o in (48,68,72)):
            raise ValueError('Unsupported prop source template.')
        record[0:12]=old[0:12];record[16:28]=old[16:28]
        name=f'{map_name}_native_prop_{p["source"]:03d}'
        c.Wr32(record,40,zlib.crc32(name.lower().encode(),0xffffffff)^0xffffffff)
        c.Wr16(record,56,p['collision_shape']);c.Wr32(record,60,p['instance'])
        profile=preset['profile']
        if profile not in offsets:
            offsets[profile]=len(damage)-4;damage+=profile.encode('ascii')+b'\0'
        c.Wr32(record,64,offsets[profile]);names[p['source']]=name.encode('ascii')
        instance[4:52]=oldi[4:52];c.Wr32(instance,104,p['mesh'])
        recs[at:at+80]=record;insts[ia:ia+112]=instance
        report['placements'].append(dict(source=p['source'],instance=p['instance'],mesh=p['mesh'],
            collision_shape=p['collision_shape'],behavior=key,profile=profile,name=name,
            stock_properties=catalog.ROWS[profile]['properties'],
            stock_explosion=catalog.ROWS[profile]['explosion'],
            settings_mode='stock profile reference; no numeric overrides'))
    c.Wr32(damage,0,len(damage)-4)
    ch.get('static_records').data=bytearray(recs[:80*count])+b''.join(n+b'\0' for n in names)
    rows=_effects(ch.get('skip388').data)
    # Keep glass resources if any actual glass/legacy wooden-shatter item remains.
    if len(props)==len(items):rows=[r for r in rows if r[0]!=0x6f041f87]
    additions=[];texture_report=[];pending_textures=[]
    if any(item['native_prop_behavior']=='explosive' for item,p in props):
        payload=(ASSETS/'propane_effect.bin').read_bytes()
        if len(payload)!=86284 or payload[:4]!=b'WB17':raise ValueError('Propane effect asset is invalid.')
        if any(key==0x1884514f and data!=payload for key,data in rows):raise ValueError('Conflicting propane effect.')
        if not any(key==0x1884514f for key,data in rows):rows.append((0x1884514f,payload))
        data=json.loads((ASSETS/'textures.json').read_text())
        if data['unresolved']:raise ValueError('Propane texture dependencies are incomplete.')
        for t in data['textures']:
            tex=(ASSETS/t['file']).read_bytes()
            if hashlib.sha256(tex).hexdigest()!=t['sha256']:raise ValueError('Propane texture asset changed: '+t['name'])
            pending_textures.append((t,tex))
    extra_effects,extra_textures=catalog.resources([item['native_prop_behavior'] for item,p in props])
    for key,payload in extra_effects:
        if any(k==key and data!=payload for k,data in rows):raise ValueError('Conflicting native effect: '+hex(key))
        if not any(k==key for k,data in rows):rows.append((key,payload))
    pending_textures.extend(extra_textures)
    raw,_,existing=peg.parse_peg(peg_path)
    if c.chunk_strings(ch)!=[x.name for x in existing]:raise ValueError('Map texture table is out of sync.')
    by_name={}
    for ex in existing:
        end=min([x.data_offset for x in existing if x.data_offset>ex.data_offset]+[len(raw)])
        by_name[ex.name.lower()]=(ex.raw,raw[ex.data_offset:end])
    for t,tex in pending_textures:
        entry=bytearray.fromhex(t['entry']);name=t['name'];key=name.lower()
        if key in by_name:
            old_entry,old_tex=by_name[key]
            # Name padding is zeroed by the glass importer; it is not texture metadata.
            if old_tex!=tex or old_entry[4:23]!=entry[4:23] or old_entry[52:56]!=entry[52:56]:
                raise ValueError('Conflicting effect texture: '+name)
        else:
            c.add_strings(ch,[name]);additions.append((entry,tex));by_name[key]=(entry,tex)
        if name not in texture_report:texture_report.append(name)
    ch.get('skip388').data=_build_effects(rows);c.Wr32(ch.header,204,len(ch.get('skip388').data))
    c.set_geometry(ch,geometry)  # Added texture names can shift 4096-byte vertex alignment.
    output=c.write_chunk(ch);check=c.read_chunk(output)
    if c.write_geometry(c.chunk_geometry(check),0)!=c.write_geometry(geometry,0):
        raise RuntimeError('Prop resources changed render geometry or terrain collision.')
    for section in ('block556','tree236','tree192'):
        if check.get(section).data!=c.read_chunk(original).get(section).data:
            raise RuntimeError('Prop behavior changed existing geometry/physics: '+section)
    for p in report['placements']:
        record=check.get('static_records').data[p['source']*80:p['source']*80+80];db=check.get('rec_blob308').data;start=4+c.U32(record,64)
        if bytes(db[start:db.index(0,start)]).decode()!=p['profile']:raise RuntimeError('Prop profile did not serialize.')
    staged_chunk=chunk_path.with_name(chunk_path.name+'.props.tmp');staged_peg=peg_path.with_name(peg_path.name+'.props.tmp')
    peg_before=peg_path.read_bytes()
    try:
        staged_chunk.write_bytes(output);staged_peg.write_bytes(ng._append_peg(peg_path,additions) if additions else peg_before)
        _,_,entries=peg.parse_peg(staged_peg)
        if c.chunk_strings(check)!=[x.name for x in entries]:raise RuntimeError('Prop texture links did not serialize.')
        staged_peg.replace(peg_path)
        try:staged_chunk.replace(chunk_path)
        except Exception:peg_path.write_bytes(peg_before);raise
    finally:
        for p in (staged_chunk,staged_peg):
            if p.exists():p.unlink()
    report.update(created=len(props),effect_keys=[hex(key) for key,_ in rows],explosion_textures=texture_report)
    return report

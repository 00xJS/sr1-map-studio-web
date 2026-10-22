"""Non-destructive multi-OBJ scene layer; exported as one OBJ for the existing SR1 backend."""
import math
from pathlib import Path

def transform(p, item):
    pivot=item.get('pivot',(0.,0.,0.))
    x,y,z=((float(v)-float(pivot[i]))*float(item.get('scale',1.0)) for i,v in enumerate(p))
    rx,ry,rz=(math.radians(float(item.get('rotation',[0,0,0])[i])) for i in range(3))
    # Local roll (Z), then local pitch (X), then world heading (Y).
    # Yaw must be the outermost rotation: turning a car must not change
    # which way its own roll/pitch controls tilt it.
    x,y=x*math.cos(rz)-y*math.sin(rz),x*math.sin(rz)+y*math.cos(rz)
    y,z=y*math.cos(rx)-z*math.sin(rx),y*math.sin(rx)+z*math.cos(rx)
    x,z=x*math.cos(ry)+z*math.sin(ry),-x*math.sin(ry)+z*math.cos(ry)
    return (x+item['position'][0],y+item['position'][1],z+item['position'][2])


def validate_pivot(item):
    pivot=item.get('pivot',(0.,0.,0.))
    if not isinstance(pivot,(list,tuple)) or len(pivot)!=3 or not all(math.isfinite(float(v)) for v in pivot):
        raise ValueError('Object pivot must contain three finite XYZ coordinates.')
    return tuple(float(v) for v in pivot)


def set_pivot(item, pivot):
    """Change the local origin while preserving every vertex's world position."""
    validate_pivot(item)
    new_pivot=validate_pivot({'pivot':pivot})
    position=transform(new_pivot,item)
    if not all(math.isfinite(v) for v in position):
        raise ValueError('Cannot set a pivot on an object with an invalid transform.')
    item['pivot']=list(new_pivot)
    item['position']=list(position)


def mesh_pivot(model, bottom=False):
    """Center of used mesh bounds, ignoring loose/unreferenced vertices."""
    used={i for face in model['faces'] for i in face[:3]}
    if not used:
        raise ValueError('The selected object has no mesh faces.')
    vertices=[model['verts'][i] for i in used]
    if not all(len(p)==3 and all(math.isfinite(float(v)) for v in p) for p in vertices):
        raise ValueError('The selected mesh contains invalid coordinates.')
    low=[min(p[a] for p in vertices) for a in range(3)]
    high=[max(p[a] for p in vertices) for a in range(3)]
    return [(low[a]+high[a])/2 if not (bottom and a==1) else low[a] for a in range(3)]

def scene_mesh(items, parser):
    verts=[]; uv=[]; norms=[]; faces=[]; textures={}; alphas={}; spans=[]
    for i,item in enumerate(items):
        validate_pivot(item)
        obj=parser(item['path']); start=len(verts)
        v=[transform(p,item) for p in obj['verts']]
        verts.extend(v); uv.extend(obj['uv0']); norms.extend([None]*len(v))
        namespace='obj%03d_'%i
        local_mats=set()
        for f in obj['faces']:
            mat=namespace+(f[3] or 'default')
            local_mats.add(mat)
            faces.append((f[0]+start,f[1]+start,f[2]+start,mat))
        for m in local_mats:
            original=m[len(namespace):]
            textures[m]=item.get('textures',{}).get(original,'')
            alphas[m]=bool(item.get('alpha',{}).get(original,False))
        spans.append((start,len(verts)))
    return {'verts':verts,'uv0':uv,'src_normals':norms,'faces':faces,'spans':spans,'textures':textures,'alpha':alphas}

def write_scene_obj(path,mesh):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('w',encoding='utf-8') as f:
        f.write('# SR1 Map Studio composed scene; positions baked from object transforms\n')
        for p in mesh['verts']: f.write('v %.9g %.9g %.9g\n'%tuple(p))
        for uv in mesh['uv0']:
            u,v=(0.,0.) if uv is None else uv[:2]
            f.write('vt %.9g %.9g\n'%(u,v))
        current=None
        for a,b,c,m in mesh['faces']:
            if current!=m: f.write('usemtl %s\n'%m); current=m
            f.write('f %d/%d %d/%d %d/%d\n'%(a+1,a+1,b+1,b+1,c+1,c+1))
    return str(path)

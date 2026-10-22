"""Import glTF 2.0 binary (.glb) into the existing OBJ/MTL SR1 pipeline.

Uses Blender's maintained glTF importer. Embedded material images are written
as normal PNGs alongside the cached OBJ so the native SR1 PEG exporter can read
real texture bytes without requiring original loose files.
"""
from pathlib import Path
import hashlib
import subprocess
from sr1_fbx_import import locate_blender

BLENDER_SCRIPT = r'''import bpy
import sys
import re
from pathlib import Path
source, target = sys.argv[sys.argv.index('--')+1:]
source, target = Path(source), Path(target)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise RuntimeError('GLB contains no mesh objects')
image_dir = target.parent / (target.stem + '_textures')
image_dir.mkdir(parents=True, exist_ok=True)
used_images = {}
material_images = {}

def get_base_color_image(mat):
    if not mat or not mat.use_nodes:
        return None
    nodes = mat.node_tree.nodes
    # glTF uses Principled BSDF Base Color. Other image nodes can be normal,
    # roughness, ORM etc. Do not accidentally import a normal map as diffuse.
    for node in nodes:
        if node.type != 'BSDF_PRINCIPLED':
            continue
        socket = node.inputs.get('Base Color')
        if not socket:
            continue
        queue = [link.from_node for link in socket.links]
        seen = set()
        while queue:
            n = queue.pop(0)
            if n.as_pointer() in seen:
                continue
            seen.add(n.as_pointer())
            if n.type == 'TEX_IMAGE' and n.image:
                return n.image
            for inp in n.inputs:
                queue.extend(link.from_node for link in inp.links)
    # Fallback for nonstandard graphs only if they have one image texture.
    images = [n.image for n in nodes if n.type == 'TEX_IMAGE' and n.image]
    return images[0] if len(images) == 1 else None

def export_image(img):
    pointer = img.as_pointer()
    if pointer in used_images:
        return used_images[pointer]
    key = len(used_images)
    safe = re.sub(r'[^A-Za-z0-9_.-]+', '_', img.name).strip('._')[:48] or 'texture'
    path = image_dir / ('%03d_%s.png' % (key, safe))
    # save_render works for embedded/packed and generated Blender images,
    # avoiding save()'s dependency on the original GLB image filepath.
    try:
        img.save_render(filepath=str(path), scene=bpy.context.scene)
    except Exception:
        img.filepath_raw = str(path)
        img.file_format = 'PNG'
        img.save()
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError('Could not extract embedded texture: ' + img.name)
    used_images[pointer] = path
    return path

materials = {}
for obj in meshes:
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or mat.name in materials:
            continue
        img = get_base_color_image(mat)
        if img is None:
            materials[mat.name] = None
            continue
        texpath = export_image(img)
        materials[mat.name] = texpath
        # Make the exported OBJ material unambiguously reference its diffuse map.
        # The original GLB PBR nodes may be too complex for Blender's OBJ writer.
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        nodes.clear()
        texnode = nodes.new('ShaderNodeTexImage')
        texnode.image = img
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
        output = nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(texnode.outputs['Color'], bsdf.inputs['Base Color'])
        mat.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
        img.filepath = str(texpath)
        img.filepath_raw = str(texpath)

for obj in bpy.context.selected_objects: obj.select_set(False)
for obj in meshes: obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if hasattr(bpy.ops.wm, 'obj_export'):
    bpy.ops.wm.obj_export(filepath=str(target), export_selected_objects=True,
        export_materials=True, export_uv=True, export_normals=True,
        path_mode='RELATIVE', apply_modifiers=True,
        forward_axis='NEGATIVE_Z', up_axis='Y')
else:
    bpy.ops.export_scene.obj(filepath=str(target), use_selection=True,
        use_materials=True, use_uvs=True, use_normals=True,
        path_mode='RELATIVE', use_mesh_modifiers=True,
        axis_forward='-Z', axis_up='Y')

# Some Blender OBJ exporters omit map_Kd even when the source material has a
# valid glTF base-color image. Explicitly repair the generated MTL sections.
mtl = target.with_suffix('.mtl')
if not mtl.is_file():
    raise RuntimeError('Blender produced no MTL: ' + str(mtl))
lines = mtl.read_text(encoding='utf-8', errors='replace').splitlines()
fixed = []
current = None
mapped_count = 0

def normalize_name(name):
    return re.sub(r'[^A-Za-z0-9_.-]+', '_', name).strip('._')

name_lookup = {normalize_name(name): path for name, path in materials.items() if path}
name_lookup.update({name: path for name, path in materials.items() if path})

def flush_section():
    global mapped_count
    if not current:
        return
    name = current[0].split(None, 1)[1].strip()
    path = name_lookup.get(name)
    if path:
        section = [line for line in current if not line.lower().startswith('map_kd ')]
        relative = path.relative_to(target.parent).as_posix()
        section.append('map_Kd ' + relative)
        mapped_count += 1
        fixed.extend(section)
    else:
        fixed.extend(current)

for line in lines:
    if line.lower().startswith('newmtl '):
        flush_section()
        current = [line]
    elif current is None:
        fixed.append(line)
    else:
        current.append(line)
flush_section()
mtl.write_text('\n'.join(fixed) + '\n', encoding='utf-8')
print('SR1_GLB_EXPORT_OK', len(meshes), 'meshes',
      len(used_images), 'images', mapped_count, 'MTL diffuse maps')
'''



def convert_glb(source, blender_path=None, cache_root=None):
    source = Path(source).resolve()
    if not source.is_file() or source.suffix.lower() != '.glb':
        raise ValueError('Choose an existing .glb file')
    cache_root = Path(cache_root) if cache_root else Path(__file__).resolve().parent / 'glb_cache_v066'
    cache_root.mkdir(parents=True, exist_ok=True)
    token = hashlib.sha256(str(source).encode('utf8')).hexdigest()[:12]
    folder = cache_root / (source.stem + '_' + token)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / (source.stem + '.obj')
    script = folder / 'sr1_blender_glb_convert.py'
    script.write_text(BLENDER_SCRIPT, encoding='utf8')
    mtl = target.with_suffix('.mtl')
    if (not target.is_file() or not mtl.is_file()
            or target.stat().st_mtime < source.stat().st_mtime
            or mtl.stat().st_mtime < source.stat().st_mtime):
        cmd = [locate_blender(blender_path), '--background', '--factory-startup',
               '--python', str(script), '--', str(source), str(target)]
        try:
            completed = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError('GLB conversion exceeded five minutes') from exc
        if completed.returncode != 0 or not target.is_file():
            raise RuntimeError('GLB conversion failed. Blender output:\n'
                               + (completed.stdout + '\n' + completed.stderr)[-6000:])
    # Validate the OBJ/MTL *actually used by the retail SR1 exporter*, not
    # Blender's success message. Cache in a new versioned folder to avoid stale
    # pre-fix OBJ geometry and texture paths.
    text = mtl.read_text(encoding='utf-8', errors='replace')
    links=[]
    for line in text.splitlines():
        if line.lower().startswith('map_kd '):
            raw=line.split(None,1)[1].strip().strip('\"')
            texture=Path(raw)
            if not texture.is_absolute(): texture=(mtl.parent/texture).resolve()
            links.append((raw,texture))
    if not links:
        raise RuntimeError('GLB imported but no diffuse texture links were exported. '
                           'Check that the GLB has Base Color image textures (not only vertex colors). '
                           'Cache: ' + str(folder))
    missing=[raw for raw,path in links if not path.is_file()]
    if missing:
        raise RuntimeError('GLB MTL references missing texture files: '+repr(missing[:12]))
    low=[float('inf')]*3; high=[float('-inf')]*3
    vertices=faces=0
    with target.open('r',encoding='utf-8',errors='replace') as stream:
        for line in stream:
            if line.startswith('v '):
                try:
                    xyz=list(map(float,line.split()[1:4]))
                    if len(xyz)!=3: continue
                except ValueError: continue
                vertices+=1
                for axis in range(3):
                    low[axis]=min(low[axis],xyz[axis]);high[axis]=max(high[axis],xyz[axis])
            elif line.startswith('f '):faces+=1
    if not vertices or not faces:
        raise RuntimeError('Converted GLB has no renderable OBJ geometry')
    dimensions=[high[i]-low[i] for i in range(3)]
    center=[(high[i]+low[i])*0.5 for i in range(3)]
    report=['GLB -> OBJ diagnostic (original SR1 map exporter unchanged)',
            'Source: '+str(source), 'OBJ: '+str(target),
            'Vertices: '+str(vertices),'Faces (possibly polygons): '+str(faces),
            'Bounds min XYZ: '+repr(low),'Bounds max XYZ: '+repr(high),
            'Bounds center XYZ: '+repr(center), 'Dimensions XYZ: '+repr(dimensions),
            'NOTE: These are pre-Map-Studio scale/mirror/centering coordinates.',
            'NOTE: Player CTS position must be over terrain in FINAL exported coordinates.',
            'Texture links: '+str(len(links))]
    report.extend('  '+str(name)+' -> '+str(path) for name,path in links)
    (folder/'GLB_IMPORT_DIAGNOSTICS.txt').write_text('\n'.join(report)+'\n',encoding='utf-8')
    return str(target)

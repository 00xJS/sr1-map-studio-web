"""Editor-side checks and material synchronization for native breakables."""
import copy
import math
from pathlib import Path
from PIL import Image
import sr1_native_glass as native
import sr1_native_props as props
import sr1_scene
from sr1_native_limits import MAX_NATIVE_OBJECTS, MAX_NATIVE_TRIANGLES, MIN_NATIVE_AXIS, MAX_NATIVE_AXIS


def sync_materials(items, textures, alpha, surfaces):
    """Persist visible assignments on the object before scene indices change."""
    for i, item in enumerate(items):
        prefix = f'obj{i:03d}_'
        for values, key in ((textures, 'textures'), (alpha, 'alpha'), (surfaces, 'surface_ids')):
            local = item.setdefault(key, {})
            for name, value in values.items():
                if name.startswith(prefix):
                    local[name[len(prefix):]] = value
        if native.is_glass(item):
            assigned = [(name, value) for name, value in textures.items() if name.startswith(prefix)]
            bundled = {str(native.ASSETS / (style + '.png')) for style in ('blue', 'tinted')}
            if len(assigned) == 1 and (native.is_custom(item) or assigned[0][1] not in bundled or item.get('glass_custom_texture')):
                item['glass_custom_texture'] = assigned[0][1]


def return_static(item):
    result = copy.deepcopy(item)
    result['name'] = result.get('native_original_name', result.get('native_prop_original_name', result['name']))
    for key in list(result):
        if key.startswith(('native_', 'glass_')):
            result.pop(key)
    result['physics_intent'] = 'Static'
    return result


def check_scene(items, world_scale, parser):
    """Read-only preflight. Slot capacity remains checked against the built map."""
    report = {'count': 0, 'errors': [], 'warnings': [], 'objects': []}
    seen = {}
    for index, original in enumerate(items):
        if not native.is_glass(original):
            continue
        report['count'] += 1
        item = copy.deepcopy(original)
        name = f'{index:02d} {item.get("name", "Unnamed")}'
        try:
            native.validate_placements([item], world_scale)
            props.validate([item])
            texture = item.get('glass_custom_texture')
            if native.is_custom(item):
                model = parser(item['native_mesh_obj'])
                faces = model['faces']; vertices = model['verts']
                if not vertices or not 1 <= len(faces) <= MAX_NATIVE_TRIANGLES:
                    raise ValueError(f'Needs 1–{MAX_NATIVE_TRIANGLES:,} triangles.')
                if len({f[3] or 'default' for f in faces}) != 1:
                    raise ValueError('Requires exactly one material.')
                if not all(len(p) == 3 and all(math.isfinite(float(v)) for v in p) for p in vertices):
                    raise ValueError('Model contains invalid vertex coordinates.')
                dims = [(max(p[a] for p in vertices) - min(p[a] for p in vertices)) * float(item['scale']) * float(world_scale) for a in range(3)]
                if any(not MIN_NATIVE_AXIS <= d <= MAX_NATIVE_AXIS for d in dims):
                    raise ValueError(f'Each box axis must be {MIN_NATIVE_AXIS}–{MAX_NATIVE_AXIS:g} game units; current size: ' + ' × '.join(f'{d:.3g}' for d in dims))
                if not props.is_prop(item) and item.get('native_breakable_kind') == 'wood':
                    report['warnings'].append(name + ': wood appearance still uses glass damage and shards.')
                if item.get('native_opacity',100) == 0:
                    report['warnings'].append(name + ': 0% opacity makes the object invisible while its collision remains.')
            else:
                dims = [native.WIDTH, native.HEIGHT]
                texture = texture or str(native.ASSETS / (item.get('glass_style','tinted') + '.png'))
            if not texture or not Path(texture).is_file():
                raise ValueError('Assign an existing texture image.')
            with Image.open(texture) as image:
                image.verify()
            signature = (str(Path(item['path']).resolve()).lower(), tuple(sr1_scene.transform((0.,0.,0.),item)), tuple(item['rotation']), item['scale'])
            if signature in seen:
                report['warnings'].append(name + ': overlaps ' + seen[signature] + ' exactly; move the duplicate apart before testing.')
            seen[signature] = name
            report['objects'].append({'name': name, 'size': dims, 'behavior': item.get('native_prop_behavior','glass shatter')})
        except Exception as exc:
            report['errors'].append(name + ': ' + str(exc))
    if report['count'] > MAX_NATIVE_OBJECTS:
        report['errors'].append(f'{report["count"]} native objects exceed the {MAX_NATIVE_OBJECTS}-object budget.')
    return report


def format_report(report):
    lines = [f'{report["count"]} / {MAX_NATIVE_OBJECTS} native objects',
             f'{len(report["errors"])} errors · {len(report["warnings"])} warnings']
    for heading, key in [('Fix before export', 'errors'), ('Check in your map', 'warnings')]:
        if report[key]:
            lines += ['', heading] + report[key]
    if report['objects']:
        lines += ['', 'Object sizes (game units)']
        lines += [entry['name'] + ': ' + ' × '.join(f'{x:.3g}' for x in entry['size']) + ' · ' + entry['behavior'] for entry in report['objects']]
    lines += ['', 'Custom objects use fitted box collision, including across openings. Actual free slots are checked during export. Gameplay still needs an in-game check.']
    return '\n'.join(lines)

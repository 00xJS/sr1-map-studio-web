"""Browser bridge for the unmodified SR1 Map Studio Python modules.

Runs inside Pyodide. The web editor keeps projects in the same scene-item
schema as the desktop app; this module repeats what sr1_halo_map_studio.py's
MainWindow did around each call (preflight checks, combined OBJ, locked base
origin, collision/face options) without any Qt code.

Paths: /studio holds these modules plus the user's own data pack folders
(reference_beavercreek, native_glass, ...), so upstream HERE-relative paths
resolve unchanged. /work holds the project's files.
"""
from __future__ import annotations

import copy
import json
import math
import re
import shutil
import traceback
from collections import Counter
from pathlib import Path

import sr1_obj_core as v13
import sr1_scene
import sr1_cts
import sr1_export
import sr1_lighting
import sr1_native_glass as native
import sr1_native_props as props
import sr1_breakable_tools as breakable_tools
import sr1_physical_materials as physical
import sr1_sidecars
from sr1_native_limits import MAX_NATIVE_OBJECTS, MAX_NATIVE_TRIANGLES, MIN_NATIVE_AXIS, MAX_NATIVE_AXIS
from vehicle_catalog_v041 import VEHICLE_CATALOG
import fast_dxt

# Same output as the original compressor, about 20x faster (see fast_dxt.py).
fast_dxt.install()
from weapon_catalog_v042 import WEAPON_CATALOG

STUDIO = Path('/studio')
WORK = Path('/work')
# The desktop list also offered 'Pimp exit (experimental)'; the game has no
# "pimp exit" trigger action (retail CTS files only use "pimp enter"), so it
# is not offered.
PIMP_EXIT = 'Pimp exit (experimental)'
MARKER_TYPES = ['Shared spawn', 'Red team spawn', 'Blue team spawn', 'Weapon pickup', 'Vehicle spawn',
                'Chains drop-off', 'Pimp entrance', 'Sphere trigger (custom)',
                'Ground navpoint', 'Floating navpoint', 'Special spawn', 'Human NPC spawn']

_cache = {}


def _parse(path):
    """Same cache contract as MainWindow._cached_obj (path + size + mtime)."""
    key = str(Path(path).resolve())
    stat = Path(key).stat()
    sig = (stat.st_mtime_ns, stat.st_size)
    hit = _cache.get(key)
    if hit is None or hit[0] != sig:
        hit = (sig, v13.parse_obj_attrs(key))
        _cache[key] = hit
    return hit[1]


def _ok(value):
    return json.dumps({'ok': True, 'value': value}, default=str)


def _fail(exc):
    return json.dumps({'ok': False, 'error': str(exc), 'trace': traceback.format_exc()})


def catalogs():
    return _ok({
        'marker_types': MARKER_TYPES,
        'spawn_kinds': sorted(sr1_cts.SPAWN_KINDS),
        'trigger_kinds': sorted(sr1_cts.TRIGGER_KINDS),
        'special_spawn_types': list(sr1_cts.SPECIAL_SPAWN_TYPES),
        'human_char_types': list(sr1_cts.HUMAN_CHAR_TYPES),
        'weapons': [list(x) for x in WEAPON_CATALOG],
        'vehicles': [list(x) for x in VEHICLE_CATALOG],
        'surface_types': list(physical.NAMES),
        'surface_suffixes': list(physical.SUFFIXES),
        'glass_styles': native.STYLES,
        'glass_kind': native.KIND,
        'custom_kind': native.CUSTOM_KIND,
        'glass_size': [native.WIDTH, native.HEIGHT],
        'prop_presets': props.PRESETS,
        'limits': {'max_native_objects': MAX_NATIVE_OBJECTS, 'max_native_triangles': MAX_NATIVE_TRIANGLES,
                   'min_native_axis': MIN_NATIVE_AXIS, 'max_native_axis': MAX_NATIVE_AXIS,
                   'max_lights': sr1_lighting.MAX_LIGHTS},
        'new_light': sr1_lighting.new_light(),
        'exporter_version': sr1_export.EXPORTER_VERSION,
    })


def _dims(model, scale, world_scale):
    return [(max(p[a] for p in model['verts']) - min(p[a] for p in model['verts'])) * float(scale) * float(world_scale)
            for a in range(3)]


def _single_material(model):
    mats = {f[3] or 'default' for f in model['faces']}
    return next(iter(mats)) if len(mats) == 1 else ''


def scene_op(op, payload_json):
    try:
        p = json.loads(payload_json)
        return _ok(_scene_op(op, p))
    except Exception as exc:
        return _fail(exc)


def _scene_op(op, p):
    ws = float(p.get('world_scale', 0.5))
    if op == 'create_glass':
        label = p['style_label']
        item = native.create_item(p['position'], ws, native.STYLES[label])
        item.update(name='Breakable glass (' + label + ')', triangles=12)
        if not p.get('raw_position'):
            item['position'][1] += native.HEIGHT / (2 * ws)
        others = p.get('others', [])
        native.validate_placements(others + [copy.deepcopy(item)], ws)
        return item
    if op == 'restore_glass':
        return native.restore_item(p['item'])
    if op == 'native_prop':
        old, behavior = p['item'], p['behavior']
        if native.is_glass(old) and not native.is_custom(old):
            raise ValueError('Fixed glass panes keep their glass behavior. Import a separate model for a movable or explosive prop.')
        model = _parse(old['path'])
        mat = _single_material(model)
        texture = old.get('textures', {}).get(mat) or old.get('glass_custom_texture')
        item = props.configure(old, behavior, model, texture)
        dims = _dims(model, item['scale'], ws)
        if any(not math.isfinite(d) or d < MIN_NATIVE_AXIS or d > MAX_NATIVE_AXIS for d in dims):
            raise ValueError(f'Native prop size must be {MIN_NATIVE_AXIS}–{MAX_NATIVE_AXIS:g} game units per axis. Resize the model first.')
        native.validate_placements(p.get('others', []) + [item], ws)
        item['native_prop_original_name'] = old.get('native_original_name', old.get('native_prop_original_name', old.get('name', 'Object')))
        item['native_original_name'] = item['native_prop_original_name']
        item['name'] = props.PRESETS[behavior]['label'] + ': ' + item['native_prop_original_name']
        return item
    if op == 'convert_breakable':
        old, mode = copy.deepcopy(p['item']), p['render_mode']
        if native.is_custom(old):
            old.pop('native_prop_behavior', None)
            old['native_breakable_kind'] = mode
            old['native_original_name'] = old.get('native_original_name', old.get('native_prop_original_name', old['name']))
            old['name'] = 'Breakable ' + mode + ': ' + old['native_original_name']
            if mode == 'wood':
                old['native_opacity'] = 100
                old['native_use_alpha'] = False
            return native.restore_item(old)
        if native.is_glass(old):
            raise ValueError('This object already uses a native prefab.')
        model = _parse(old['path'])
        if not model['verts'] or not 1 <= len(model['faces']) <= MAX_NATIVE_TRIANGLES:
            raise ValueError(f'This experiment supports 1–{MAX_NATIVE_TRIANGLES:,} triangles.')
        mat = _single_material(model)
        if not mat:
            raise ValueError('This first experiment only supports one material per object.')
        texture = old.get('textures', {}).get(mat)
        if not texture or not Path(texture).is_file():
            texture = str(native.ASSETS / 'crate_placeholder.png')
            if not Path(texture).is_file():
                raise ValueError('No texture assigned to model. Assign an image in the materials panel first.')
        dims = _dims(model, old.get('scale', 1), ws)
        if max(dims) > MAX_NATIVE_AXIS or min(dims) < MIN_NATIVE_AXIS:
            raise ValueError(f'Experimental box must fit between {MIN_NATIVE_AXIS} and {MAX_NATIVE_AXIS:g} game units per axis. Bounds=' + str([round(d, 3) for d in dims]))
        item = copy.deepcopy(old)
        item['native_prefab'] = native.CUSTOM_KIND
        item['native_breakable_kind'] = mode
        item['native_mesh_obj'] = str(Path(old['path']).resolve())
        item['glass_custom_texture'] = str(Path(texture).resolve())
        item['native_opacity'] = 100
        item['native_use_alpha'] = False
        item['glass_style'] = 'blue'
        item['native_original_name'] = str(old.get('name', 'object'))
        item['name'] = 'Breakable ' + mode + ': ' + item['native_original_name']
        item['triangles'] = len(model['faces'])
        native.restore_item(item)
        native.validate_placements(p.get('others', []) + [item], ws)
        return item
    if op == 'return_static':
        item = breakable_tools.return_static(p['item'])
        item['physics_intent'] = 'Static'
        return item
    if op == 'check_breakables':
        report = breakable_tools.check_scene(p['items'], ws, _parse)
        return {'report': report, 'text': breakable_tools.format_report(report)}
    if op == 'validate_lights':
        return sr1_lighting.validate(p['lights'])
    if op == 'validate_items':
        props.validate(p['items'])
        for item in p['items']:
            sr1_scene.validate_pivot(item)
        return True
    if op == 'marker_preview':
        space = 'game' if p.get('marker_game_coords') else 'scene'
        origin = (0., 0., 0.) if space == 'game' else _base_origin(p['items'])
        coords = sr1_cts.convert_xyz(p['marker']['position'], ws, bool(p.get('mirror_x', True)), origin, space)
        yaw = sr1_cts.convert_yaw(p['marker'].get('yaw', 0), bool(p.get('mirror_x', True)), space)
        return {'xyz': list(coords), 'orient': yaw, 'origin': list(origin)}
    if op == 'audit':
        return _audit(p['items'])
    if op == 'validate_markers':
        counts = Counter(m['type'] for m in p['markers'])
        notes = [f'{k}: {v}' for k, v in sorted(counts.items())]
        if sum(counts.get(t, 0) for t in ('Shared spawn', 'Red team spawn', 'Blue team spawn')) < 4:
            notes.append('Recommendation from mapconv: use at least four respawn points.')
        if bool(counts['Red team spawn']) != bool(counts['Blue team spawn']):
            notes.append('Warning: both team colors should have spawn points for balanced team modes.')
        if counts.get(PIMP_EXIT, 0):
            notes.append('Pimp exit markers will block export: the game has no "pimp exit" trigger action. Remove them or change their type.')
        if counts.get('Pimp entrance', 0):
            notes.append('Pimp entrances are written only to the Protect Tha Pimp CTS (with the team spawns).')
        notes.append('Full map export writes the records into its CTS; in-game activation still requires testing.')
        return notes
    raise ValueError('Unknown scene operation: ' + op)


def _audit(items):
    lines = ['SR1 Map Studio scene audit', 'Native glass and converted movable/explosive props export as native objects. Legacy intent tags alone remain metadata only.', '']
    total = 0
    for idx, it in enumerate(items):
        obj = _parse(it['path'])
        faces = len(obj['faces'])
        total += faces
        mats = len(set(f[3] or 'default' for f in obj['faces']))
        if obj['verts']:
            v = [sr1_scene.transform(q, it) for q in obj['verts']]
            lo = [min(q[k] for q in v) for k in range(3)]
            hi = [max(q[k] for q in v) for k in range(3)]
            dim = ' x '.join('%.3f' % (hi[k] - lo[k]) for k in range(3))
        else:
            dim = 'EMPTY'
        lines.append('%02d  %s | %s | %d triangles | %d materials | bounds %s' % (idx, it['name'], it.get('physics_intent', 'Static'), faces, mats, dim))
    lines.extend(['', 'Total: %d objects, %d triangles' % (len(items), total)])
    return lines


def _base_origin(items):
    """Locked to the first/base map, exactly as MainWindow.export_map."""
    if not items:
        raise ValueError('No base map is loaded')
    base = items[0]
    verts = [sr1_scene.transform(v, base) for v in _parse(base['path'])['verts']]
    return sr1_cts.compute_normalization_bounds(verts)


def _collision_excluded_global_indices(items, mesh):
    counters = {}
    result = []
    for fi, face in enumerate(mesh['faces']):
        match = re.match(r'^obj(\d{3})_', str(face[3]))
        if not match:
            continue
        i = int(match.group(1))
        local = counters.get(i, 0)
        counters[i] = local + 1
        if i < len(items) and local in items[i].get('collision_excluded_faces', []):
            result.append(fi)
    return result


def _check_ptp(markers):
    counts = Counter(m.get('type') for m in markers)
    missing = [what for what, ok in (('a Red team spawn', counts['Red team spawn']), ('a Blue team spawn', counts['Blue team spawn']),
                                     ('a Pimp entrance', counts['Pimp entrance'])) if not ok]
    if missing:
        raise ValueError('Protect Tha Pimp needs ' + ', '.join(missing) + '.')


def _write_ptp_cts(out, job, base, markers, world_scale, mirror_x, origin, space, log):
    """<map>_ptp.cts, as retail mp_ptp_* and installed PTP packs: team respawns
    (+MPTeam1/+MPTeam2) and "pimp enter" triggers only, no items."""
    skeleton = job / 'ptp_skeleton.cts'
    sr1_sidecars.build_cts(skeleton, base, [])
    text, report = sr1_cts.build_cts(skeleton.read_text(encoding='ascii'), markers, base, world_scale, mirror_x,
                                     origin, space, replace_respawns=True)
    spawns = sum(1 for m in markers if m.get('type') in sr1_cts.SPAWN_KINDS)
    sr1_cts.validate_spawn_links(text, spawns)
    (out / (base + '_ptp.cts')).write_text(text, encoding='utf-8', newline='\r\n')
    log(f'Protect Tha Pimp CTS: {spawns} team respawns, {report["counts"].get("Pimp entrance", 0)} pimp entrance trigger(s)')


def export_project(spec_json, log):
    """spec: scene_items, markers, lights and settings. Returns output files."""
    try:
        return _ok(_export(json.loads(spec_json), log))
    except Exception as exc:
        return _fail(exc)


def _export(s, log):
    items = s['scene_items']
    ws = float(s.get('world_scale', 0.5))
    for it in items:
        if native.is_glass(it):
            native.restore_item(it)
    if not items or native.is_glass(items[0]):
        raise ValueError('Load a base map first.')
    preflight = breakable_tools.check_scene(items, ws, _parse)
    if preflight['errors']:
        raise ValueError('\n'.join(preflight['errors']))
    for warning in preflight['warnings']:
        log('Breakable check: ' + warning)
    props.validate(items)
    lights = sr1_lighting.validate(s.get('lights', []))
    glass_items = [copy.deepcopy(it) for it in items if native.is_glass(it)]
    native.validate_placements(glass_items, ws)
    mesh = native.export_scene_mesh(items, _parse)
    if not mesh['faces']:
        raise ValueError('Load ordinary map geometry before exporting glass.')
    textures = dict(mesh['textures'])
    missing = [m for m in textures if not textures.get(m) or not Path(textures[m]).is_file()]
    if missing:
        raise ValueError('Assign a texture to every material first:\n' + '\n'.join(missing[:20]))
    markers = [dict(m) for m in s.get('markers', [])]
    if any(m.get('type') == PIMP_EXIT for m in markers):
        raise ValueError('The game has no "pimp exit" trigger action (only "pimp enter"). Remove the Pimp exit markers or change their type.')
    if not any(m.get('type') in sr1_cts.SPAWN_KINDS for m in markers):
        raise ValueError('Place at least one spawn in the Spawns tab. Random default spawns are disabled.')
    # Pimp entrances only matter in Protect Tha Pimp, which loads its own CTS.
    ptp_markers = [m for m in markers if m.get('type') in ('Red team spawn', 'Blue team spawn', 'Pimp entrance')]
    main_markers = [m for m in markers if m.get('type') != 'Pimp entrance']
    if len(main_markers) != len(markers):
        log('Pimp entrance markers go only into the Protect Tha Pimp CTS.')
    if s.get('ptp'):
        _check_ptp(ptp_markers)
    base = sr1_export.sanitize_map_name(s.get('base_name', 'halo_map'))
    job = WORK / 'jobs' / str(s.get('job', 'export'))
    if job.exists():
        shutil.rmtree(job)
    out = job / 'out'
    composed = job / (base + '_scene_combined.obj')
    job.mkdir(parents=True)
    sr1_scene.write_scene_obj(composed, mesh)
    fixed_origin = _base_origin(items)
    log('Base-map locked normalization origin: ' + str(tuple(round(x, 4) for x in fixed_origin)))
    nonstatic = [it['name'] + ' (' + it.get('physics_intent', 'Static') + ')' for it in items
                 if not native.is_glass(it) and it.get('physics_intent', 'Static') != 'Static']
    if nonstatic:
        log('PHYSICS WARNING: intent tags do NOT create native movable or destructible objects. Static collision export continues: ' + ', '.join(nonstatic))
    surface = {}
    for j, it in enumerate(items):
        for m, v in it.get('surface_ids', {}).items():
            surface['obj%03d_%s' % (j, m)] = int(v)
    space = 'game' if s.get('marker_game_coords') else 'scene'

    def opt(key):
        value = s.get(key)
        return value if value else None

    result = sr1_export.export_map(
        str(composed), {m: textures[m] for m in mesh['textures']}, str(out), base, str(STUDIO / 'reference_beavercreek'),
        log=log, alpha_mapping={m: bool(mesh['alpha'].get(m, False)) for m in mesh['textures']},
        surface_mapping={m: surface.get(m, 0) for m in mesh['textures']},
        world_scale=ws, sky_texture=opt('sky_texture'), minimap_texture=opt('minimap_texture'),
        mirror_x=bool(s.get('mirror_x', True)), flip_obj_v=bool(s.get('flip_obj_v', True)),
        double_sided=bool(s.get('double_sided', False)), sky_scale=float(s.get('sky_scale', 0.0)),
        breakable_materials=[], breakables_donor=None, lights=lights, native_glass=glass_items,
        fixed_origin=fixed_origin,
        render_only_scene_indices=[i for i, it in enumerate(items) if it.get('collision_disabled', False) and not native.is_glass(it) and not props.is_prop(it)],
        render_only_face_indices=_collision_excluded_global_indices(items, mesh),
        double_sided_scene_indices=[i for i, it in enumerate(items) if it.get('double_sided', False) and not native.is_glass(it)],
        markers=main_markers, marker_coordinate_space=space, cts_template=opt('cts_template'),
        bbcity_donor=opt('bbcity_donor'), native_sky_chunk=opt('native_sky_chunk'), native_sky_peg=opt('native_sky_peg'))
    if s.get('ptp'):
        origin = (0., 0., 0.) if space == 'game' else fixed_origin
        _write_ptp_cts(out, job, base, ptp_markers, ws, bool(s.get('mirror_x', True)), origin, space, log)
    files = sorted(str(p) for p in out.rglob('*') if p.is_file())
    summary = {
        'render_triangles': result['bbchunk']['render_triangles'],
        'render_meshes': result['bbchunk']['render_meshes_used'],
        'material_batches': result['bbchunk']['material_batches'],
        'collision_triangles': result['bbchunk']['collision_triangles'],
        'source_triangles': result['bbchunk']['source_triangles'],
        'native_objects': result.get('native_glass', {}).get('native_breakables_created', 0),
        'native_props': result.get('native_props', {}).get('created', 0),
        'lights': result.get('lighting', {}).get('exported', 0),
    }
    return {'map_name': base, 'out_dir': str(out), 'files': files, 'summary': summary}


def extract_bbchunk(chunk_path, peg_path, out_obj):
    """Desktop 'Export BBChunk + materials to OBJ' tool."""
    try:
        import sr1_bbchunk_to_obj
        out = Path(out_obj)
        if out.parent.exists():
            shutil.rmtree(out.parent)
        out.parent.mkdir(parents=True)
        report = sr1_bbchunk_to_obj.export_bbchunk_obj(chunk_path, str(out), peg_path=peg_path or None)
        files = sorted(str(p) for p in out.parent.rglob('*') if p.is_file())
        return _ok({'report': report, 'files': files})
    except Exception as exc:
        return _fail(exc)


def texture_preview(path, max_size=1024):
    """PNG bytes for formats a browser cannot show (TGA, DDS, TIFF)."""
    from PIL import Image
    import io
    with Image.open(path) as im:
        im.load()
        im = im.convert('RGBA')
        im.thumbnail((max_size, max_size))
        buf = io.BytesIO()
        im.save(buf, 'PNG')
        return buf.getvalue()


def run_self_test():
    import runpy
    import contextlib
    import io
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            runpy.run_path(str(STUDIO / 'self_test.py'), run_name='__main__')
        return _ok(buf.getvalue())
    except BaseException as exc:
        return json.dumps({'ok': False, 'error': str(exc), 'trace': buf.getvalue() + '\n' + traceback.format_exc()})

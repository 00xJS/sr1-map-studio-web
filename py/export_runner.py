"""Runs web_api.export_project with progress, and skips work whose inputs did not change.

- Progress: progress(json) gets {"stage", "label", "done", "total"} as the
  export moves through its stages (the exporter's own "n/5" steps, texture by
  texture while textures are encoded, then the map extras).
- The geometry step (sr_reborn_bridge.build_bbchunk_multibatch) is remembered
  for the last scene it built: when only markers, lights or settings it does
  not read have changed, its output file, report and log are reused.
- A whole export is remembered too: pressing Play again with nothing changed
  hands back the files the last export wrote.
- Old job folders are removed so repeated exports do not pile up in memory.

Everything here keys on the exact inputs (file contents or path + size +
mtime, and every argument), so the files written are the same as without it;
tests/export_cache_check.py compares them.
"""
from __future__ import annotations

import hashlib
import json
import os
import pickle
import re
import shutil
import time
from pathlib import Path

import export_cache
import sr_reborn_bridge as bridge
import sr1_export
import web_api

STAGES = [
    ('check', 'Checking the scene'),
    ('geometry', 'Building geometry and collision'),
    ('textures', 'Encoding textures'),
    ('sidecars', 'Writing the city, height map and spawns'),
    ('verify', 'Checking the map files'),
    ('package', 'Finishing the map files'),
    ('extras', 'Adding map extras'),
]
_STEP = re.compile(r'^([1-5])/5 ')

_state = {'progress': None, 'stage': None, 'textures': 0, 'texture_total': 0}
_geometry = {}       # key -> (output bytes, pickled (report, obj), log lines, report path text)
_last_export = {}    # 'key', 'value'
_original = {}


def _emit(stage, done=None, total=None):
    fn = _state['progress']
    if fn is None:
        return
    label = dict(STAGES)[stage]
    try:
        fn(json.dumps({'stage': stage, 'index': [s for s, _ in STAGES].index(stage), 'count': len(STAGES),
                       'label': label, 'done': done, 'total': total}))
    except Exception:
        pass


def _stage(stage):
    _state['stage'] = stage
    _emit(stage)


def _hash_file(path, h):
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)


def _stat(path):
    st = os.stat(path)
    return (str(path), st.st_size, st.st_mtime_ns)


# ---------------- geometry step ----------------

def build_bbchunk_multibatch(obj_path, reference_path, output_path, texture_mapping, map_name, **kw):
    log = kw.pop('log', None)
    report_path = kw.pop('report_path', None)
    h = hashlib.sha256(b'geometry-v1')
    _hash_file(obj_path, h)
    # Texture names are made from a hash of each texture file, so those count too.
    textures = sorted((m, _stat(p) if p and os.path.isfile(p) else p) for m, p in texture_mapping.items())
    h.update(repr((_stat(reference_path), textures, map_name, sorted(kw.items()))).encode())
    key = h.hexdigest()
    hit = _geometry.get(key)
    if hit is None:
        lines = []

        def say(x):
            lines.append(str(x))
            if log:
                log(x)
        report, obj = _original['build'](obj_path, reference_path, output_path, texture_mapping, map_name,
                                         log=say, report_path=report_path, **kw)
        _geometry.clear()
        _geometry[key] = {'chunk': Path(output_path).read_bytes(), 'result': pickle.dumps((report, obj)), 'log': lines,
                          'paths': (str(reference_path), str(output_path), str(obj_path))}
    else:
        export_cache.stats['geometry_reused'] += 1
        report, obj = pickle.loads(hit['result'])
        # The report names this job's files; nothing else in it depends on the job.
        report.update(reference=str(reference_path), output=str(output_path), obj=str(obj_path))
        Path(output_path).write_bytes(hit['chunk'])
        if report_path:
            Path(report_path).write_text(json.dumps(report, indent=2, default=str), encoding='utf-8')
        if log:
            for line in hit['log']:
                log(line)
    # Each picture is encoded once, however many materials share it (shared_textures.py).
    _state['texture_total'] = len({str(t.get('name')) for t in report.get('texture_items', [])})
    return report, obj


def encoded_payload(im, fmt):
    out = _original['payload'](im, fmt)
    if _state['stage'] == 'textures':
        _state['textures'] += 1
        _emit('textures', _state['textures'], _state['texture_total'] or None)
    return out


def export_map(*a, **kw):
    out = _original['export_map'](*a, **kw)
    _stage('extras')
    return out


# ---------------- whole export ----------------

def _export_key(spec):
    h = hashlib.sha256(b'export-v1')
    h.update(json.dumps({k: v for k, v in spec.items() if k != 'job'}, sort_keys=True).encode())

    def files(v):
        if isinstance(v, str):
            if os.path.isabs(v) and os.path.isfile(v):
                yield v
        elif isinstance(v, dict):
            for x in v.values():
                yield from files(x)
        elif isinstance(v, list):
            for x in v:
                yield from files(x)
    for path in sorted(set(files(spec))):
        h.update(repr(_stat(path)).encode())
    studio = Path(web_api.STUDIO)
    if studio.is_dir():
        for root, dirs, names in os.walk(studio):
            dirs.sort()
            for n in sorted(names):
                h.update(repr(_stat(os.path.join(root, n))).encode())
    return h.hexdigest()


def _drop_old_jobs(keep):
    jobs = Path(web_api.WORK) / 'jobs'
    if not jobs.is_dir():
        return
    for d in jobs.iterdir():
        if d.is_dir() and d.name != keep:
            shutil.rmtree(d, ignore_errors=True)


def export_project(spec_json, log, progress=None):
    """web_api.export_project, with progress events and reuse of unchanged work."""
    _state.update(progress=progress, stage=None, textures=0, texture_total=0)
    export_cache.reset(memory=False)
    t0 = time.perf_counter()
    try:
        spec = json.loads(spec_json)
        key = _export_key(spec)
    except Exception:
        spec, key = None, None
    last = _last_export.get('value')
    if key and key == _last_export.get('key') and last and all(os.path.isfile(f) for f in last['files']):
        log('Nothing changed since the last build: reusing its map files.')
        _emit('extras')
        return web_api._ok(last)

    def step_log(text):
        m = _STEP.match(str(text))
        if m:
            _stage(STAGES[int(m.group(1))][0])
        log(text)
    _stage('check')
    try:
        raw = web_api.export_project(spec_json, step_log)
    finally:
        _state['progress'] = None
        export_cache.release()
    result = json.loads(raw)
    if result.get('ok'):
        job = str(spec.get('job', 'export')) if spec else None
        if job:
            _drop_old_jobs(job)
        _last_export.update(key=key, value=result['value'])
        s = export_cache.stats
        reused = s['memory_hits'] + s['disk_hits'] + s['payload_hits']
        log(f'Build time {time.perf_counter() - t0:.1f}s; textures: {s["compressed"]} encoded, {reused} reused.')
        try:
            export_cache.prune()
        except Exception:
            pass
    else:
        _last_export.clear()
    return raw


def uninstall():
    """Put every replaced function back (for tests that compare with and without)."""
    if _original:
        bridge.build_bbchunk_multibatch = _original['build']
        bridge._encoded_payload = _original['payload']
        sr1_export.export_map = _original['export_map']
        _original.clear()
    _geometry.clear()
    _last_export.clear()
    export_cache.uninstall()


def install(cache_dir=None):
    export_cache.install(cache_dir)
    if _original:
        return
    _original.update(build=bridge.build_bbchunk_multibatch, payload=bridge._encoded_payload, export_map=sr1_export.export_map)
    bridge.build_bbchunk_multibatch = build_bbchunk_multibatch
    bridge._encoded_payload = encoded_payload
    sr1_export.export_map = export_map

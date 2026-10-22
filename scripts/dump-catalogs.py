"""Regenerate src/lib/catalogs.json from the vendored Python (run after updating studio-py/)."""
import json, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
import web_api
value = json.loads(web_api.catalogs())['value']
(root / 'src' / 'lib' / 'catalogs.json').write_text(json.dumps(value, indent=1, ensure_ascii=False), encoding='utf-8')
print('wrote catalogs.json')

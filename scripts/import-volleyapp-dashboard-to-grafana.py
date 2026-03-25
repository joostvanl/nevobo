#!/usr/bin/env python3
"""Import grafana/volleyapp-dashboard.json into Grafana (run on Pi or anywhere with Grafana reachable)."""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

def main():
    grafana_url = os.environ.get('GRAFANA_URL', 'http://127.0.0.1:3000').rstrip('/')
    user = os.environ.get('GRAFANA_USER', 'admin')
    password = os.environ.get('GRAFANA_PASSWORD', 'admin')
    path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/volleyapp-dashboard.json'

    auth = base64.b64encode(f'{user}:{password}'.encode()).decode()

    def api(method, url, data=None):
        req = urllib.request.Request(
            f'{grafana_url}{url}',
            data=data.encode() if data else None,
            method=method,
        )
        req.add_header('Authorization', f'Basic {auth}')
        if data:
            req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())

    ds = api('GET', '/api/datasources/name/Prometheus')
    uid = ds.get('uid') or 'prometheus'

    with open(path, encoding='utf-8') as f:
        dashboard = json.loads(f.read().replace('${datasource}', uid))

    dashboard['templating'] = {'list': []}

    payload = json.dumps({'dashboard': dashboard, 'overwrite': True})
    out = api('POST', '/api/dashboards/db', payload)
    print(json.dumps(out, indent=2))

if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as e:
        print(e.read().decode(), file=sys.stderr)
        sys.exit(1)

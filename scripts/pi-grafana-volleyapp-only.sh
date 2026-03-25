#!/usr/bin/env bash
set -euo pipefail
GF_USER="${GF_USER:-admin}"
GF_PASS="${GF_PASS:-admin}"
AUTH=$(printf '%s:%s' "$GF_USER" "$GF_PASS")
exists=$(curl -sS -u "$AUTH" "http://127.0.0.1:3000/api/datasources/name/Prometheus" -o /dev/null -w '%{http_code}' || true)
if [ "$exists" = "200" ]; then
  echo "Grafana: Prometheus datasource already exists"
else
  curl -sS -u "$AUTH" -X POST "http://127.0.0.1:3000/api/datasources" \
    -H "Content-Type: application/json" \
    -d '{"name":"Prometheus","type":"prometheus","url":"http://prometheus:9090","access":"proxy","isDefault":true}'
  echo ""
  echo "Grafana: Prometheus datasource created"
fi
DS_UID=$(curl -sS -u "$AUTH" "http://127.0.0.1:3000/api/datasources/name/Prometheus" | python3 -c "import sys,json; print(json.load(sys.stdin).get('uid','prometheus'))")
DASH_JSON=$(cat <<DASHEND
{
  "dashboard": {
    "uid": "volleyapp-blackbox",
    "title": "Volleyapp — Blackbox",
    "tags": ["volleyapp", "blackbox"],
    "timezone": "browser",
    "schemaVersion": 39,
    "version": 1,
    "refresh": "30s",
    "panels": [
      {
        "id": 1,
        "type": "stat",
        "title": "Probe OK (1 = up)",
        "gridPos": {"h": 5, "w": 8, "x": 0, "y": 0},
        "datasource": {"type": "prometheus", "uid": "DSUID_PLACEHOLDER"},
        "targets": [
          {
            "expr": "probe_success{instance=\"https://volleyapp.joostvanleeuwaarden.com\"}",
            "legendFormat": "up",
            "refId": "A"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "mappings": [
              {"type": "value", "options": {"0": {"text": "DOWN", "color": "red"}, "1": {"text": "UP", "color": "green"}}}
            ],
            "thresholds": {"mode": "absolute", "steps": [{"color": "red", "value": null}, {"color": "green", "value": 1}]}
          }
        },
        "options": {"reduceOptions": {"calcs": ["lastNotNull"]}, "colorMode": "background", "graphMode": "none"}
      },
      {
        "id": 2,
        "type": "timeseries",
        "title": "Probe duration (s)",
        "gridPos": {"h": 8, "w": 16, "x": 8, "y": 0},
        "datasource": {"type": "prometheus", "uid": "DSUID_PLACEHOLDER"},
        "targets": [
          {
            "expr": "probe_duration_seconds{instance=\"https://volleyapp.joostvanleeuwaarden.com\"}",
            "legendFormat": "duration",
            "refId": "A"
          }
        ],
        "fieldConfig": {"defaults": {"unit": "s"}},
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}}
      },
      {
        "id": 3,
        "type": "timeseries",
        "title": "HTTP status",
        "gridPos": {"h": 8, "w": 24, "x": 0, "y": 8},
        "datasource": {"type": "prometheus", "uid": "DSUID_PLACEHOLDER"},
        "targets": [
          {
            "expr": "probe_http_status_code{instance=\"https://volleyapp.joostvanleeuwaarden.com\"}",
            "legendFormat": "code",
            "refId": "A"
          }
        ],
        "fieldConfig": {"defaults": {"decimals": 0}},
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}}
      }
    ]
  },
  "overwrite": true
}
DASHEND
)
DASH_JSON=${DASH_JSON//DSUID_PLACEHOLDER/$DS_UID}
resp=$(curl -sS -u "$AUTH" -X POST "http://127.0.0.1:3000/api/dashboards/db" \
  -H "Content-Type: application/json" \
  -d "$DASH_JSON")
echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Grafana dashboard:', d.get('url', d.get('status', d)))"
echo Done.

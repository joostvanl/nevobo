#!/usr/bin/env bash
set -euo pipefail
STACK=/home/joostvl/monitoring-stack
cp "$STACK/prometheus/prometheus.yml" "$STACK/prometheus/prometheus.yml.bak.pi-setup"
cp /tmp/prometheus.pi.yml "$STACK/prometheus/prometheus.yml"
docker network connect volleyapp_default prometheus 2>/dev/null || true
curl -sS -X POST http://127.0.0.1:9090/-/reload
echo "Prometheus config updated and reloaded."
sleep 3
sed -i 's/\r$//' /tmp/import-volleyapp-dashboard-to-grafana.py
python3 /tmp/import-volleyapp-dashboard-to-grafana.py /tmp/volleyapp-dashboard.json
echo "Done. Check Grafana for dashboard 'Volleyapp — applicatie-metrics'."

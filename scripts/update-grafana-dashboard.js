#!/usr/bin/env node
/**
 * Importeert grafana/volleyapp-dashboard.json in Grafana op de Pi (via SSH).
 *
 * Vereist: SSH-key naar de Pi, zelfde .env als deploy-to-pi.js:
 *   PI_HOST, PI_USER (default pi), PI_PATH (default ~/Team)
 * Optioneel voor niet-default Grafana-login op de Pi:
 *   GRAFANA_USER, GRAFANA_PASSWORD
 *
 * Usage:
 *   node scripts/update-grafana-dashboard.js
 *   node scripts/update-grafana-dashboard.js --dry-run
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

const envVars = {};
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
    if (m) envVars[m[1].trim()] = m[2].trim();
  });
}

const piHost = envVars.PI_HOST || '';
const piUser = envVars.PI_USER || 'pi';
const piPath = envVars.PI_PATH || '~/Team';
const gfUser = envVars.GRAFANA_USER || 'admin';
const gfPass = envVars.GRAFANA_PASSWORD || envVars.GF_PASS || 'admin';

if (!piHost) {
  console.error('ERROR: PI_HOST not set in .env');
  process.exit(1);
}

const remote = `${piUser}@${piHost}`;

const escapedPass = gfPass.replace(/'/g, "'\\''");
const remoteScript = `
set -e
cd ${piPath}
echo "==> $(pwd)  $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
git fetch origin main
git reset --hard origin/main
export GRAFANA_URL=\${GRAFANA_URL:-http://127.0.0.1:3000}
export GRAFANA_USER='${gfUser.replace(/'/g, "'\\''")}'
export GRAFANA_PASSWORD='${escapedPass}'
python3 scripts/import-volleyapp-dashboard-to-grafana.py grafana/volleyapp-dashboard.json
echo "==> Grafana dashboard geïmporteerd (Volleyapp — applicatie-metrics)."
`.trim();

console.log('=== Grafana dashboard bijwerken op Pi ===');
if (dryRun) {
  console.log('DRY RUN — would SSH to', remote);
  console.log('--- remote script ---\n' + remoteScript + '\n---');
  process.exit(0);
}

try {
  execFileSync('ssh', ['-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', remote, remoteScript], {
    stdio: 'inherit',
    timeout: 120000,
  });
} catch (e) {
  console.error('Grafana update failed. Check SSH, PI_* in .env, and Python3 + Grafana on the Pi.');
  process.exit(e.status || 1);
}

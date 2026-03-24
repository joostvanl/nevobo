#!/usr/bin/env node
// deploy-to-pi.js — git pull + Docker rebuild on production (Raspberry Pi / server).
//
// Usage:
//   node scripts/deploy-to-pi.js
//   node scripts/deploy-to-pi.js --dry-run
//
// Reads PI_HOST, PI_USER, PI_PATH from .env (same as pull-from-pi.js).
// Requires SSH key auth to the host.

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

if (!piHost) {
  console.error('ERROR: PI_HOST not set in .env');
  process.exit(1);
}

const remote = `${piUser}@${piHost}`;

const remoteScript = `
set -e
cd ${piPath}
echo "==> $(pwd)  branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
git fetch origin main
git reset --hard origin/main
docker compose build
docker compose up -d --remove-orphans
echo "==> Deploy finished."
docker compose ps
`.trim();

console.log('=== Deploy to production (remote git + Docker) ===');
if (dryRun) {
  console.log('DRY RUN — would SSH to', remote);
  console.log('--- remote script ---\n' + remoteScript + '\n---');
  process.exit(0);
}

try {
  execFileSync('ssh', ['-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', remote, remoteScript], {
    stdio: 'inherit',
    timeout: 600000,
  });
} catch (e) {
  console.error('Deploy failed. Check SSH key, PI_HOST, and Docker on the server.');
  process.exit(e.status || 1);
}

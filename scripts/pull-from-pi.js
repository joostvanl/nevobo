#!/usr/bin/env node
// pull-from-pi.js — download production db + uploads to local dev machine
// Usage: node scripts/pull-from-pi.js [--skip-backup] [--force]
//
// Reads PI_HOST, PI_USER, PI_PATH from .env in the project root.

const { execFileSync, execSync } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const root     = path.resolve(__dirname, '..');
const args     = process.argv.slice(2);
const force    = args.includes('--force');
const noBackup = args.includes('--skip-backup');

// ── Load .env ────────────────────────────────────────────────────────────────
const envVars = {};
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
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

const remote       = `${piUser}@${piHost}`;
const remoteDbTmp  = '/tmp/volleyapp-db-pull.db';
const remoteUplTar = '/tmp/volleyapp-uploads-pull.tar.gz';

console.log('=== Pull content from Pi ===');
console.log(`Remote: ${remote}:${piPath}`);
console.log(`Local:  ${root}\n`);

// ── Helper: SSH command, output piped (non-interactive) ───────────────────────
function ssh(cmd, { allowFail = false } = {}) {
  try {
    const out = execFileSync('ssh', [
      '-o', 'ConnectTimeout=15',
      '-o', 'BatchMode=yes',       // never prompt, fail immediately if no key
      '-o', 'StrictHostKeyChecking=accept-new',
      remote,
      cmd,
    ], { encoding: 'utf8', timeout: 180000 });
    if (out.trim()) console.log(' ', out.trim());
    return 0;
  } catch (e) {
    if (e.stdout?.trim()) console.log(' ', e.stdout.trim());
    if (e.stderr?.trim()) console.error(' ', e.stderr.trim());
    if (!allowFail) { console.error(`SSH command failed.`); process.exit(1); }
    return e.status || 1;
  }
}

// ── Helper: local command ─────────────────────────────────────────────────────
function run(file, args2, { allowFail = false } = {}) {
  try {
    execFileSync(file, args2, { stdio: 'inherit', timeout: 120000 });
    return 0;
  } catch (e) {
    if (!allowFail) { console.error(`Command failed: ${file} ${args2.join(' ')}`); process.exit(1); }
    return e.status || 1;
  }
}

main();

async function main() {
  // ── Backup local state ──────────────────────────────────────────────────────
  if (!noBackup) {
    console.log('Creating backup of current local state...');
    try {
      execSync(`node "${path.join(__dirname, 'backup-content.js')}"`, { stdio: 'inherit' });
    } catch (_) {}
    console.log('');
  }

  // ── Test SSH ────────────────────────────────────────────────────────────────
  process.stdout.write('Testing SSH connection... ');
  const rc = ssh('echo SSH_OK', { allowFail: true });
  if (rc !== 0) {
    console.error(`\nERROR: Cannot connect to ${remote}.`);
    console.error('Make sure SSH key auth is set up: ssh-copy-id ' + remote);
    process.exit(1);
  }
  console.log('OK');

  // ── Fetch database ──────────────────────────────────────────────────────────
  console.log('\nFetching database from Pi...');
  // WAL checkpoint + docker cp
  let dbOk = ssh(
    `docker cp volleyapp:/app/data/volleyball.db ${remoteDbTmp}`,
    { allowFail: true }
  );
  if (dbOk !== 0) {
    console.log('  docker cp failed, trying direct file copy...');
    dbOk = ssh(`cp ${piPath}/data/volleyball.db ${remoteDbTmp}`, { allowFail: true });
    if (dbOk !== 0) { console.error('ERROR: Cannot find database on Pi.'); process.exit(1); }
  }

  const dbTmp = path.join(os.tmpdir(), 'volleyapp-db-pull.db');
  run('scp', [`${remote}:${remoteDbTmp}`, dbTmp]);
  console.log(`  Downloaded: ${(fs.statSync(dbTmp).size / 1024).toFixed(0)} KB`);

  // ── Fetch uploads ───────────────────────────────────────────────────────────
  console.log('\nFetching uploads from Pi...');

  // First figure out which volume exists and its host path
  const volumeList = (() => {
    try { return execFileSync('ssh', ['-o', 'BatchMode=yes', remote, 'docker volume ls --format {{.Name}}'], { encoding: 'utf8' }); }
    catch (_) { return ''; }
  })();

  const volumeName = volumeList.includes('volleyapp_uploads') ? 'volleyapp_uploads'
                   : volumeList.includes('team_uploads') ? 'team_uploads'
                   : null;

  const remoteUplTarHome = `/home/${piUser}/volleyapp-uploads-pull.tar.gz`;
  let uplOk = 1;

  if (volumeName) {
    console.log(`  Using Docker volume: ${volumeName}`);
    // Get the actual host mount path so we can tar it with sudo
    const mountPoint = (() => {
      try { return execFileSync('ssh', ['-o', 'BatchMode=yes', remote,
        `docker inspect ${volumeName} --format '{{.Mountpoint}}'`], { encoding: 'utf8' }).trim(); }
      catch (_) { return ''; }
    })();

    if (mountPoint) {
      uplOk = ssh(`sudo tar -czf ${remoteUplTarHome} -C ${mountPoint} .`, { allowFail: true });
    }
  }
  if (uplOk !== 0) {
    console.log('  Falling back to bind-mount path...');
    uplOk = ssh(`tar -czf ${remoteUplTarHome} -C ${piPath}/public/uploads .`, { allowFail: true });
    if (uplOk !== 0) { console.error('ERROR: Could not export uploads on Pi.'); process.exit(1); }
  }

  const uplTar = path.join(os.tmpdir(), 'volleyapp-uploads-pull.tar.gz');
  run('scp', [`${remote}:${remoteUplTarHome}`, uplTar]);
  console.log(`  Downloaded: ${(fs.statSync(uplTar).size / 1024).toFixed(0)} KB`);

  // ── Apply locally ───────────────────────────────────────────────────────────
  console.log('\nApplying to local dev environment...');

  const dbDest  = path.join(root, 'data', 'volleyball.db');
  const uplDest = path.join(root, 'public', 'uploads');

  // Database
  [dbDest + '-shm', dbDest + '-wal'].forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
  fs.mkdirSync(path.dirname(dbDest), { recursive: true });
  fs.copyFileSync(dbTmp, dbDest);
  console.log(`  Database: ${(fs.statSync(dbDest).size / 1024).toFixed(0)} KB`);

  // Uploads
  fs.rmSync(uplDest, { recursive: true, force: true });
  fs.mkdirSync(uplDest, { recursive: true });
  run('tar', ['-xzf', uplTar, '-C', uplDest]);
  const countUploads = countFiles(uplDest);
  console.log(`  Uploads: ${countUploads} files`);

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  ssh(`rm -f ${remoteDbTmp} ${remoteUplTarHome}`, { allowFail: true });
  try { fs.unlinkSync(dbTmp); fs.unlinkSync(uplTar); } catch (_) {}

  console.log('\nDone! Restart the local dev server to use the new database.');
}

function countFiles(dir) {
  let n = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) n += countFiles(full);
      else n++;
    }
  } catch (_) {}
  return n;
}

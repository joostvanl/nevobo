#!/usr/bin/env node
// pull-from-pi.js — download production database + uploads to local dev machine.
//
// Usage:
//   node scripts/pull-from-pi.js            # backup + pull, no prompts
//   node scripts/pull-from-pi.js --dry-run  # show what would happen, don't change anything
//   node scripts/pull-from-pi.js --skip-backup  # skip local backup step
//
// Reads PI_HOST, PI_USER, PI_PATH from .env in the project root.
// Prerequisites: SSH key-based auth to Pi (no password prompts).

const { execFileSync } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const root     = path.resolve(__dirname, '..');
const args     = process.argv.slice(2);
const dryRun   = args.includes('--dry-run');
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

const remote          = `${piUser}@${piHost}`;
const remoteDbTmp     = '/tmp/volleyapp-db-pull.db';
const remoteUplTarHome = `/home/${piUser}/volleyapp-uploads-pull.tar.gz`;

console.log('=== Pull content from Pi ===');
console.log(`Remote : ${remote}:${piPath}`);
console.log(`Local  : ${root}`);
if (dryRun) console.log('DRY RUN — no changes will be made');
console.log('');

// ── Helper: run SSH command (non-interactive, output captured) ────────────────
function ssh(cmd, { allowFail = false } = {}) {
  try {
    const out = execFileSync('ssh', [
      '-o', 'ConnectTimeout=15',
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      remote, cmd,
    ], { encoding: 'utf8', timeout: 180000 });
    if (out.trim()) console.log('  ' + out.trim());
    return 0;
  } catch (e) {
    if (e.stdout?.trim()) console.log('  ' + e.stdout.trim());
    if (e.stderr?.trim()) console.error('  ' + e.stderr.trim());
    if (!allowFail) { console.error('SSH command failed.'); process.exit(1); }
    return e.status || 1;
  }
}

// ── Helper: run local command with visible output ─────────────────────────────
function run(file, fileArgs, { allowFail = false } = {}) {
  try {
    execFileSync(file, fileArgs, { stdio: 'inherit', timeout: 120000 });
    return 0;
  } catch (e) {
    if (!allowFail) { console.error(`Command failed: ${file} ${fileArgs.join(' ')}`); process.exit(1); }
    return e.status || 1;
  }
}

// ── Helper: inline Node backup (no subproces needed) ─────────────────────────
function localBackup(label) {
  const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dirName = label ? `${ts}-${label}` : ts;
  const dest    = path.join(root, 'backups', dirName);
  const dbSrc   = path.join(root, 'data', 'volleyball.db');
  const uplSrc  = path.join(root, 'public', 'uploads');

  fs.mkdirSync(dest, { recursive: true });

  // Database: copy .db + .wal + .shm together — SQLite merges WAL on open
  if (fs.existsSync(dbSrc)) {
    fs.copyFileSync(dbSrc, path.join(dest, 'volleyball.db'));
    for (const ext of ['-wal', '-shm']) {
      if (fs.existsSync(dbSrc + ext)) fs.copyFileSync(dbSrc + ext, path.join(dest, 'volleyball.db' + ext));
    }
    console.log(`  DB  : ${(fs.statSync(path.join(dest, 'volleyball.db')).size / 1024).toFixed(0)} KB`);
  }

  // Uploads: recursive copy
  if (fs.existsSync(uplSrc)) {
    copyDir(uplSrc, path.join(dest, 'uploads'));
    console.log(`  Uploads: ${countFiles(path.join(dest, 'uploads'))} files`);
  }

  // Manifest
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify({
    created_at: new Date().toISOString(), label,
    db_size: fs.existsSync(path.join(dest, 'volleyball.db')) ? fs.statSync(path.join(dest, 'volleyball.db')).size : 0,
    upload_files: fs.existsSync(path.join(dest, 'uploads')) ? countFiles(path.join(dest, 'uploads')) : 0,
  }, null, 2));

  console.log(`  Saved: backups/${dirName}`);
  return dirName;
}

main();

async function main() {
  // ── 1. Backup current local state ──────────────────────────────────────────
  if (!noBackup) {
    console.log('Creating backup of current local state...');
    if (!dryRun) localBackup('pre-pull-from-pi');
    console.log('');
  }

  // ── 2. Test SSH connection ──────────────────────────────────────────────────
  process.stdout.write('Testing SSH connection... ');
  const rc = ssh('echo SSH_OK', { allowFail: true });
  if (rc !== 0) {
    console.error(`\nERROR: Cannot connect to ${remote}.`);
    console.error('Set up SSH key auth: ssh-copy-id ' + remote);
    process.exit(1);
  }
  console.log('OK\n');

  // ── 3. Fetch database via container backup API ──────────────────────────────
  console.log('Fetching database from Pi...');

  if (!dryRun) {
    // Upload dump script to Pi, copy into container, run it
    const dumpScript = path.join(os.tmpdir(), '_vapp_dbdump.js');
    fs.writeFileSync(dumpScript, [
      "const Database = require('better-sqlite3');",
      "const db = new Database('/app/data/volleyball.db');",
      "db.pragma('wal_checkpoint(TRUNCATE)');",
      "db.backup('/tmp/vapp-db-clean.db')",
      "  .then(() => { db.close(); process.stdout.write('backup ok\\n'); })",
      "  .catch(e  => { process.stderr.write(e.message + '\\n'); process.exit(1); });",
    ].join('\n'));

    run('scp', [dumpScript, `${remote}:/tmp/_vapp_dbdump.js`]);
    ssh('docker cp /tmp/_vapp_dbdump.js volleyapp:/app/_vapp_dbdump.js');
    ssh('docker exec volleyapp node /app/_vapp_dbdump.js');
    ssh(`docker cp volleyapp:/tmp/vapp-db-clean.db ${remoteDbTmp}`);

    const dbTmp = path.join(os.tmpdir(), 'volleyapp-db-pull.db');
    run('scp', [`${remote}:${remoteDbTmp}`, dbTmp]);

    // Integrity check before overwriting anything local
    const Database = require('better-sqlite3');
    let check;
    try {
      const testDb = new Database(dbTmp, { readonly: true });
      check = testDb.pragma('integrity_check')[0].integrity_check;
      testDb.close();
    } catch (e) {
      console.error(`ERROR: Downloaded database is unreadable: ${e.message}`);
      process.exit(1);
    }
    if (check !== 'ok') {
      console.error(`ERROR: Database integrity check failed: ${check}`);
      process.exit(1);
    }
    console.log(`  Downloaded and verified: ${(fs.statSync(dbTmp).size / 1024).toFixed(0)} KB ✓\n`);

    // ── 4. Fetch uploads via Docker volume ────────────────────────────────────
    console.log('Fetching uploads from Pi...');

    const volumeList = (() => {
      try { return execFileSync('ssh', ['-o', 'BatchMode=yes', remote,
        'docker volume ls --format {{.Name}}'], { encoding: 'utf8' }); }
      catch (_) { return ''; }
    })();

    const volumeName = volumeList.includes('volleyapp_uploads') ? 'volleyapp_uploads'
                     : volumeList.includes('team_uploads') ? 'team_uploads'
                     : null;

    let uplOk = 1;
    if (volumeName) {
      console.log(`  Using Docker volume: ${volumeName}`);
      const mountPoint = (() => {
        try { return execFileSync('ssh', ['-o', 'BatchMode=yes', remote,
          `docker inspect ${volumeName} --format '{{.Mountpoint}}'`], { encoding: 'utf8' }).trim(); }
        catch (_) { return ''; }
      })();
      if (mountPoint) uplOk = ssh(`sudo tar -czf ${remoteUplTarHome} -C ${mountPoint} .`, { allowFail: true });
    }
    if (uplOk !== 0) {
      uplOk = ssh(`tar -czf ${remoteUplTarHome} -C ${piPath}/public/uploads .`, { allowFail: true });
      if (uplOk !== 0) { console.error('ERROR: Could not export uploads on Pi.'); process.exit(1); }
    }

    const uplTar = path.join(os.tmpdir(), 'volleyapp-uploads-pull.tar.gz');
    run('scp', [`${remote}:${remoteUplTarHome}`, uplTar]);
    console.log(`  Downloaded: ${(fs.statSync(uplTar).size / 1024).toFixed(0)} KB\n`);

    // ── 5. Apply to local environment ─────────────────────────────────────────
    console.log('Applying to local dev environment...');

    const dbDest  = path.join(root, 'data', 'volleyball.db');
    const uplDest = path.join(root, 'public', 'uploads');

    [dbDest + '-shm', dbDest + '-wal'].forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
    fs.mkdirSync(path.dirname(dbDest), { recursive: true });
    fs.copyFileSync(dbTmp, dbDest);
    console.log(`  Database : ${(fs.statSync(dbDest).size / 1024).toFixed(0)} KB`);

    fs.rmSync(uplDest, { recursive: true, force: true });
    fs.mkdirSync(uplDest, { recursive: true });
    run('tar', ['-xzf', uplTar, '-C', uplDest]);
    console.log(`  Uploads  : ${countFiles(uplDest)} files`);

    // ── 6. Cleanup remote + local temp files ──────────────────────────────────
    ssh(`rm -f ${remoteDbTmp} ${remoteUplTarHome} /tmp/_vapp_dbdump.js`, { allowFail: true });
    for (const f of [dbTmp, uplTar, path.join(os.tmpdir(), '_vapp_dbdump.js')]) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
  }

  console.log('\nDone! Restart the local dev server to use the new database.');
  if (!dryRun) console.log('  → node server/index.js   or   npm run dev');
}

function countFiles(dir) {
  let n = 0;
  try { for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) n += countFiles(full); else n++;
  } } catch (_) {}
  return n;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dest, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

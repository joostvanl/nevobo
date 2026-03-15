# pull-from-pi.ps1
# Downloads the production database and uploads from the Raspberry Pi to your local dev machine.
# Automatically creates a timestamped backup of your current local content first.
#
# Usage:
#   .\scripts\pull-from-pi.ps1
#   .\scripts\pull-from-pi.ps1 -PiHost "192.168.1.50" -PiUser "pi"
#   .\scripts\pull-from-pi.ps1 -SkipBackup
#
# Prerequisites:
#   - SSH access to the Pi (key-based auth recommended)
#   - Docker running on the Pi with the volleyapp container
#   - OpenSSH client available locally (Windows 10+ has it built-in)

param(
    [string]$PiHost  = $env:PI_HOST,   # or set PI_HOST in your local .env
    [string]$PiUser  = $env:PI_USER,
    [string]$PiPath  = $env:PI_PATH,   # remote path to the project, e.g. /home/pi/Team
    [switch]$SkipBackup,
    [switch]$Force     # skip confirmation prompt
)

$root = Split-Path $PSScriptRoot -Parent

# ── Load .env for PI_HOST / PI_USER / PI_PATH if not set via param ────────────
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+?)\s*=\s*(.+?)\s*$') {
            $k = $Matches[1]; $v = $Matches[2]
            if ($k -eq "PI_HOST"  -and -not $PiHost)  { $PiHost  = $v }
            if ($k -eq "PI_USER"  -and -not $PiUser)  { $PiUser  = $v }
            if ($k -eq "PI_PATH"  -and -not $PiPath)  { $PiPath  = $v }
        }
    }
}

# ── Defaults ──────────────────────────────────────────────────────────────────
if (-not $PiUser) { $PiUser = "pi" }
if (-not $PiPath) { $PiPath = "~/Team" }

# ── Validate ──────────────────────────────────────────────────────────────────
if (-not $PiHost) {
    Write-Host "ERROR: Pi hostname/IP not configured." -ForegroundColor Red
    Write-Host "Either pass -PiHost '192.168.x.x' or add PI_HOST=... to your .env file."
    exit 1
}

Write-Host "=== Pull content from Pi ===" -ForegroundColor Cyan
Write-Host "Remote: $PiUser@$PiHost:$PiPath"
Write-Host "Local:  $root"
Write-Host ""

# ── Confirmation ─────────────────────────────────────────────────────────────
if (-not $Force) {
    Write-Host "WARNING: This will OVERWRITE your local database and uploads." -ForegroundColor Yellow
    $confirm = Read-Host "Type YES to continue"
    if ($confirm -ne "YES") { Write-Host "Cancelled."; exit 0 }
}

# ── Backup current local state ────────────────────────────────────────────────
if (-not $SkipBackup) {
    Write-Host ""
    Write-Host "Creating backup of current local state..." -ForegroundColor Yellow
    & "$PSScriptRoot\backup-content.ps1" -Label "pre-pull-from-pi"
    Write-Host ""
}

$tmpDir  = Join-Path $env:TEMP "volleyapp-pull-$(Get-Date -Format 'HHmmss')"
$dbTmp   = Join-Path $tmpDir "volleyball.db"
$uplTmp  = Join-Path $tmpDir "uploads"
$dbDest  = Join-Path $root "data\volleyball.db"
$uplDest = Join-Path $root "public\uploads"

New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$ssh = "ssh ${PiUser}@${PiHost}"

# ── 1. Database: dump via docker exec so WAL is flushed ───────────────────────
Write-Host "Fetching database from Pi..." -ForegroundColor Yellow

# Checkpoint WAL on the Pi, then copy db file to a temp location accessible by SCP
$remoteDbTmp = "/tmp/volleyapp-db-pull.db"
$checkpointCmd = "docker exec volleyapp sqlite3 /app/data/volleyball.db 'PRAGMA wal_checkpoint(TRUNCATE);' 2>/dev/null; docker cp volleyapp:/app/data/volleyball.db $remoteDbTmp"
Invoke-Expression "$ssh '$checkpointCmd'"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Checkpoint/copy failed — trying direct file copy..." -ForegroundColor Yellow
    $remotePath = "${PiPath}/data/volleyball.db"
    $checkpointCmd2 = "cp ${remotePath} $remoteDbTmp 2>/dev/null || true"
    Invoke-Expression "$ssh '$checkpointCmd2'"
}

scp "${PiUser}@${PiHost}:${remoteDbTmp}" $dbTmp
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Could not download database from Pi" -ForegroundColor Red
    exit 1
}

# ── 2. Uploads: export named Docker volume via tar ────────────────────────────
Write-Host "Fetching uploads from Pi..." -ForegroundColor Yellow

$remoteUplTar = "/tmp/volleyapp-uploads-pull.tar"
$tarCmd = "docker run --rm -v volleyapp_uploads:/src -v /tmp:/dst alpine tar -czf /dst/volleyapp-uploads-pull.tar -C /src ."
Invoke-Expression "$ssh '$tarCmd'"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Docker volume export failed — trying bind mount path..." -ForegroundColor Yellow
    $tarCmd2 = "tar -czf $remoteUplTar -C ${PiPath}/public/uploads ."
    Invoke-Expression "$ssh '$tarCmd2'"
}

$uplTar = Join-Path $tmpDir "uploads.tar.gz"
scp "${PiUser}@${PiHost}:${remoteUplTar}" $uplTar
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Could not download uploads from Pi" -ForegroundColor Red
    exit 1
}

# ── 3. Apply locally ──────────────────────────────────────────────────────────
Write-Host "Applying to local dev environment..." -ForegroundColor Yellow

# Database
Remove-Item "${dbDest}-shm" -ErrorAction SilentlyContinue
Remove-Item "${dbDest}-wal" -ErrorAction SilentlyContinue
Copy-Item $dbTmp $dbDest -Force
Write-Host ("  Database: {0:N0} bytes" -f (Get-Item $dbDest).Length) -ForegroundColor Green

# Uploads — extract tar
if (Test-Path $uplDest) { Remove-Item $uplDest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $uplDest | Out-Null
tar -xzf $uplTar -C $uplDest
$count = (Get-ChildItem $uplDest -Recurse -File).Count
Write-Host "  Uploads: $count files" -ForegroundColor Green

# ── 4. Clean up remote temp files ─────────────────────────────────────────────
Invoke-Expression "$ssh 'rm -f $remoteDbTmp $remoteUplTar'" 2>$null

# ── 5. Clean up local temp dir ────────────────────────────────────────────────
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done! Production content is now available locally." -ForegroundColor Green
Write-Host "Restart the local dev server to use the new database."

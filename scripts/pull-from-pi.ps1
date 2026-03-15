# pull-from-pi.ps1
# Downloads the production database and uploads from the Raspberry Pi to your local dev machine.
# Automatically creates a timestamped backup of your current local content first.
#
# Usage:
#   .\scripts\pull-from-pi.ps1
#   .\scripts\pull-from-pi.ps1 -PiHost "192.168.1.50" -PiUser "pi"
#   .\scripts\pull-from-pi.ps1 -SkipBackup   (skip local backup before overwriting)
#   .\scripts\pull-from-pi.ps1 -Force         (skip confirmation prompt)
#
# Prerequisites:
#   - SSH access to the Pi (key-based auth recommended: ssh-copy-id user@host)
#   - Docker running on the Pi with the volleyapp container
#   - OpenSSH client available locally (Windows 10+ has it built-in)

param(
    [string]$PiHost     = "",
    [string]$PiUser     = "",
    [string]$PiPath     = "",
    [switch]$SkipBackup,
    [switch]$Force
)

$root = Split-Path $PSScriptRoot -Parent

# ── Load .env for PI_HOST / PI_USER / PI_PATH ─────────────────────────────────
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+?)\s*=\s*(.+?)\s*$') {
            $k = $Matches[1].Trim()
            $v = $Matches[2].Trim()
            if ($k -eq "PI_HOST" -and -not $PiHost) { $PiHost = $v }
            if ($k -eq "PI_USER" -and -not $PiUser) { $PiUser = $v }
            if ($k -eq "PI_PATH" -and -not $PiPath) { $PiPath = $v }
        }
    }
}

# ── Defaults ──────────────────────────────────────────────────────────────────
if (-not $PiUser) { $PiUser = "pi" }
if (-not $PiPath) { $PiPath = "~/Team" }

# ── Validate ──────────────────────────────────────────────────────────────────
if (-not $PiHost) {
    Write-Host "ERROR: Pi hostname/IP not configured." -ForegroundColor Red
    Write-Host "Add PI_HOST=192.168.x.x to your local .env file, or pass -PiHost."
    exit 1
}

$remote = "${PiUser}@${PiHost}"

Write-Host "=== Pull content from Pi ===" -ForegroundColor Cyan
Write-Host "Remote: ${remote}:${PiPath}"
Write-Host "Local:  $root"
Write-Host ""

# ── Confirmation ─────────────────────────────────────────────────────────────
if (-not $Force) {
    Write-Host "WARNING: This will OVERWRITE your local database and uploads." -ForegroundColor Yellow
    $confirm = Read-Host "Type YES to continue"
    if ($confirm -ne "YES") { Write-Host "Cancelled."; exit 0 }
    Write-Host ""
}

# ── Backup current local state ────────────────────────────────────────────────
if (-not $SkipBackup) {
    Write-Host "Creating backup of current local state..." -ForegroundColor Yellow
    & "$PSScriptRoot\backup-content.ps1" -Label "pre-pull-from-pi"
    Write-Host ""
}

# ── Temp paths ────────────────────────────────────────────────────────────────
$tmpDir      = Join-Path $env:TEMP "volleyapp-pull-$(Get-Date -Format 'HHmmss')"
$dbTmp       = Join-Path $tmpDir "volleyball.db"
$uplTar      = Join-Path $tmpDir "uploads.tar.gz"
$dbDest      = Join-Path $root "data\volleyball.db"
$uplDest     = Join-Path $root "public\uploads"
$remoteDbTmp = "/tmp/volleyapp-db-pull.db"
$remoteUplTar= "/tmp/volleyapp-uploads-pull.tar.gz"

New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

# Helper: run a command on the Pi via SSH, return exit code
function Invoke-SSH {
    param([string]$cmd)
    $result = ssh "-o" "ConnectTimeout=10" $remote -- $cmd
    return $LASTEXITCODE
}

# ── 1. Test SSH connection ────────────────────────────────────────────────────
Write-Host "Testing SSH connection..." -ForegroundColor Yellow
$rc = Invoke-SSH "echo ok"
if ($rc -ne 0) {
    Write-Host "ERROR: Cannot connect to ${remote}. Check PI_HOST, PI_USER and SSH key." -ForegroundColor Red
    exit 1
}
Write-Host "  SSH OK" -ForegroundColor Green

# ── 2. Database: checkpoint WAL, then copy to /tmp ───────────────────────────
Write-Host "Fetching database from Pi..." -ForegroundColor Yellow

$rc = Invoke-SSH "docker exec volleyapp sqlite3 /app/data/volleyball.db 'PRAGMA wal_checkpoint(TRUNCATE);' 2>/dev/null; docker cp volleyapp:/app/data/volleyball.db $remoteDbTmp"
if ($rc -ne 0) {
    Write-Host "  docker cp failed, trying direct file copy..." -ForegroundColor Yellow
    $rc = Invoke-SSH "cp ${PiPath}/data/volleyball.db $remoteDbTmp"
    if ($rc -ne 0) {
        Write-Host "ERROR: Could not copy database on Pi." -ForegroundColor Red
        exit 1
    }
}

scp "${remote}:${remoteDbTmp}" $dbTmp
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: scp of database failed." -ForegroundColor Red
    exit 1
}
Write-Host ("  Database downloaded: {0:N0} bytes" -f (Get-Item $dbTmp).Length) -ForegroundColor Green

# ── 3. Uploads: tar the Docker named volume via a throwaway Alpine container ──
Write-Host "Fetching uploads from Pi..." -ForegroundColor Yellow

$rc = Invoke-SSH "docker run --rm -v team_uploads:/src alpine tar -czf - -C /src . > $remoteUplTar"
if ($rc -ne 0) {
    Write-Host "  team_uploads volume not found, trying volleyapp_uploads..." -ForegroundColor Yellow
    $rc = Invoke-SSH "docker run --rm -v volleyapp_uploads:/src alpine tar -czf - -C /src . > $remoteUplTar"
}
if ($rc -ne 0) {
    Write-Host "  Docker volume export failed, trying bind-mount path..." -ForegroundColor Yellow
    $rc = Invoke-SSH "tar -czf $remoteUplTar -C ${PiPath}/public/uploads ."
    if ($rc -ne 0) {
        Write-Host "ERROR: Could not export uploads on Pi." -ForegroundColor Red
        exit 1
    }
}

scp "${remote}:${remoteUplTar}" $uplTar
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: scp of uploads failed." -ForegroundColor Red
    exit 1
}
$uplTarSize = (Get-Item $uplTar).Length
Write-Host ("  Uploads downloaded: {0:N0} bytes" -f $uplTarSize) -ForegroundColor Green

# ── 4. Apply to local dev environment ────────────────────────────────────────
Write-Host "Applying to local dev environment..." -ForegroundColor Yellow

# Database
Remove-Item "${dbDest}-shm" -ErrorAction SilentlyContinue
Remove-Item "${dbDest}-wal" -ErrorAction SilentlyContinue
Copy-Item $dbTmp $dbDest -Force
Write-Host ("  Database applied: {0:N0} bytes" -f (Get-Item $dbDest).Length) -ForegroundColor Green

# Uploads
if (Test-Path $uplDest) { Remove-Item $uplDest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $uplDest | Out-Null
tar -xzf $uplTar -C $uplDest
$count = (Get-ChildItem $uplDest -Recurse -File -ErrorAction SilentlyContinue).Count
Write-Host "  Uploads applied: $count files" -ForegroundColor Green

# ── 5. Clean up temp files ────────────────────────────────────────────────────
Invoke-SSH "rm -f $remoteDbTmp $remoteUplTar" | Out-Null
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done! Production content is now available locally." -ForegroundColor Green
Write-Host "Restart the local dev server to use the new database."

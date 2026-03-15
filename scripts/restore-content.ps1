# restore-content.ps1
# Restores database and uploads from a backup created by backup-content.ps1.
# Usage: .\scripts\restore-content.ps1 [-Backup "2026-03-15_10-00-00"] [-Force]
# If -Backup is omitted, lists available backups and prompts for selection.

param(
    [string]$Backup = "",
    [switch]$Force
)

$root       = Split-Path $PSScriptRoot -Parent
$backupsDir = Join-Path $root "backups"

# ── List available backups ────────────────────────────────────────────────────
if (-not (Test-Path $backupsDir)) {
    Write-Host "No backups directory found at $backupsDir" -ForegroundColor Red
    exit 1
}

$available = Get-ChildItem $backupsDir -Directory | Sort-Object Name -Descending

if ($available.Count -eq 0) {
    Write-Host "No backups found in $backupsDir" -ForegroundColor Red
    exit 1
}

if (-not $Backup) {
    Write-Host "=== Available Backups ===" -ForegroundColor Cyan
    $i = 1
    foreach ($b in $available) {
        $manifestPath = Join-Path $b.FullName "manifest.json"
        $info = ""
        if (Test-Path $manifestPath) {
            $m = Get-Content $manifestPath | ConvertFrom-Json
            $info = "  db=$('{0:N0}' -f $m.db_size) bytes  uploads=$($m.upload_files) files  label=$($m.label)"
        }
        Write-Host "  [$i] $($b.Name)$info"
        $i++
    }
    Write-Host ""
    $choice = Read-Host "Enter number to restore (or Q to quit)"
    if ($choice -eq 'Q' -or $choice -eq 'q') { exit 0 }
    $idx = [int]$choice - 1
    if ($idx -lt 0 -or $idx -ge $available.Count) {
        Write-Host "Invalid selection" -ForegroundColor Red
        exit 1
    }
    $Backup = $available[$idx].Name
}

$srcDir  = Join-Path $backupsDir $Backup
$dbSrc   = Join-Path $srcDir "volleyball.db"
$uplSrc  = Join-Path $srcDir "uploads"
$dbDest  = Join-Path $root "data\volleyball.db"
$uplDest = Join-Path $root "public\uploads"

if (-not (Test-Path $srcDir)) {
    Write-Host "Backup not found: $srcDir" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Content Restore ===" -ForegroundColor Cyan
Write-Host "Source:  $srcDir"
Write-Host "Target:  $root"
Write-Host ""

# ── Confirmation ─────────────────────────────────────────────────────────────
if (-not $Force) {
    Write-Host "WARNING: This will OVERWRITE the current database and uploads." -ForegroundColor Yellow
    Write-Host "Stop the server before restoring to avoid data corruption." -ForegroundColor Yellow
    Write-Host ""
    $confirm = Read-Host "Type YES to continue"
    if ($confirm -ne "YES") {
        Write-Host "Cancelled." -ForegroundColor Gray
        exit 0
    }
}

# ── Auto-create a safety backup of current state before overwriting ───────────
Write-Host ""
Write-Host "Creating safety backup of current state..." -ForegroundColor Yellow
$safetyLabel = "pre-restore-$(Get-Date -Format 'HH-mm-ss')"
& "$PSScriptRoot\backup-content.ps1" -Label $safetyLabel
Write-Host ""

# ── Stop any running Node processes (local dev) ───────────────────────────────
$nodeProcs = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodeProcs) {
    Write-Host "Stopping $($nodeProcs.Count) node process(es)..." -ForegroundColor Yellow
    $nodeProcs | Stop-Process -Force
    Start-Sleep -Seconds 1
}

# ── Restore database ──────────────────────────────────────────────────────────
if (Test-Path $dbSrc) {
    Write-Host "Restoring database..." -ForegroundColor Yellow
    # Remove WAL/SHM files to avoid conflicts
    Remove-Item "$dbDest-shm" -ErrorAction SilentlyContinue
    Remove-Item "$dbDest-wal" -ErrorAction SilentlyContinue
    Copy-Item $dbSrc $dbDest -Force
    Write-Host "  Database restored: $('{0:N0}' -f (Get-Item $dbDest).Length) bytes" -ForegroundColor Green
} else {
    Write-Host "  WARNING: no database found in backup, skipping" -ForegroundColor Yellow
}

# ── Restore uploads ───────────────────────────────────────────────────────────
if (Test-Path $uplSrc) {
    Write-Host "Restoring uploads..." -ForegroundColor Yellow
    # Remove current uploads and replace with backup
    if (Test-Path $uplDest) {
        Remove-Item $uplDest -Recurse -Force
    }
    Copy-Item $uplSrc $uplDest -Recurse -Force
    $count = (Get-ChildItem $uplDest -Recurse -File).Count
    Write-Host "  Uploads restored: $count files" -ForegroundColor Green
} else {
    Write-Host "  WARNING: no uploads found in backup, skipping" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Restore complete from: $Backup" -ForegroundColor Green
Write-Host "You can now restart the server."

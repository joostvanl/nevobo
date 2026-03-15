# backup-content.ps1
# Creates a timestamped backup of the database and uploads folder.
# Usage: .\scripts\backup-content.ps1 [-Label "mijn-label"]
# Backups are stored in: backups/YYYY-MM-DD_HH-MM-SS[-label]/

param(
    [string]$Label = ""
)

$root    = Split-Path $PSScriptRoot -Parent
$ts      = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$dirName = if ($Label) { "${ts}-${Label}" } else { $ts }
$dest    = Join-Path $root "backups\$dirName"

Write-Host "=== Content Backup ===" -ForegroundColor Cyan
Write-Host "Destination: $dest"

# Flush WAL so the SQLite backup is consistent
$dbSrc   = Join-Path $root "data\volleyball.db"
$dbDest  = Join-Path $dest "volleyball.db"
$uplSrc  = Join-Path $root "public\uploads"
$uplDest = Join-Path $dest "uploads"

New-Item -ItemType Directory -Force -Path $dest | Out-Null

# --- Database ---
if (Test-Path $dbSrc) {
    Write-Host "Backing up database..." -ForegroundColor Yellow
    # Use SQLite's online backup via a temp Node script so WAL is checkpointed
    $tmpScript = Join-Path $env:TEMP "sqlite-backup-$ts.mjs"
    @"
import Database from 'better-sqlite3';
const src  = new Database(process.argv[2], { readonly: true });
src.pragma('wal_checkpoint(TRUNCATE)');
src.backup(process.argv[3]).then(() => { src.close(); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
"@ | Set-Content $tmpScript
    node $tmpScript $dbSrc $dbDest
    Remove-Item $tmpScript -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Database backup failed — falling back to file copy" -ForegroundColor Red
        Copy-Item $dbSrc $dbDest -Force
    }
    Write-Host "  Database backed up: $('{0:N0}' -f (Get-Item $dbDest).Length) bytes" -ForegroundColor Green
} else {
    Write-Host "  WARNING: database not found at $dbSrc" -ForegroundColor Red
}

# --- Uploads ---
if (Test-Path $uplSrc) {
    Write-Host "Backing up uploads..." -ForegroundColor Yellow
    Copy-Item $uplSrc $uplDest -Recurse -Force
    $count = (Get-ChildItem $uplDest -Recurse -File).Count
    Write-Host "  Uploads backed up: $count files" -ForegroundColor Green
} else {
    Write-Host "  WARNING: uploads folder not found at $uplSrc" -ForegroundColor Yellow
}

# --- Manifest ---
$manifest = @{
    created_at  = (Get-Date -Format "o")
    label       = $Label
    db_size     = if (Test-Path $dbDest) { (Get-Item $dbDest).Length } else { 0 }
    upload_files = if (Test-Path $uplDest) { (Get-ChildItem $uplDest -Recurse -File).Count } else { 0 }
} | ConvertTo-Json
$manifest | Set-Content (Join-Path $dest "manifest.json")

Write-Host ""
Write-Host "Backup complete: backups\$dirName" -ForegroundColor Green
Write-Host "To restore: .\scripts\restore-content.ps1 -Backup '$dirName'"

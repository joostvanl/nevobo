#!/bin/bash
# restore-content.sh — restore database + uploads from a backup
# Usage: ./scripts/restore-content.sh [backup-name] [--force]
# If backup-name is omitted, lists available backups and prompts.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUPS_DIR="$ROOT/backups"
BACKUP_NAME="${1:-}"
FORCE=0
[[ "${2:-}" == "--force" ]] && FORCE=1

# ── List available backups ────────────────────────────────────────────────────
if [ ! -d "$BACKUPS_DIR" ] || [ -z "$(ls -A "$BACKUPS_DIR" 2>/dev/null)" ]; then
    echo "No backups found in $BACKUPS_DIR"
    exit 1
fi

mapfile -t AVAILABLE < <(ls -r "$BACKUPS_DIR")

if [ -z "$BACKUP_NAME" ]; then
    echo "=== Available Backups ==="
    i=1
    for b in "${AVAILABLE[@]}"; do
        INFO=""
        MANIFEST="$BACKUPS_DIR/$b/manifest.json"
        if [ -f "$MANIFEST" ] && command -v python3 &>/dev/null; then
            INFO=$(python3 -c "
import json,sys
m=json.load(open('$MANIFEST'))
print(f\"  db={m.get('db_size',0):,} bytes  uploads={m.get('upload_files',0)} files  label={m.get('label','')}\")" 2>/dev/null || true)
        fi
        echo "  [$i] $b$INFO"
        ((i++))
    done
    echo ""
    read -rp "Enter number to restore (or q to quit): " CHOICE
    [[ "$CHOICE" == "q" || "$CHOICE" == "Q" ]] && exit 0
    IDX=$((CHOICE - 1))
    BACKUP_NAME="${AVAILABLE[$IDX]}"
fi

SRC_DIR="$BACKUPS_DIR/$BACKUP_NAME"
DB_SRC="$SRC_DIR/volleyball.db"
UPL_SRC="$SRC_DIR/uploads"
DB_DEST="$ROOT/data/volleyball.db"
UPL_DEST="$ROOT/public/uploads"

if [ ! -d "$SRC_DIR" ]; then
    echo "Backup not found: $SRC_DIR"
    exit 1
fi

echo ""
echo "=== Content Restore ==="
echo "Source:  $SRC_DIR"
echo "Target:  $ROOT"
echo ""

# ── Confirmation ─────────────────────────────────────────────────────────────
if [ "$FORCE" -eq 0 ]; then
    echo "WARNING: This will OVERWRITE the current database and uploads."
    echo "Stop the server / app container before restoring."
    echo ""
    read -rp "Type YES to continue: " CONFIRM
    if [ "$CONFIRM" != "YES" ]; then
        echo "Cancelled."
        exit 0
    fi
fi

# ── Safety backup of current state ───────────────────────────────────────────
echo ""
echo "Creating safety backup of current state..."
SAFETY_LABEL="pre-restore-$(date +%H-%M-%S)"
bash "$ROOT/scripts/backup-content.sh" "$SAFETY_LABEL" || true
echo ""

# ── Stop app container if running on Pi ──────────────────────────────────────
if command -v docker &>/dev/null && docker compose -f "$ROOT/docker-compose.yml" ps --quiet app 2>/dev/null | grep -q .; then
    echo "Stopping app container..."
    docker compose -f "$ROOT/docker-compose.yml" stop app
    RESTART_DOCKER=1
else
    RESTART_DOCKER=0
fi

# ── Restore database ──────────────────────────────────────────────────────────
if [ -f "$DB_SRC" ]; then
    echo "Restoring database..."
    rm -f "${DB_DEST}-shm" "${DB_DEST}-wal"
    cp "$DB_SRC" "$DB_DEST"
    SIZE=$(wc -c < "$DB_DEST")
    echo "  Database restored: $SIZE bytes"
else
    echo "  WARNING: no database in backup, skipping"
fi

# ── Restore uploads ───────────────────────────────────────────────────────────
if [ -d "$UPL_SRC" ]; then
    echo "Restoring uploads..."
    rm -rf "$UPL_DEST"
    cp -r "$UPL_SRC" "$UPL_DEST"
    COUNT=$(find "$UPL_DEST" -type f | wc -l)
    echo "  Uploads restored: $COUNT files"
else
    echo "  WARNING: no uploads in backup, skipping"
fi

# ── Restart app container if it was running ───────────────────────────────────
if [ "$RESTART_DOCKER" -eq 1 ]; then
    echo "Restarting app container..."
    docker compose -f "$ROOT/docker-compose.yml" start app
fi

echo ""
echo "Restore complete from: $BACKUP_NAME"
[ "$RESTART_DOCKER" -eq 0 ] && echo "You can now restart the server."

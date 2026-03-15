#!/bin/bash
# backup-content.sh — create a timestamped backup of database + uploads
# Usage: ./scripts/backup-content.sh [label]
# Works both locally and inside a Docker container on the Pi.

set -euo pipefail

LABEL="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS="$(date +%Y-%m-%d_%H-%M-%S)"
DIR_NAME="${TS}${LABEL:+-$LABEL}"
DEST="$ROOT/backups/$DEST_NAME"
DEST="$ROOT/backups/$DIR_NAME"

DB_SRC="$ROOT/data/volleyball.db"
DB_DEST="$DEST/volleyball.db"
UPL_SRC="$ROOT/public/uploads"
UPL_DEST="$DEST/uploads"

echo "=== Content Backup ==="
echo "Destination: $DEST"

mkdir -p "$DEST"

# --- Database (checkpoint WAL first) ---
if [ -f "$DB_SRC" ]; then
    echo "Backing up database..."
    # Flush WAL via sqlite3 if available, otherwise plain copy
    if command -v sqlite3 &>/dev/null; then
        sqlite3 "$DB_SRC" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
    fi
    cp "$DB_SRC" "$DB_DEST"
    SIZE=$(wc -c < "$DB_DEST")
    echo "  Database backed up: $SIZE bytes"
else
    echo "  WARNING: database not found at $DB_SRC"
fi

# --- Uploads ---
if [ -d "$UPL_SRC" ]; then
    echo "Backing up uploads..."
    cp -r "$UPL_SRC" "$UPL_DEST"
    COUNT=$(find "$UPL_DEST" -type f | wc -l)
    echo "  Uploads backed up: $COUNT files"
else
    echo "  WARNING: uploads folder not found at $UPL_SRC"
fi

# --- Manifest ---
DB_SIZE=0
[ -f "$DB_DEST" ] && DB_SIZE=$(wc -c < "$DB_DEST")
UPL_COUNT=0
[ -d "$UPL_DEST" ] && UPL_COUNT=$(find "$UPL_DEST" -type f | wc -l)

cat > "$DEST/manifest.json" <<EOF
{
  "created_at": "$(date -Iseconds)",
  "label": "$LABEL",
  "db_size": $DB_SIZE,
  "upload_files": $UPL_COUNT
}
EOF

echo ""
echo "Backup complete: backups/$DIR_NAME"
echo "To restore: ./scripts/restore-content.sh '$DIR_NAME'"

#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PYTHON:-python3}"
"$PYTHON" -c 'import sys; assert sys.version_info >= (3,11), "Python 3.11 or newer is required"'
DATASET="${1:-$HOME/Developer/AXOM/web/public/application-schools.json}"
if [[ ! -f "$DATASET" ]]; then
  echo "School dataset not found: $DATASET" >&2
  echo "Usage: bash run-local.sh /absolute/path/to/application-schools.json" >&2
  exit 1
fi
"$PYTHON" "$ROOT/crawler.py" bootstrap "$DATASET" --allow-private-capture
exec "$PYTHON" "$ROOT/crawler.py" serve

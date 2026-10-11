#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == "Darwin" ]] || { echo "This installer is for macOS." >&2; exit 1; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATASET="${1:-$HOME/Developer/AXOM/web/public/application-schools.json}"
[[ -f "$DATASET" ]] || { echo "Missing dataset: $DATASET" >&2; exit 1; }
PYTHON=""
for candidate in python3.14 python3.13 python3.12 python3.11 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; assert sys.version_info >= (3,11)' >/dev/null 2>&1; then PYTHON="$(command -v "$candidate")"; break; fi
done
[[ -n "$PYTHON" ]] || { echo "Install Python 3.11+ first. No system Python has been modified." >&2; exit 1; }
DEST="$HOME/Library/Application Support/AXOM/PathwaysCrawler"
PLIST="$HOME/Library/LaunchAgents/org.axom.pathways-crawler.plist"
mkdir -p "$DEST/data" "$HOME/Library/LaunchAgents"
chmod 700 "$DEST" "$DEST/data"
for file in crawler.py fields.json pdf_worker.py browser_worker.py dashboard.html app.js style.css requirements-optional.txt; do cp "$ROOT/$file" "$DEST/$file"; done
"$PYTHON" -m venv "$DEST/.venv"
"$DEST/.venv/bin/python" "$DEST/crawler.py" bootstrap "$DATASET" --allow-private-capture
# Optional packages are not downloaded silently. HTML collection works immediately.
DEST="$DEST" PLIST="$PLIST" "$PYTHON" - <<'PY'
import os, plistlib
from pathlib import Path
dest=Path(os.environ['DEST'])
plist={'Label':'org.axom.pathways-crawler','ProgramArguments':[str(dest/'.venv/bin/python'),str(dest/'crawler.py'),'serve'], 'WorkingDirectory':str(dest),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':30,'StandardOutPath':str(dest/'data/service.log'),'StandardErrorPath':str(dest/'data/service-error.log'),'EnvironmentVariables':{'PYTHONUNBUFFERED':'1'}}
with open(os.environ['PLIST'],'wb') as f: plistlib.dump(plist,f)
PY
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/org.axom.pathways-crawler"
curl --fail --silent --retry 5 --retry-connrefused --retry-delay 2 http://127.0.0.1:5488/api/status
printf '\nInstalled. Dashboard: http://127.0.0.1:5488\n'
printf 'This Mac must remain awake and connected. The service starts at login, not before login.\n'
open http://127.0.0.1:5488

#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if [[ ! -f web/smash.wasm ]]; then bash tools/build_web.sh; fi
printf '%s\n' 'Open http://localhost:8000/'
exec python3 -m http.server 8000 --bind 127.0.0.1 --directory web

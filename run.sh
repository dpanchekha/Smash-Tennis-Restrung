#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if [[ ! -f web/smash.wasm ]]; then bash tools/build_web.sh; fi
printf '%s\n' 'Open http://localhost:8000/'
exec node lobby_server.js

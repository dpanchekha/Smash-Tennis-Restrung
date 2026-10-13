#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
export EMSDK_QUIET=1
source "${SMASH_EMSDK:-$HOME/emsdk}/emsdk_env.sh"
export EM_CACHE="$project_root/build/emcache"
emcmake cmake -S "$project_root" -B "$project_root/build/web" -DCMAKE_BUILD_TYPE=Release
cmake --build "$project_root/build/web" --parallel 4

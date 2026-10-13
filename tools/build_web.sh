#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
export EMSDK_QUIET=1
source "${SMASH_EMSDK:-$HOME/emsdk}/emsdk_env.sh"
export EM_CACHE="$project_root/build/emcache"
fresh=()
if [[ -f "$project_root/build/web/CMakeCache.txt" ]] &&
   ! rg -q -F "CMAKE_HOME_DIRECTORY:INTERNAL=$project_root" "$project_root/build/web/CMakeCache.txt"; then
  fresh=(--fresh)
fi
emcmake cmake "${fresh[@]}" -S "$project_root" -B "$project_root/build/web" -DCMAKE_BUILD_TYPE=Release
cmake --build "$project_root/build/web" --parallel 4

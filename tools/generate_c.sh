#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
engine=${SNESRECOMP_ROOT:-"$HOME/snesrecomp"}
if [[ ! -f "$engine/snesrecomp_cli.py" ]]; then
    printf '%s\n' 'Missing SNESRecomp source checkout. Obtain it with:' >&2
    printf 'git clone --recursive https://github.com/RetroPortingToolKit/snesrecomp.git %q\n' "$engine" >&2
    exit 1
fi
export PYTHONDONTWRITEBYTECODE=1
export SNESRECOMP_NATIVE_ANALYZER="$project_root/build/analyzer/release/snesrecomp-analyze"
cargo build --offline --locked --release \
    --manifest-path "$engine/recompiler-rs/Cargo.toml" \
    --target-dir "$project_root/build/analyzer"
python3 "$project_root/tools/inspect_rom.py" "$project_root/Smash Tennis (axekin.com).sfc"
if [[ -f "$project_root/recompiled/config/bank00.cfg" ]]; then
    python3 "$engine/snesrecomp_cli.py" generate \
        --rom "$project_root/Smash Tennis (axekin.com).sfc" \
        --project-root "$project_root/recompiled" \
        --cfg-dir config --out-dir generated --funcs-h config/funcs.h \
        --expected-crc32 6f7d1745 --no-host-root-scan
    exit
fi
python3 "$engine/snesrecomp_cli.py" build \
    --rom "$project_root/Smash Tennis (axekin.com).sfc" \
    --name 'Smash Tennis' --output "$project_root/recompiled"

# Smash Tennis

Run `./run.sh`, open **http://localhost:8000/**, and click **Start game**.
Enter starts the original game and confirms menus. Arrow keys move;
Z/X/A/S map to SNES B/A/Y/X, Q/W to L/R, right Shift to Select.
A standard gamepad is also supported. The page has only the start button and game.

The prebuilt `web/` directory is a standalone static site, including the supplied
ROM as `game.sfc`. Serve it over HTTP rather than opening index.html as a file.
The input ROM is unchanged.

Rebuild with `bash tools/build_web.sh`. It uses `$HOME/emsdk` (override with
`SMASH_EMSDK`) and puts caches inside this project. No SDL or downloads are needed.

The C host in `src/game_host.c` connects generated code to SNESRecomp's hardware
runtime. JavaScript presents pixels, queues PCM audio, and passes controller input;
the game executes in WebAssembly.

This is a hybrid static recompilation, not a fully decompiled, interpreter-free
source restoration. Dynamic or unresolved targets still use the interpreter.
Pixel-perfect equivalence to an original console has not been established.

Local runtime fixes implement PAL timing and the PAL region flag, select the
compatible renderer for Mode 5 menus, and preserve the 512-wide high-resolution
image. Low-resolution scanlines are doubled; the browser displays at 4:3.
Browser presentation converts the runtime's `0x00RRGGBB` pixels to opaque RGBA
with a packed store. This fixes the previous unmasked green/blue writes, which
clamped those channels to white and gave the entire game a cyan/gray cast.
WebAssembly builds use `-O3` and link-time optimization; game timing is unchanged.
The compiled task dispatcher at `$80:8895` lost seven stack bytes per menu frame
through its `$82:BC24` tail. The host interprets that boundary while keeping its
children eligible for C dispatch. This was tested against the interpreter path:
the main-loop stack remains at `$1FFB` rather than leaking into game memory.
Changes are confined to the copied runtime in this project.

`node tests/wasm_smoke.cjs 8 8 8:300 8:180 8:180` runs the browser WASM in Node,
checks frame execution and nonzero PCM audio, and writes captures under `build/`.
Optional `--interactive` accepts `buttonMask:idleFrames` commands. This tests the
binary, not browser audio devices or event delivery. The agent sandbox blocks
listening sockets and Chromium launch, so a real browser session must be tested
outside it.

Verified final build: 3,134 frames through title, menus, match setup, movement,
and serving, with stack checks and nonzero PCM audio. The optimized build ran
this route in 40.11 seconds versus 45.81 seconds before optimization in Node
(about 12% less runtime). All 14 captured frame hashes remained identical.
These timings exclude browser presentation and are not browser FPS guarantees.
Reproduce with:

```sh
SMASH_ASSERT_STACK=1 node tests/wasm_smoke.cjs 8 8 8:300 8:180 8:180 8:180 8:500 8:500 1:240 128:30:10 1:30 1:180
node tests/web_host.cjs
```

The second test uses DOM/audio mocks with the real WASM to verify the browser
host's loading, Start, exact RGBA channel conversion, audio scheduling, keyboard,
and focus-reset paths. Color cases include black, white, each primary, and mixed
colors using the same clamped pixel array as a browser.
It does not replace an actual browser test. Full matches and every court have
not been exhaustively validated.

Runtime license and attribution are retained in `recompiled/snesrecomp/` and
copied into `web/`. Hardware reference: [PPU registers](https://snes.nesdev.org/wiki/PPU_registers).

## Reconstruction details

Status: SNESRecomp generated 504 ahead-of-time CPU-state variants across five
ROM banks, with 23 interpreter-only variants. The C sources are in
`recompiled/generated/`, alongside the full analysis manifest.
The browser host now runs this generated code with hardware and interpreter support.
The original ROM has not been modified.

`src/reset_prefix.c` translates CPU addresses `00:8000` through `00:8027`,
preserving register effects and ordered bus accesses under the stated reset
preconditions. It does not implement timing, SNES hardware, or subsequent code.
Its test checks expected state and bus writes; it is not differential validation
against an emulator.

Inspect the exact ROM and test the translated prefix:

```sh
python3 tools/inspect_rom.py
gcc -std=c11 -Wall -Wextra -Werror -Isrc src/reset_prefix.c tests/reset_prefix_test.c -o /tmp/smash-reset-test
/tmp/smash-reset-test
```

## C generation

[SNESRecomp](https://github.com/RetroPortingToolKit/snesrecomp) supplies a
65816-to-C analyzer/emitter and a SNES hardware runtime. Its upstream source CLI
accepts `build --rom PATH --output DIRECTORY --name NAME`. Once the framework
is available locally, `bash tools/generate_c.sh` invokes that workflow with this
ROM and an output directory named `recompiled`. It checks the ROM hash first.
The default checkout is `$HOME/snesrecomp`; set `SNESRECOMP_ROOT` to override.
The analyzer is built offline into this project's `build/analyzer`, using
cached Cargo dependencies. The original framework checkout is not modified.
Subsequent runs regenerate the existing project.

Generation succeeded using the user's local checkout at revision
`e54427bad93fb75729ce8214fdd7a46e197e6223`.

```sh
bash tools/generate_c.sh
cmake -S recompiled -B build/recompiled -DCMAKE_BUILD_TYPE=Release
cmake --build build/recompiled --parallel 4
python3 tools/coverage.py
```

The build produces `build/recompiled/libsnesrecomp_game.a`, a C static library.
The generated code is a low-level translation of machine instructions, not
recovered original variable names or original developer source.

Eliminating all interpreter fallback and validating full-game equivalence remain
future reconstruction work. Regenerating existing C does not overwrite the
local runtime fixes; do not replace the copied framework with an unpatched tree.

Instruction reference: [WDC W65C816S datasheet](https://www.westerndesigncenter.com/wdc/documentation/w65c816s.pdf).

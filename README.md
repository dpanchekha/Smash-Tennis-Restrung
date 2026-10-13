# Smash Tennis

Run `./run.sh`, open **http://localhost:8000/**, and click **Start game**.
The game's mode menu offers Exhibition, Tournament, Multiplayer, and Option.
Multiplayer is implemented in `src/multiplayer.c`: it draws directly into the
game framebuffer and handles menu selection, username/code entry, the actual
20-character roster, and setup of an original 1P versus 2P exhibition match.
There is no separate HTML launcher menu. Enter starts the original game and
confirms menus. Arrow keys move;
Z/X/A/S map to SNES B/A/Y/X, Q/W to L/R, right Shift to Select.
A standard gamepad is also supported. Online, the first connected gamepad
controls your assigned player. Offline, a second gamepad controls player two.
For in-game text entry, type on the keyboard or choose letters with the D-pad
and SNES A (keyboard X). Start/Enter accepts; B deletes; Select/Escape goes back.
Lobby codes are case-insensitive, accept up to 48 printable ASCII characters,
and trim leading/trailing spaces. Usernames accept up to 20 characters.

Both players must open the same running server and enter the same code. Each
lobby admits exactly two players. Each browser keeps its existing game instance.
The host shares a one-time snapshot of its current native menu; both instances
continue from that state into the same singles exhibition and chosen characters,
compare their state, then start together. No second instance or intro replay is
needed. Original character/court setup still runs, so this is not an instant
jump into a match. This removes 722 simulated setup frames from the previous path
(the test pairing takes 1,816 instead of 2,538 frames; wall time varies by device).
Gameplay runs locally. Online play uses rollback with two frames of local input
delay (about 40 ms at this game's 50 Hz rate) and at most six unconfirmed frames
(about 120 ms). Missing opponent inputs repeat the last known buttons. When the
relay supplies the actual pair, C restores the earliest incorrect state and
replays it, at most two frames per browser callback. Longer delays pause forward
simulation until inputs catch up. Only confirmed states are compared every 120
frames; speculative differences are expected.

Replay keeps CPU, APU, sprite evaluation and HDMA running, but omits hidden pixel
composition. It discards replay-generated PCM and preserves the live audio queue
and resampler, so corrections do not play the same sound twice. A sound already
heard from a wrong prediction cannot be taken back. The separate browser audio
buffer remains 80 ms. Rollback can produce visible corrections and adds CPU work;
WebSocket relay transport still has ordered-delivery delays, and this is not a
guarantee of smooth play on every connection or device. Disconnections
return you to an in-game error screen with a route back to your saved local menu,
still inside the same instance. Online setup uses the host's current game state
and the default court selection. Tournament and doubles are
not offered by online setup.

Node.js 22+ runs the included lobby service. `./run.sh` listens on port 8000
on all interfaces (`HOST=127.0.0.1 ./run.sh` restricts it to this computer).
For internet play, host this service at a shared address; an HTTPS reverse
proxy must forward `/ws` WebSocket upgrades. A public deployment has not been
performed. Browsers require JavaScript for their WebSocket and Gamepad APIs;
JavaScript transports events while the C code owns the game UI and match flow.
Use HTTPS beyond localhost for browser controller access, and restart the Node
service after rebuilding so its game-version identifier matches the new files.

The prebuilt `web/` directory is a standalone static site, including the supplied
ROM as `game.sfc`. Serve it over HTTP rather than opening index.html as a file.
Offline play works with static hosting; online play requires the Node service.
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

Before the multiplayer change: 3,134 frames through title, menus, match setup, movement,
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

Multiplayer checks:

```sh
node tests/multiplayer_core.cjs
node tests/rollback.cjs
node tests/lobby_server.cjs
node tests/web_host.cjs
# Requires an installed playwright-core and Chromium:
node tests/multiplayer_browser.cjs
SMASH_TEST_JITTER=1 node tests/multiplayer_browser.cjs
```

The core test uses two real WASM instances with different menu histories, verifies
same-instance snapshot synchronization/restoration, the selected character
records, load/input barriers, and compares WRAM through 360 gameplay frames.
The rollback test compares both player seats against a lockstep oracle through
360 frames, including inputs arriving mid-replay, ring reuse, delayed inputs,
a long interruption, bounded stalls and final pixel equality. It reports local
Node timing, not browser or device performance guarantees. The jitter browser
variant delays authoritative inputs by 70 ms with a 240 ms burst.
The server test checks capacity, shared codes, readiness, ordering, mismatches,
disconnects, and partial WebSocket headers. The browser test drives two Chromium
pages through the C menus and lobby into synchronized play. Set `SMASH_PLAYWRIGHT`
to an installed playwright-core module and `SMASH_CHROMIUM` to an existing browser
executable if they are not available through the default paths. Controller
mapping is tested with simulated Gamepad API data, not a physical controller.

Runtime license and attribution are retained in `recompiled/snesrecomp/` and
copied into `web/`. Hardware reference: [PPU registers](https://snes.nesdev.org/wiki/PPU_registers).

## Reconstruction details

### Character data

`character_stats_mined.csv` is the readable, ROM-mined character matrix.
`character_shot_profiles_mined.csv` preserves full shot parameters and ROM
locations; `character_stats_mined.md` explains the mappings, units, and limits.
Verify them with `node tools/mine_character_stats.cjs --check`.
`character_stats_original.csv` is the unchanged lossless record backup.
Do not confuse these with `character_ratings.csv`, which only transcribes the
user-provided image and is not mined data. No character modifications are applied.

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

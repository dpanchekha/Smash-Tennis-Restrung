# Original character data — verification and limitations

Update: the subsequent investigation in `character_stats_mined.md` establishes
named shot mappings and movement/trait fields. Use `character_stats_mined.csv`
for the readable mined sheet. This original byte backup remains unchanged;
the investigation notes below record what was known when it was first made.

`character_stats_original.csv` is a **lossless raw record export**, not a fully
decoded table of named stats. No gameplay values or arithmetic were changed.
Unknown fields are named by byte offset rather than assigned speculative meanings.
All numeric byte values are unsigned decimal storage values, not normalized
ratings; a signed or fixed-point interpretation may apply at individual consumers.

## Source and coverage

- Original ROM SHA-256:
  `09fdef0c959e7275563f65d8267d95a20104f054e9438e9ac739ef7f46120a2d`.
- Both `Smash Tennis (axekin.com).sfc` and deployed `web/game.sfc` still match.
- The 26 little-endian pointers at file offset `0x8000` select 55-byte records
  starting at `0x806B`, with stride `0x37`. The CSV preserves all 1,430 bytes,
  including name/identity/graphics-related bytes, not just gameplay parameters.
- The normal selection screen supplies the 20 names in row-major order. An
  analysis-only runtime probe observed cursor indices 0, 2, 4, 5 while moving
  Mike → John → Matt → Mark; confirming Mark wrote 5 to WRAM `0x0110`.
- Six additional table records are included with blank names. Their identities
  and availability are unverified; they must not be presented as six confirmed
  additional playable characters. The unindexed block at `0x8034` is not one of
  these 26 records and its purpose remains unknown.
- The runtime copy at WRAM `0x8000..0x8600` matched the original ROM byte for byte
  on the character-selection screen.

These findings use ordinary ROM/source inspection and an analysis-only WASM
probe, not REA-generated evidence; REA was unavailable in this session.

## Code evidence

Addresses below are SNES bank:address; file offsets use this ROM's LoROM mapping.

- `82:8D16`: copies `81:8000..87FF` into `7E:8000..87FF` (also present in
  `recompiled/generated/bank82_part01_v2.c`, label `L_8D16_M0X0`).
- `81:A0D8`: initialization resolves selection at `0110,X` through the pointer
  table and stores the selected record pointer at player field `1074,Y`.
- `81:B0ED/B0F5/B0FD/B105`: return record offsets `17/1B/1F/23` respectively.
  For example `B9 74 10 18 69 17 00 60` loads the record pointer, adds `0x17`,
  and returns. `81:B189/B193` similarly return offsets `0F/13`.
- `81:B35F`: `48 AA BF 00 00 7E 85 30` loads the selected shot profile into
  direct-page location `30`. `81:B390` calls `80:8B49`.
- `80:8B49` begins `08 E2 20 A5 30 8F 02 42 00`: save flags, select 8-bit
  accumulator, load byte `30`, write the SNES multiply input `$4202`.
  The second multiplier input comes from byte `32`, written to `$4203`.
  Therefore the first shot-profile parameter is consumed as a single byte.
- Debug strings at file `0x8DB5` mention individual forehand/backhand A/B,
  shared profiles, volleys, smashes, and service A/B. A complete mapping from
  those labels to every field has **not** been verified. Do not infer one
  universal hitting-power stat from this export.

## Mike and the requested edit

Mike is record 0 at file offset `0x806B`. The six character-specific shot
profiles begin at the following record-relative offsets:

| Profile offset | First parameter, original raw byte |
| --- | ---: |
| `0x0F` | 95 |
| `0x13` | 61 |
| `0x17` | 73 |
| `0x1B` | 57 |
| `0x1F` | 56 |
| `0x23` | 49 |

The storage range of each such byte is 0–255; that is **not** a guarantee that
every value in that range is sensible or safe for gameplay. `1,000,000` cannot
be represented by a stat-only edit. Its low byte would be 64, which would not
implement the request. Writing additional bytes would overwrite neighboring
parameters. Neither was done. A replacement value and an unambiguous target
profile are still needed before any patch can be applied.

## Verification and future restoration

Run `node tools/export_character_stats.cjs --check` to verify every exported
byte and record hash against the original and confirm the deployed ROM matches.
The exporter refuses a ROM with a different full-file hash.
The CSV's file offset plus column offset identifies every original byte, and
each row includes a SHA-256 of the complete record. Preserve the original ROM
unchanged for a future patch/revert workflow. No revert is needed now.

`tools/probe_character_records.cjs` uses a separately linked diagnostic build
under `build/stats-probe.js` exposing `g_ram`; production `web/smash.js` and
`web/smash.wasm` were not rebuilt or changed for this investigation. Probe logs
and snapshots are under `build/character-*`.

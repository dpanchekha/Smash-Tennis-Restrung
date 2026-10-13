# Character stats mined from the actual game

## Files and scope

- **character_stats_mined.csv**: readable matrix with categories down the left
  and all 20 normal-roster characters across the top, like the supplied chart.
- **character_shot_profiles_mined.csv**: 380 resolved profile rows, including
  conditional/shared variants, all four parameters, selector values, exact ROM
  locations, and original bytes.
- **tools/mine_character_stats.cjs**: reproducible extractor. It reads only the
  original ROM, not `character_ratings.csv` or the supplied image.

These files supersede the image transcription **as the mined statsheet**.
The transcription and original raw-record backup remain separate and unchanged.
No game data, runtime arithmetic, production JavaScript, or WebAssembly changed.
The earlier requested Mike edit remains unapplied.

ROM SHA-256:
`09fdef0c959e7275563f65d8267d95a20104f054e9438e9ac739ef7f46120a2d`.
Addresses below are SNES addresses unless explicitly called file offsets.
For bank 81 in this LoROM, the address's low word also equals the file offset.

## How to read the matrix

There is no verified universal 1–10 rating or overall rank in these records.
Values therefore retain the game's actual scale. A slash separates parameters,
**not** a fraction or score out of a maximum.

- **Speed**: horizontal / vertical movement coefficients. Each is a byte.
  Base movement steps are also given as internal coordinate units per movement
  update, separately for the two court sides. These are not screen pixels/sec,
  an averaged speed rating, or a guarantee of speed in every animation/state.
- **Serve, forehand, backhand, volley, smash**: A / B power coefficients.
  A/B are the game's internal shot labels. These are the initial coefficients
  entering the velocity calculation, not measured ball speed or overall quality.
  Court position, aim, directional input, trajectory and timing also matter.
- **Lob**: forehand / backhand coefficients, not A/B. This label is a behavioral
  inference from the dedicated input path and high-arc profiles, not literal
  debug text. Profile addresses and numbers are exact regardless of that label.
- **Volley low B** and **Smash timed A** expose conditional alternatives rather
  than hide them inside a single rating. Shared forehand/backhand profiles are
  included because not every shot uses a character-specific profile.
- **Diving**: the exact enable byte with a high-confidence behavioral label;
  it gates the directional special-action state with temporary movement speeds.
- **Amplitude**: numeric span of the base horizontal target table in singles,
  side 0 / side 1. This is a precise, limited proxy for aiming width—not final
  ball dispersion or a transcription of the chart's “Wide/Narrow/Hiro” labels.
  Doubles, ball position, swing timing and other corrections change targeting.
- **Handedness**: the byte that mirrors sprites and the forehand/backhand side
  test. `0=right`, `1=left`.
- **Unique moves**: unresolved. Swing/profile differences exist, but no universal
  unique-move flag or complete special-move classification has been established.

The detailed profile CSV additionally includes:

| Field | Game interpretation |
| --- | --- |
| power_coefficient_u8 | Unsigned 8-bit input to shot-speed calculation |
| initial_vertical_coefficient_s8 | Signed 8-bit vertical launch coefficient |
| initial_vertical_velocity_raw | Signed coefficient multiplied by 16 |
| initial_vertical_deceleration_u8 | Initial per-update subtraction from vertical velocity |
| falling_vertical_deceleration_u8 | Replacement subtraction after the downward crossing, on the traced normal path |

The latter two fields are actual vertical-physics coefficients, not guessed
“spin,” “accuracy,” or “control” ratings. A higher value is not universally better.

## Evidence: records and movement

The 26-pointer table at file `0x8000` selects 55-byte records starting at
`0x806B`. The first 20 map to the normal roster; the other six remain in
`character_stats_original.csv` without invented names. The 20-name ordering
was established from the game's selection screen and cursor/selection memory,
not its chart ratings (see the original-record notes).

`82:8D16` copies ROM `81:8000..87FF` to WRAM `7E:8000..87FF`.
Initialization at `81:A0D8` resolves selection `$0110` to a record pointer
stored in player field `$1074`.

| Record byte | Load site | Runtime use |
| --- | --- | --- |
| `+0D` | `81:A0E9..A0F5` | `byte*16 → player[101E]`, horizontal step |
| `+0E` | `81:A0F8..A104` | `byte*16 → player[1022]`, vertical step |
| `+0A` | `81:A120..A123` | `player[100C]`, handedness/mirroring |
| `+30` | `81:A154..A157` | `player[1082]`, directional special-action enable |
| `+31` | `81:A15A..A15D` | `player[1084]`, aiming-table selector |

For side 1, `81:A107..A11B` subtracts one original byte from each step, giving
`byte*15` instead of `byte*16`. Movement at `81:AA49..AA73` and `AA8B..AACB`
adds/subtracts these values to 24-bit fixed-point coordinates; the lowest byte
is fractional, so reported coordinate steps divide these raw values by 256.
Other states can replace or increase speeds (`81:AE4E..AE63`, `A9AB..A9BE`).

`81:ADDA/ADF5` gate the directional action on `$1082`; the enabled path reaches
`AE4E..AE7E`, saves/restores movement speeds and enters state `0C`.
`81:B959..B989` uses `$100C` to reverse the forehand/backhand side test; sprite
code branches on it at `81:8720`.

`81:B1B0` uses `$1084` to add `0x20` to a table index. The four little-endian
target values at file `0xB207 + (flag?32:0) + (side?8:0)` give the singles
base target span (`max-min`): flag 0 yields `120/144`, flag 1 yields `96/132`.
The ball-position term and swing corrections are applied separately at
`81:B1C4..B203`. This is why the sheet doesn't claim final shot spread.

## Evidence: named shot profiles

The game itself contains spaced ASCII debug labels at `81:8DB5`. The renderer
at `81:8D4E..8D5A` maps shot ID `$10B8` to these labels through `81:8D85`,
subtracting `0x14` for IDs `>=0x3C`. This establishes the named shot mapping
that was still unverified in the earlier raw-record investigation.

| Category | IDs | Profile file offset formula |
| --- | --- | --- |
| Serve A/B | `40/42` | `record+0F / record+13` |
| Character forehand A/B | `00/02` | `record+17 / record+1B` |
| Character backhand A/B | `04/06` | `record+1F / record+23` |
| Shared forehand A/B | `08/0A` | `8601 / 8605` |
| Shared backhand A/B | `0C/0E` | `8609 / 860D` |
| Volley A | A variants in `10..26` | `8631 + 4*record[2C]` |
| Volley B, height >=14 | B variants in `10..26` | `8645 + 4*record[2C]` |
| Volley B, height <14 | forehand/backhand | `8611 / 8621 + 4*record[2B]` |
| Lob forehand/backhand | `38/3A` | `8661 / 8671 + 4*record[2D]` |
| Smash A/B | `3C/3E` | `8681 / 8691 + 4*record[2E]` |
| Timed smash A | alternate `3C` | `86A1 + 4*record[2F]` |

All numbers in the table except the decimal height threshold are hexadecimal.
Each selected profile consists of four bytes. The dispatch table at `81:B061`
and routines `81:B0A9..B19C` implement these formulas. The special smash path
at `B15E` tests unsigned `(player[1088]-8)<4`; it has other state effects, so the
alternate profile is not claimed to be an unconditional upgrade.
The lob path tests input bit `0040` at `AC89`, sets IDs `38/3A` at `ACFB..AD08`,
and selects the high-arc tables through `B151/B156`.

`81:B35F` loads profile bytes into direct page `$30`. `80:8B49` consumes the
low byte through the SNES 8-bit multiplier input `$4202`. `81:B35F..B435`
then applies position/aim/directional factors and writes velocity `$1422`.
`81:B439..B466` sign-extends profile byte 1 after multiplying it by 16 and
writes vertical velocity `$1426`. `B468..B479` writes bytes 2 and 3 to
`$0126/$0128` and `$012A`. Physics at `81:9239..9253` subtracts `$0126`
and on the traced downward crossing replaces it with `$012A`.

## Validation and limits

Run:

```sh
node tools/mine_character_stats.cjs --check
node tools/export_character_stats.cjs --check
node tests/mined_stats_runtime.cjs
```

The first two verify ROM identity, exported values, record addresses, opcode
guards, debug-label/dispatch mappings, and unchanged deployed ROM contents.
The runtime test uses the separate `build/stats-probe.js` diagnostic build
with an exported `g_ram`, not the deployed game. Its match-setup run confirmed
Mike's two player instances have horizontal/vertical raw steps `608/224`
(side 0) and `570/210` (side 1), and matching handedness/diving/aim flags.
This is runtime corroboration for those loads, **not** a claim that every
profile for all 20 characters was executed or every rally outcome validated.

The extractor covers the named categories and conditional profiles described
above, not every animation, AI parameter, special-case override or game mode.
No chart-derived ranking, aggregate rating, invented units, or statistical
averages are used. Evidence comes from ROM code/data and the local runtime
probe; REA was unavailable, so these are not REA Evidence IDs.

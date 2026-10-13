# Readable character ratings

For actual ROM-mined values, use `character_stats_mined.csv` and its companion
notes instead. This file describes only the earlier image transcription.

`character_ratings.csv` transcribes the user-supplied statsheet image. It contains
all 20 displayed characters and preserves the chart's ratings, ranks, diving,
amplitude, handedness, and unique-move annotations. A blank unique-move cell
means no annotation in the chart, not independent verification of its absence.
“Hiro” and the move labels are retained as displayed, without inventing meanings.

These are chart ratings, **not verified internal ROM stat values**. The chart
attributes ranks to a Japanese forum but does not provide a source URL or a
formula relating its ratings to the game data. No scaling formula is assumed.
The chart compares male and female category averages separately and ranks all
characters together; its category averages and cell colors are not individual
character stats and are omitted from this CSV.

`character_stats_original.csv` remains the byte-exact original record backup.
No ROM, game stat, executable, or arithmetic was changed to produce this sheet.

To establish an editable, ROM-verified version of these categories, the remaining
work is to trace each category to its parameter(s), verify shot-profile labels,
and determine whether the chart ratings are calculated or subjective. A chart
rating such as Mike's forehand 9 must not be written directly into an unidentified
ROM field. Mike's requested 1,000,000 edit remains unapplied.

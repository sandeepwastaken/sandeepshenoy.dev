# Tidal Wave — Progress Dashboard

A Monkeytype-inspired dashboard showing every attempt on Tidal Wave
(Geometry Dash Extreme Demon, ID `86407629`).

## Files

- `index.html` — the dashboard (self-contained, one page)
- `attempts.json` — parsed attempt data (regenerate with the script below)
- `parse_apx.py` — reads the game's `.apx` file and writes `attempts.json`
- `86407629_attempts.apx` — a copy of the game's save file (do not touch the
  game's own copy in `~/Library/Application Support/GeometryDash/geode/mods/
  manshoety.attemptplayback/attempts/`)

## Refreshing your progress

After playing more attempts, re-run the parser:

```bash
python3 parse_apx.py
```

It re-copies the game's `.apx` file (read-only), decodes the ATT3 chunks,
and rewrites `attempts.json`. Refresh the page to see new dots.

## What's plotted

- **Dots** — each attempt's endpoint (%). Left = earliest, right = newest.
- **Rolling averages** — 2 / 10 / 100 attempts (toggle in the header).
- **PB dashed line** — your personal best, drawn across the whole chart.
- **`hide below` slider** — filters out low-% attempts so the trend lines
  reflect only meaningful runs.

## Format reference

The `.apx` format is documented in the mod source at
<https://github.com/manshoety/AttemptPlaybackMod/blob/main/src/core/apx_io.cpp>.
Only the per-attempt `ATT3` chunk prefix + V1/V2 tail are decoded here — the
frame streams are skipped so parsing stays fast on multi-MB files.

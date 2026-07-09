---
name: college-radio-matcher
description: Build a focused college and non-commercial radio candidate list for a specific release using a licensed or user-supplied directory, then verify current fit and submission rules before outreach. Works across genres and pairs with college-radio-outreach.
---

# College Radio Matcher

Turn one song or release into a ranked station candidate list, then verify every send-first target against current public evidence.

RunnerOS does not redistribute the commercial contact directory. Pass a licensed/user-owned JSON file with `--data`, or set `COLLEGE_RADIO_DIRECTORY`. See `data/README.md` for the import contract.

## Intake

Use known Artist HQ and campaign context first. Collect only what is missing:

- genre/subgenre and vibe
- 2–5 honest sound-alikes
- single, EP, or album
- clean/explicit status and clean-edit availability
- hometown city/state or province
- tour-market cities/states or provinces
- links-only versus physical-format availability

## First-pass matching

```bash
python3 "$HOME/.agents/skills/college-radio-matcher/match.py" \
  --data /path/to/stations.json \
  --home-state CA \
  --home-city "Los Angeles" \
  --market-states OR,WA \
  --market-cities "Portland,Seattle" \
  --genre hip-hop \
  --release single \
  --explicit \
  --links-only \
  --format json
```

The matcher:

- validates input and fails on invalid/dependent flags
- skips invalid station records
- merges duplicate call-sign/city identities conservatively
- filters single/albums-only and explicit/positive-only conflicts
- requires a usable digital path for `--links-only`
- gates clearly mismatched jazz/classical/Christian/news-talk specialists unless explicitly overridden
- ranks exact hometown/tour cities above broad state matches
- preserves rules and emits match rationale
- labels every result `directory_only`, never verified

Use `--clean-edit` only with `--explicit`. Use `--include-unverified-specialists` only when the user wants those candidates reviewed manually.

## Verification pass

For the strongest candidates, check current public station evidence:

1. Confirm the station and relevant music/local/specialty show still operate.
2. Confirm the current website, schedule, contact, and submission instructions.
3. Confirm the release genuinely fits the show or station.
4. Record evidence URL, checked date, submission method, restrictions, and confidence.
5. Drop stale, conflicting, or unverifiable candidates from the send-first tier.

Never infer fit from an old directory tag alone. Never invent a contact, show, relationship, or airplay history.

## Output

Return:

`rank | station/show | city | why it fits | current evidence | checked at | submission path | contact | rules | confidence`

Then include:

- send-first tier
- directory-only research queue
- rules watch-list
- dropped targets and reason
- exact handoff fields for `college-radio-outreach`

The matcher selects and verifies candidates. It does not contact stations.

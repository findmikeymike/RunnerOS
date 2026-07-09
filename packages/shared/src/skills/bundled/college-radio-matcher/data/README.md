# College Radio directory

The bundled directory contains station data in JSON/CSV plus a bonus tastemaker list.
`match.py` reads `stations.json` by default. An updated JSON array can override it with `--data`
or `COLLEGE_RADIO_DIRECTORY`.

Station fields:

- required: `id`, `station`, `country`, `state`, `city`
- recommended: `school`, `emails`, `music_director`, `website`, `phone`, `address`
- matching: `genre_hints`, `submission_methods`, `submission_url`, `flags`, `station_type`, `outreach_ease`, `notes_raw`

Directory records are always labeled `directory_only` until the agent verifies current public evidence.

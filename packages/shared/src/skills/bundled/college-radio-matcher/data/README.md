# Directory import

RunnerOS does not redistribute the commercial station contact directory.

Provide a licensed or user-owned JSON array with:

- required: `id`, `station`, `country`, `state`, `city`
- recommended: `school`, `emails`, `music_director`, `website`, `phone`, `address`
- matching: `genre_hints`, `submission_methods`, `submission_url`, `flags`, `station_type`, `outreach_ease`, `notes_raw`

Run the matcher with `--data /path/to/stations.json` or set `COLLEGE_RADIO_DIRECTORY`.
Directory records are always labeled `directory_only` until the agent verifies current public evidence.

---
name: prosody
description: >-
  Find rhymes and fit words to a rhythm — the SOUND layer of songwriting. Use when a writer needs
  rhymes (perfect OR slant/near), a word that fits a syllable/stress pocket, help counting
  syllables or scanning a line's meter, or a fresher rhyme than the cliché. Trigger on: "what
  rhymes with ___," "I need a slant rhyme for ___," "give me a near rhyme," "does this line fit,"
  "how many syllables," "this rhyme is too obvious," "what sings better here." Runs a deterministic
  CMUdict engine (exact, free, no token waste) for the computable work, then applies TASTE — which
  candidate sings, fits the pocket, isn't a cliché, matches the feel. Especially good at slant /
  near rhymes. Pairs with impact-phrases (the punch) and hook-writer. Do NOT use to write the whole
  lyric or melody.
---

# Prosody — the sound layer

Rhyme and meter are **computable phonetic facts**, not judgment calls — so don't reason them out
token by token (you'll miscount and hallucinate rhymes). Call the engine, then spend your
attention on the part only taste can do: which rhyme actually *sings*.

## Division of labor (this is the whole design)

- **The engine computes** (free, exact, zero tokens for the heavy part): perfect rhymes, slant /
  near rhymes, syllable counts, stress patterns, meter — all from CMUdict via `rhyme_engine.py`.
- **You (the agent) taste**: from the engine's pre-ranked shortlist, pick the ones that sing, fit
  the emotional register and the rhythmic pocket, and aren't clichés. You also cover what the
  dictionary can't: slang / coined / proper-noun words, compound and multi-word rhymes, and
  sung-vowel bends (rap especially forces rhymes that don't rhyme on paper).

## Running the engine

Setup once: `pip install pronouncing wordfreq` (wordfreq filters junk/proper-noun rhymes; the
engine still runs without it, just noisier).

```
python3 engine/rhyme_engine.py rhymes WORD [--type perfect|slant|all] [--syllables N] [--max N] [--json]
python3 engine/rhyme_engine.py scan "a whole line of lyric"      # syllables + stress + last word
python3 engine/rhyme_engine.py fit  "a line" --meter x/x/x/      # rough stress-fit check
```

Use `--json` when you want the raw shortlist to rank silently; use plain output when showing the
writer. **Filter to the pocket at the engine level** (`--syllables N`) so you're only tasting
candidates that already fit — that's the token-saving move: let the engine prune, then you judge a
small set, never the whole dictionary.

Typical flow:
1. Get the target word (the line-ender the writer wants to rhyme) and, if known, the **syllable
   count / stress** the slot needs — run `scan` on the line to get it.
2. Call `rhymes WORD --syllables N` for perfect + slant.
3. **Taste-pass the shortlist** and hand back a tight, curated set (see below), leading with the
   freshest that still sings.

## The taste pass — what to actually return

Don't dump the engine's list. Curate to a handful, grouped and annotated:

- **Lead with slant when the obvious perfect rhyme is a cliché.** The writer specifically wants
  help here. If the perfect rhyme is `fire/desire`, offer the slant that keeps the vowel but
  dodges the wallpaper (`fire → quiet, tired, spiral, wildfire`), and say why.
- **Fit the pocket.** Only offer words that match the syllable count and, ideally, the stress
  pattern of the slot. A rhyme that won't scan is useless.
- **Match the register / emotion.** A tender ballad and a hard rap want different words from the
  same rhyme family. Read the song and pick accordingly.
- **Flag the cliché, offer the fix.** Check candidates against the cliché-rhyme list in
  `engine/reference.json` (fire/desire, heart/apart, love/above, girl/world…). If they're heading
  for one, say so plainly and hand them a fresher partner or a slant.
- **Prefer open, singable vowels on the words that ring.** For a held or belted line-ender, favor
  ah/oh/ay/eye/oo endings; note when a candidate lands on a tight vowel or a hard stop that will
  choke a sustain. (See `sung_vowels` in the reference.)

Name the rhyme *type* when it helps the writer choose — "that's a slant (assonance): same vowel,
softer landing." The reference has the vocabulary (perfect, slant, assonance, consonance,
multisyllabic, feminine/masculine, identity, eye, forced).

## Slant / near rhymes (the writer's favorite part)

The engine returns slant candidates tagged `assonance` (same vowel, different coda), `consonance`
(same coda, different vowel), or `near` (both close). Use them to:
- **Unstick a dead-end word** the dictionary has no good perfect rhyme for (`orange → sponge,
  plunge, challenge, lunch`).
- **Keep honesty over neatness** — a slight mismatch often feels more true than a too-perfect click.
- **Widen the palette** so the writer isn't forced into the one obvious pair.

Cover the engine's blind spots by ear: multi-word rhymes ("closer / ghost of her"), coined words,
and pronunciations bent for a genre. When a word isn't in the dictionary the engine says so —
approximate it by ear and say you're doing that. **Drop proper nouns / brand names** (CMUdict has
no part-of-speech, so a "heart" query may surface "Walmart, Bogart" — silently cut them unless the
writer actually wants a name in the line).

## Meter & fit

`scan` gives a line's syllable total and per-word stress (1 = stressed, 0 = unstressed). Use it to:
- Match a new line to the syllable count and stress shape of an existing one (so it sings in the
  same pocket).
- Spot where a stressed syllable lands on a weak beat (the line "trips") and suggest a swap.
Keep melody to the artist — you're fitting the *words'* rhythm, not writing the tune.

## Honest limits

CMUdict is **spoken** English: sung vowels bend, so treat sung-vowel guidance as taste; it's
**English-only**; and slang/names/coined words fall to your ear, not the dictionary. Say so when
it matters rather than pretending the engine is the last word.

## Working with the other tools

**prosody** (sound) sits under the whole toolkit: **impact-phrases** gives the punch and its rhyme
family, **References** the color, **The Excavator** the idea, **hook-writer** the build. When a
writer is choosing a line-ender or fixing a rhyme, this is the tool; hand back to hook-writer to
seat it in the hook.

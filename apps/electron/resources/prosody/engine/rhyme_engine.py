#!/usr/bin/env python3
"""Rhyme & meter engine — deterministic phonetics via CMUdict (`pronouncing`),
frequency-filtered with `wordfreq` so junk/proper-nouns don't pollute results.

Does the computable work (rhymes, slant rhymes, syllables, stress, meter) so the agent
spends tokens only on taste. Prints a compact, pre-ranked shortlist.

Install:  pip install pronouncing wordfreq
Usage:
  rhyme_engine.py rhymes WORD [--type perfect|slant|all] [--syllables N] [--max N]
                              [--min-freq Z] [--json]
  rhyme_engine.py scan "a whole line of lyric"          # syllables + stress + last word
  rhyme_engine.py fit  "a line" --meter x/x/x/          # rough stress-fit check

Perfect rhymes already capture rich/multisyllabic rhymes (they match from the last
stressed vowel). Slant = the ear-rhymes beyond that. Compound / multi-word rhymes and
sung-vowel bends are left to the agent's taste layer. CMUdict has no part-of-speech, so
a few proper nouns/brand names may still surface — the agent drops those unless intended.
"""
import sys, json, argparse, re
import pronouncing as P
try:
    from wordfreq import zipf_frequency
    def freq(w): return zipf_frequency(w, "en")
    HAVE_FREQ = True
except Exception:
    def freq(w): return 5.0   # neutral if wordfreq missing (no filtering)
    HAVE_FREQ = False

VOWELS = set("AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW".split())
MANNER = {}
for c in "P B T D K G".split(): MANNER[c] = "stop"
for c in "F V TH DH S Z SH ZH HH".split(): MANNER[c] = "fric"
for c in "CH JH".split(): MANNER[c] = "affr"
for c in "M N NG".split(): MANNER[c] = "nasal"
for c in "L R".split(): MANNER[c] = "liquid"
for c in "W Y".split(): MANNER[c] = "glide"

def bare(ph): return re.sub(r"\d", "", ph)
def phones(word):
    p = P.phones_for_word(word.lower()); return p[0] if p else None

def anchors(ph):
    """Return the two rhyme anchors: the last STRESSED vowel (+tail) — the ear's main anchor —
    and the FINAL syllable vowel (+coda). Also whether the final vowel is stressed."""
    toks = ph.split()
    vidx = [i for i, t in enumerate(toks) if bare(t) in VOWELS]
    if not vidx: return None
    fi = vidx[-1]
    fv = bare(toks[fi]); fstress = toks[fi][-1] in "12"; fcoda = [bare(t) for t in toks[fi+1:]]
    st = [i for i in vidx if toks[i][-1] in "12"]
    si = st[-1] if st else fi
    sv = bare(toks[si]); stail = [bare(t) for t in toks[si+1:]]
    return {"fv": fv, "fstress": fstress, "fcoda": fcoda, "sv": sv, "stail": stail}

def coda_score(c1, c2):
    if c1 == c2: return 3
    s = 0
    for a, b in zip(reversed(c1), reversed(c2)):
        if a == b: s += 2
        elif a in MANNER and MANNER[a] == MANNER.get(b): s += 1
    return s - abs(len(c1) - len(c2))

def tail_sim(t1, t2):
    """Align tails so one added consonant is a near match (town / sound)."""
    if not t1 and not t2: return 2
    previous = [-j for j in range(len(t2) + 1)]
    for i, a in enumerate(t1, 1):
        current = [-i]
        for j, b in enumerate(t2, 1):
            similarity = (2 if a == b else
                          1 if a in MANNER and MANNER[a] == MANNER.get(b) else -2)
            current.append(max(previous[j - 1] + similarity,
                               previous[j] - 1, current[j - 1] - 1))
        previous = current
    return previous[-1]

_ALL = None
_RHYMES = None

def rhyme_key(ph):
    # Primary and secondary stress can rhyme (town / breakdown).
    return tuple(bare(t) for t in P.rhyming_part(ph).split())

def all_words():
    global _ALL, _RHYMES
    if _ALL is None:
        P.init_cmu()
        seen = {}
        rhymes = {}
        for w, ph in P.pronunciations:
            if not re.fullmatch(r"[a-z]+(?:[-'][a-z]+)*", w): continue
            if not any(c in "aeiouy" for c in w): continue
            seen.setdefault(w, set()).add(ph)
            rhymes.setdefault(rhyme_key(ph), {}).setdefault(w, set()).add(ph)
        _ALL = {w: tuple(sorted(phs)) for w, phs in seen.items()}
        _RHYMES = rhymes
    return _ALL

def perfect_matches(word):
    """Matching pronunciations, including every reading of the selected word."""
    all_words()
    matches = {}
    for ph in P.phones_for_word(word.lower()):
        for w, phs in _RHYMES.get(rhyme_key(ph), {}).items():
            if w != word.lower(): matches.setdefault(w, set()).update(phs)
    return matches

def slant_score(T, W):
    # Anchor at the stressed vowel, never just an unstressed final syllable.
    # Shared vowels need some supporting tail similarity; longer tails must
    # match proportionately so a final consonant cannot outweigh a weak anchor.
    if (T["sv"] == W["sv"]
            and sum(t in VOWELS for t in T["stail"])
                == sum(t in VOWELS for t in W["stail"])):
        similarity = tail_sim(T["stail"], W["stail"])
        threshold = max(1, max(len(T["stail"]), len(W["stail"])) - 1)
        if similarity >= threshold:
            return 3 + similarity, "assonance"
    # Different vowels need an exact consonant cluster at a stressed ending.
    # A single F (enough / sheriff) or N (town / in) is not enough evidence.
    if (T["fstress"] and W["fstress"]
            and T["fcoda"] == W["fcoda"] and len(T["fcoda"]) >= 2):
        return 3, "consonance"
    return None

def slant(word, want_syll=None, max_n=40, min_freq=3.4):
    targets = [anchors(ph) for ph in P.phones_for_word(word.lower())]
    targets = [t for t in targets if t]
    if not targets: return []
    perfect_set = set(perfect_matches(word)); wl = word.lower()
    out = []
    for w, pronunciations in all_words().items():
        if not w.isalpha() or not any(c in "aeiouy" for c in w): continue
        if w == wl or w in perfect_set: continue
        if len(wl) >= 4 and (wl in w or w in wl): continue
        frequency = freq(w)
        if frequency < min_freq: continue
        best = None
        for wph in pronunciations:
            W = anchors(wph)
            if not W: continue
            syl = P.syllable_count(wph)
            if want_syll and syl != want_syll: continue
            for T in targets:
                match = slant_score(T, W)
                if match is None: continue
                base, kind = match
                score = base + 0.25 * frequency - 0.1 * syl
                candidate = (score, w, syl, P.stresses(wph), kind)
                if best is None or candidate > best: best = candidate
        if best is not None: out.append(best)
    out.sort(key=lambda x: (-x[0], x[2], x[1]))
    return out[:max_n]

def perfect(word, want_syll=None, max_n=40, min_freq=2.6):
    res = []
    for w, pronunciations in perfect_matches(word).items():
        frequency = freq(w)
        if frequency < min_freq: continue
        if want_syll and not any(P.syllable_count(ph) == want_syll for ph in pronunciations): continue
        res.append((w, round(frequency, 2)))
    res.sort(key=lambda x: (-x[1], x[0]))
    return [w for w, _ in res[:max_n]]

def do_rhymes(a):
    word = a.word; ph = phones(word)
    res = {"word": word, "in_dictionary": bool(ph), "freq_filter": HAVE_FREQ}
    if not ph:
        res["note"] = "Not in CMUdict (slang/name/coined) — agent should approximate by ear."
        print(json.dumps(res) if a.json else f"'{word}' not in dictionary — approximate by ear.")
        return
    res.update({"phones": ph, "syllables": P.syllable_count(ph),
                "stress": P.stresses(ph), "rhyming_part": P.rhyming_part(ph)})
    if a.type in ("perfect", "all"):
        res["perfect"] = perfect(word, a.syllables, a.max)
    if a.type in ("slant", "all"):
        res["slant"] = [{"word": w, "syllables": s, "stress": st, "kind": k}
                        for _, w, s, st, k in slant(word, a.syllables, a.max, a.min_freq)]
    if a.json:
        print(json.dumps(res, ensure_ascii=False)); return
    print(f"{word}  [{ph}]  {res['syllables']} syl, stress {res['stress']}")
    if "perfect" in res: print("  PERFECT:", ", ".join(res["perfect"]) or "(none — try slant)")
    if "slant" in res: print("  SLANT:  ", ", ".join(d["word"] for d in res["slant"]))

def do_scan(a):
    words = re.findall(r"[A-Za-z']+", a.line)
    total = 0; stress = []; missing = []
    for w in words:
        ph = phones(w)
        if ph: total += P.syllable_count(ph); stress.append(P.stresses(ph))
        else: missing.append(w)
    out = {"line": a.line, "syllables": total, "stress_by_word": stress,
           "missing": missing, "last_word": words[-1] if words else None}
    print(json.dumps(out, ensure_ascii=False) if a.json else
          f"~{total} syllables | stress {' '.join(stress)}" + (f" | not-found: {missing}" if missing else ""))

def do_fit(a):
    words = re.findall(r"[A-Za-z']+", a.line)
    s = "".join(P.stresses(phones(w)) for w in words if phones(w))
    print(json.dumps({"line_stress": s, "target": a.meter}) if a.json else
          f"line stress: {s}\ntarget:      {a.meter}\n(match stressed 1s to the / beats)")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("rhymes"); r.add_argument("word")
    r.add_argument("--type", choices=["perfect", "slant", "all"], default="all")
    r.add_argument("--syllables", type=int); r.add_argument("--max", type=int, default=40)
    r.add_argument("--min-freq", type=float, default=3.4, dest="min_freq")
    r.add_argument("--json", action="store_true"); r.set_defaults(func=do_rhymes)
    sc = sub.add_parser("scan"); sc.add_argument("line"); sc.add_argument("--json", action="store_true"); sc.set_defaults(func=do_scan)
    ft = sub.add_parser("fit"); ft.add_argument("line"); ft.add_argument("--meter", default=""); ft.add_argument("--json", action="store_true"); ft.set_defaults(func=do_fit)
    a = ap.parse_args(); a.func(a)

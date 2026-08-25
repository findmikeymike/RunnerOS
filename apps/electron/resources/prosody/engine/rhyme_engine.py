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
        elif MANNER.get(a) == MANNER.get(b): s += 1
    return s - abs(len(c1) - len(c2))

def tail_sim(t1, t2):
    if not t1 and not t2: return 2
    s = 0
    for a, b in zip(reversed(t1), reversed(t2)):
        if a == b: s += 2
        elif MANNER.get(a) == MANNER.get(b): s += 1
    return max(-1, s - abs(len(t1) - len(t2)))

_ALL = None
def all_words():
    global _ALL
    if _ALL is None:
        seen = {}
        for w, ph in P.pronunciations:
            if "(" in w or not w.isalpha(): continue
            if not any(c in "aeiouy" for c in w): continue  # kill abbrevs like dr, mr, tv
            if w not in seen: seen[w] = ph
        _ALL = seen
    return _ALL

def slant(word, want_syll=None, max_n=40, min_freq=3.4):
    ph = phones(word)
    if not ph: return []
    T = anchors(ph)
    if not T: return []
    perfect_set = set(P.rhymes(word)); wl = word.lower()
    out = []
    for w, wph in all_words().items():
        if w == wl or w in perfect_set: continue
        if len(wl) >= 4 and (wl in w or w in wl): continue  # skip compounds/derivatives
        if freq(w) < min_freq: continue
        W = anchors(wph)
        if not W: continue
        # Anchor A — last STRESSED vowel matches (assonance; the ear's primary anchor)
        sA = (3 + tail_sim(T["stail"], W["stail"])) if W["sv"] == T["sv"] else None
        # Anchor B — final syllable. A bare UNSTRESSED final vowel is only a weak rhyme,
        # so require the final vowel be stressed in both, OR a real consonant-coda match.
        sB = None
        if W["fv"] == T["fv"]:
            cs = coda_score(T["fcoda"], W["fcoda"])
            if (T["fstress"] and W["fstress"]) or (cs >= 2 and T["fcoda"]):
                sB = 2 + cs
        else:
            cs = coda_score(T["fcoda"], W["fcoda"])
            if cs >= 3 and T["fcoda"]:            # consonance: strong coda, different vowel
                sB = cs
        cands = [x for x in (sA, sB) if x is not None]
        if not cands: continue
        base = max(cands)
        syl = P.syllable_count(wph)
        if want_syll and syl != want_syll: continue
        if sA is not None and sA >= (sB or -99): kind = "assonance"
        elif sB is not None and W["fv"] == T["fv"]: kind = "assonance"
        else: kind = "consonance"
        score = base + 0.25 * freq(w) - 0.1 * syl
        out.append((score, w, syl, P.stresses(wph), kind))
    out.sort(key=lambda x: (-x[0], x[2], x[1]))
    return out[:max_n]

def perfect(word, want_syll=None, max_n=40, min_freq=2.6):
    res = []
    for w in P.rhymes(word):
        if freq(w) < min_freq: continue
        wph = phones(w)
        if want_syll and wph and P.syllable_count(wph) != want_syll: continue
        res.append((w, round(freq(w), 2)))
    res.sort(key=lambda x: -x[1])
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

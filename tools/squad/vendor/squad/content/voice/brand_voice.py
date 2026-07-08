"""Brand voice system — the personality engine for all content output.

Usage:
    from content.voice.brand_voice import BrandVoicePack, load_voice_pack, DEFAULT_VOICE

    # Use the default voice
    voice = DEFAULT_VOICE

    # Or load from a YAML file
    voice = load_voice_pack(Path("voices/my_brand.yaml"))

    # Check copy against the voice
    violations = voice.check(draft_text)

    # Get platform-adapted voice direction
    direction = voice.platform_direction("tiktok")
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class VoiceViolation:
    """A specific brand voice violation found in copy."""

    rule: str  # "banned_word", "anti_tone", "too_long", "weak_opener"
    detail: str  # human-readable explanation
    severity: str  # "hard" (must fix) or "soft" (suggestion)
    position: int | None = None  # char index where violation occurs, if applicable

    def __str__(self) -> str:
        prefix = "MUST FIX" if self.severity == "hard" else "SUGGESTION"
        return f"[{prefix}] {self.rule}: {self.detail}"


@dataclass
class BrandVoicePack:
    """Complete brand voice definition. This is the soul of the Content Agent.

    The Content Agent's system prompt references this pack for every piece of copy.
    The copy scorer uses it to evaluate brand voice fit.
    """

    brand_name: str

    # --- Voice ---
    tone: list[str] = field(default_factory=list)
    anti_tone: list[str] = field(default_factory=list)

    # --- Language ---
    vocabulary: list[str] = field(default_factory=list)
    banned_words: list[str] = field(default_factory=list)
    sentence_style: str = "short and punchy"

    # --- Audience ---
    icp_language: list[str] = field(default_factory=list)
    icp_identity: str = ""

    # --- Examples ---
    good_examples: list[str] = field(default_factory=list)
    bad_examples: list[str] = field(default_factory=list)

    # --- Platform adaptations ---
    platform_voice: dict[str, str] = field(default_factory=dict)

    # --- Scoring thresholds ---
    max_sentence_words: int = 25  # sentences longer than this trigger a warning
    max_paragraph_sentences: int = 4  # paragraphs longer than this trigger a warning
    min_hook_power: int = 6  # first sentence must be <= this many words for social content

    def check(self, text: str, *, platform: str | None = None) -> list[VoiceViolation]:
        """Check copy against this voice pack. Returns list of violations.

        This is the fast heuristic check — catches obvious violations without
        an LLM call. The LLM-powered scorer (copy_scorer.py) does the deeper
        semantic evaluation.
        """
        violations: list[VoiceViolation] = []
        text_lower = text.lower()

        # --- Banned words ---
        for word in self.banned_words:
            pattern = rf"\b{re.escape(word.lower())}\b"
            match = re.search(pattern, text_lower)
            if match:
                violations.append(
                    VoiceViolation(
                        rule="banned_word",
                        detail=f'Found banned word/phrase: "{word}"',
                        severity="hard",
                        position=match.start(),
                    )
                )

        # --- Anti-tone patterns ---
        anti_tone_patterns = {
            "corporate": [
                r"\bsynergy\b", r"\bsynergize\b", r"\bsynergistic\b",
                r"\bleverage\b", r"\bleveraging\b",
                r"\boptimize\b", r"\boptimizing\b",
                r"\bstakeholder\b", r"\bstakeholders\b",
                r"\bparadigm\b", r"\bparadigm shift\b",
                r"\bscalable\b", r"\bscalability\b",
                r"\bactionable\b", r"\bactionable insights\b",
                r"\bvalue[- ]add(?:ed)?\b",
                r"\bcore competenc(?:y|ies)\b",
                r"\bmission[- ]critical\b",
                r"\bcross[- ]functional\b",
                r"\bdeliver(?:ing)? value\b",
                r"\bstrategic alignment\b",
                r"\bholistic approach\b",
                r"\brobust (?:solution|platform|framework)\b",
                r"\bpipeline\b(?!.*\b(?:code|CI|CD|git|deploy)\b)",  # allow tech usage
                r"\bdriving (?:growth|results|outcomes|engagement)\b",
                r"\bcircle back\b",
                r"\blow[- ]hanging fruit\b",
                r"\bboil the ocean\b",
                r"\bmove the needle\b",
            ],
            "salesy": [
                r"\bdon'?t miss out\b",
                r"\blimited time\b", r"\blimited[- ]time offer\b",
                r"\bact now\b", r"\border now\b",
                r"\bhurry\b", r"\bhurry up\b",
                r"\bexclusive offer\b", r"\bexclusive deal\b",
                r"\bbuy now\b", r"\bshop now\b",
                r"\b(?:100|totally|completely) free\b",
                r"\bbefore it'?s (?:too late|gone)\b",
                r"\bonly \d+ left\b",
                r"\bwhile (?:supplies|stocks?) last\b",
                r"\bunbeatable (?:price|deal|offer)\b",
                r"\brisk[- ]free\b",
                r"\bno[- ]brainer\b",
                r"\byou won'?t (?:believe|regret)\b",
                r"\bonce in a lifetime\b",
                r"\bguaranteed results\b",
                r"\b(?:massive|huge|incredible) (?:savings?|discount|deal)\b",
            ],
            "try-hard": [
                r"\b(?:super|incredibly|amazingly|insanely|absolutely) (?:excited|thrilled|pumped|hyped|stoked)\b",
                r"🔥{2,}", r"🚀{2,}", r"💯{2,}", r"😱{2,}",
                r"!!{2,}", r"\?\?{2,}",
                r"\bOMG\b", r"\bLFG\b",
                r"\bLITERALLY (?:DYING|DEAD|SHAKING|SCREAMING)\b",
                r"\bI can'?t even\b",
                r"\bthis is (?:everything|insane|wild|crazy)\b",
                r"\bbiggest (?:thing|drop|launch) ever\b",
                r"\byou'?re not ready\b",
                r"\blet that sink in\b",
                r"\bread that again\b",
            ],
            "generic": [
                r"\bin today'?s (?:fast[- ]paced|digital|modern|ever[- ]changing) (?:world|age|era|landscape)\b",
                r"\btake (?:your|it|things) to the next level\b",
                r"\bgame[- ]chang(?:er|ing)\b",
                r"\bat the end of the day\b",
                r"\bit goes without saying\b",
                r"\bneedless to say\b",
                r"\bwithout further ado\b",
                r"\bthat being said\b",
                r"\bhaving said that\b",
                r"\bthought leader(?:ship)?\b",
                r"\bbest[- ]in[- ]class\b",
                r"\bworld[- ]class\b",
                r"\bcutting[- ]edge\b",
                r"\bnext[- ]gen(?:eration)?\b",
                r"\bone[- ]stop[- ]shop\b",
                r"\bseamless(?:ly)? integrat\b",
                r"\b(?:we|I) believe that\b",
                r"\bpassionate about\b",
                r"\bon a mission to\b",
            ],
            "begging": [
                r"\bplease (?:share|like|follow|subscribe|retweet|RT)\b",
                r"\bhelp (?:me|us) (?:reach|grow|hit|get to)\b",
                r"\bevery (?:like|share|follow|retweet) (?:counts|matters|helps)\b",
                r"\bif you (?:enjoyed|liked) this,? (?:share|follow|subscribe)\b",
                r"\bdon'?t forget to (?:like|follow|subscribe|share)\b",
                r"\btag (?:a friend|someone|3 people)\b",
                r"\bshare (?:this|if you agree)\b",
                r"\b(?:drop|leave) a (?:like|comment|follow)\b",
                r"\bsmash that (?:like|subscribe) button\b",
            ],
        }

        for tone_category, patterns in anti_tone_patterns.items():
            if tone_category in [t.lower() for t in self.anti_tone]:
                for pattern in patterns:
                    match = re.search(pattern, text_lower)
                    if match:
                        violations.append(
                            VoiceViolation(
                                rule="anti_tone",
                                detail=f'Anti-tone "{tone_category}" detected: "{match.group()}"',
                                severity="hard",
                                position=match.start(),
                            )
                        )

        # --- Sentence length ---
        sentences = re.split(r"[.!?]+", text)
        for i, sentence in enumerate(sentences):
            words = sentence.split()
            if len(words) > self.max_sentence_words:
                violations.append(
                    VoiceViolation(
                        rule="sentence_length",
                        detail=f"Sentence {i + 1} has {len(words)} words (max {self.max_sentence_words}). Cut it.",
                        severity="soft",
                    )
                )

        # --- Hook strength (for social platforms) ---
        social_platforms = {"tiktok", "instagram", "twitter", "x", "instagram_feed", "instagram_story"}
        if platform and platform.lower() in social_platforms:
            first_sentence = sentences[0].strip() if sentences else ""
            first_words = first_sentence.split()
            if len(first_words) > self.min_hook_power:
                violations.append(
                    VoiceViolation(
                        rule="weak_opener",
                        detail=(
                            f"First sentence is {len(first_words)} words. "
                            f"Social hooks should be {self.min_hook_power} words or fewer. "
                            "Tighten the opener."
                        ),
                        severity="soft",
                    )
                )

        return violations

    def platform_direction(self, platform: str) -> str:
        """Get voice direction for a specific platform."""
        return self.platform_voice.get(
            platform.lower(),
            f"Follow the core voice: {', '.join(self.tone)}. "
            f"Avoid: {', '.join(self.anti_tone)}.",
        )

    def to_prompt_block(self, platform: str | None = None) -> str:
        """Render this voice pack as a block to inject into an LLM prompt.

        This is what gets inserted into the Content Agent's system prompt
        or into the scorer's evaluation prompt.
        """
        lines = [
            f"## Brand Voice: {self.brand_name}",
            "",
            f"**Tone:** {', '.join(self.tone)}",
            f"**Never sound:** {', '.join(self.anti_tone)}",
            "",
            f"**Sentence style:** {self.sentence_style}",
            f"**Words we use:** {', '.join(self.vocabulary)}",
            f"**Words we NEVER use:** {', '.join(self.banned_words)}",
            "",
            f"**Our audience:** {self.icp_identity}",
            f"**How they talk:** {'; '.join(self.icp_language)}",
            "",
            "**Examples of our voice (good):**",
        ]
        for ex in self.good_examples:
            lines.append(f'- "{ex}"')
        lines.append("")
        lines.append("**Examples of what we DON'T sound like (bad):**")
        for ex in self.bad_examples:
            lines.append(f'- "{ex}"')

        if platform:
            direction = self.platform_direction(platform)
            lines.extend(["", f"**Platform-specific ({platform}):** {direction}"])

        return "\n".join(lines)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict for storage/transmission."""
        return {
            "brand_name": self.brand_name,
            "tone": self.tone,
            "anti_tone": self.anti_tone,
            "vocabulary": self.vocabulary,
            "banned_words": self.banned_words,
            "sentence_style": self.sentence_style,
            "icp_language": self.icp_language,
            "icp_identity": self.icp_identity,
            "good_examples": self.good_examples,
            "bad_examples": self.bad_examples,
            "platform_voice": self.platform_voice,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> BrandVoicePack:
        """Deserialize from dict."""
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


def load_voice_pack(path: Path) -> BrandVoicePack:
    """Load a BrandVoicePack from a YAML file.

    Expected YAML structure matches the dataclass fields exactly.
    """
    try:
        import yaml
    except ImportError as exc:
        raise ImportError("PyYAML is required to load voice packs from YAML: pip install pyyaml") from exc

    with open(path) as f:
        data = yaml.safe_load(f)

    return BrandVoicePack.from_dict(data)


# ---------------------------------------------------------------------------
# Voice Fingerprint — statistical profile extracted from real writing samples
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class VoiceFingerprint:
    """Statistical profile of a writing style, extracted from samples.

    This is the upgrade path from "adjective lists" to "real data."
    Feed it 10-20 samples of copy you love, and it extracts measurable
    patterns the scorer can compare against.
    """

    avg_sentence_length: float  # words per sentence
    avg_word_length: float      # characters per word
    short_sentence_ratio: float  # % of sentences ≤ 5 words
    fragment_ratio: float       # % of sentences without a verb (rough heuristic)
    question_ratio: float       # % of sentences that are questions
    exclamation_ratio: float    # % of sentences ending with !
    avg_paragraph_sentences: float
    unique_word_ratio: float    # vocabulary diversity (unique / total)
    top_words: list[str]        # most common non-stopword words
    top_bigrams: list[str]      # most common word pairs
    sample_count: int           # how many samples were analyzed

    def compare(self, text: str) -> dict[str, float]:
        """Compare a draft against this fingerprint. Returns per-metric deltas.

        Positive delta = draft has MORE of that quality than the samples.
        Negative delta = draft has LESS.
        Values near 0 = good match.
        """
        draft_fp = extract_fingerprint([text])
        return {
            "sentence_length_delta": draft_fp.avg_sentence_length - self.avg_sentence_length,
            "word_length_delta": draft_fp.avg_word_length - self.avg_word_length,
            "short_sentence_delta": draft_fp.short_sentence_ratio - self.short_sentence_ratio,
            "fragment_delta": draft_fp.fragment_ratio - self.fragment_ratio,
            "question_delta": draft_fp.question_ratio - self.question_ratio,
            "exclamation_delta": draft_fp.exclamation_ratio - self.exclamation_ratio,
            "vocabulary_diversity_delta": draft_fp.unique_word_ratio - self.unique_word_ratio,
        }

    def deviation_score(self, text: str) -> float:
        """Single 0-1 score for how much a draft deviates from this fingerprint.

        0.0 = perfect match to the sample style
        1.0 = maximally different

        Normalization is adaptive: each metric is scaled relative to its
        expected range so that sentence_length_delta=10 (huge) and
        fragment_ratio_delta=0.3 (also huge) contribute proportionally.
        """
        deltas = self.compare(text)

        # Per-metric weights and expected max deviations for normalization.
        # max_delta is the deviation we'd expect between radically different
        # styles (e.g., punchy marketing vs. academic prose). This replaces
        # the old magic constant and makes each metric contribute on a 0-1 scale.
        metrics = {
            #                       weight  max_delta (empirical range)
            "sentence_length_delta":     (0.25, 20.0),   # 5 vs 25 words/sentence
            "word_length_delta":         (0.10,  2.0),   # 3.5 vs 5.5 chars/word
            "short_sentence_delta":      (0.20,  0.6),   # 0.0 vs 0.6 ratio
            "fragment_delta":            (0.15,  0.5),   # 0.0 vs 0.5 ratio
            "question_delta":            (0.05,  0.3),   # 0.0 vs 0.3 ratio
            "exclamation_delta":         (0.10,  0.4),   # 0.0 vs 0.4 ratio
            "vocabulary_diversity_delta": (0.15,  0.4),  # 0.3 vs 0.7 ratio
        }

        weighted_sum = 0.0
        for key, (weight, max_delta) in metrics.items():
            raw_delta = abs(deltas.get(key, 0.0))
            # Normalize each metric to 0-1 range, then weight
            normalized = min(1.0, raw_delta / max_delta) if max_delta > 0 else 0.0
            weighted_sum += normalized * weight

        return round(min(1.0, weighted_sum), 3)


# Common English stopwords for fingerprint extraction
_STOPWORDS = frozenset(
    "a an the and or but if in on at to for of is it its i me my we our "
    "you your he she they them their this that these those with from by as "
    "be been being was were are am will would could should can may might do "
    "did does have has had not no nor so than too very just about also into "
    "out up all each every both few more most other some such only own same "
    "then when where while how what which who whom why".split()
)

# Common verbs for fragment detection (rough heuristic)
_COMMON_VERBS = frozenset(
    "is are was were be been being have has had do does did will would could "
    "should can may might shall must need get got make made take took come came "
    "go went see saw know knew think thought give gave find found say said tell "
    "told work use run let".split()
)


def extract_fingerprint(samples: list[str]) -> VoiceFingerprint:
    """Extract a VoiceFingerprint from a list of writing samples.

    Feed this 10-20 pieces of copy that represent your ideal voice.
    The more samples, the more reliable the fingerprint.
    """
    all_sentences: list[list[str]] = []  # list of word-lists
    all_words: list[str] = []
    paragraph_sentence_counts: list[int] = []
    question_count = 0
    exclamation_count = 0
    fragment_count = 0

    for sample in samples:
        # Split into paragraphs
        paragraphs = [p.strip() for p in sample.split("\n\n") if p.strip()]
        for para in paragraphs:
            sentences = [s.strip() for s in re.split(r"[.!?]+", para) if s.strip()]
            paragraph_sentence_counts.append(len(sentences))

        # Split into sentences (preserving punctuation for type detection)
        raw_sentences = re.split(r"(?<=[.!?])\s+", sample)
        for raw in raw_sentences:
            raw = raw.strip()
            if not raw:
                continue
            if raw.endswith("?"):
                question_count += 1
            elif raw.endswith("!"):
                exclamation_count += 1

            words = re.findall(r"[a-zA-Z']+", raw.lower())
            if words:
                all_sentences.append(words)
                all_words.extend(words)

                # Fragment detection: sentence has no common verb
                if not any(w in _COMMON_VERBS for w in words):
                    fragment_count += 1

    total_sentences = max(len(all_sentences), 1)
    total_words = max(len(all_words), 1)

    # Sentence length stats
    sentence_lengths = [len(s) for s in all_sentences]
    avg_sentence_length = sum(sentence_lengths) / total_sentences
    short_sentences = sum(1 for l in sentence_lengths if l <= 5)

    # Word stats
    avg_word_length = sum(len(w) for w in all_words) / total_words
    unique_words = set(all_words)
    unique_word_ratio = len(unique_words) / total_words

    # Top words (excluding stopwords)
    word_counts: dict[str, int] = {}
    for w in all_words:
        if w not in _STOPWORDS and len(w) > 2:
            word_counts[w] = word_counts.get(w, 0) + 1
    top_words = sorted(word_counts, key=word_counts.get, reverse=True)[:20]  # type: ignore[arg-type]

    # Top bigrams
    bigram_counts: dict[str, int] = {}
    for sent_words in all_sentences:
        content_words = [w for w in sent_words if w not in _STOPWORDS and len(w) > 2]
        for i in range(len(content_words) - 1):
            bg = f"{content_words[i]} {content_words[i+1]}"
            bigram_counts[bg] = bigram_counts.get(bg, 0) + 1
    top_bigrams = sorted(bigram_counts, key=bigram_counts.get, reverse=True)[:10]  # type: ignore[arg-type]

    return VoiceFingerprint(
        avg_sentence_length=round(avg_sentence_length, 1),
        avg_word_length=round(avg_word_length, 1),
        short_sentence_ratio=round(short_sentences / total_sentences, 2),
        fragment_ratio=round(fragment_count / total_sentences, 2),
        question_ratio=round(question_count / total_sentences, 2),
        exclamation_ratio=round(exclamation_count / total_sentences, 2),
        avg_paragraph_sentences=round(
            sum(paragraph_sentence_counts) / max(len(paragraph_sentence_counts), 1), 1
        ),
        unique_word_ratio=round(unique_word_ratio, 2),
        top_words=top_words,
        top_bigrams=top_bigrams,
        sample_count=len(samples),
    )


# ---------------------------------------------------------------------------
# DEFAULT VOICE — Mikey's brand aesthetic (used until calibrated with real data)
# ---------------------------------------------------------------------------

DEFAULT_VOICE = BrandVoicePack(
    brand_name="Squad Default",
    tone=[
        "confident",
        "direct",
        "culturally aware",
        "cool without trying",
        "sharp",
    ],
    anti_tone=[
        "corporate",
        "salesy",
        "try-hard",
        "generic",
        "begging",
    ],
    vocabulary=[
        "built",
        "crafted",
        "designed for",
        "made different",
        "the real ones know",
        "hits different",
        "no noise",
        "clean",
        "sharp",
    ],
    banned_words=[
        "synergy",
        "leverage",
        "best-in-class",
        "revolutionary",
        "game-changing",
        "disruptive",
        "innovative",
        "utilize",
        "solutions",
        "empower",
        "take your X to the next level",
        "in today's fast-paced world",
        "don't miss out",
        "limited time offer",
        "act now",
        "click here",
        "buy now",
        "we're excited to announce",
        "we're thrilled",
        "we're passionate about",
    ],
    sentence_style="short and punchy. Fragments are fine. One-word sentences land.",
    icp_language=[
        "I just want something that works",
        "tired of apps that try to do everything",
        "if you know, you know",
        "the details matter",
        "I don't need another tool, I need the right tool",
    ],
    icp_identity=(
        "People who care about craft, taste, and doing things intentionally. "
        "Not hype-chasers. People who find something good and stick with it."
    ),
    good_examples=[
        "Made for the ones who notice the difference.",
        "Your tools should work as hard as you do. These do.",
        "Not for everyone. That's the point.",
        "Three years in the making. You'll feel it.",
        "Less noise. More signal.",
        "Works the first time. Every time.",
    ],
    bad_examples=[
        "Introducing our revolutionary new product that will change the way you work!",
        "Don't miss out on this amazing opportunity!!! 🔥🔥🔥",
        "We're passionate about delivering best-in-class solutions for your needs.",
        "Take your productivity to the NEXT LEVEL with our game-changing app!",
        "In today's fast-paced digital world, you need tools that keep up.",
        "Like and share if you agree! Help us reach 10K followers! 🙏",
    ],
    platform_voice={
        "tiktok": (
            "Loose, casual, speak like a friend sharing a discovery. "
            "Okay to be funny. Hook in first 2 words. "
            "First person always. 'I found...' not 'Introducing...'"
        ),
        "instagram": (
            "Visual-first, copy is secondary. Captions short. "
            "Let the image do the work. "
            "125 chars visible before 'more' — front-load the hook."
        ),
        "instagram_story": (
            "Even more casual than feed. Polls, questions, reactions. "
            "Text overlays: 3-5 words max per screen."
        ),
        "twitter": (
            "Sharp. Witty if it comes naturally. No threads unless content demands it. "
            "No hashtags in the main tweet. Every character earns its place."
        ),
        "x": (
            "Sharp. Witty if it comes naturally. No threads unless content demands it. "
            "No hashtags in the main tweet. Every character earns its place."
        ),
        "linkedin": (
            "Still direct, but more measured. No corporate speak. "
            "Write like a founder, not a marketer. "
            "Personal story angle outperforms corporate announcements 10:1."
        ),
        "website": (
            "Clear above all. Every sentence answers a question the visitor has. "
            "No fluff. Headline: 6-10 words. Subhead: 15-25 words."
        ),
        "email": (
            "Personal tone. Write like one human to another. "
            "Short paragraphs. One CTA per email. "
            "Subject line: 40 chars, curiosity or benefit."
        ),
        "spotify": (
            "Minimal. The music speaks. Bio should be evocative, not descriptive. "
            "Sentence fragments. Mood over information."
        ),
        "app_store": (
            "Benefits first, features second. First line is the value prop. "
            "Use social proof if available. Clear, specific, no hype."
        ),
    },
)

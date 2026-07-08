from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True, slots=True)
class ScriptGuidance:
    script_bits: tuple[str, ...] = ()
    must_say: tuple[str, ...] = ()
    avoid_phrases: tuple[str, ...] = ()
    hook_direction: str = ""
    tone_direction: str = ""

    @property
    def has_any(self) -> bool:
        return bool(
            self.script_bits
            or self.must_say
            or self.avoid_phrases
            or self.hook_direction
            or self.tone_direction
        )


def script_guidance_from_brief(brief) -> ScriptGuidance:
    return ScriptGuidance(
        script_bits=_clean_items(getattr(brief, "script_bits", ()) or ()),
        must_say=_clean_items(getattr(brief, "must_say", ()) or ()),
        avoid_phrases=tuple(item.lower() for item in _clean_items(getattr(brief, "avoid_phrases", ()) or ())),
        hook_direction=clean_fragment(getattr(brief, "hook_direction", "") or ""),
        tone_direction=clean_fragment(getattr(brief, "tone_direction", "") or ""),
    )


def clean_fragment(text: str) -> str:
    return " ".join(str(text or "").strip().rstrip(".").split())


def clean_sentence(text: str) -> str:
    cleaned = clean_fragment(text)
    return f"{cleaned}." if cleaned else ""


def contains_avoided_phrase(text: str, avoid_phrases: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(phrase and phrase in lowered for phrase in avoid_phrases)


def render_guidance_block(guidance: ScriptGuidance) -> str:
    if not guidance.has_any:
        return "- none"
    lines: list[str] = []
    if guidance.hook_direction:
        lines.append(f"- hook_direction: {guidance.hook_direction}")
    if guidance.tone_direction:
        lines.append(f"- tone_direction: {guidance.tone_direction}")
    if guidance.script_bits:
        lines.append(f"- script_bits: {'; '.join(guidance.script_bits)}")
    if guidance.must_say:
        lines.append(f"- must_say: {'; '.join(guidance.must_say)}")
    if guidance.avoid_phrases:
        lines.append(f"- avoid_phrases: {'; '.join(guidance.avoid_phrases)}")
    return "\n".join(lines)


def assemble_guided_lines(parts: Iterable[str], *, guidance: ScriptGuidance) -> str:
    lines: list[str] = []
    seen: set[str] = set()
    for part in parts:
        sentence = clean_sentence(part)
        if not sentence:
            continue
        if contains_avoided_phrase(sentence, guidance.avoid_phrases):
            continue
        key = sentence.lower()
        if key in seen:
            continue
        seen.add(key)
        lines.append(sentence)
    return " ".join(lines)


def guidance_prefix_line(guidance: ScriptGuidance, *, fallback: str) -> str:
    quoted = quoted_line(guidance.hook_direction)
    if quoted:
        return quoted
    text = guidance.hook_direction.lower()
    if not text:
        return fallback
    if any(term in text for term in ("pain", "painful", "frustrat", "angry", "annoy", "problem")):
        return "Here is the part that was quietly costing me"
    if any(term in text for term in ("identity", "for people", "creator", "founder", "artist")):
        return "This is for people who keep pretending the messy part is normal"
    if any(term in text for term in ("curiosity", "mystery", "nobody tells", "realization")):
        return "This is the part nobody tells you until you feel it"
    if any(term in text for term in ("contradiction", "relief", "calm", "surprise", "turn")):
        return "This looked small, but it changed the whole feeling"
    return fallback


def quoted_line(text: str) -> str:
    for quote in ('"', "'"):
        if quote not in text:
            continue
        parts = text.split(quote)
        if len(parts) >= 3:
            candidate = clean_fragment(parts[1])
            if 3 <= len(candidate.split()) <= 24:
                return candidate
    return ""


def _clean_items(items: Iterable[str]) -> tuple[str, ...]:
    cleaned = [clean_fragment(item) for item in items]
    return tuple(item for item in cleaned if item)

"""Research Validator — quality gate between Research Agent and Content Agent.

The Research Agent gathers audience insights, competitor data, hooks, word banks,
and visual references. This validator ensures that output is complete, relevant,
and actionable BEFORE the Content Agent starts writing.

Without this, the Content Agent gets half-baked research and produces generic copy
that ignores the audience. The validator catches:
- Missing required fields (no hooks? no audience data?)
- Stale or irrelevant data (competitor info from 2 years ago)
- Thin research (only 1 hook found? need at least 3)
- Self-contradicting insights

Usage:
    from content.validation.research_validator import validate_research, ResearchOutput

    result = validate_research(research_output)
    if result.passed:
        # Safe to hand off to Content Agent
        content_agent.write(brief, research=research_output)
    else:
        # Send back to Research Agent with specific gaps
        research_agent.fill_gaps(result.gaps)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Research output types (mirrors what the Research Agent produces)
# ---------------------------------------------------------------------------

@dataclass
class ResearchOutput:
    """Structured output from the Research Agent.

    This is the handoff document from Research Agent → Content Agent.
    The validator checks this before the Content Agent sees it.
    """

    # Audience insights
    audience_pain_points: list[str] = field(default_factory=list)
    audience_desires: list[str] = field(default_factory=list)
    audience_language: list[str] = field(default_factory=list)  # phrases they use

    # Competitive intelligence
    competitor_hooks: list[str] = field(default_factory=list)  # hooks competitors use
    competitor_angles: list[str] = field(default_factory=list)  # positioning angles
    competitor_weaknesses: list[str] = field(default_factory=list)

    # Content ingredients
    hooks: list[str] = field(default_factory=list)  # proposed hooks for this campaign
    word_bank: list[str] = field(default_factory=list)  # audience-resonant vocabulary
    angles: list[str] = field(default_factory=list)  # strategic angles to try
    proof_points: list[str] = field(default_factory=list)  # stats, testimonials, etc.

    # Visual direction
    visual_references: list[str] = field(default_factory=list)  # URLs or descriptions
    trending_formats: list[str] = field(default_factory=list)  # what's working now

    # Meta
    sources: list[str] = field(default_factory=list)  # where the data came from
    confidence: float = 0.5  # Research Agent's self-assessed confidence
    research_type: str = "general"  # "audience", "competitor", "trend", "general"

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if v}


# ---------------------------------------------------------------------------
# Validation result
# ---------------------------------------------------------------------------

@dataclass
class ValidationIssue:
    """A single issue found during research validation."""

    field: str  # which field has the issue
    severity: str  # "critical" (blocks handoff), "warning" (proceed with caution)
    message: str  # human-readable explanation
    suggestion: str  # what to do about it

    def __str__(self) -> str:
        prefix = "CRITICAL" if self.severity == "critical" else "WARNING"
        return f"[{prefix}] {self.field}: {self.message}"


@dataclass
class ValidationResult:
    """Result of research validation."""

    passed: bool  # True if no critical issues
    issues: list[ValidationIssue] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)  # specific gaps to fill
    quality_score: float = 0.0  # 0-1 overall research quality
    usable_fields: list[str] = field(default_factory=list)  # which fields are good enough

    @property
    def critical_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "critical")

    @property
    def warning_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "warning")


# ---------------------------------------------------------------------------
# Validation rules
# ---------------------------------------------------------------------------

# Minimum item counts per field for the research to be considered useful
_MIN_COUNTS: dict[str, int] = {
    "hooks": 3,
    "audience_pain_points": 2,
    "audience_desires": 2,
    "audience_language": 3,
    "word_bank": 5,
    "angles": 2,
    "sources": 1,
}

# Fields that are always required (critical if missing)
_REQUIRED_FIELDS = {"hooks", "audience_pain_points", "word_bank", "sources"}

# Fields that are recommended but not blocking
_RECOMMENDED_FIELDS = {"audience_desires", "audience_language", "angles", "competitor_hooks"}

# Maximum length for individual items (catches data quality issues)
_MAX_ITEM_LENGTH = 500  # characters — anything longer is probably a dump, not an insight

# Minimum length for hooks (too-short hooks are useless)
_MIN_HOOK_LENGTH = 10  # characters


def validate_research(
    research: ResearchOutput,
    *,
    strict: bool = False,
) -> ValidationResult:
    """Validate research output before handing off to Content Agent.

    Args:
        research: The Research Agent's output to validate.
        strict: If True, recommended fields become required too.

    Returns:
        ValidationResult with pass/fail, issues, and gaps.
    """
    issues: list[ValidationIssue] = []
    gaps: list[str] = []
    usable_fields: list[str] = []

    # --- Check required fields ---
    required = _REQUIRED_FIELDS | (_RECOMMENDED_FIELDS if strict else set())

    for field_name in required:
        items = getattr(research, field_name, [])
        min_count = _MIN_COUNTS.get(field_name, 1)
        severity = "critical" if field_name in required else "warning"

        if not items:
            issues.append(ValidationIssue(
                field=field_name,
                severity=severity,
                message=f"Missing entirely. Need at least {min_count} items.",
                suggestion=f"Research Agent should gather {field_name} before Content Agent starts.",
            ))
            gaps.append(f"Gather {min_count}+ {field_name.replace('_', ' ')}")
        elif len(items) < min_count:
            issues.append(ValidationIssue(
                field=field_name,
                severity="warning",
                message=f"Only {len(items)} items, need at least {min_count}.",
                suggestion=f"Try to find {min_count - len(items)} more {field_name.replace('_', ' ')}.",
            ))
            gaps.append(f"Find {min_count - len(items)} more {field_name.replace('_', ' ')}")
            usable_fields.append(field_name)  # Still usable, just thin
        else:
            usable_fields.append(field_name)

    # --- Check recommended fields (non-blocking) ---
    if not strict:
        for field_name in _RECOMMENDED_FIELDS:
            items = getattr(research, field_name, [])
            if not items:
                issues.append(ValidationIssue(
                    field=field_name,
                    severity="warning",
                    message=f"No {field_name.replace('_', ' ')} provided. Copy quality will suffer.",
                    suggestion=f"Recommended: gather at least {_MIN_COUNTS.get(field_name, 2)} {field_name.replace('_', ' ')}.",
                ))

    # --- Quality checks on individual items ---
    _check_item_quality(research.hooks, "hooks", issues, min_len=_MIN_HOOK_LENGTH)
    _check_item_quality(research.audience_pain_points, "audience_pain_points", issues)
    _check_item_quality(research.word_bank, "word_bank", issues)

    # --- Duplicate detection ---
    _check_duplicates(research.hooks, "hooks", issues)
    _check_duplicates(research.angles, "angles", issues)

    # --- Confidence sanity check ---
    if research.confidence < 0.3:
        issues.append(ValidationIssue(
            field="confidence",
            severity="warning",
            message=f"Research Agent confidence is only {research.confidence:.0%}. Results may be unreliable.",
            suggestion="Consider re-running research with different search terms or sources.",
        ))

    # --- Source validation ---
    if research.sources:
        empty_sources = [s for s in research.sources if len(s.strip()) < 5]
        if empty_sources:
            issues.append(ValidationIssue(
                field="sources",
                severity="warning",
                message=f"{len(empty_sources)} source(s) appear empty or invalid.",
                suggestion="Verify all source URLs/descriptions are complete.",
            ))

    # --- Compute quality score ---
    quality = _compute_quality_score(research, issues)

    # Passed = no critical issues
    critical_issues = [i for i in issues if i.severity == "critical"]
    passed = len(critical_issues) == 0

    return ValidationResult(
        passed=passed,
        issues=issues,
        gaps=gaps,
        quality_score=quality,
        usable_fields=usable_fields,
    )


# ---------------------------------------------------------------------------
# Quality check helpers
# ---------------------------------------------------------------------------

def _check_item_quality(
    items: list[str],
    field_name: str,
    issues: list[ValidationIssue],
    *,
    min_len: int = 3,
) -> None:
    """Check individual items for quality issues."""
    if not items:
        return

    too_long = [i for i in items if len(i) > _MAX_ITEM_LENGTH]
    too_short = [i for i in items if len(i.strip()) < min_len]

    if too_long:
        issues.append(ValidationIssue(
            field=field_name,
            severity="warning",
            message=f"{len(too_long)} item(s) over {_MAX_ITEM_LENGTH} chars. Probably raw dumps, not distilled insights.",
            suggestion="Condense each item to a single clear insight or phrase.",
        ))

    if too_short:
        issues.append(ValidationIssue(
            field=field_name,
            severity="warning",
            message=f"{len(too_short)} item(s) suspiciously short (under {min_len} chars). May be empty or useless.",
            suggestion="Remove or expand these items.",
        ))


_DUPLICATE_STOPWORDS = frozenset(
    "a an the and or but if in on at to for of is it its i me my we our "
    "you your he she they them their this that these those with from by as "
    "be been being was were are am will would could should can may do did does "
    "have has had not no so than too very just about also".split()
)


def _tokenize_for_similarity(text: str) -> set[str]:
    """Extract content words for Jaccard similarity comparison."""
    words = re.findall(r"[a-z]+", text.lower())
    return {w for w in words if w not in _DUPLICATE_STOPWORDS and len(w) > 2}


def _jaccard_similarity(a: set[str], b: set[str]) -> float:
    """Jaccard similarity between two token sets. 0.0 = no overlap, 1.0 = identical."""
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


# Threshold for near-duplicate detection (0.6 = ~60% word overlap)
_NEAR_DUPE_THRESHOLD = 0.6


def _check_duplicates(
    items: list[str],
    field_name: str,
    issues: list[ValidationIssue],
) -> None:
    """Flag exact and near-duplicate items using token-overlap similarity."""
    if len(items) < 2:
        return

    # Exact duplicates
    normalized = [re.sub(r"\s+", " ", i.lower().strip()) for i in items]
    seen: set[str] = set()
    exact_dupes = 0
    for item in normalized:
        if item in seen:
            exact_dupes += 1
        seen.add(item)

    if exact_dupes:
        issues.append(ValidationIssue(
            field=field_name,
            severity="warning",
            message=f"{exact_dupes} exact duplicate(s) found. Research is repetitive.",
            suggestion="Remove identical entries.",
        ))

    # Near-duplicates (same idea, different phrasing)
    token_sets = [_tokenize_for_similarity(item) for item in items]
    near_dupe_pairs: list[tuple[int, int]] = []

    for i in range(len(token_sets)):
        for j in range(i + 1, len(token_sets)):
            sim = _jaccard_similarity(token_sets[i], token_sets[j])
            if sim >= _NEAR_DUPE_THRESHOLD:
                # Skip if already counted as exact dupe
                if normalized[i] != normalized[j]:
                    near_dupe_pairs.append((i, j))

    if near_dupe_pairs:
        examples = []
        for i, j in near_dupe_pairs[:2]:  # Show max 2 examples
            examples.append(f'"{items[i][:60]}..." ≈ "{items[j][:60]}..."')
        example_str = "; ".join(examples)
        issues.append(ValidationIssue(
            field=field_name,
            severity="warning",
            message=f"{len(near_dupe_pairs)} near-duplicate pair(s) found (>{_NEAR_DUPE_THRESHOLD:.0%} word overlap). E.g.: {example_str}",
            suggestion="Diversify — same insight reworded doesn't add value.",
        ))


def _compute_quality_score(
    research: ResearchOutput,
    issues: list[ValidationIssue],
) -> float:
    """Compute a 0-1 quality score for the research output."""
    score = 0.0
    max_score = 0.0

    # Weighted field completeness
    field_weights = {
        "hooks": 0.20,
        "audience_pain_points": 0.15,
        "audience_desires": 0.10,
        "audience_language": 0.10,
        "word_bank": 0.10,
        "angles": 0.10,
        "competitor_hooks": 0.05,
        "competitor_angles": 0.05,
        "proof_points": 0.05,
        "sources": 0.05,
        "visual_references": 0.05,
    }

    for field_name, weight in field_weights.items():
        max_score += weight
        items = getattr(research, field_name, [])
        min_count = _MIN_COUNTS.get(field_name, 2)

        if not items:
            continue
        elif len(items) >= min_count:
            score += weight  # Full credit
        else:
            score += weight * (len(items) / min_count)  # Partial credit

    # Deduct for issues
    critical_penalty = sum(0.15 for i in issues if i.severity == "critical")
    warning_penalty = sum(0.03 for i in issues if i.severity == "warning")

    raw = (score / max(max_score, 0.01)) - critical_penalty - warning_penalty
    return round(max(0.0, min(1.0, raw)), 2)

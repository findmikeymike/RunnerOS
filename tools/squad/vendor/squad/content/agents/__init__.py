"""Micro-agent chain for creative direction.

Instead of one massive system prompt, the Creative Director's job is split
into 4 focused agents that chain together. Each has a short prompt (~300 tokens)
and one clear job. LLMs follow short, specific instructions 10x better than
long essays.

Chain: BriefAnalyzer → TemplateSelector → PromptComposer → QualityGate

The coding agent wires these as LangGraph nodes. Each module exposes:
- A system prompt (SYSTEM_PROMPT constant)
- A run function that takes typed input and returns typed output
- No LLM client dependency — accepts an `llm_call` callable

Modules:
    brief_analyzer   — Classifies raw briefs into structured BriefAnalysis
    template_selector — Deterministic lookup: analysis → template + model IDs
    prompt_composer   — Fills templates with vivid scene descriptions (det + LLM)
    quality_gate      — Scores generated assets, decides ship/regenerate/escalate
"""

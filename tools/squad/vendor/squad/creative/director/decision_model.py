from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from creative.director.contracts import ALLOWED_DIRECTOR_ACTIONS, CreativeDirectorDecision, CreativeDirectorState
from creative.director.prompt import build_decision_prompt, director_decision_schema


@dataclass(frozen=True, slots=True)
class OpenAIResponsesDirectorDecisionModel:
    api_key: str
    model: str = "gpt-4.1-mini"
    base_url: str | None = None
    timeout_sec: int = 120
    client: object | None = None

    def _client(self):
        if self.client is not None:
            return self.client
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("openai package is required for director decisions") from exc
        kwargs = {"api_key": self.api_key, "timeout": self.timeout_sec}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        return OpenAI(**kwargs)

    def __call__(
        self,
        state: CreativeDirectorState | None,
        system_prompt: str | None = None,
        user_prompt: str | None = None,
    ) -> CreativeDirectorDecision:
        try:
            resolved_system, resolved_user = self._resolve_prompts(
                state=state,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
            )
            response = self._client().responses.create(
                model=self.model,
                input=[
                    {"role": "system", "content": [{"type": "input_text", "text": resolved_system}]},
                    {"role": "user", "content": [{"type": "input_text", "text": resolved_user}]},
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "creative_director_decision",
                        "strict": True,
                        "schema": director_decision_schema(),
                    }
                },
                store=False,
            )
            raw_text = getattr(response, "output_text", None)
            if not raw_text:
                return self._fail_closed("decision model returned no output")
            payload = json.loads(raw_text)
            return self._validate_payload(payload)
        except Exception as exc:
            return self._fail_closed(f"decision model failure: {exc}")

    @staticmethod
    def _resolve_prompts(
        *,
        state: CreativeDirectorState | None,
        system_prompt: str | None,
        user_prompt: str | None,
    ) -> tuple[str, str]:
        if system_prompt and user_prompt:
            return system_prompt, user_prompt
        if state is None:
            raise ValueError("state is required when prompts are not provided")
        return build_decision_prompt(state)

    @staticmethod
    def _validate_payload(payload: dict[str, Any]) -> CreativeDirectorDecision:
        action = payload.get("action")
        if action not in ALLOWED_DIRECTOR_ACTIONS:
            raise ValueError(f"unsupported action: {action}")
        rationale = str(payload.get("rationale", "")).strip()
        if not rationale:
            raise ValueError("rationale must not be empty")
        confidence = payload.get("confidence")
        if confidence is not None:
            confidence = float(confidence)
            if confidence < 0.0 or confidence > 1.0:
                raise ValueError("confidence must be between 0.0 and 1.0")
        return CreativeDirectorDecision(
            action=action,
            rationale=rationale,
            prompt_adjustment=_normalize_optional_string(payload.get("prompt_adjustment")),
            next_style_family=_normalize_optional_string(payload.get("next_style_family")),
            next_template_id=_normalize_optional_string(payload.get("next_template_id")),
            confidence=confidence,
        )

    @staticmethod
    def _fail_closed(reason: str) -> CreativeDirectorDecision:
        return CreativeDirectorDecision(
            action="escalate_to_human_review",
            rationale=reason,
            confidence=0.0,
        )


def _normalize_optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None

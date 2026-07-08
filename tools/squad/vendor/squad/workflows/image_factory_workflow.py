"""LangGraph-light workflow for the Sprint 1 image factory."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

from agents.image_factory_agent import ImageFactoryAgent
from core.agent_base import AgentContext
from core.config import Settings, load_settings
from creative.image_factory.assets import (
    DeterministicCopyBackgroundRemovalProvider,
    FalBackgroundRemovalProvider,
    prepare_product_asset,
    should_remove_background,
    validate_image_path,
)
from creative.image_factory.billing import CreativeBillingLedger
from creative.image_factory.contracts import ImageFactoryRequest, ImageFactoryResult, ImageFactoryState
from creative.image_factory.evals import ImageRunDecision, choose_run_decision
from creative.image_factory.scoring import ImageScorer, OpenAIResponsesImageScorer
from creative.image_factory.repository import ImageFactoryRepository
from creative.image_factory.review import build_review_packet
from memory.store import InMemoryStore, MemoryStore, make_memory_store

try:  # pragma: no cover
    from langgraph.graph import END, StateGraph
except Exception:  # pragma: no cover
    END = "__end__"
    StateGraph = None


@dataclass
class ImageFactoryWorkflow:
    fal_client: Any
    settings: Settings = field(default_factory=load_settings)
    store: MemoryStore = field(default_factory=InMemoryStore)
    image_factory_agent: ImageFactoryAgent = field(default_factory=ImageFactoryAgent)
    background_provider_override: Any | None = None
    image_scorer: ImageScorer | None = None

    @classmethod
    def from_settings(cls, fal_client: Any, settings: Settings | None = None) -> "ImageFactoryWorkflow":
        settings = settings or load_settings()
        store = make_memory_store(settings.postgres_dsn)
        return cls(fal_client=fal_client, settings=settings, store=store)

    @property
    def output_root(self) -> Path:
        return Path(self.settings.image_factory_output_root)

    def _make_context(self, run_id: str, request: ImageFactoryRequest) -> AgentContext:
        return AgentContext(
            run_id=run_id,
            brand_guidelines=self.settings.brand_guidelines,
            metadata={"template_id": request.template_id, **request.metadata},
        )

    def run(
        self,
        *,
        request: ImageFactoryRequest,
        product_subject: str,
        extra_variables: dict[str, str] | None = None,
        max_regeneration_attempts_override: int | None = None,
    ) -> ImageFactoryResult:
        repository = ImageFactoryRepository(store=self.store, output_root=self.output_root)
        run = repository.start_run(request, metadata={"template_id": request.template_id})
        context = self._make_context(run.id, request)
        prepared_asset = None
        plan = None
        variants = ()
        evaluations = ()
        decision = None
        generated_variants: list[Any] = []
        generated_evaluations: list[Any] = []
        warnings: list[str] = []
        attempts_run = 0
        ledger = CreativeBillingLedger(
            run_id=run.id,
            request_id=str(uuid4()),
            budget_cap_usd=request.budget_cap_usd,
        )
        try:
            background_provider = self._make_background_provider()
            source_path = validate_image_path(request.product_image_path, label="product image")
            if should_remove_background(request.background_mode, source_path):
                estimated_background_cost = float(getattr(background_provider, "cost_usd", 0.0))
                ledger.assert_can_afford(
                    estimated_background_cost,
                    provider=getattr(background_provider, "provider_name", "background-provider"),
                    operation="background.remove",
                )
            prepared_asset = prepare_product_asset(
                request,
                run_id=run.id,
                output_root=self.output_root,
                background_provider=background_provider,
            )
            repository.persist_asset(run.id, prepared_asset)
            warnings.extend(prepared_asset.warnings)
            if prepared_asset.background_removed and prepared_asset.background_provider_name:
                ledger.record(
                    provider=prepared_asset.background_provider_name,
                    operation="background.remove",
                    cost_usd=prepared_asset.background_removal_cost_usd,
                    provider_request_id=prepared_asset.background_removal_request_id,
                    latency_ms=prepared_asset.background_removal_latency_ms,
                    metadata={},
                )

            image_scorer = self.image_scorer or self._make_image_scorer()
            regeneration_hint: str | None = None
            configured_regeneration_attempts = (
                self.settings.image_factory_max_regeneration_attempts
                if max_regeneration_attempts_override is None
                else max_regeneration_attempts_override
            )
            max_attempts = max(1, int(configured_regeneration_attempts) + 1)
            for attempt_index in range(1, max_attempts + 1):
                attempts_run = attempt_index
                attempt_variants, attempt_evaluations, decision, plan = self._run_attempt(
                    repository=repository,
                    run_id=run.id,
                    request=request,
                    prepared_asset=prepared_asset,
                    context=context,
                    product_subject=product_subject,
                    extra_variables=extra_variables or {},
                    regeneration_hint=regeneration_hint,
                    attempt_index=attempt_index,
                    ledger=ledger,
                    image_scorer=image_scorer,
                    generated_variants=generated_variants,
                    generated_evaluations=generated_evaluations,
                    warnings=warnings,
                )
                variants = tuple(generated_variants)
                evaluations = tuple(generated_evaluations)
                if decision is None or decision.verdict in {"ship", "human_review", "unscored"}:
                    if decision is not None and decision.verdict != "ship":
                        warnings.append(f"run verdict is {decision.verdict}")
                    break
                if configured_regeneration_attempts <= 0:
                    warnings.append(
                        f"attempt {attempt_index} fell below ship threshold; internal regeneration disabled"
                    )
                else:
                    warnings.append(f"attempt {attempt_index} verdict is regenerate")
                if attempt_index >= max_attempts:
                    decision = self._decision_for_exhausted_regeneration(
                        evaluations=tuple(generated_evaluations),
                        fallback_attempt_index=attempt_index,
                    )
                    repository.persist_decision(run.id, decision)
                    if configured_regeneration_attempts <= 0:
                        warnings.append("internal regeneration disabled; escalating to human review")
                    else:
                        warnings.append("max regeneration attempts reached")
                    break
                regeneration_hint = self._regeneration_hint_for_attempt(attempt_evaluations)
            if decision is None:
                decision = choose_run_decision(())
                repository.persist_decision(run.id, decision)
                warnings.append("run verdict is unscored")
            for event in ledger.events:
                repository.persist_billing_event(run.id, event)
            billing_summary = ledger.summary()
            repository.persist_billing_summary(run.id, billing_summary)
            manifest = repository.write_manifest(
                run.id,
                state=ImageFactoryState(
                    run_id=run.id,
                    request=request,
                    prepared_asset=prepared_asset,
                    plan=plan,
                    variants=variants,
                    evaluations=evaluations,
                    decision=decision,
                    total_cost_usd=billing_summary.total_cost_usd,
                    attempts_run=attempts_run,
                    warnings=warnings,
                    errors=[],
                ),
                warnings=warnings,
                billing_summary=billing_summary,
                billing_events=list(ledger.events),
            )
            result = ImageFactoryResult(
                run_id=run.id,
                status="awaiting_review",
                variants=variants,
                evaluations=evaluations,
                decision=decision,
                total_cost_usd=billing_summary.total_cost_usd,
                manifest_path=manifest.manifest_path,
                warnings=tuple(warnings),
                trace_url=None,
                attempts_run=attempts_run,
            )
            review_packet = build_review_packet(result)
            approval_request_id = None
            approval = self.store.save_approval(
                run_id=run.id,
                stage="creative_review",
                summary=review_packet.summary,
                payload=review_packet.approval_payload,
                status="pending",
            )
            approval_request_id = approval.id
            repository.complete_run(run.id, status="awaiting_review")
            return ImageFactoryResult(
                run_id=result.run_id,
                status=result.status,
                variants=result.variants,
                total_cost_usd=result.total_cost_usd,
                manifest_path=result.manifest_path,
                evaluations=result.evaluations,
                decision=result.decision,
                warnings=result.warnings,
                trace_url=result.trace_url,
                attempts_run=result.attempts_run,
                review_packet_path=review_packet.review_path,
                approval_request_id=approval_request_id,
            )
        except Exception as exc:
            variants = tuple(generated_variants)
            evaluations = tuple(generated_evaluations)
            billing_summary = ledger.summary()
            if ledger.events:
                for event in ledger.events:
                    repository.persist_billing_event(run.id, event)
            if billing_summary.event_count:
                repository.persist_billing_summary(run.id, billing_summary)
            manifest = repository.write_manifest(
                run.id,
                status="failed",
                state=ImageFactoryState(
                    run_id=run.id,
                    request=request,
                    prepared_asset=prepared_asset,
                    plan=plan,
                    variants=variants,
                    evaluations=evaluations,
                    decision=decision,
                    total_cost_usd=billing_summary.total_cost_usd,
                    attempts_run=attempts_run,
                    warnings=warnings,
                    errors=[str(exc)],
                ),
                warnings=warnings,
                billing_summary=billing_summary if billing_summary.event_count else None,
                billing_events=list(ledger.events),
            )
            repository.complete_run(run.id, status="failed")
            raise RuntimeError(
                f"Image factory run {run.id} failed; manifest written to {manifest.manifest_path}"
            ) from exc

    def _run_attempt(
        self,
        *,
        repository: ImageFactoryRepository,
        run_id: str,
        request: ImageFactoryRequest,
        prepared_asset,
        context: AgentContext,
        product_subject: str,
        extra_variables: dict[str, str],
        regeneration_hint: str | None,
        attempt_index: int,
        ledger: CreativeBillingLedger,
        image_scorer: ImageScorer | None,
        generated_variants: list[Any],
        generated_evaluations: list[Any],
        warnings: list[str],
    ):
        plan_output = self.image_factory_agent.run(
            {
                "request": request,
                "product_subject": product_subject,
                "extra_variables": extra_variables,
                "attempt_index": attempt_index,
                "regeneration_hint": regeneration_hint,
            },
            context,
        )
        plan = plan_output["plan"]
        repository.persist_plan(run_id, plan)
        attempt_variants = self.fal_client.generate_variants(
            run_id=run_id,
            plan=plan,
            prepared_asset=prepared_asset,
            output_root=self.output_root,
            ledger=ledger,
            on_variant_ready=lambda variant: (
                generated_variants.append(variant),
                repository.persist_variant(run_id, variant),
            ),
        )
        attempt_evaluations = ()
        attempt_decision = None
        if image_scorer is not None:
            evaluation_records = []
            for variant in attempt_variants:
                try:
                    scoring_result = image_scorer.score(
                        run_id=run_id,
                        request=request,
                        prepared_asset=prepared_asset,
                        plan=plan,
                        variant=variant,
                    )
                    evaluation = scoring_result.evaluation
                except Exception as exc:
                    warnings.append(f"scoring failed for {variant.variant_id}: {exc}")
                    continue
                repository.persist_eval(run_id, evaluation)
                evaluation_records.append(evaluation)
                generated_evaluations.append(evaluation)
                if scoring_result.provider and scoring_result.operation:
                    ledger.record(
                        provider=scoring_result.provider,
                        operation=scoring_result.operation,
                        cost_usd=scoring_result.cost_usd,
                        provider_request_id=scoring_result.provider_request_id,
                        latency_ms=scoring_result.latency_ms,
                        metadata=dict(scoring_result.metadata or {}),
                    )
            attempt_evaluations = tuple(evaluation_records)
            attempt_decision = choose_run_decision(attempt_evaluations)
            repository.persist_decision(run_id, attempt_decision)
        return attempt_variants, attempt_evaluations, attempt_decision, plan

    @staticmethod
    def _regeneration_hint_for_attempt(evaluations) -> str | None:
        if not evaluations:
            return None
        ranked = sorted(evaluations, key=lambda item: item.weighted_average, reverse=True)
        return ranked[0].regeneration_hint

    @staticmethod
    def _decision_for_exhausted_regeneration(
        *,
        evaluations,
        fallback_attempt_index: int,
    ) -> ImageRunDecision:
        records = tuple(evaluations)
        if not records:
            return ImageRunDecision(
                verdict="human_review",
                selected_asset_id=None,
                selected_score=None,
                reason="regeneration budget exhausted without any scored variants",
                attempt_index=fallback_attempt_index,
            )
        winner = max(records, key=lambda item: item.weighted_average)
        return ImageRunDecision(
            verdict="human_review",
            selected_asset_id=winner.asset_id,
            selected_score=winner.weighted_average,
            reason="regeneration budget exhausted without a shippable result",
            attempt_index=winner.attempt_index,
        )

    def _make_background_provider(self):
        if self.background_provider_override is not None:
            return self.background_provider_override
        provider_setting = self.settings.image_background_removal_provider.strip().lower()
        if provider_setting in {"off", "none", "copy"}:
            return DeterministicCopyBackgroundRemovalProvider()
        if self.settings.fal_api_key:
            return FalBackgroundRemovalProvider(
                api_key=self.settings.fal_api_key,
                model_id=self.settings.fal_background_removal_model,
                timeout_sec=self.settings.fal_timeout_sec,
                cost_usd=self.settings.fal_background_removal_cost_usd,
            )
        return DeterministicCopyBackgroundRemovalProvider()

    def _make_image_scorer(self) -> ImageScorer | None:
        provider_setting = self.settings.image_eval_provider.strip().lower()
        if provider_setting in {"off", "none", ""}:
            return None
        if provider_setting in {"structural", "local"}:
            from creative.image_factory.scoring import StructuralImageScorer
            return StructuralImageScorer()
        if provider_setting in {"openai", "auto"} and self.settings.openai_api_key:
            return OpenAIResponsesImageScorer(
                api_key=self.settings.openai_api_key,
                model=self.settings.openai_image_scorer_model,
                base_url=self.settings.openai_base_url,
                estimated_cost_usd=self.settings.openai_image_scorer_cost_usd,
                timeout_sec=self.settings.fal_timeout_sec,
            )
        return None

    def build_langgraph(self):
        if StateGraph is None:
            return None
        raise NotImplementedError(
            "build_langgraph is intentionally disabled until it matches the full run() semantics "
            "(budgeting, retries, scoring, review packet, approvals). Use run() for production behavior."
        )

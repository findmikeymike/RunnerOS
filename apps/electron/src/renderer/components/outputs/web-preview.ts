import type { OutputManifestDTO } from '@/hooks/useOutputs'
import {
  isLocalWebPreviewUrl as isSharedLocalWebPreviewUrl,
  resolveGeneratedHtmlPreviewTarget,
  resolveLocalWebPreviewTarget,
  RUNNER_OUTPUT_SCHEME,
  type WebPreviewPolicyOptions,
} from '@craft-agent/shared/outputs/web-preview'

export interface WebPreviewTarget {
  url: string
  label: string
  displayHost: string
}

export function isLocalWebPreviewUrl(value: string | undefined, options: WebPreviewPolicyOptions = {}): boolean {
  return isSharedLocalWebPreviewUrl(value, options)
}

export function resolveWebPreviewTarget(manifest: OutputManifestDTO, options: WebPreviewPolicyOptions = {}): WebPreviewTarget | null {
  return resolveLocalWebPreviewTarget(manifest, options) ?? resolveGeneratedHtmlPreviewTarget(manifest)
}

export function isGeneratedOutputPreviewUrl(url: string): boolean {
  return url.startsWith(`${RUNNER_OUTPUT_SCHEME}:`)
}

/**
 * Each generated output now has a separate protocol origin. Retain that origin
 * for same-bundle fetch, modules and fonts. The protocol handler verifies the
 * host/path binding and sends a self-only CSP in iframe AND Browser Pane.
 * Legacy shared-origin URLs redirect to a scoped origin before serving bytes.
 */
export const GENERATED_OUTPUT_SANDBOX = 'allow-scripts allow-forms allow-same-origin'

/**
 * A localhost dev server is already its own origin and cannot reach
 * `runner-output://` assets, so the shared-origin problem above does not apply.
 * It keeps `allow-same-origin` because real sites need storage and same-origin
 * fetch to render at all.
 */
export const LOCAL_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-same-origin'

/** Sandbox attribute for a preview iframe, chosen by how much the source is trusted. */
export function sandboxForPreviewUrl(url: string): string {
  return isGeneratedOutputPreviewUrl(url) ? GENERATED_OUTPUT_SANDBOX : LOCAL_PREVIEW_SANDBOX
}

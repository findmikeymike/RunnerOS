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
 * Agent-authored HTML served from `runner-output://`. No `allow-same-origin`:
 * every `runner-output://` URL shares one origin (`runner-output://asset` —
 * the workspace and output ids live in the path, not the host), so a document
 * with a real origin here could read any other output of any other local
 * workspace. An opaque origin removes that read primitive entirely.
 *
 * Kept in step with `HTML_PREVIEW_CSP` in `main/output-asset-protocol.ts`,
 * which allows subresources by scheme precisely because `'self'` cannot match
 * an opaque origin.
 */
export const GENERATED_OUTPUT_SANDBOX = 'allow-scripts allow-forms'

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

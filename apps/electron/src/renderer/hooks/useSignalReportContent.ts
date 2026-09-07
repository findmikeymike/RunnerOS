import { useEffect, useState } from 'react'
import { loadFullSignalOutputText } from '../lib/artist-signals'

type TextInput = Parameters<typeof loadFullSignalOutputText>[0]
interface Selection {
  key: string
  kind: 'context' | 'output'
  summary: string
  body?: string
  output?: TextInput['output'] & { updatedAt?: string }
}

/** Output-list broadcasts must not restart playback for an unchanged report. */
export function useSignalReportContent(workspaceId: string, item: Selection | null, getOutput: TextInput['getOutput']) {
  const key = item?.key
  const kind = item?.kind
  const body = item?.body
  const summary = item?.summary
  const outputId = item?.output?.id
  const updatedAt = item?.output?.updatedAt
  const inlineText = item?.output?.preview?.inlineText
  const assetId = item?.output?.preview?.assetId
  const outputSummary = item?.output?.summary
  const revision = JSON.stringify([workspaceId, key, kind, body, summary, outputId, updatedAt, inlineText, assetId, outputSummary])
  const [result, setResult] = useState({ revision: '', content: '', loading: false })

  useEffect(() => {
    let cancelled = false
    if (!key || kind === 'context' || !outputId) {
      setResult({ revision, content: key ? body || summary || '' : '', loading: false })
      return
    }
    const fallback = inlineText || outputSummary || 'This report has no readable text preview.'
    setResult({ revision, content: fallback, loading: true })
    void loadFullSignalOutputText({
      output: { id: outputId, summary: outputSummary, preview: { inlineText, assetId } },
      getOutput,
      readAssetText: (id, asset) => window.electronAPI.readOutputAssetText(workspaceId, id, asset),
    }).then(content => {
      if (!cancelled) setResult({ revision, content: content.trim() || fallback, loading: false })
    }).catch(() => {
      if (!cancelled) setResult({ revision, content: fallback, loading: false })
    })
    return () => { cancelled = true }
  }, [workspaceId, key, kind, body, summary, outputId, updatedAt, inlineText, assetId, outputSummary, revision, getOutput])

  return result.revision === revision ? result : { content: '', loading: Boolean(key) }
}

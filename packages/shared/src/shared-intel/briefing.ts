/** Text-only contract shared by Signals readers and explicit audio requests. */
export const SIGNAL_BRIEFING_INSTRUCTIONS = `Include a section headed exactly "## Your Briefing" after the complete detailed report and its sources. Keep this section only in the report; do not create a separate briefing context document or duplicate Output.
Write the detailed report first in your reasoning, then ground this briefing only in findings supported by that report. The briefing must be 120-150 words of natural, conversational plain text, like the artist's manager talking directly to them, not a formal summary or a list. Pick the 2-3 strongest supported insights and explain why they matter to this artist. Include a small next move only when the evidence and available artist context support it; never invent relevance, metrics, urgency, or advice. Preserve uncertainty and mention missing coverage when material. If fewer insights are supported, use fewer; do not pad or manufacture findings to meet the count. If the scan is unavailable or there are no usable findings, omit Your Briefing entirely.
Use no bullets, links, citations, Markdown emphasis, code, or stage directions in Your Briefing. End it with: "The full report has the details and sources."
This is a written script only. Do not generate audio, invoke speech tools, or start playback. Return the complete report directly to the workflow, not a separate duplicate Output.`;

interface SignalReportIdentity {
  kind?: string;
  title?: string;
  status?: string;
  primary?: { id?: string };
  primaryAssetId?: string;
  tags?: readonly string[];
  origin?: { source?: string; workflowSlug?: string; workflowRunId?: string; stepId?: string };
}

/** Eligibility only: confirming the run's finalOutputId requires a host lookup. */
export function isFinalSignalReport(output: SignalReportIdentity): boolean {
  return output.kind === 'report'
    && output.status === 'published'
    && Boolean(output.primary?.id?.trim() || output.primaryAssetId?.trim())
    && output.origin?.source === 'workflow'
    && output.origin.workflowSlug === 'weekly-signal-scan'
    && Boolean(output.origin.workflowRunId?.trim())
    && output.origin.stepId === 'synthesize'
    && !output.tags?.includes('signal-source-packet');
}

/** Fail closed rather than reading an old report, source packet, or markup aloud. */
export function parseSignalBriefing(markdown: string): string | null {
  if (!markdown || markdown.length > 100_000) return null;
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let fence: { marker: string; length: number } | null = null;
  let found = false;
  let collecting = false;
  const body: string[] = [];
  for (const line of lines) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (delimiter && delimiter[1]![0] === fence.marker
        && delimiter[1]!.length >= fence.length && !delimiter[2]!.trim()) fence = null;
      continue;
    }
    if (delimiter) {
      if (collecting) return null;
      fence = { marker: delimiter[1]![0]!, length: delimiter[1]!.length };
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})[\t ]+(.*)$/);
    if (heading) {
      const title = heading[2]!.replace(/[\t ]+#+[\t ]*$/, '').trim();
      if (heading[1] === '##' && title === 'Your Briefing') {
        if (found) return null;
        found = collecting = true;
        continue;
      }
      if (heading[1]!.length <= 2) collecting = false;
      else if (collecting) return null;
    }
    // A setext heading also ends the section; never include its title in speech.
    if (collecting && /^ {0,3}(?:=+|-+)[\t ]*$/.test(line) && body.at(-1)?.trim()) {
      body.pop();
      collecting = false;
    }
    if (collecting) body.push(line);
  }
  const text = body.join('\n').trim();
  if (!found || text.length > 2_000
    || /[`*_<>{}\[\]|]|https?:\/\/|www\.|&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(text)
    || /^\s*(?:[-+#>]\s|\d+[.)]\s|\S.*\n(?:=+|-+)\s*$)/m.test(text)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(text)) return null;
  const words = text.split(/\s+/);
  return words.length >= 80 && words.length <= 180 ? words.join(' ') : null;
}

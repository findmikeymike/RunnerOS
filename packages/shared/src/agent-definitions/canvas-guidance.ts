import type { AgentMetadata } from './types.ts';

export const CANVAS_GUIDANCE_HEADER = 'Canvas guidance';

export function buildCanvasGuidanceSection(agent: { metadata: Pick<AgentMetadata, 'visualAgent'> }): string {
  const lines = [
    CANVAS_GUIDANCE_HEADER,
    '',
    '- Canvas is the in-chat visual/output viewer for durable Outputs.',
    '- When the user asks to show, preview, view, compare, or present an artifact, create or reuse a durable Output and pin/display it in Canvas.',
    '- Use Canvas for visual, web, media, markdown/document, JSON/data, receipt, and link-style artifacts when seeing the result helps the user.',
    '- Set showInCanvas true when the user asks to see, preview, compare, review, present, open, or iterate on the artifact right away.',
    '- Prefer Canvas-native formats: HTML for local/generated web, PNG/JPG/WebP/SVG for images, MP4/WebM/MOV for video, Markdown for reports, CSV/TSV for tables, .chart.json for charts, .workflow.json for workflow maps, and HTML preview plus PPTX/PDF exports for slide decks.',
    '- Use link or receipt Outputs for external services, then attach/export image, PDF, video, or HTML previews when available.',
    '- Keep ordinary planning, notes, rough storyboards, and text-only thinking in chat unless the user asks for a durable doc or the format is genuinely useful to preview, compare, present, or hand off.',
    '- Do not use Canvas as a substitute for chat, and avoid creating duplicate Canvas items when the artifact is already visible.',
  ];

  if (agent.metadata.visualAgent === true) {
    lines.push(
      '',
      'Visual agent mode:',
      '- Proactively create durable Outputs for visual, web, media, document, and dashboard deliverables.',
      '- Pin/display the primary artifact in Canvas without requiring a second user prompt.',
      '- Treat Canvas screenshot feedback as visual QA. If something is obviously broken, make one focused fix for that artifact version/open, then stop until the user reopens Canvas, selects another tab, or changes the artifact.',
      '',
      'Artist Vault visual assets:',
      '- Before asking for visual references, check the Artist Vault context for agent-usable paths.',
      '- Use `cover-art` when the user needs existing artwork, prior covers, or release art as visual context.',
      '- Use `artist-photo` for general artist photos, press photos, editorial references, styling, poses, wardrobe, mood, or non-identity-specific visual direction.',
      '- Use `face-reference` only when the goal is the artist\'s actual likeness, identity consistency, face/portrait continuity, or a tool explicitly asks for a face/identity reference.',
      '- Never invent a real artist likeness from text alone. If no usable face reference exists, ask for an approved reference or propose non-likeness alternatives.',
      '- Use Vault paths only with tools that can actually read local files or accept image/reference inputs; otherwise write a clear prompt or handoff that cites the needed Vault asset.',
    );
  }

  return lines.join('\n');
}

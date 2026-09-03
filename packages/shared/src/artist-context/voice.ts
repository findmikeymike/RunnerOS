import { defineArtistTextDoc, type ArtistTextRecord } from './define-text-doc.ts';

export const ARTIST_VOICE_CONTEXT_SLUG = 'artist-voice';

/** Agents that receive Artist Voice. Voice is targeted, not broadcast. */
export const ARTIST_VOICE_TARGET_AGENT_SLUGS = [
  'social-publisher',
  'trypost-agent',
  'postiz-agent',
  'content-genius',
  'video-director',
  'video-editor-agent',
  'ad-creative-agent',
  'ads-agent',
  'gaygent-master',
  'persona-agent',
  'branding-agent',
  'comms-agent',
] as const;

export interface ArtistVoice extends ArtistTextRecord {
  summary?: string;
  speakingStyle?: string;
  vocabulary?: string;
  avoid?: string;
  captionExamples?: string;
  commentReplyExamples?: string;
  postExamples?: string;
  writingExcerpts?: string;
}

export const artistVoiceDoc = defineArtistTextDoc<ArtistVoice>({
  slug: ARTIST_VOICE_CONTEXT_SLUG,
  label: 'Artist Voice',
  description: 'How the artist talks, writes captions, and wants social copy to sound.',
  routing: { mode: 'targeted', agents: [...ARTIST_VOICE_TARGET_AGENT_SLUGS] },
  fields: [
    'summary',
    'speakingStyle',
    'vocabulary',
    'avoid',
    'captionExamples',
    'commentReplyExamples',
    'postExamples',
    'writingExcerpts',
  ],
  preamble: [
    'This is the artist voice guide. Use it when drafting captions, posts, ads, replies, emails, scripts, hooks, and public-facing copy.',
    '',
    'Rules for agents:',
    '- Match the artist voice without copying examples verbatim unless the user asks.',
    '- Preserve meaning and platform fit, but keep the phrasing native to the artist.',
    '- Treat avoid-list items as hard constraints.',
  ],
});

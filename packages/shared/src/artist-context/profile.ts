import { defineArtistTextDoc, type ArtistTextRecord } from './define-text-doc.ts';
import { normalizeProseText } from './text.ts';

export const ARTIST_PROFILE_CONTEXT_SLUG = 'artist-profile';

export interface ArtistProfile extends ArtistTextRecord {
  artistName?: string;
  mission?: string;
  aliases?: string;
  bio?: string;
  themes?: string;
  sound?: string;
  visualWorld?: string;
  bannerImagePath?: string;
  brandWords?: string;
  audience?: string;
  similarArtists?: string;
  priorityMarkets?: string;
  socialLinks?: string;
  spotifyProfile?: string;
  team?: string;
  promoBudget?: string;
  rules?: string;
}

/** Reads `- Label: value` out of the hand-filled markdown intake form. */
function extractMarkdownField(body: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`^-\\s*${escaped}:[ \\t]*(.*)$`, 'im'));
  return normalizeProseText(match?.[1]);
}

/**
 * Recovers a profile from the markdown intake form used during onboarding,
 * before the doc has been round-tripped through the UI into JSON. Several
 * intake answers fold into one profile field, joined by newlines.
 */
function parseMarkdownProfileIntake(body: string): Partial<ArtistProfile> | null {
  if (!body.includes('## Basics') || !body.includes('- Artist name:')) {
    return null;
  }

  const field = (label: string) => extractMarkdownField(body, label);
  const combined = (...values: Array<string | undefined>) => values.filter(Boolean).join('\n');

  return {
    version: 1,
    artistName: field('Artist name'),
    aliases: combined(field('Stage name (if different)'), field('Location / origin')),
    bio: combined(
      field('What do fans (or friends) say about your music'),
      field('A lyric, line, or idea that feels like "you"'),
      field('Recent releases, demos, or works in progress'),
      field("What's already been tried (content, ads, playlisting, shows)"),
      field('Anything else the HQ brain should know before making worker recommendations'),
    ),
    themes: combined(
      field('What emotional territory does your music live in'),
      field('What are you actively promoting right now'),
      field("What's your next 60-day goal"),
      field('Cultural references (cities, subcultures, movements, moments)'),
    ),
    sound: combined(
      field('Primary genre or lane'),
      field('One-sentence sound description'),
      field('Sonic references (producers, albums, textures, moods)'),
    ),
    visualWorld: field('Visual references (films, fashion, photographers, eras, aesthetics)'),
    audience: combined(
      field('Who feels seen by this? (Psychographic, not demographic — e.g., "people who...")'),
      field('Where do they hang out online'),
      field('What are they already fans of (music, shows, brands, subcultures)'),
    ),
    similarArtists: combined(
      field('3 artists you actually sound like'),
      field('3 artists you want to be compared to'),
    ),
    socialLinks: combined(
      field('Social handles and current follower counts (if known)'),
      field('Link to best existing content (song, video, post)'),
    ),
    rules: field('One thing you refuse to be in your branding'),
  };
}

export const artistProfileDoc = defineArtistTextDoc<ArtistProfile>({
  slug: ARTIST_PROFILE_CONTEXT_SLUG,
  label: 'Artist Profile',
  description:
    'Global artist identity, audience, brand, music, and operating context for workers.',
  routing: { mode: 'broadcast' },
  // Who the artist is. No agent should have to ask for this.
  delivery: 'always',
  fields: [
    'artistName',
    'mission',
    'aliases',
    'bio',
    'themes',
    'sound',
    'visualWorld',
    'bannerImagePath',
    'brandWords',
    'audience',
    'similarArtists',
    'priorityMarkets',
    'socialLinks',
    'spotifyProfile',
    'team',
    'promoBudget',
    'rules',
  ],
  completionFields: [
    'artistName',
    'mission',
    'bio',
    'themes',
    'sound',
    'visualWorld',
    'brandWords',
    'audience',
    'similarArtists',
    'priorityMarkets',
    'socialLinks',
    'spotifyProfile',
    'promoBudget',
    'rules',
  ],
  preamble: [
    'This is global artist profile context. Treat it as long-term creator context, not one-campaign context.',
  ],
  fallbackParse: parseMarkdownProfileIntake,
});

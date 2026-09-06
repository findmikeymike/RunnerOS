import { defineArtistTextDoc, type ArtistTextRecord } from './define-text-doc.ts';
import { ARTIST_BRANDING_ALWAYS_AGENT_SLUGS } from '../workspace-context/types.ts';

export const ARTIST_BRANDING_CONTEXT_SLUG = 'artist-branding';

export interface ArtistBranding extends ArtistTextRecord {
  creativeDna?: string;
  tensions?: string;
  fascinations?: string;
  reactionHooks?: string;
  mythology?: string;
  emotionalTerritory?: string;
  audienceGravity?: string;
  notes?: string;
}

/**
 * Agents that always receive Artist Branding in their prompt. Everyone else can
 * still read it on demand — see `SYSTEM_CONTEXT_DOC_DELIVERY`, which is the
 * single source of truth and is what the injection decision actually consults.
 */
export { ARTIST_BRANDING_ALWAYS_AGENT_SLUGS };

export const artistBrandingDoc = defineArtistTextDoc<ArtistBranding>({
  slug: ARTIST_BRANDING_CONTEXT_SLUG,
  label: 'Artist Branding',
  description:
    'Brand DNA, creative gravity, mythology, tensions, and audience psychology for branding workers.',
  routing: { mode: 'broadcast' },
  // Readable by everyone (routing stays broadcast); auto-injected only for the
  // agents that need brand DNA in front of them on every turn.
  delivery: 'on-demand',
  deliveryAlwaysFor: ARTIST_BRANDING_ALWAYS_AGENT_SLUGS,
  fields: [
    'creativeDna',
    'tensions',
    'fascinations',
    'reactionHooks',
    'mythology',
    'emotionalTerritory',
    'audienceGravity',
    'notes',
  ],
  completionFields: [
    'creativeDna',
    'tensions',
    'fascinations',
    'reactionHooks',
    'mythology',
    'emotionalTerritory',
    'audienceGravity',
  ],
  preamble: [
    'This is the artist branding guide. Use it when shaping positioning, narrative, creative direction, visuals, campaigns, hooks, content angles, and artist mythology.',
    '',
    'Rules for agents:',
    '- Treat this as brand gravity, not a questionnaire.',
    '- Preserve contradictions, fascinations, symbols, and emotional territory when creating brand work.',
    '- Use Profile and Voice context with this guide when drafting public-facing output.',
  ],
});

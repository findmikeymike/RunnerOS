/**
 * Artist context docs — shared schemas
 *
 * The artist's durable context (profile, voice, branding, and the analytics /
 * relationship docs that follow) is stored as workspace context docs holding a
 * ```json record under prose guidance. These definitions are the single source
 * of truth for that format so the renderer, the HQ state composer, and
 * server-side session tools all read and write the same shape.
 */
export * from './text.ts';
export * from './json-block.ts';
export * from './define-text-doc.ts';
export * from './snapshot-doc.ts';
export * from './profile.ts';
export * from './voice.ts';
export * from './branding.ts';
export * from './spotify.ts';
export * from './instagram.ts';
export * from './workspace-link.ts';
export * from './calendar.ts';
export * from './network.ts';

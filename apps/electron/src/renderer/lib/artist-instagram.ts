/**
 * Renderer view of the Artist Instagram Snapshot context doc.
 * Schema, parsing, and the growth-history helper live in
 * `@craft-agent/shared/artist-context` so server-side tools read the same
 * format. Re-exported here to keep the `@/lib/artist-*` import convention.
 */
export {
  ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG,
  artistInstagramSnapshotMetadata,
  buildArtistInstagramGrowthHistory,
  parseArtistInstagramSnapshotDocResult,
  parseArtistInstagramSnapshotJsonResult,
  serializeArtistInstagramSnapshotBody,
  type ArtistInstagramGrowthPoint,
  type ArtistInstagramSnapshot,
  type ArtistInstagramSnapshotParseResult,
} from '@craft-agent/shared/artist-context'

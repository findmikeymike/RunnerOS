/**
 * Renderer view of the Artist Spotify Snapshot context doc.
 * Schema, parsing, and the history/growth helpers live in
 * `@craft-agent/shared/artist-context` so server-side tools read the same
 * format. Re-exported here to keep the `@/lib/artist-*` import convention.
 */
export {
  ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG,
  artistSpotifySnapshotMetadata,
  buildArtistSpotifyStreamHistory,
  calculateArtistSpotifyGrowth,
  parseArtistSpotifySnapshotDocResult,
  parseArtistSpotifySnapshotJsonResult,
  serializeArtistSpotifySnapshotBody,
  type ArtistSpotifyDataSource,
  type ArtistSpotifyGrowth,
  type ArtistSpotifyHistoryPoint,
  type ArtistSpotifySnapshot,
  type ArtistSpotifySnapshotParseResult,
} from '@craft-agent/shared/artist-context'

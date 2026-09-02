/**
 * Renderer view of the Artist Network context doc.
 * Schema, parsing, and the person/category helpers live in
 * `@craft-agent/shared/artist-context` so server-side tools read the same
 * format. Re-exported here to keep the `@/lib/artist-*` import convention.
 */
export {
  ARTIST_NETWORK_CONTEXT_SLUG,
  NETWORK_CATEGORIES,
  artistNetworkMetadata,
  createNetworkCategory,
  createNetworkPerson,
  emptyArtistNetwork,
  linkNetworkPersonToWorkspace,
  networkPeopleForWorkspace,
  normalizeArtistNetworkEmail,
  parseArtistNetworkDoc,
  parseArtistNetworkDocResult,
  serializeArtistNetworkBody,
  unlinkNetworkPersonFromWorkspace,
  updateNetworkPerson,
  type ArtistNetwork,
  type ArtistNetworkCategory,
  type ArtistNetworkCategoryDefinition,
  type ArtistNetworkParseResult,
  type ArtistNetworkPerson,
  type ArtistNetworkRelationship,
  type ArtistWorkspaceLink,
  type GooglePeopleSyncState,
} from '@craft-agent/shared/artist-context'

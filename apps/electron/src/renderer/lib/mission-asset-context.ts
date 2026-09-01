// Keep one serializer for agent-facing campaign context. Renderer drift previously
// exposed review-needed lyrics that the server correctly withheld.
export {
  MISSION_ASSET_CONTEXT_SLUG,
  missionAssetContextMetadata,
  serializeMissionAssetContext,
} from '@craft-agent/shared/mission-assets/manifest-context'

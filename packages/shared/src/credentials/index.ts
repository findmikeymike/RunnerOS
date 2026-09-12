/**
 * Credential Storage Module
 *
 * Provides secure credential storage using AES-256-GCM encrypted file.
 * All methods auto-initialize, so explicit initialize() calls are optional.
 *
 * Usage:
 *   import { getCredentialManager } from './credentials';
 *
 *   const manager = getCredentialManager();
 *
 *   // Get/set API key
 *   const apiKey = await manager.getApiKey();
 *   await manager.setApiKey('sk-ant-...');
 *
 *   // Get/set workspace OAuth
 *   const oauth = await manager.getWorkspaceOAuth(workspaceId);
 *   await manager.setWorkspaceOAuth(workspaceId, { accessToken, refreshToken, ... });
 *
 *   // Get/set agent MCP/API credentials
 *   const mcpCreds = await manager.getMcpOAuth(wsId, agentId, serverName);
 *   const apiKey = await manager.getApiKeyForAgent(wsId, agentId, apiName);
 */

export { CredentialManager, getCredentialManager, isValidUserSecretName, maskSecretValue, normalizeUserSecretName } from './manager.ts';
export type { UserSecretSummary, CredentialSnapshot } from './manager.ts';
export {
  INWORLD_API_KEY_NAME,
  INWORLD_VOICE_ID_NAME,
  INWORLD_LEGACY_API_KEY_NAMES,
  INWORLD_LEGACY_VOICE_ID_NAMES,
  INWORLD_API_KEY_NAMES,
  INWORLD_VOICE_ID_NAMES,
  buildInworldBasicAuthorization,
  resolveInworldApiKey,
  resolveInworldVoiceId,
} from './inworld.ts';
export type { CredentialId, CredentialType, StoredCredential } from './types.ts';
export { credentialIdToAccount, accountToCredentialId, SOURCE_CREDENTIAL_TYPES } from './types.ts';
export type { CredentialBackend } from './backends/types.ts';

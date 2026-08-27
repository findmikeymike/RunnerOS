import { describe, expect, test } from 'bun:test';
import { RPC_CHANNELS, getAllChannelValues } from '../protocol/channels.ts';
import { classifyArtistOSLicenseChannel } from './channel-policy.ts';

describe('ArtistOS license channel policy', () => {
  test('keeps recovery, reading, audit, and raw export reachable', () => {
    for (const channel of [
      RPC_CHANNELS.workflowRuns.GET,
      RPC_CHANNELS.workflowRuns.LIST,
      RPC_CHANNELS.resources.EXPORT,
      RPC_CHANNELS.outputs.READ_ASSET_TEXT,
      RPC_CHANNELS.settings.GET_SERVER_CONFIG,
      RPC_CHANNELS.sessions.CANCEL,
      RPC_CHANNELS.workflowRuns.CANCEL,
      RPC_CHANNELS.browserPane.STOP,
    ]) expect(classifyArtistOSLicenseChannel(channel)).toBe('always-reachable');
  });

  test('gates representative execution and canonical mutations', () => {
    for (const channel of [
      RPC_CHANNELS.sessions.SEND_MESSAGE,
      RPC_CHANNELS.workflowRuns.START,
      RPC_CHANNELS.outputs.PROMOTE_TO_FINAL,
      RPC_CHANNELS.artistVault.SAVE_OUTPUT_ASSET,
      RPC_CHANNELS.deepResearch.START,
      RPC_CHANNELS.community.SEND_RESEND_EMAIL,
      RPC_CHANNELS.update.CHECK,
      RPC_CHANNELS.server.CREATE_WORKSPACE,
      RPC_CHANNELS.workspaces.CREATE,
      RPC_CHANNELS.secrets.FUND_ZERO,
      'workspace:remove',
    ]) expect(classifyArtistOSLicenseChannel(channel)).toBe('paid');
  });

  test('fails new and unknown channels closed as paid', () => {
    expect(classifyArtistOSLicenseChannel('future:execute')).toBe('paid');
    for (const channel of getAllChannelValues()) {
      expect(['always-reachable', 'paid']).toContain(classifyArtistOSLicenseChannel(channel));
    }
  });
});

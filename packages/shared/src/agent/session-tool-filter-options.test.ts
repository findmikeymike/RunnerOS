import { describe, expect, test } from 'bun:test';
import { getSessionToolDefs } from '@craft-agent/session-tools-core';
import { deriveSessionToolFilterOptions } from './session-tool-filter-options.ts';
import { getSessionToolProxyDefs } from './backend/pi/session-tool-defs.ts';
import { isToolBlockedForDelegatedSession } from './spawn-session-isolation.ts';
import { RUNTIME_IDENTITY } from '../config/runtime-identity.ts';
import { FEATURE_FLAGS } from '../feature-flags.ts';

describe('shared session tool role and scope derivation', () => {
  test('Manager privileges follow canonical slug and workspace scope', () => {
    const hq = deriveSessionToolFilterOptions('concierge', 'hq');
    expect(hq.includeManagerTools).toBe(true);
    expect(hq.includeCampaignManagerTools).toBe(false);
    expect(hq.includeScheduleWork).toBe(true);
    expect(hq.includeSupplyWorkInput).toBe(true);
    expect(deriveSessionToolFilterOptions('concierge', 'campaign').includeCampaignManagerTools).toBe(true);
    expect(deriveSessionToolFilterOptions('concierge', 'lab').includeManagerTools).toBe(false);
    expect(deriveSessionToolFilterOptions('Artist Manager', 'hq').includeManagerTools).toBe(false);
  });

  test('Lab exposure comes from scope and social tools retain their role split', () => {
    expect(deriveSessionToolFilterOptions('record-doctor', 'lab').includeLabTools).toBe(true);
    expect(deriveSessionToolFilterOptions('record-doctor', 'campaign').includeLabTools).toBe(false);
    const editor = deriveSessionToolFilterOptions('raw-video-editor', 'campaign');
    expect(editor.includeSocialVariantTools).toBe(true);
    expect(editor.includeSocialVariantQueryTools).toBe(false);
    const publisher = deriveSessionToolFilterOptions('social-publisher', 'campaign');
    expect(publisher.includeSocialVariantQueryTools).toBe(true);
    expect(publisher.includeSocialVariantTools).toBe(false);
    expect(Object.values(deriveSessionToolFilterOptions(undefined, undefined)).every((flag) => !flag)).toBe(true);
  });

  for (const agentSlug of [undefined, 'concierge', 'raw-video-editor', 'social-publisher', 'scriptwriter']) {
    for (const scope of [undefined, 'hq', 'campaign', 'lab']) {
      for (const delegated of [false, true]) {
        test(`Claude/Pi role parity: ${agentSlug ?? 'ordinary'} / ${scope ?? 'unspecified'} / delegated=${delegated}`, () => {
          const roleOptions = deriveSessionToolFilterOptions(agentSlug, scope);
          const claude = getSessionToolDefs({
            ...roleOptions,
            includeManagedSkillTools: RUNTIME_IDENTITY.variant === 'artist-os',
            includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback,
          }).map((tool) => tool.name)
            .filter((name) => !isToolBlockedForDelegatedSession(name, delegated));
          const pi = getSessionToolProxyDefs(roleOptions)
            .filter((tool) => !isToolBlockedForDelegatedSession(tool.name, delegated))
            .map((tool) => tool.name.replace(/^mcp__session__/, ''));
          expect(pi).toContain('update_tasks');
          expect(claude).not.toContain('update_tasks');
          expect(pi.filter((name) => name !== 'update_tasks').sort()).toEqual(claude.sort());
        });
      }
    }
  }
});

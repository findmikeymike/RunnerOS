import { describe, expect, test } from 'bun:test';
import { getSessionToolDefs } from '@craft-agent/session-tools-core';
import { deriveSessionToolFilterOptions } from './session-tool-filter-options.ts';
import { getSessionToolProxyDefs } from './backend/pi/session-tool-defs.ts';
import { isToolBlockedForDelegatedSession } from './spawn-session-isolation.ts';
import { RUNTIME_IDENTITY } from '../config/runtime-identity.ts';
import { FEATURE_FLAGS } from '../feature-flags.ts';

describe('shared session tool role and scope derivation', () => {
  test('Composio tools belong only to approved Artist OS communication roles in HQ/Campaign', () => {
    for (const role of ['concierge', 'comms-agent', 'outreach-agent', 'builder', 'gravity', undefined]) {
      for (const scope of ['hq', 'campaign', 'lab', undefined]) {
        for (const variant of ['artist-os', 'runneros']) {
          const options = deriveSessionToolFilterOptions(role, scope, variant);
          const expected = ['concierge', 'comms-agent', 'outreach-agent'].includes(role ?? '') && variant === 'artist-os' && (scope === 'hq' || scope === 'campaign');
          expect(options.includeComposioTools).toBe(expected);
          expect(getSessionToolDefs(options).some(tool => tool.name === 'composio_gmail_send')).toBe(expected);
          expect(getSessionToolProxyDefs(options).some(tool => tool.name === 'mcp__session__composio_gmail_send')).toBe(expected);
        }
      }
    }
  });

  test('Website source context belongs only to Website Agent in Artist HQ or Campaigns', () => {
    for (const role of ['website-agent', 'site-builder', 'concierge', undefined]) {
      for (const scope of ['hq', 'campaign', 'lab', undefined]) {
        for (const variant of ['artist-os', 'runneros']) {
          const options = deriveSessionToolFilterOptions(role, scope, variant);
          const expected = role === 'website-agent' && variant === 'artist-os' && (scope === 'hq' || scope === 'campaign');
          expect(options.includeWebsiteCampaignContext).toBe(expected);
          expect(getSessionToolDefs(options).some(tool => tool.name === 'get_website_campaign_context')).toBe(expected);
          expect(getSessionToolProxyDefs(options).some(tool => tool.name === 'mcp__session__get_website_campaign_context')).toBe(expected);
        }
      }
    }
  });

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

  test('Artist OS Builder schedules without inheriting Manager or goal privileges', () => {
    const options = deriveSessionToolFilterOptions('builder', 'hq', 'artist-os');
    const names = getSessionToolDefs(options).map(tool => tool.name);
    expect(names).toContain('schedule_work');
    expect(names).toContain('create_agent');
    expect(names).toContain('list_automations');
    expect(names).toContain('get_automation');
    expect(names).toContain('update_automation');
    expect(names).not.toContain('supply_work_input');
    expect(names).not.toContain('manage_goal_run');
    expect(names).not.toContain('get_manager_brief');
  });

  test('stock Artist OS operating roles route authoring to Builder while custom and generic roles retain it', () => {
    for (const slug of ['concierge', 'setup-concierge', 'orchestrator']) {
      const artist = getSessionToolDefs(deriveSessionToolFilterOptions(slug, 'hq', 'artist-os')).map(tool => tool.name);
      const generic = getSessionToolDefs(deriveSessionToolFilterOptions(slug, 'hq', 'runneros')).map(tool => tool.name);
      for (const name of ['create_agent', 'create_workflow', 'create_automation']) {
        expect(artist).not.toContain(name);
        expect(generic).toContain(name);
      }
      expect(artist).not.toContain('update_automation');
    }
    const custom = getSessionToolDefs(deriveSessionToolFilterOptions('my-custom-author', 'campaign', 'artist-os')).map(tool => tool.name);
    expect(custom).toContain('create_agent');
    expect(custom).toContain('create_workflow');
    expect(custom).toContain('create_automation');
    const manager = getSessionToolDefs(deriveSessionToolFilterOptions('concierge', 'hq', 'artist-os')).map(tool => tool.name);
    expect(manager).toContain('schedule_work');
    expect(manager).toContain('supply_work_input');
    expect(manager).toContain('manage_goal_run');
  });

  for (const agentSlug of [undefined, 'builder', 'setup-concierge', 'orchestrator', 'concierge', 'raw-video-editor', 'social-publisher', 'scriptwriter', 'website-agent']) {
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

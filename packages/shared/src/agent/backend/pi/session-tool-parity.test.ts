import { describe, it, expect } from 'bun:test';
import { SESSION_BACKEND_TOOL_NAMES } from '@craft-agent/session-tools-core';
import { PI_BACKEND_SESSION_TOOL_NAMES } from '../../pi-agent.ts';
import { getSessionToolProxyDefs } from './session-tool-defs.ts';

describe('Pi backend session tool parity', () => {
  it('always exposes the provider-neutral update_tasks proxy', () => {
    expect(getSessionToolProxyDefs().some((tool) => tool.name === 'mcp__session__update_tasks')).toBe(true);
  });
  it('implements all backend-mode session tools from core registry', () => {
    const missing = [...SESSION_BACKEND_TOOL_NAMES].filter(
      (toolName) => !PI_BACKEND_SESSION_TOOL_NAMES.has(toolName),
    );

    expect(missing).toEqual([]);
  });

  it('exposes schedule_work only for HNIC proxy registration', () => {
    expect(getSessionToolProxyDefs().some((tool) => tool.name === 'mcp__session__schedule_work')).toBe(false);
    expect(getSessionToolProxyDefs({ includeScheduleWork: true }).some((tool) => tool.name === 'mcp__session__schedule_work')).toBe(true);
  });

  it('exposes input supply only for Artist Manager proxy registration', () => {
    expect(getSessionToolProxyDefs().some((tool) => tool.name === 'mcp__session__supply_work_input')).toBe(false);
    expect(getSessionToolProxyDefs({ includeSupplyWorkInput: true }).some((tool) => tool.name === 'mcp__session__supply_work_input')).toBe(true);
  });

  it('exposes semantic Manager tools only for HNIC proxy registration', () => {
    const ordinary = getSessionToolProxyDefs().map((tool) => tool.name);
    const manager = getSessionToolProxyDefs({ includeManagerTools: true }).map((tool) => tool.name);
    expect(ordinary).not.toContain('mcp__session__get_manager_brief');
    expect(ordinary).toContain('mcp__session__get_workspace_context');
    expect(ordinary).toContain('mcp__session__search_artist_network');
    expect(manager).toContain('mcp__session__get_manager_brief');
    expect(manager).toContain('mcp__session__get_artist_context');
    expect(manager).toContain('mcp__session__get_campaign_context');
    expect(manager).not.toContain('mcp__session__get_campaign_brief');
    expect(getSessionToolProxyDefs({ includeManagerTools: true, includeCampaignManagerTools: true }).map((tool) => tool.name))
      .toContain('mcp__session__get_campaign_brief');
  });

  it('exposes Lab tools only for Lab proxy registration', () => {
    expect(getSessionToolProxyDefs().some((tool) => tool.name === 'mcp__session__create_lab_song')).toBe(false);
    expect(getSessionToolProxyDefs({ includeLabTools: true }).some((tool) => tool.name === 'mcp__session__create_lab_song')).toBe(true);
  });
});

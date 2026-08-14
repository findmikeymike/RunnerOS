import { describe, expect, test } from 'bun:test';
import { resolveRuntimeIdentity } from '../runtime-identity.ts';

const HOME = '/Users/isolation-test';

describe('runtime product identity', () => {
  test('preserves every existing Runner default when no variant is specified', () => {
    const identity = resolveRuntimeIdentity({ env: {}, homeDir: HOME });

    expect(identity.variant).toBe('runner');
    expect(identity.productName).toBe('Runner');
    expect(identity.appId).toBe('com.findmikeymike.runner');
    expect(identity.deeplinkScheme).toBe('craftagents');
    expect(identity.dataRoot).toBe(`${HOME}/.craft-agent`);
    expect(identity.workspacesRoot).toBe(`${HOME}/.craft-agent/workspaces`);
    expect(identity.credentialsFile).toBe(`${HOME}/.craft-agent/credentials.enc`);
    expect(identity.agentsDir).toBe(`${HOME}/.agents/agents`);
    expect(identity.skillsDir).toBe(`${HOME}/.agents/skills`);
    expect(identity.sourcesDir).toBe(`${HOME}/.agents/sources`);
    expect(identity.workflowsDir).toBe(`${HOME}/.workflows`);
    expect(identity.integrationCacheRoot).toBe(`${HOME}/.config/runneros`);
    expect(identity.socialDataRoot).toBe(`${HOME}/.config/printing-press-clis`);
    expect(identity.defaultRpcPort).toBe(9100);
    expect(identity.defaultTriggerPort).toBe(9101);
  });

  test('places every Artist OS mutable store beneath its isolated root', () => {
    const identity = resolveRuntimeIdentity({
      env: { CRAFT_PRODUCT_VARIANT: 'artist-os' },
      homeDir: HOME,
    });

    expect(identity.variant).toBe('artist-os');
    expect(identity.productName).toBe('Artist OS');
    expect(identity.appId).toBe('com.findmikeymike.artistos');
    expect(identity.deeplinkScheme).toBe('artistos');
    expect(identity.dataRoot).toBe(`${HOME}/.artist-os`);
    expect(identity.workspacesRoot).toBe(`${HOME}/.artist-os/workspaces`);
    expect(identity.credentialsFile).toBe(`${HOME}/.artist-os/credentials.enc`);
    expect(identity.agentsDir).toBe(`${HOME}/.artist-os/libraries/agents/agents`);
    expect(identity.skillsDir).toBe(`${HOME}/.artist-os/libraries/agents/skills`);
    expect(identity.sourcesDir).toBe(`${HOME}/.artist-os/libraries/agents/sources`);
    expect(identity.workflowsDir).toBe(`${HOME}/.artist-os/libraries/workflows`);
    expect(identity.integrationCacheRoot).toBe(`${HOME}/.artist-os/cache/integrations`);
    expect(identity.socialDataRoot).toBe(`${HOME}/.artist-os/integrations/social`);
    expect(identity.defaultRpcPort).toBe(9200);
    expect(identity.defaultTriggerPort).toBe(9201);
  });

  test('allows isolated Artist OS development profiles', () => {
    const identity = resolveRuntimeIdentity({
      env: {
        CRAFT_PRODUCT_VARIANT: 'artist-os',
        CRAFT_CONFIG_DIR: `${HOME}/.artist-os-dev-2`,
      },
      homeDir: HOME,
    });

    expect(identity.dataRoot).toBe(`${HOME}/.artist-os-dev-2`);
    expect(identity.agentsDir.startsWith(`${HOME}/.artist-os-dev-2/`)).toBe(true);
  });

  test('fails closed when Artist OS is pointed at Runner data', () => {
    expect(() => resolveRuntimeIdentity({
      env: {
        CRAFT_PRODUCT_VARIANT: 'artist-os',
        CRAFT_CONFIG_DIR: `${HOME}/.craft-agent`,
      },
      homeDir: HOME,
    })).toThrow("Artist OS refuses to use Runner's data root");

    expect(() => resolveRuntimeIdentity({
      env: {
        CRAFT_PRODUCT_VARIANT: 'artist-os',
        CRAFT_CONFIG_DIR: `${HOME}/.craft-agent/workspaces/artist`,
      },
      homeDir: HOME,
    })).toThrow("Artist OS refuses to use Runner's data root");
  });

  test('rejects unknown product variants', () => {
    expect(() => resolveRuntimeIdentity({
      env: { CRAFT_PRODUCT_VARIANT: 'script-os' },
      homeDir: HOME,
    })).toThrow('Invalid CRAFT_PRODUCT_VARIANT');
  });
});

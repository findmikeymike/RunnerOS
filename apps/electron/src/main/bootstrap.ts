import { app } from 'electron';
import { join } from 'node:path';
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity';
import { loadShellEnv } from './shell-env';

async function bootstrap(): Promise<void> {
  loadShellEnv();

  // Use bracket access so the real environment is propagated to subprocesses
  // even when the product variant is baked into this bundle by esbuild.
  Object.assign(process.env, {
    CRAFT_PRODUCT_VARIANT: RUNTIME_IDENTITY.variant,
    CRAFT_CONFIG_DIR: RUNTIME_IDENTITY.dataRoot,
    CRAFT_GLOBAL_SKILLS_DIR: RUNTIME_IDENTITY.skillsDir,
    CRAFT_INTEGRATION_CACHE_ROOT: RUNTIME_IDENTITY.integrationCacheRoot,
  });

  if (RUNTIME_IDENTITY.variant === 'artist-os') {
    process.env['CRAFT_DEEPLINK_SCHEME'] = RUNTIME_IDENTITY.deeplinkScheme;
    process.env['CRAFT_APP_NAME'] = RUNTIME_IDENTITY.productName;
    process.env['CRAFT_TRIGGER_PORT'] ??= String(RUNTIME_IDENTITY.defaultTriggerPort);
    process.env['SOCIAL_HOME'] = RUNTIME_IDENTITY.socialDataRoot;

    app.setName(RUNTIME_IDENTITY.productName);
    app.setAppUserModelId(RUNTIME_IDENTITY.appId);
    app.setPath('userData', RUNTIME_IDENTITY.browserDataRoot);
    app.setPath('sessionData', join(RUNTIME_IDENTITY.browserDataRoot, 'session'));
  }

  await import('./index');
}

void bootstrap().catch((error) => {
  console.error('[bootstrap] Failed to initialize product runtime', error);
  app.exit(1);
});

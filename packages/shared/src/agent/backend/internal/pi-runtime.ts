import { execFileSync } from 'node:child_process';

const missingRuntime = 'The Bun runtime required for this model is unavailable. Reinstall Artist OS from a complete installer. For development, install Bun and relaunch the app.';

/** Pi's distributed bundle targets Bun; never accidentally launch Electron as a GUI. */
export function requirePiBunRuntime(runtimePath: string | undefined): string {
  if (!runtimePath) throw new Error(missingRuntime);
  try {
    const result = execFileSync(runtimePath, ['-e', 'process.stdout.write(process.versions.bun ? "artist-os-bun:" + process.versions.bun : "unsupported-runtime")'], {
      encoding: 'utf8', timeout: 3000, maxBuffer: 1024,
      // Even an explicitly misconfigured Electron executable must not open a window.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!/^artist-os-bun:\d+\.\d+\.\d+/.test(result)) throw new Error('unsupported-runtime');
    return runtimePath;
  } catch {
    // Avoid surfacing inherited environment or executable stderr to users/logs.
    throw new Error(missingRuntime);
  }
}

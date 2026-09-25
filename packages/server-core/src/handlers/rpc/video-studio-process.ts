import { spawn } from 'node:child_process';
import { VIDEO_RENDER_TIMEOUT_MS } from '../../transport/timeout-policy';

/** Run the CLI off the RPC thread; its synchronous FFmpeg child stays isolated. */
export function runVideoStudioProcess(
  args: string[],
  options: { cwd: string; timeoutMs?: number; maxOutputBytes?: number },
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const maxBytes = options.maxOutputBytes ?? 2 * 1024 * 1024;
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let failure: string | undefined;
    const stop = (message: string) => {
      if (failure) return;
      failure = message;
      // The isolated process group includes FFmpeg; never leave a timed-out
      // renderer writing an output after the caller receives failure.
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* process may already have exited */ }
    };
    const timer = setTimeout(() => stop('Video render exceeded its time limit.'), options.timeoutMs ?? VIDEO_RENDER_TIMEOUT_MS);
    const collect = (chunk: Buffer, isError: boolean) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { stop('Video render produced too much diagnostic output.'); return; }
      if (isError) stderr += chunk.toString(); else stdout += chunk.toString();
    };
    child.stdout.on('data', chunk => collect(chunk, false));
    child.stderr.on('data', chunk => collect(chunk, true));
    child.once('error', error => { failure = error.message; });
    child.once('close', code => {
      clearTimeout(timer);
      resolve({ status: failure ? 1 : code ?? 1, stdout, stderr: failure ? `${stderr}\n${failure}`.trim() : stderr });
    });
  });
}

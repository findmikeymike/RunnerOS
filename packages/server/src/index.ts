#!/usr/bin/env bun
import { spawn } from 'node:child_process'

// Bun native libraries need this in the process's launch environment.
// Keep all server imports below this boundary so sharp cannot load first.
if (process.platform === 'darwin' && !process.env.PANGOCAIRO_BACKEND) {
  const child = spawn(process.execPath, process.argv.slice(1), {
    env: { ...process.env, PANGOCAIRO_BACKEND: 'fontconfig' },
    stdio: 'inherit',
  })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => child.kill(signal))
  }
  child.once('error', () => {
    console.error('[server] Could not start the server runtime.')
    process.exit(1)
  })
  child.once('exit', (code, signal) => {
    process.exit(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGHUP' ? 129 : 143))
  })
} else {
  await import('./server')
}

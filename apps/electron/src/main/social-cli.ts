import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_DIR } from '@craft-agent/shared/config'

function socialToolDir(): string {
  const candidates = [
    process.env.RUNNEROS_ROOT ? path.join(process.env.RUNNEROS_ROOT, 'tools', 'printing-press-social') : null,
    path.join(process.cwd(), 'tools', 'printing-press-social'),
    path.join(app.getAppPath(), 'tools', 'printing-press-social'),
    path.resolve(app.getAppPath(), '..', '..', 'tools', 'printing-press-social'),
  ].filter(Boolean) as string[]

  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'src', 'social.mjs')))
  if (!found) throw new Error('Printing Press Social CLI was not found in this app bundle')
  return found
}

export function runSocialJson(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cwd = socialToolDir()
    const child = spawn(process.execPath, [path.join(cwd, 'src', 'social.mjs'), ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        SOCIAL_HOME: process.env.SOCIAL_HOME || path.join(CONFIG_DIR, 'social'),
      },
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      finish(() => {
        child.kill('SIGKILL')
        reject(new Error(`Social CLI timed out while running: ${args.join(' ')}`))
      })
    }, 30_000)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code) => {
      finish(() => {
        const text = stdout.trim() || stderr.trim()
        try {
          const parsed = text ? JSON.parse(text) as { error?: string } : null
          if (code === 0) resolve(parsed)
          else reject(new Error(parsed?.error || stderr || `social exited ${code}`))
        } catch (error) {
          reject(new Error(`Invalid social CLI response: ${error instanceof Error ? error.message : String(error)}`))
        }
      })
    })
  })
}

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

const pending = new Map<string, Promise<void>>()

/** Keep each shared CLI cache ordered, including credential resolution and removal. */
export async function syncCredentialCache(
  cachePath: string,
  resolvePayload: () => Promise<Record<string, unknown> | null>,
): Promise<void> {
  const previous = pending.get(cachePath)
  const operation = (async () => {
    if (previous) await previous.catch(() => undefined)
    const payload = await resolvePayload()
    if (payload === null) {
      await rm(cachePath, { force: true })
      return
    }
    const serialized = JSON.stringify(payload, null, 2)
    await mkdir(dirname(cachePath), { recursive: true })
    const temporary = `${cachePath}.${randomUUID()}.tmp`
    try {
      // Credentials are private from creation, including before publication.
      await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await rename(temporary, cachePath)
    } finally {
      await rm(temporary, { force: true })
    }
  })()
  pending.set(cachePath, operation)
  try { await operation }
  finally { if (pending.get(cachePath) === operation) pending.delete(cachePath) }
}

import { afterAll, describe, expect, mock, test } from 'bun:test'
import * as realOs from 'node:os'
import { mkdtemp, mkdir, symlink, writeFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'

// Isolate mocked default roots so tmpdir itself cannot accidentally authorize
// every test fixture and hide a failure to canonicalize the workspace root.
const sandbox = await mkdtemp(join(realOs.tmpdir(), 'file-path-symlinks-'))
const workspace = join(sandbox, 'workspace')
const alias = join(sandbox, 'workspace-alias')
await mkdir(workspace)
await symlink(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir')
mock.module('os', () => ({ ...realOs, homedir: () => join(sandbox, 'home'), tmpdir: () => join(sandbox, 'temp') }))
const { validateFilePath } = await import('../utils')
afterAll(async () => { await rm(sandbox, { recursive: true, force: true }) })

describe('canonical workspace file boundaries', () => {
  test('reads an output via a symlinked authorized workspace root', async () => {
    const file = join(workspace, 'output.md')
    await writeFile(file, '# Preview')
    expect(await validateFilePath(join(alias, 'output.md'), [alias])).toBe(await realpath(file))
    expect(await validateFilePath(file, [alias])).toBe(await realpath(file))
  })
  test('does not follow a file symlink outside the authorized root', async () => {
    const outside = join(sandbox, 'outside.txt')
    await writeFile(outside, 'outside')
    await symlink(outside, join(workspace, 'escape.txt'))
    await expect(validateFilePath(join(alias, 'escape.txt'), [alias])).rejects.toThrow('Access denied')
  })
  test('does not authorize a sibling sharing the workspace prefix', async () => {
    const sibling = join(sandbox, 'workspace-other')
    await mkdir(sibling)
    const file = join(sibling, 'output.md')
    await writeFile(file, 'other')
    await expect(validateFilePath(file, [alias])).rejects.toThrow('Access denied')
  })
  test('still blocks sensitive files in a symlinked authorized workspace', async () => {
    await writeFile(join(workspace, '.env'), 'fixture-only')
    await expect(validateFilePath(join(alias, '.env'), [alias])).rejects.toThrow('sensitive')
  })
})

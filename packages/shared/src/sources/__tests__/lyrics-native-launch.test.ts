import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getLyricsTranscriberSource } from '../builtin-sources'

test('finds development lyrics tools from app resources independently of launch cwd', () => {
  const root = mkdtempSync(join(tmpdir(), 'lyrics-native-'))
  const old = process.env.CRAFT_RESOURCES_BASE
  try {
    const resources = join(root, 'apps', 'electron')
    const tool = join(root, 'tools', 'lyrics-transcriber')
    mkdirSync(resources, { recursive: true })
    mkdirSync(tool, { recursive: true })
    process.env.CRAFT_RESOURCES_BASE = resources
    expect(getLyricsTranscriberSource('test', root).folderPath).toBe(tool)
  } finally {
    if (old === undefined) delete process.env.CRAFT_RESOURCES_BASE
    else process.env.CRAFT_RESOURCES_BASE = old
    rmSync(root, { recursive: true, force: true })
  }
})

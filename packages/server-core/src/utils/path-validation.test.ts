import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Stats } from 'fs'
import {
  validatePathFormat,
  isValidWorkingDirectory,
  isValidWorkspaceRootPath,
  resolveContainedWorkspacePath,
} from './path-validation'

function directoryStats(): Stats {
  return { isDirectory: () => true } as Stats
}

function fileStats(): Stats {
  return { isDirectory: () => false } as Stats
}

describe('validatePathFormat', () => {
  it('accepts Unix absolute paths on Unix platforms', () => {
    expect(validatePathFormat('/Users/test/project', 'darwin')).toEqual({ valid: true })
  })

  it('rejects relative paths on Unix platforms', () => {
    expect(validatePathFormat('project', 'linux')).toEqual({
      valid: false,
      reason: 'Path must be absolute (start with /).',
    })
  })

  it('rejects Windows-style paths on Unix platforms', () => {
    expect(validatePathFormat('C:\\repo', 'darwin').valid).toBe(false)
    expect(validatePathFormat('\\\\server\\share', 'linux').valid).toBe(false)
    expect(validatePathFormat('C:repo', 'linux').valid).toBe(false)
  })

  it('accepts only absolute Windows paths on Windows platforms', () => {
    expect(validatePathFormat('C:\\repo', 'win32')).toEqual({ valid: true })
    expect(validatePathFormat('\\\\server\\share\\folder', 'win32')).toEqual({ valid: true })
  })

  it('rejects relative and drive-relative Windows paths on Windows platforms', () => {
    const samples = ['repo', '.\\repo', 'C:repo', '\\temp']
    for (const sample of samples) {
      expect(validatePathFormat(sample, 'win32').valid).toBe(false)
    }
  })
})

describe('isValidWorkingDirectory', () => {
  it('accepts an existing Unix directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-agent-path-validation-'))
    try {
      expect(isValidWorkingDirectory(dir, 'darwin')).toEqual({ valid: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-agent-path-validation-'))
    const file = join(dir, 'file.txt')
    writeFileSync(file, 'x')

    try {
      expect(isValidWorkingDirectory(file, 'darwin')).toEqual({
        valid: false,
        reason: `Not a directory: ${file}`,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects invalid Windows paths before filesystem checks', () => {
    expect(isValidWorkingDirectory('C:repo', 'win32').valid).toBe(false)
  })

  it('accepts absolute Windows paths when the directory exists', () => {
    const statFn = (path: string) => {
      expect(path).toBe('C:\\repo')
      return directoryStats()
    }

    expect(isValidWorkingDirectory('C:\\repo', 'win32', statFn)).toEqual({ valid: true })
  })
})

describe('isValidWorkspaceRootPath', () => {
  it('accepts an existing directory', () => {
    const statFn = (path: string) => {
      expect(path).toBe('/workspace/new-root')
      return directoryStats()
    }

    expect(isValidWorkspaceRootPath('/workspace/new-root', 'linux', statFn)).toEqual({ valid: true })
  })

  it('accepts a non-existent path when the parent directory exists', () => {
    const statFn = (path: string) => {
      if (path === '/workspace/new-root') throw new Error('missing')
      if (path === '/workspace') return directoryStats()
      throw new Error(`Unexpected path: ${path}`)
    }

    expect(isValidWorkspaceRootPath('/workspace/new-root', 'linux', statFn)).toEqual({ valid: true })
  })

  it('accepts a non-existent path when an ancestor directory exists', () => {
    const statFn = (path: string) => {
      if (path === '/workspace/nested/new-root') throw new Error('missing')
      if (path === '/workspace/nested') throw new Error('missing')
      if (path === '/workspace') return directoryStats()
      throw new Error(`Unexpected path: ${path}`)
    }

    expect(isValidWorkspaceRootPath('/workspace/nested/new-root', 'linux', statFn)).toEqual({ valid: true })
  })

  it('rejects a non-existent path when no ancestor directory exists', () => {
    const statFn = () => {
      throw new Error('missing')
    }

    expect(isValidWorkspaceRootPath('/workspace/new-root', 'linux', statFn)).toEqual({
      valid: false,
      reason: 'Parent directory not found: /',
    })
  })

  it('rejects a non-directory parent path', () => {
    const statFn = (path: string) => {
      if (path === 'C:\\workspaces\\new-root') throw new Error('missing')
      if (path === 'C:\\workspaces') return fileStats()
      throw new Error(`Unexpected path: ${path}`)
    }

    expect(isValidWorkspaceRootPath('C:\\workspaces\\new-root', 'win32', statFn)).toEqual({
      valid: false,
      reason: 'Parent path is not a directory: C:\\workspaces',
    })
  })
})

describe('resolveContainedWorkspacePath', () => {
  it('resolves a normal child beneath the workspace root', () => {
    expect(resolveContainedWorkspacePath('/product/workspaces/trading', 'icon.png'))
      .toBe('/product/workspaces/trading/icon.png')
  })

  it('rejects absolute paths, traversal, and sibling-prefix escapes', () => {
    const root = '/product/workspaces/trading'
    expect(() => resolveContainedWorkspacePath(root, '/tmp/icon.png')).toThrow()
    expect(() => resolveContainedWorkspacePath(root, '../trading-evil/icon.png')).toThrow()
    expect(() => resolveContainedWorkspacePath(root, '../../.craft-agent/icon.png')).toThrow()
  })

  it('rejects a symlink created beneath the workspace after startup', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'trade-god-workspace-path-'))
    const root = join(sandbox, 'workspaces', 'trading')
    const outside = join(sandbox, 'outside')
    mkdirSync(root, { recursive: true })
    mkdirSync(outside, { recursive: true })
    symlinkSync(outside, join(root, 'escape'))
    try {
      expect(() => resolveContainedWorkspacePath(root, 'escape/icon.png')).toThrow('symbolic')
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})

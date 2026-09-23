import { normalize, isAbsolute, sep, dirname, basename, join } from 'path'
import { homedir, tmpdir } from 'os'
import { realpath, lstat } from 'fs/promises'
import { getWorkspaceByNameOrId, type Workspace } from '@craft-agent/shared/config'
import { assertWorkspaceOpenable, loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import type { PlatformServices } from '../runtime/platform'

/**
 * Get workspace by ID or name, throwing if not found.
 * Use this when a workspace must exist for the operation to proceed.
 */
export function getWorkspaceOrThrow(workspaceId: string): Workspace {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }
  assertWorkspaceOpenable(workspace.rootPath)
  return workspace
}

export function buildBackendHostRuntimeContext(platform: PlatformServices) {
  return {
    appRootPath: platform.appRootPath,
    resourcesPath: platform.resourcesPath,
    isPackaged: platform.isPackaged,
  }
}

/**
 * Sanitizes a filename to prevent path traversal and filesystem issues.
 * Removes dangerous characters and limits length.
 */
export function sanitizeFilename(name: string): string {
  return name
    // Remove path separators and traversal patterns
    .replace(/[/\\]/g, '_')
    // Remove Windows-forbidden characters: < > : " | ? *
    .replace(/[<>:"|?*]/g, '_')
    // Remove control characters (ASCII 0-31)
    .replace(/[\x00-\x1f]/g, '')
    // Collapse multiple dots (prevent hidden files and extension tricks)
    .replace(/\.{2,}/g, '.')
    // Remove leading/trailing dots and spaces (Windows issues)
    .replace(/^[.\s]+|[.\s]+$/g, '')
    // Limit length (200 chars is safe for all filesystems)
    .slice(0, 200)
    // Fallback if name is empty after sanitization
    || 'unnamed'
}

/**
 * Resolve allowed directories for a workspace: its root path and configured
 * working directory (if set). Returns an empty array if the workspace is
 * unknown or has no relevant paths.
 */
export function getWorkspaceAllowedDirs(workspaceId?: string | null): string[] {
  if (!workspaceId) return []
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) return []

  const dirs: string[] = [workspace.rootPath]
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (config?.defaults?.workingDirectory) {
    dirs.push(config.defaults.workingDirectory)
  }
  return dirs
}

/** Resolve the existing ancestor, keeping absent children in the same canonical boundary. */
async function canonicalizeFileBoundary(path: string): Promise<string> {
  let ancestor = normalize(path)
  const missing: string[] = []
  while (true) {
    try {
      return join(await realpath(ancestor), ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // realpath also reports ENOENT for a dangling symlink. Never treat that
      // link as an ordinary absent filename: its eventual target may escape.
      try {
        if ((await lstat(ancestor)).isSymbolicLink()) {
          throw new Error('Access denied: unresolved symbolic link in file path')
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError
      }
      const parent = dirname(ancestor)
      // An absent drive/root has no symlinks to resolve (e.g. offline Windows drive).
      if (parent === ancestor) return join(ancestor, ...missing.reverse())
      missing.push(basename(ancestor))
      ancestor = parent
    }
  }
}

/**
 * Validates that a file path is within allowed directories to prevent path traversal attacks.
 * Allowed directories: user's home directory, /tmp, and any additional dirs passed by the caller
 * (e.g. workspace root, workspace working directory).
 */
export async function validateFilePath(
  filePath: string,
  additionalAllowedDirs?: string[],
): Promise<string> {
  // Normalize the path to resolve . and .. components
  let normalizedPath = normalize(filePath)

  // Expand ~ to home directory
  if (normalizedPath.startsWith('~')) {
    normalizedPath = normalizedPath.replace(/^~/, homedir())
  }

  // Must be an absolute path
  if (!isAbsolute(normalizedPath)) {
    throw new Error('Only absolute file paths are allowed')
  }

  const realFilePath = await canonicalizeFileBoundary(normalizedPath)

  // Define allowed base directories
  const allowedDirs = [
    homedir(),
    tmpdir(),
    ...(additionalAllowedDirs ?? []),
  ].filter(dir => Boolean(dir) && isAbsolute(dir))

  // Compare canonical paths on both sides: macOS /tmp and symlinked workspace
  // roots otherwise reject their own files after the file resolves via realpath.
  // An unavailable extra root grants nothing, but must not disable healthy roots.
  const canonicalAllowedDirs = (await Promise.all(allowedDirs.map(async dir => {
    try { return await canonicalizeFileBoundary(dir) } catch { return null }
  }))).filter((dir): dir is string => dir !== null)

  // Check if the real path is within an allowed directory (cross-platform).
  const isAllowed = canonicalAllowedDirs.some(dir => {
    const normalizedDir = normalize(dir)
    const normalizedReal = normalize(realFilePath)
    return normalizedReal.startsWith(normalizedDir + sep) || normalizedReal === normalizedDir
  })

  if (!isAllowed) {
    throw new Error('Access denied: file path is outside allowed directories')
  }

  // Block sensitive files even within allowed directories.
  // Use [\\/] to match both Unix / and Windows \ separators.
  const sensitivePatterns = [
    /\.ssh[\\/]/,
    /\.gnupg[\\/]/,
    /\.aws[\\/]credentials/,
    /\.env$/,
    /\.env\./,
    /credentials\.json$/,
    /secrets?\./i,
    /\.pem$/,
    /\.key$/,
  ]

  if (sensitivePatterns.some(pattern => pattern.test(realFilePath))) {
    throw new Error('Access denied: cannot read sensitive files')
  }

  return realFilePath
}

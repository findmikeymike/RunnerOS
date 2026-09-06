const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function beforePack(context) {
  const projectDir = context?.packager?.projectDir
  if (typeof projectDir !== 'string' || !projectDir) {
    throw new Error('electron-builder did not provide the project directory')
  }
  const runtimeDir = join(projectDir, 'vendor', 'omniroute-runtime')
  const serverPath = join(runtimeDir, 'node_modules', 'omniroute', 'dist', 'server-ws.mjs')
  if (existsSync(serverPath)) return

  execFileSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: runtimeDir,
      env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
      stdio: 'inherit',
    },
  )

  if (!existsSync(serverPath)) {
    throw new Error(`OmniRoute runtime preparation did not produce ${serverPath}`)
  }
}

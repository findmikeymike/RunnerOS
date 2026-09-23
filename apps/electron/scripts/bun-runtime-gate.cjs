const { accessSync, constants, statSync } = require('node:fs')
const { join } = require('node:path')

// Check the target file without executing it: release builders may cross-compile.
exports.assertBundledBun = function assertBundledBun(projectDir, platform) {
  const runtime = join(projectDir, 'vendor', 'bun', platform === 'win32' ? 'bun.exe' : 'bun')
  try {
    if (!statSync(runtime).isFile() || statSync(runtime).size === 0) throw new Error('invalid runtime')
    accessSync(runtime, platform === 'win32' ? constants.R_OK : constants.R_OK | constants.X_OK)
  } catch {
    throw new Error('Artist OS packaging requires a nonempty executable bundled Bun runtime in vendor/bun. Run the platform release build script before packaging.')
  }
}

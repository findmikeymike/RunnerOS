import { homedir } from 'node:os'
import { app } from 'electron'

import { loadShellEnv } from './shell-env.ts'
import { applyPackagedTradeGodRuntimeIdentity } from './trade-god-runtime-identity.ts'

loadShellEnv()
applyPackagedTradeGodRuntimeIdentity(process.env, homedir(), app.isPackaged)
void import('./index.ts').catch((error) => {
  console.error('[trade-god] Main process bootstrap failed.', error)
  process.exitCode = 1
})

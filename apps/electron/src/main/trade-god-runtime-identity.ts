import path from 'node:path'

export const applyPackagedTradeGodRuntimeIdentity = (
  env: NodeJS.ProcessEnv,
  homeDir: string,
  isPackaged = true,
): void => {
  if (!isPackaged) return

  env.CRAFT_CONFIG_DIR = env.TRADE_GOD_CONFIG_DIR ?? path.join(homeDir, '.trade-god')
  env.CRAFT_USER_DATA_DIR = env.TRADE_GOD_USER_DATA_DIR
    ?? path.join(homeDir, '.trade-god', 'electron')
  env.CRAFT_APP_NAME = 'Trade God'
  env.CRAFT_DEEPLINK_SCHEME = 'tradegod'
  env.CRAFT_TRIGGER_PORT = env.TRADE_GOD_TRIGGER_PORT ?? '9201'
  env.CRAFT_TRIGGER_HOST = env.TRADE_GOD_TRIGGER_HOST ?? '127.0.0.1'

  if (env.TRADE_GOD_SERVER_URL) env.CRAFT_SERVER_URL = env.TRADE_GOD_SERVER_URL
  else delete env.CRAFT_SERVER_URL
  if (env.TRADE_GOD_RUNNEROS_ROOT) env.RUNNEROS_ROOT = env.TRADE_GOD_RUNNEROS_ROOT
  else delete env.RUNNEROS_ROOT
}

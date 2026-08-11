import { expect, test } from 'bun:test'

import { applyPackagedTradeGodRuntimeIdentity } from '../trade-god-runtime-identity.ts'

test('packaged Trade God refuses generic Runner identity and runtime variables', () => {
  const env: NodeJS.ProcessEnv = {
    CRAFT_CONFIG_DIR: '/artist/config',
    CRAFT_USER_DATA_DIR: '/artist/electron',
    CRAFT_APP_NAME: 'Artist OS',
    CRAFT_DEEPLINK_SCHEME: 'artist',
    CRAFT_SERVER_URL: 'wss://artist.invalid',
    CRAFT_TRIGGER_PORT: '9999',
    CRAFT_TRIGGER_HOST: '0.0.0.0',
    RUNNEROS_ROOT: '/artist/worktree',
  }

  applyPackagedTradeGodRuntimeIdentity(env, '/Users/operator')

  expect(env).toMatchObject({
    CRAFT_CONFIG_DIR: '/Users/operator/.trade-god',
    CRAFT_USER_DATA_DIR: '/Users/operator/.trade-god/electron',
    CRAFT_APP_NAME: 'Trade God',
    CRAFT_DEEPLINK_SCHEME: 'tradegod',
    CRAFT_TRIGGER_PORT: '9201',
    CRAFT_TRIGGER_HOST: '127.0.0.1',
  })
  expect(env.CRAFT_SERVER_URL).toBeUndefined()
  expect(env.RUNNEROS_ROOT).toBeUndefined()
})

test('packaged Trade God accepts only dedicated Trade God overrides', () => {
  const env: NodeJS.ProcessEnv = {
    TRADE_GOD_CONFIG_DIR: '/trade/config',
    TRADE_GOD_USER_DATA_DIR: '/trade/electron',
    TRADE_GOD_SERVER_URL: 'wss://trade.invalid',
    TRADE_GOD_RUNNEROS_ROOT: '/trade/worktree',
    TRADE_GOD_TRIGGER_PORT: '9301',
    TRADE_GOD_TRIGGER_HOST: '127.0.0.2',
  }

  applyPackagedTradeGodRuntimeIdentity(env, '/Users/operator')
  expect(env).toMatchObject({
    CRAFT_CONFIG_DIR: '/trade/config',
    CRAFT_USER_DATA_DIR: '/trade/electron',
    CRAFT_SERVER_URL: 'wss://trade.invalid',
    RUNNEROS_ROOT: '/trade/worktree',
    CRAFT_TRIGGER_PORT: '9301',
    CRAFT_TRIGGER_HOST: '127.0.0.2',
  })
})

test('development keeps its explicitly isolated worktree identity only from trusted app state', () => {
  const env: NodeJS.ProcessEnv = {
    VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    CRAFT_CONFIG_DIR: '/dev/trade-config',
  }
  applyPackagedTradeGodRuntimeIdentity(env, '/Users/operator', false)
  expect(env.CRAFT_CONFIG_DIR).toBe('/dev/trade-config')
})

test('packaged identity cannot be bypassed by an inherited Vite URL', () => {
  const env: NodeJS.ProcessEnv = {
    VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    CRAFT_CONFIG_DIR: '/artist/config',
  }
  applyPackagedTradeGodRuntimeIdentity(env, '/Users/operator', true)
  expect(env.CRAFT_CONFIG_DIR).toBe('/Users/operator/.trade-god')
  expect(env.CRAFT_APP_NAME).toBe('Trade God')
})

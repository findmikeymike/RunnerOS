import { type ChildProcess, spawn as spawnProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const EMBEDDED_OMNIROUTE_PORT = 20128
export const EMBEDDED_OMNIROUTE_BASE_URL = `http://127.0.0.1:${EMBEDDED_OMNIROUTE_PORT}/v1`

export interface EmbeddedOmniRoutePaths {
  serverPath: string
  runtimePath: string
  dataDir: string
}

export interface ResolveEmbeddedOmniRoutePathsOptions {
  appRootPath: string
  resourcesPath: string
  dataRoot: string
  isPackaged: boolean
  cwd?: string
  configuredRuntimePath?: string
}

export function resolveEmbeddedOmniRoutePaths(
  options: ResolveEmbeddedOmniRoutePathsOptions,
): EmbeddedOmniRoutePaths | null {
  const serverCandidates = options.isPackaged
    ? [join(options.resourcesPath, 'app', 'omniroute-runtime', 'node_modules', 'omniroute', 'dist', 'server-ws.mjs')]
    : [
        join(options.cwd ?? process.cwd(), 'node_modules', 'omniroute', 'dist', 'server-ws.mjs'),
        resolve(options.appRootPath, '..', '..', 'node_modules', 'omniroute', 'dist', 'server-ws.mjs'),
      ]

  // OmniRoute's packaged server is Node-targeted. Always use Electron's own
  // Node runtime in the app; CRAFT_BUN is for other subprocesses and is not a
  // compatible substitute here.
  const runtimeCandidates = [options.configuredRuntimePath ?? process.execPath]

  const serverPath = serverCandidates.find(existsSync)
  const runtimePath = runtimeCandidates.find(existsSync)
  if (!serverPath || !runtimePath) return null

  return {
    serverPath,
    runtimePath,
    dataDir: join(options.dataRoot, 'integrations', 'omniroute'),
  }
}

export function buildEmbeddedOmniRouteEnv(
  dataDir: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    DATA_DIR: dataDir,
    PORT: String(EMBEDDED_OMNIROUTE_PORT),
    API_PORT: String(EMBEDDED_OMNIROUTE_PORT),
    DASHBOARD_PORT: String(EMBEDDED_OMNIROUTE_PORT),
    OMNIROUTE_PORT: String(EMBEDDED_OMNIROUTE_PORT),
    OMNIROUTE_SERVER_HOST: '127.0.0.1',
    HOSTNAME: '127.0.0.1',
    REQUIRE_API_KEY: 'false',
    OMNIROUTE_CLI_SKIP_REPO_ENV: '1',
    NO_UPDATE_NOTIFIER: '1',
    NODE_ENV: 'production',
    ELECTRON_RUN_AS_NODE: '1',
  }
}

export interface EmbeddedOmniRouteLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface EmbeddedOmniRouteStartResult {
  ready: boolean
  owned: boolean
  error?: string
}

interface EmbeddedOmniRouteDependencies {
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  spawnImpl?: typeof spawnProcess
  exists?: typeof existsSync
  mkdir?: typeof mkdirSync
  wait?: (ms: number) => Promise<void>
}

export class EmbeddedOmniRoute {
  private child: ChildProcess | null = null
  private startPromise: Promise<EmbeddedOmniRouteStartResult> | null = null

  constructor(
    private readonly paths: EmbeddedOmniRoutePaths,
    private readonly logger: EmbeddedOmniRouteLogger,
    private readonly dependencies: EmbeddedOmniRouteDependencies = {},
  ) {}

  start(): Promise<EmbeddedOmniRouteStartResult> {
    this.startPromise ??= this.startInternal()
    return this.startPromise
  }

  private async startInternal(): Promise<EmbeddedOmniRouteStartResult> {
    if (await this.isReady()) {
      this.logger.info('[omniroute] Reusing gateway already listening on loopback')
      return { ready: true, owned: false }
    }

    const exists = this.dependencies.exists ?? existsSync
    if (!exists(this.paths.serverPath) || !exists(this.paths.runtimePath)) {
      return { ready: false, owned: false, error: 'Bundled OmniRoute runtime is unavailable.' }
    }

    const mkdir = this.dependencies.mkdir ?? mkdirSync
    mkdir(this.paths.dataDir, { recursive: true })

    const spawn = this.dependencies.spawnImpl ?? spawnProcess
    const child = spawn(
      this.paths.runtimePath,
      [
        '--max-old-space-size=4096',
        this.paths.serverPath,
      ],
      {
        cwd: resolve(this.paths.serverPath, '..'),
        env: buildEmbeddedOmniRouteEnv(this.paths.dataDir),
        // OmniRoute is intentionally noisy. Never leave stdout piped without a
        // consumer or the child can stall once the pipe buffer fills.
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
    this.child = child

    let lastError = ''
    child.stderr?.on('data', (chunk) => {
      lastError = String(chunk).trim().slice(-500)
    })
    child.on('error', (error) => {
      lastError = error.message
    })
    child.on('exit', (code, signal) => {
      if (this.child === child) {
        this.logger.warn(`[omniroute] Embedded gateway exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})${lastError ? `: ${lastError}` : ''}`)
      }
    })

    const wait = this.dependencies.wait ?? ((ms: number) => new Promise<void>((resolveWait) => setTimeout(resolveWait, ms)))
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (await this.isReady()) {
        this.logger.info(`[omniroute] Embedded gateway ready at ${EMBEDDED_OMNIROUTE_BASE_URL}`)
        return { ready: true, owned: true }
      }
      if (child.exitCode !== null) break
      await wait(250)
    }

    await this.stop()
    const detail = lastError ? ` ${lastError}` : ''
    const error = `Embedded OmniRoute failed to start.${detail}`
    this.logger.error(`[omniroute] ${error}`)
    return { ready: false, owned: true, error }
  }

  async isReady(): Promise<boolean> {
    const fetchImpl = this.dependencies.fetchImpl ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1_500)
    try {
      const response = await fetchImpl(`${EMBEDDED_OMNIROUTE_BASE_URL}/models`, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
      })
      if (!response.ok) return false
      const payload = await response.json() as { data?: Array<{ id?: unknown }> }
      return Array.isArray(payload.data)
        && payload.data.some((model) => model?.id === 'auto/best-free')
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    this.startPromise = null
    if (!child || child.exitCode !== null) return

    child.kill('SIGTERM')
    const wait = this.dependencies.wait ?? ((ms: number) => new Promise<void>((resolveWait) => setTimeout(resolveWait, ms)))
    for (let attempt = 0; attempt < 20 && child.exitCode === null; attempt += 1) {
      await wait(100)
    }
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

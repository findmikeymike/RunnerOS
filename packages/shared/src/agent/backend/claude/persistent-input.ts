/** Default-on cross-turn Claude query support; set CRAFT_KEEP_BG_AGENTS_ALIVE=0 to disable. */
export function resolveKeepBackgroundTasksAlive(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env.CRAFT_KEEP_BG_AGENTS_ALIVE
  if (value === '0' || value === 'false') return false
  if (value === '1' || value === 'true') return true
  return true
}

export interface PushableInputStream<T> {
  readonly stream: AsyncIterable<T>
  readonly isEnded: boolean
  push(item: T): void
  end(): void
}

/** Single-consumer FIFO async stream used by Claude SDK streaming-input mode. */
export function createPushableInputStream<T>(): PushableInputStream<T> {
  const queue: T[] = []
  let wake: (() => void) | null = null
  let ended = false

  const wakeConsumer = () => {
    const pending = wake
    wake = null
    pending?.()
  }

  async function* generator(): AsyncGenerator<T> {
    while (true) {
      while (queue.length > 0) yield queue.shift() as T
      if (ended) return
      await new Promise<void>((resolve) => { wake = resolve })
    }
  }

  return {
    stream: generator(),
    push(item: T) {
      if (ended) throw new Error('PushableInputStream: cannot push after end')
      queue.push(item)
      wakeConsumer()
    },
    end() {
      if (ended) return
      ended = true
      wakeConsumer()
    },
    get isEnded() { return ended },
  }
}

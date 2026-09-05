/** Synchronous ownership guard around asynchronous voice setup and teardown. */
export class VoiceSessionLifecycle<T extends { destroy(): Promise<void> }> {
  private epoch = 0
  private active = false
  private runtime: T | null = null
  private cleanup: Promise<void> = Promise.resolve()

  begin(): number {
    if (this.active) throw new Error('A voice session is already starting or running')
    this.active = true
    return ++this.epoch
  }

  owns(epoch: number): boolean { return this.active && this.epoch === epoch }
  assertOwner(epoch: number): void {
    if (!this.owns(epoch)) throw new Error('Voice startup was cancelled')
  }
  async ready(epoch: number): Promise<void> {
    await this.cleanup
    this.assertOwner(epoch)
  }
  attach(epoch: number, runtime: T): void {
    this.assertOwner(epoch)
    this.runtime = runtime
  }
  stop(): Promise<void> {
    this.active = false
    this.epoch += 1
    const runtime = this.runtime
    this.runtime = null
    // A new start waits for destruction of the previous audio graph/helper lease.
    if (runtime) this.cleanup = this.cleanup.catch(() => undefined).then(() => runtime.destroy())
    return this.cleanup
  }
}

/** Owns pending startup as well as the host, so quit cannot race journal creation. */
export class DurableWorkflowLifetime {
  private opening?: Promise<{ close(): Promise<void> }>;
  private stopping = false;
  private closing?: Promise<void>;

  open<T extends { close(): Promise<void> }>(create: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('durable-host-closing'));
    if (this.opening) return Promise.reject(new Error('durable-host-already-owned'));
    const opening = Promise.resolve().then(create);
    this.opening = opening;
    void opening.catch(() => { if (this.opening === opening) this.opening = undefined; });
    return opening;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopping = true;
    const opening = this.opening;
    const attempt = (async () => {
      // Failed construction has its own error/cleanup; there is no host to drain.
      const host = await opening?.catch(() => undefined);
      await host?.close();
    })();
    this.closing = attempt;
    void attempt.catch(() => { if (this.closing === attempt) this.closing = undefined; });
    return attempt;
  }
}

export const electronDurableWorkflowLifetime = new DurableWorkflowLifetime();

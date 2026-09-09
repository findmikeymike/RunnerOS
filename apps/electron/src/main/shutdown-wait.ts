/** Bound the silent wait, never the lifetime of storage or in-flight work. */
export async function waitForSafeShutdown(cleanup: Promise<void>, options: { waitMs: number; onWaiting: () => void | Promise<void> }): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Promise<'waiting'>(resolve => { timer = setTimeout(() => resolve('waiting'), options.waitMs); });
  try {
    const outcome = await Promise.race([cleanup.then(() => 'done' as const), pending]);
    if (outcome === 'waiting') {
      // The notice is advisory; it cannot close storage or authorize an update.
      void Promise.resolve().then(options.onWaiting).catch(() => {});
      await cleanup;
    }
  } finally { if (timer) clearTimeout(timer); }
}

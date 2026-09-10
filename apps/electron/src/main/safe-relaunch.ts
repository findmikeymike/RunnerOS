/** Schedule a native restart only after the existing shutdown path has finished successfully. */
export function createSafeRelaunch(options: {
  prepare(): void;
  cleanup(): Promise<void>;
  relaunch(): void;
  exit(): void;
  failed(): void;
}): () => Promise<void> {
  let active: Promise<void> | undefined;
  return () => {
    if (active) return active;
    const attempt = Promise.resolve().then(async () => {
      try {
        options.prepare();
        await options.cleanup();
        options.relaunch();
        options.exit();
      } catch (error) {
        options.failed();
        throw error;
      }
    });
    active = attempt;
    void attempt.catch(() => { if (active === attempt) active = undefined; });
    return attempt;
  };
}

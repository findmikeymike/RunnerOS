/** Strict connection probes must never proceed using an SDK-selected default. */
export async function setQueryModel<T>(session: { setModel(model: T): Promise<unknown>; dispose(): void }, model: T, strict: boolean): Promise<boolean> {
  try { await session.setModel(model); return true; }
  catch (error) {
    if (strict) {
      try { session.dispose(); } catch { /* preserve original model failure */ }
      throw error;
    }
    return false;
  }
}

/**
 * Tracks in-flight background analyses so tests can await them
 * deterministically instead of sleeping. Production never calls settle().
 */
export function createAnalysisQueue() {
  const pending = new Set();

  return {
    add(promise) {
      pending.add(promise);
      // `.finally()` returns a *derived* promise that rejects whenever the
      // tracked one does. Nothing awaits that derived promise, so leaving it
      // bare surfaces as an unhandledRejection. Swallow it here — callers get
      // the original promise back with its rejection intact.
      promise.finally(() => pending.delete(promise)).catch(() => {});
      return promise;
    },

    async settle() {
      // Loop rather than a single allSettled: an analysis could enqueue more.
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    },
  };
}

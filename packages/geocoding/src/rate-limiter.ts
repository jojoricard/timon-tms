/** Waits until a request may go out. */
export type RateLimiter = { readonly acquire: () => Promise<void> };

/**
 * At most `perSecond` requests in any second, shared by everything that calls `acquire` in this
 * process (the API server, or the demo's service worker). Requests beyond it wait their turn.
 */
export function createRateLimiter(
  perSecond: number,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> } = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
): RateLimiter {
  const sent: number[] = [];
  let queue = Promise.resolve();
  const acquire = async () => {
    for (;;) {
      const now = clock.now();
      while (sent.length > 0 && (sent[0] ?? 0) <= now - 1000) sent.shift();
      if (sent.length < perSecond) {
        sent.push(now);
        return;
      }
      await clock.sleep((sent[0] ?? now) + 1000 - now);
    }
  };
  return {
    // One caller at a time decides; the others queue behind it, in order.
    acquire: () => {
      const turn = queue.then(acquire);
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
}

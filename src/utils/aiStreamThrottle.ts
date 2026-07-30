/** Throttle with leading + trailing flush (for Dexie / UI stream updates). */
export function createThrottle<T extends (value: string) => void>(
  fn: T,
  intervalMs: number,
): {
  call: (value: string) => void;
  flush: () => void;
  cancel: () => void;
} {
  let lastValue = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let trailingPending = false;

  const run = () => {
    timer = null;
    if (trailingPending) {
      trailingPending = false;
      fn(lastValue);
    }
  };

  return {
    call(value: string) {
      lastValue = value;
      if (timer === null) {
        fn(value);
        timer = setTimeout(run, intervalMs);
      } else {
        trailingPending = true;
      }
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      trailingPending = false;
      if (lastValue !== '') {
        fn(lastValue);
      }
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      trailingPending = false;
      lastValue = '';
    },
  };
}

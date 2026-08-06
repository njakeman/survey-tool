import { useEffect, useState } from 'preact/hooks';

// Subscribes to a pre-bound sensor adapter ((handlers) => stop, see
// sensors/position.js) and exposes the latest reading. Unmount-safety lives
// in the adapter itself (its stop() suppresses late callbacks) — this hook
// only has to call stop() on cleanup, which the returned function from
// useEffect does automatically.
export function usePosition(watch) {
  const [reading, setReading] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    return watch({
      onReading: (r) => {
        setReading(r);
        setError(null);
      },
      onError: (e) => setError(e),
    });
  }, [watch]);

  return { reading, error, hasFix: reading !== null };
}

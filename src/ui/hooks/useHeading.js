import { useEffect, useRef, useState } from 'preact/hooks';

// State machine: idle -> (enable() tap) -> denied | waiting -> active | unavailable.
// enable() must be called synchronously from a user gesture — see
// CapturePage's Start-session handler — because requestPermission() is what
// consumes iOS's gesture activation, and it's the first thing this does.
export function useHeading({ requestPermission, watch }) {
  const [status, setStatus] = useState('idle');
  const [reading, setReading] = useState(null);
  const stopRef = useRef(null);

  useEffect(() => {
    return () => stopRef.current?.();
  }, []);

  async function enable() {
    stopRef.current?.();
    const permission = await requestPermission();

    if (permission === 'denied') {
      setStatus('denied');
      return;
    }
    if (permission === 'error') {
      setStatus('unavailable');
      return;
    }

    // 'granted' or 'not-required' both mean "go ahead and watch".
    setStatus('waiting');
    stopRef.current = watch({
      onReading: (r) => {
        setReading(r);
        setStatus('active');
      },
      onUnavailable: () => setStatus('unavailable'),
    });
  }

  return { reading, status, enable };
}

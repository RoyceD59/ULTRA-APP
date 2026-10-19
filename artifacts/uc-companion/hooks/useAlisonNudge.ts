import { useCallback, useEffect, useRef, useState } from 'react';

/** Dismissal lasts for this mount; filtering hides the bubble without restarting its timer. */
export function useAlisonNudge(isFiltering: boolean, hasProducts: boolean) {
  const dismissed = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!dismissed.current) setReady(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = useCallback(() => {
    dismissed.current = true;
    setReady(false);
  }, []);

  return { visible: ready && !isFiltering && hasProducts, dismiss };
}
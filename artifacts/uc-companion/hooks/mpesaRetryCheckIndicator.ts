/**
 * Delay retry-check feedback to avoid flashing a spinner for fast responses.
 * The returned cleanup is safe to call on completion, cancellation or unmount.
 */
export function delayMpesaRetryCheckIndicator(show: () => void): () => void {
  let active = true;
  const timer = setTimeout(() => {
    if (active) show();
  }, 500);
  return () => {
    active = false;
    clearTimeout(timer);
  };
}
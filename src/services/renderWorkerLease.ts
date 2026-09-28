/**
 * Returns the non-negative delay until a render-worker lease expires.
 * Invalid timestamps are deliberately treated as unknown so the UI does not
 * silently revoke a valid session based on a malformed display value.
 */
export const renderWorkerLeaseDelay = (expiresAt: string, now = Date.now()): number | null => {
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - now);
};

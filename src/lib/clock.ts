/** Request-time clock for server components (one reading per request render). */
export function requestNow(): number {
  return Date.now();
}

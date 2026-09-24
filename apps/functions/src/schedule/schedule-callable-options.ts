import { browserAdminCallableOptions } from "../auth/callable-options.js";

/** Writes: a replayed token must not repeat a booking, a copy or a cancellation. */
export const scheduleCallableOptions = Object.freeze({
  ...browserAdminCallableOptions,
  enforceAppCheck: true,
  consumeAppCheckToken: true,
});

/**
 * Reads still require App Check, but a replayed read changes nothing, so they accept the browser's
 * cached token. Consuming it forced a fresh reCAPTCHA exchange for every read, and the calendar's
 * parallel reads tripped the exchange's throttle. The only writes behind them are idempotent:
 * `listSessions` creates missing weekly occurrences inside a transaction that skips any that exist
 * (`materialise`), and `listScheduleCatalog` only reads. A replayed call writes nothing new, so
 * replay protection gains nothing here.
 */
export const scheduleReadCallableOptions = Object.freeze({
  ...browserAdminCallableOptions,
  enforceAppCheck: true,
});

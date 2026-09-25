/**
 * Every browser origin allowed to call this backend, in one place so this option set and the three
 * in staff/birthdays/penalties cannot drift apart.
 *
 * The canonical host is www.bptjersey.com since 2026-09-25: zone and Bulk Redirects send the apex
 * and bptjersey.pages.dev to it with a 301. The apex and the Pages domain stay on this list only so
 * callables keep working in tabs opened before the redirects flipped; drop them in a later deploy.
 */
export const browserOrigins = [
  "https://www.bptjersey.com",
  "https://bptjersey.com",
  "https://bptjersey.pages.dev",
];

export const browserAdminCallableOptions = {
  cors: browserOrigins,
  invoker: "public" as const,
  enforceAppCheck: true,
};

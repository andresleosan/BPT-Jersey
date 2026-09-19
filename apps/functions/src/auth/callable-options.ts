/**
 * Every browser origin allowed to call this backend, in one place so this option set and the three
 * in staff/birthdays/penalties cannot drift apart.
 *
 * The custom domain went live on 2026-09-18 and the site is now served from the apex, which until
 * then was not on this list: the pages loaded and every callable failed CORS. The Pages domain
 * stays because the same deployment still answers there, and dropping it before the apex is proven
 * would leave no working origin at all. "www" is absent on purpose — a zone Redirect Rule sends it
 * to the apex with a 301, so a browser never calls from that origin.
 */
export const browserOrigins = ["https://bptjersey.com", "https://bptjersey.pages.dev"];

export const browserAdminCallableOptions = {
  cors: browserOrigins,
  invoker: "public" as const,
  enforceAppCheck: true,
};

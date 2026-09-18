// Kill switch for the service worker of the previous bptjersey.com site (GoDaddy Website Builder),
// which registered /sw.js and kept serving its cached pages to returning visitors after the domain
// moved to this app. Browsers re-fetch this URL on their next visit: this worker takes over, deletes
// every cache the old one created, unregisters itself and reloads open tabs onto the live site.
// It has no fetch handler on purpose, so it never serves anything. Keep it until old visitors have
// cycled through (months, not days); removing it early strands them on the cached old site.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => undefined)));
    })(),
  );
});

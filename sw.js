// Minimal service worker: makes the builder installable to the home screen.
// It never caches anything, so every visit always gets the latest builder, prices and stock.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

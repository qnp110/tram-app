/**
 * Service worker: caches only this app's own files so it opens offline and installs as a PWA.
 * Requests to other sites (the transport API) are not touched and always go to the network.
 * Bump VERSION after changing any app file so installed copies pick up the update.
 */
const VERSION = "v1";
const CACHE = `departures-${VERSION}`;
const APP_FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "config.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

/** Pre-cache the app files on install. */
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

/** Delete caches from older versions. */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("departures-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Same-origin GET requests: network first (so edits show up right away), cache as offline fallback.
 * Everything else is left to the browser.
 */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});

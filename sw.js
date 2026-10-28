/* PacketBridge service worker — caches the PROGRAM (never packet data).
   Packet files are read in-memory by the page and are never stored, cached,
   or sent anywhere by this worker. */
var CACHE = "packetbridge-v0.2.0";
var ASSETS = [
  "./",
  "./index.html",
  "./extract.js",
  "./app.js",
  "./lib/pdf.min.js",
  "./lib/pdf.worker.min.js",
  "./lib/pdf-lib.min.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./README-OPEN-ME.txt"
];
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); }).then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  /* Page loads: network-first so a new version appears on the next visit
     instead of hiding behind the cache (v0.1.1 got stuck this way).
     The cache is the offline fallback. */
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put("./index.html", copy); });
        return res;
      }).catch(function () {
        return caches.match("./index.html", { ignoreSearch: true });
      })
    );
    return;
  }
  /* Program files: cache-first (fast, offline). They refresh when the
     service worker itself updates after a version bump. */
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(event.request);
    })
  );
});

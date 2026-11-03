/* PacketBridge service worker — caches the PROGRAM (never packet data).
   Packet files are read in-memory by the page and are never stored, cached,
   or sent anywhere by this worker. */
var CACHE = "packetbridge-v0.15.0";
var ASSETS = [
  "./",
  "./index.html",
  "./extract.js",
  "./details.js",
  "./tasks-data.js",
  "./templates/VR2902.pdf",
  "./templates/VR2868.pdf",
  "./generate.js",
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
    caches.open(CACHE).then(function (cache) {
      /* no-cache: revalidate with the origin instead of trusting the
         host's HTTP cache, which can still hold the previous release's
         files during its propagation window (that is how a v0.7.0 cache
         ended up containing v0.6.0's app.js). */
      return cache.addAll(ASSETS.map(function (u) { return new Request(u, { cache: "no-cache" }); }));
    }).then(function () { return self.skipWaiting(); })
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
  /* Page loads and program scripts: network-first so a new version
     appears on the next visit instead of hiding behind the cache
     (v0.1.1 got stuck this way; v0.5.0 mixed a new page with a stale
     app.js cached during the host's propagation window). The cache
     is the offline fallback. */
  var url = new URL(event.request.url);
  var ownScript = url.origin === self.location.origin &&
    url.pathname.slice(-3) === ".js" && url.pathname.indexOf("/lib/") === -1;
  if (event.request.mode === "navigate" || ownScript) {
    event.respondWith(
      fetch(event.request, { cache: "no-cache" }).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
        return res;
      }).catch(function () {
        return caches.match(event.request, { ignoreSearch: true }).then(function (hit) {
          return hit || caches.match("./index.html", { ignoreSearch: true });
        });
      })
    );
    return;
  }
  /* Everything else (libraries, templates, icons): cache-first — large,
     stable within a version, and they refresh on a version bump. */
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(event.request);
    })
  );
});

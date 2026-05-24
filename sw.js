/**
 * NTE Dashboard — service worker (PWA shell cache).
 * Live data (/data, /events, /api/*) always uses the network.
 */
var CACHE_NAME = "nte-dashboard-v1";
var PRECACHE = [
  "/",
  "/dashboard.css",
  "/dashboard.js",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/bg.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

function isLiveRequest(url) {
  var path = url.pathname;
  if (path === "/data" || path === "/events" || path === "/share") return true;
  if (path.indexOf("/api/") === 0) return true;
  return false;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) {
          return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  var url;
  try {
    url = new URL(event.request.url);
  } catch (e) {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (isLiveRequest(url)) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(function () {
        return caches.match("/");
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var network = fetch(event.request).then(function (response) {
        if (response && response.status === 200 && response.type === "basic") {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, copy);
          });
        }
        return response;
      });
      return cached || network;
    })
  );
});

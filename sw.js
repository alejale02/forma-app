const CACHE_VERSION = 'forma55-v1c';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const MEDIA_CACHE = `${CACHE_VERSION}-media`;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const urls = ['./', './index.html'];
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok) await cache.put(url, response.clone());
      } catch (_) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cacheResponse(request, response) {
  try {
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(MEDIA_CACHE);
      await cache.put(request, response.clone());
    }
  } catch (_) {}
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Same-origin app shell: cache-first so the installed Forma 55 opens offline.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (_) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // External exercise media: network-first once, then permanently available offline.
  // Opaque cross-origin responses are intentionally cacheable; the page only needs
  // the browser to play/display them, not to inspect their bytes in JavaScript.
  const isMedia = /\.(mp4|webm|mov|gif|jpe?g|png|webp)(\?|#|$)/i.test(url.pathname + url.search) ||
                  /(^|\.)video\.wixstatic\.com$|(^|\.)videos\.pexels\.com$|(^|\.)images\.pexels\.com$|(^|\.)raw\.githubusercontent\.com$|(^|\.)thetrackerapp\.io$|(^|\.)fitnessvolt\.com$|(^|\.)hips\.hearstapps\.com$|(^|\.)workout-temple\.com$/i.test(url.hostname);
  if (!isMedia) return;

  event.respondWith((async () => {
    const cache = await caches.open(MEDIA_CACHE);
    const isVideo = /\.(mp4|webm|mov)(\?|#|$)/i.test(url.pathname + url.search);
    if (isVideo) {
      // Video elements often request byte ranges. Keep a full-response cache entry
      // keyed by the URL so an offline playback request does not depend on the exact
      // Range header used by Safari.
      const fullCached = await cache.match(url.href, { ignoreVary: true });
      if (!navigator.onLine && fullCached) return fullCached;
      try {
        const fullRequest = new Request(url.href, { method: 'GET', credentials: 'omit', cache: 'no-store' });
        const response = await fetch(fullRequest);
        if (response.ok || response.type === 'opaque') {
          try { await cache.put(url.href, response.clone()); } catch (_) {}
        }
        return response;
      } catch (_) {
        return fullCached || Response.error();
      }
    }
    try {
      const response = await fetch(request);
      return await cacheResponse(request, response);
    } catch (_) {
      const cached = await cache.match(request, { ignoreVary: true });
      return cached || Response.error();
    }
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'CACHE_MEDIA' && Array.isArray(data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(MEDIA_CACHE);
      for (const raw of data.urls) {
        try {
          const url = new URL(raw, self.location.href).href;
          if (url.startsWith('data:') || url.startsWith('blob:')) continue;
          const existing = await cache.match(url, {ignoreVary:true});
          if (existing) continue;
          const response = await fetch(url, {mode:'no-cors', credentials:'omit'});
          if (response.ok || response.type === 'opaque') await cache.put(url, response);
        } catch (_) {}
      }
    })());
  }
});

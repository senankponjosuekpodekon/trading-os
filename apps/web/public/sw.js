const CACHE_NAME = 'trading-os-v3';

// Purge tous les anciens caches (le HTML ne doit JAMAIS être caché :
// un HTML stale référence des chunks JS qui n'existent plus après un deploy)
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('push', (event) => {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Trading-OS';
    const options = {
      body: data.body || 'Nouvelle alerte',
      icon: data.icon || '/icon-192.svg',
      badge: data.badge || '/icon-192.svg',
      data: data.data || {},
      requireInteraction: true,
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    // ignore malformed push
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/scanner';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});

// Aucun handler 'fetch' : le réseau passe directement, pas d'interception.

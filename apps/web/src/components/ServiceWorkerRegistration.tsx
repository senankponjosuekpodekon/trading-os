import { logger } from '@/lib/logger';
'use client';
import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
                    logger.info('SW registered: ', registration.scope);

          // If an updated SW is waiting, claim it and reload once so the new bundle is used
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                window.location.reload();
              }
            });
          });
        })
        .catch((error) => {
                    logger.warn('SW registration failed: ', error);
        });
    });
  }, []);

  return null;
}

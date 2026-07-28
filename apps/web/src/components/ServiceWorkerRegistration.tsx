'use client';
import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          // eslint-disable-next-line no-console
          console.log('SW registered: ', registration.scope);
        })
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.warn('SW registration failed: ', error);
        });
    });
  }, []);

  return null;
}

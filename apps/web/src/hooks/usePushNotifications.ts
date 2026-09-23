'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function usePushNotifications() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setSupported(true);
    setPermission(Notification.permission);

    api.get('/notifications/push-public-key')
      .then(res => {
        if (res.data.enabled) setPublicKey(res.data.publicKey);
      })
      .catch(() => {});

    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setSubscribed(!!sub))
      .catch(() => {});
  }, []);

  const subscribe = async (key?: string) => {
    const appKey = key ?? publicKey;
    if (!appKey || !supported) return;
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(appKey),
    });
    await api.post('/notifications/push-subscribe', { subscription: sub.toJSON() });
    setSubscribed(true);
    setPermission('granted');
  };

  const unsubscribe = async () => {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    await api.post('/notifications/push-unsubscribe');
    setSubscribed(false);
  };

  const requestPermission = async () => {
    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm !== 'granted') return;
    // La clé publique arrive en async — la re-fetcher si pas encore chargée
    let key = publicKey;
    if (!key) {
      const res = await api.get('/notifications/push-public-key').catch(() => null);
      key = res?.data?.enabled ? res.data.publicKey : null;
      if (key) setPublicKey(key);
    }
    await subscribe(key ?? undefined);
  };

  return { supported, permission, subscribed, publicKey, requestPermission, unsubscribe };
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

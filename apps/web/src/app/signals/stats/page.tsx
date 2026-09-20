'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function StatsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/signals?tab=stats');
  }, [router]);
  return null;
}

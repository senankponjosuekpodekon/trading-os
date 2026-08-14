'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';

function isCancelledError(err: any): boolean {
  if (!err) return false;
  const code = err?.code ?? '';
  const msg = (err?.message ?? '').toLowerCase();
  return (
    code === 'ERR_CANCELED' ||
    code === 'CanceledError' ||
    err?.name === 'CanceledError' ||
    err?.name === 'AbortError' ||
    msg.includes('cancel') ||
    msg.includes('aborted')
  );
}

function isAuthError(err: any): boolean {
  return err?.response?.status === 401;
}

export function QueryErrorToast() {
  const qc = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        const err = event.action.error as any;
        if (isCancelledError(err)) return;
        if (isAuthError(err)) return;
        const msg = err?.response?.data?.message || err?.message || 'Erreur de chargement';
        toast(msg, { type: 'error', title: 'Erreur' });
      }
    });

    const unsubscribeMutations = qc.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        const err = event.action.error as any;
        if (isCancelledError(err)) return;
        if (isAuthError(err)) return;
        const msg = err?.response?.data?.message || err?.message || 'Erreur lors de l\'opération';
        toast(msg, { type: 'error', title: 'Erreur' });
      }
    });

    return () => {
      unsubscribe();
      unsubscribeMutations();
    };
  }, [qc, toast]);

  return null;
}

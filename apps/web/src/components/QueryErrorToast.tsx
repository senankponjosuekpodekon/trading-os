'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';

export function QueryErrorToast() {
  const qc = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        const query = event.query;
        const err = event.action.error as any;
        const msg = err?.response?.data?.message || err?.message || 'Erreur de chargement';
        toast(msg, { type: 'error', title: 'Erreur' });
      }
    });

    const unsubscribeMutations = qc.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        const err = event.action.error as any;
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

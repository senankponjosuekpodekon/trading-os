'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { QueryErrorToast } from './QueryErrorToast';
import { TradingStoreProvider } from './providers/TradingStoreProvider';
import { ToastProvider } from './ui/ToastProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 60_000,
        gcTime: 5 * 60_000,
      },
      mutations: {
        onError: undefined,
      },
    },
  }));

  return (
    <ErrorBoundary>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <QueryErrorToast />
          <TradingStoreProvider>{children}</TradingStoreProvider>
        </QueryClientProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

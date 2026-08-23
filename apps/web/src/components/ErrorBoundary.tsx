'use client';

import { logger } from '@/lib/logger';
import { Component, ErrorInfo, ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('React error boundary caught:', error, info.componentStack);
    if (Sentry.getCurrentHub().getClient()) {
      Sentry.captureException(error, {
        tags: { boundary: 'client' },
        extra: { componentStack: info.componentStack },
      });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="p-6 text-center">
            <h2 className="text-lg font-semibold text-red-600">Oups, quelque chose s&apos;est mal passé.</h2>
            <p className="text-sm text-gray-600 mt-2">
              {this.state.error?.message || 'Erreur inattendue dans le client.'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Réessayer
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

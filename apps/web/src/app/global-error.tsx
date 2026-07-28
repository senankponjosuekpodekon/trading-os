'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fr">
      <body className="min-h-screen bg-gray-950 text-gray-100">
        <div className="flex flex-col items-center justify-center min-h-screen px-6">
          <div className="max-w-md text-center space-y-4">
            <p className="text-sm text-gray-500">{error.digest}</p>
            <h1 className="text-2xl font-semibold text-white">Une erreur est survenue</h1>
            <p className="text-gray-400">
              Nous avons été notifiés et travaillons à la corriger. Vous pouvez réessayer ou revenir plus tard.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => reset()}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-medium hover:bg-emerald-400 transition"
              >
                Réessayer
              </button>
              <button
                type="button"
                onClick={() => (window.location.href = '/')}
                className="px-4 py-2 rounded-lg border border-gray-700 text-gray-200 hover:border-gray-500 transition"
              >
                Retour accueil
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}

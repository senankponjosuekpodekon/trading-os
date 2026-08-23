import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/Providers';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trading OS — AI Investment System',
  description: "Système d'investissement assisté par IA",
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.svg',
    apple: '/icon-192.svg',
    shortcut: '/icon-192.svg',
  },
  appleWebApp: { capable: false, statusBarStyle: 'black-translucent' },
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#111827',
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="antialiased bg-gray-950 text-gray-100" style={{ fontFamily: 'var(--font-sans)' }}>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistration />
        <script
          async
          src="https://bot-int-git-dev-senankponjosuekpodekons-projects.vercel.app/api/widget/embed.js"
          data-agent="f37e3ebd-eba2-4dc9-9ca6-c3444e12811c"
          data-color="#4f46e5"
          data-title="Chat IA"
          data-position="bottom-right"
          data-api="https://bot-int-git-dev-senankponjosuekpodekons-projects.vercel.app/api">
        </script>
      </body>
    </html>
  );
}

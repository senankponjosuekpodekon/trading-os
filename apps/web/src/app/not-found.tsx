import Link from 'next/link';
import { TrendingUp, Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center space-y-6 max-w-md px-6">
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center">
            <TrendingUp className="w-10 h-10 text-emerald-400" />
          </div>
        </div>
        <div>
          <h1 className="text-6xl font-black text-white mb-2">404</h1>
          <p className="text-xl font-semibold text-gray-300 mb-1">Page introuvable</p>
          <p className="text-gray-500 text-sm">Cette page n&apos;existe pas ou a été déplacée.</p>
        </div>
        <Link href="/dashboard"
          className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-xl transition-colors">
          <Home className="w-4 h-4" />
          Retour au Dashboard
        </Link>
      </div>
    </div>
  );
}

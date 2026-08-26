'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Zap, AlertCircle, RefreshCw, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [result, setResult] = useState<{ resetUrl?: string; resetToken?: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setResult(null);
    setIsLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setSuccess(true);
      setResult(data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Zap className="w-8 h-8 text-emerald-400" />
            <span className="text-2xl font-bold text-white">Trading OS</span>
          </div>
          <p className="text-gray-400">Réinitialiser votre mot de passe</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {success && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>Lien de réinitialisation généré.</span>
                </div>
                {result?.resetUrl && (
                  <div className="p-3 bg-gray-800 rounded-lg text-xs break-all text-gray-300">
                    <p className="font-medium text-gray-200 mb-1">Lien :</p>
                    <a href={result.resetUrl} className="text-emerald-400 hover:underline">
                      {result.resetUrl}
                    </a>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={success}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors disabled:opacity-50"
                placeholder="vous@exemple.com"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || success}
              className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
            >
              {isLoading ? <RefreshCw className="w-4 h-4 animate-spin inline" /> : 'Envoyer le lien'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            <Link href="/auth/login" className="text-emerald-400 hover:text-emerald-300 font-medium">
              Retour à la connexion
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

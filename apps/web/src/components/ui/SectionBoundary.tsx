'use client';
import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  title?: string;
  children: ReactNode;
}
interface State {
  hasError: boolean;
  message?: string;
}

/**
 * Error boundary par section : une erreur dans un widget/onglet
 * ne casse plus la page entière — placeholder + retry.
 */
export class SectionBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message };
  }

  componentDidCatch(err: Error) {
    // Remonter à Sentry si configuré — l'init globale le capte déjà via window.onerror,
    // mais on log pour traçabilité locale.
    console.error('[SectionBoundary]', this.props.title, err);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center py-14 px-4 bg-gray-900 border border-gray-800 rounded-xl text-center">
        <AlertTriangle className="w-8 h-8 text-amber-400 mb-3" />
        <p className="text-sm font-medium text-white">{this.props.title ?? 'Cette section'} a rencontré une erreur</p>
        {this.state.message && (
          <p className="text-xs text-gray-500 mt-1 max-w-md truncate" title={this.state.message}>{this.state.message}</p>
        )}
        <button
          onClick={() => this.setState({ hasError: false, message: undefined })}
          className="mt-4 flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200"
        >
          <RefreshCw className="w-3 h-3" /> Réessayer
        </button>
      </div>
    );
  }
}

'use client';
import { Minus, TrendingUp, Square, Trash2, MousePointer, Ruler } from 'lucide-react';

export type DrawingTool = 'pointer' | 'hline' | 'trendline' | 'rect' | 'fib';

interface Props {
  active: DrawingTool;
  onChange: (t: DrawingTool) => void;
  onClearAll: () => void;
  drawingCount: number;
}

const TOOLS: { id: DrawingTool; icon: React.ReactNode; label: string }[] = [
  { id: 'pointer',   icon: <MousePointer className="w-4 h-4" />, label: 'Sélection' },
  { id: 'hline',     icon: <Minus className="w-4 h-4" />,        label: 'Ligne horizontale (S/R)' },
  { id: 'trendline', icon: <TrendingUp className="w-4 h-4" />,   label: 'Trendline' },
  { id: 'rect',      icon: <Square className="w-4 h-4" />,       label: 'Zone (rectangle)' },
  { id: 'fib',       icon: <Ruler className="w-4 h-4" />,        label: 'Fibonacci retracement' },
];

export function DrawingToolbar({ active, onChange, onClearAll, drawingCount }: Props) {
  return (
    <div className="flex items-center gap-1 p-1 bg-gray-900 border border-gray-800 rounded-lg">
      {TOOLS.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          title={t.label}
          className={`p-2 rounded transition-colors ${
            active === t.id
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          {t.icon}
        </button>
      ))}
      {drawingCount > 0 && (
        <>
          <div className="w-px h-5 bg-gray-700 mx-1" />
          <button
            onClick={onClearAll}
            title="Effacer tous les tracés"
            className="p-2 rounded text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-600 px-1">{drawingCount}</span>
        </>
      )}
    </div>
  );
}

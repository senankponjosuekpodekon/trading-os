import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';

const ChartView = dynamic(
  () => import('@/components/chart/ChartView').then(mod => mod.ChartView),
  { ssr: false, loading: () => <div className="h-[500px] flex items-center justify-center text-gray-600">Chargement…</div> },
);

interface PageProps {
  params: { symbol: string };
  searchParams: { tf?: string };
}

function Fallback() {
  return (
    <div className="h-96 flex items-center justify-center text-gray-600">
      <span className="w-5 h-5 border-2 border-gray-600 border-t-emerald-400 rounded-full animate-spin" />
    </div>
  );
}

export default function ChartSymbolPage({ params, searchParams }: PageProps) {
  const symbol = decodeURIComponent(params.symbol);
  if (!symbol.includes('/')) {
    notFound();
  }
  const tf = typeof searchParams.tf === 'string' ? searchParams.tf : '1h';
  return (
    <Suspense fallback={<Fallback />}>
      <ChartView mode="dynamic" initialSymbol={symbol} initialTf={tf} />
    </Suspense>
  );
}

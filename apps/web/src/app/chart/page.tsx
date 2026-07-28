'use client';
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';

const ChartView = dynamic(
  () => import('@/components/chart/ChartView').then(mod => mod.ChartView),
  { ssr: false, loading: () => <div className="h-[500px] flex items-center justify-center text-gray-600">Chargement du graphique…</div> },
);

function Fallback() {
  return (
    <AppLayout title="Graphique">
      <div className="h-96 flex items-center justify-center text-gray-600">
        <span className="w-5 h-5 border-2 border-gray-600 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    </AppLayout>
  );
}

export default function ChartPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <ChartView mode="search" />
    </Suspense>
  );
}

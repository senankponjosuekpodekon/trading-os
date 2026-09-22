'use client';

import { PhaseBWidgets } from '../dashboard/_components/PhaseBWidgets';

export default function PhaseBPage() {
  return (
    <>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold text-white">Phase B - Données avancées</h1>
        <PhaseBWidgets />
      </div>
    </>
  );
}

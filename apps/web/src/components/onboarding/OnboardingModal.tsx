'use client';
import { useState } from 'react';
import { X, ChevronRight, ChevronLeft, CheckCircle } from 'lucide-react';

export type TraderProfile = 'conservative' | 'moderate' | 'aggressive';

interface Question {
  id: string;
  text: string;
  choices: { label: string; value: number }[];
}

const QUESTIONS: Question[] = [
  {
    id: 'experience',
    text: "Quelle est votre expérience en trading ?",
    choices: [
      { label: 'Débutant — je découvre', value: 1 },
      { label: 'Intermédiaire — quelques trades', value: 2 },
      { label: 'Avancé — je trade régulièrement', value: 3 },
    ],
  },
  {
    id: 'risk',
    text: "Quel risque maximal acceptez-vous par trade ?",
    choices: [
      { label: '0.5 % — capital protégé', value: 1 },
      { label: '1 % — équilibré', value: 2 },
      { label: '2 %+ — opportunités élevées', value: 3 },
    ],
  },
  {
    id: 'drawdown',
    text: "Quel drawdown sur votre capital vous mettrait mal à l'aise ?",
    choices: [
      { label: '-5 %', value: 1 },
      { label: '-15 %', value: 2 },
      { label: '-30 %+', value: 3 },
    ],
  },
  {
    id: 'horizon',
    text: "Quel est votre horizon de détention préféré ?",
    choices: [
      { label: 'Swing — plusieurs jours', value: 2 },
      { label: 'Day trading — intraday', value: 3 },
      { label: 'Investissement — semaines/mois', value: 1 },
    ],
  },
];

function computeProfile(score: number): TraderProfile {
  if (score <= 6) return 'conservative';
  if (score <= 9) return 'moderate';
  return 'aggressive';
}

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProfile: (profile: TraderProfile) => void;
}

export function OnboardingModal({ isOpen, onClose, onSelectProfile }: OnboardingModalProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<TraderProfile | null>(null);

  if (!isOpen) return null;

  const current = QUESTIONS[step];
  const isLast = step === QUESTIONS.length - 1;

  const handleAnswer = (value: number) => {
    const nextAnswers = { ...answers, [current.id]: value };
    setAnswers(nextAnswers);
    if (isLast) {
      const total = Object.values(nextAnswers).reduce((s, v) => s + v, 0);
      setResult(computeProfile(total));
    } else {
      setStep(s => s + 1);
    }
  };

  const handleBack = () => {
    if (result) {
      setResult(null);
    } else {
      setStep(s => Math.max(0, s - 1));
    }
  };

  const handleConfirm = () => {
    if (result) {
      onSelectProfile(result);
      onClose();
      setStep(0);
      setAnswers({});
      setResult(null);
    }
  };

  const progress = result ? 100 : Math.round(((step) / QUESTIONS.length) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
          aria-label="Fermer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-6">
          <h3 className="text-white text-lg font-semibold">Définir mon profil trader</h3>
          <p className="text-gray-500 text-sm">Répondez à {QUESTIONS.length} questions pour obtenir une recommandation.</p>
        </div>

        <div className="h-1 w-full bg-gray-800 rounded-full overflow-hidden mb-6">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>

        {!result ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
              <span>Question {step + 1} / {QUESTIONS.length}</span>
              <button
                onClick={handleBack}
                disabled={step === 0}
                className="flex items-center gap-1 text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />Retour
              </button>
            </div>

            <p className="text-white font-medium mb-3">{current.text}</p>

            <div className="space-y-2">
              {current.choices.map((choice) => (
                <button
                  key={choice.label}
                  onClick={() => handleAnswer(choice.value)}
                  className="w-full text-left p-3 rounded-lg border border-gray-700 bg-gray-800 hover:border-emerald-500/50 hover:bg-gray-700/50 transition-colors group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-200">{choice.label}</span>
                    <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-emerald-400 transition-colors" />
                  </div>
                </button>
              ))}
            </div>

            <div className="pt-4 border-t border-gray-800">
              <button
                onClick={onClose}
                className="text-xs text-gray-500 hover:text-gray-300 underline"
                data-testid="skip-onboarding"
              >
                Passer le questionnaire — choisir manuellement
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center space-y-5 py-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/30">
                <CheckCircle className="w-8 h-8 text-emerald-400" />
              </div>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Profil recommandé</p>
              <p className="text-2xl font-bold text-white capitalize mt-1">{result}</p>
            </div>
            <p className="text-sm text-gray-400">
              {result === 'conservative' && "Privilégiez la protection du capital et des R/R conservateurs."}
              {result === 'moderate' && "Équilibre risque/rendement, adapté à la majorité des traders."}
              {result === 'aggressive' && "Risque élevé et R/R étendus pour viser une croissance rapide."}
            </p>
            <button
              onClick={handleConfirm}
              className="px-6 py-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              Appliquer ce profil
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

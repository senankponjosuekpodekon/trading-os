/**
 * Prix de liquidation d'une position à effet de levier.
 *
 * Modèle simplifié : levier effectif = notionnel / capital du portefeuille.
 * La position est liquidée quand la perte approche la marge engagée :
 *   distance liquidation = 1/leverage − buffer de maintenance.
 * Levier ≤ 1 (position non levée) → pas de liquidation possible (null).
 *
 * Approximation documentée : utilise le capital courant comme proxy de
 * l'equity à l'ouverture. Suffisant pour le paper — le broker réel calcule
 * sa liquidation propre sur le mark price.
 */
export const LIQ_BUFFER = 0.015;

export function liquidationPrice(
  entry: number,
  quantity: number,
  portfolioCapital: number,
  direction: 'BUY' | 'SELL',
  buffer: number = LIQ_BUFFER,
): number | null {
  if (!entry || !quantity || !portfolioCapital || portfolioCapital <= 0) return null;
  const leverage = (entry * quantity) / portfolioCapital;
  if (leverage <= 1) return null;
  const liqPct = 1 / leverage - buffer;
  if (liqPct <= 0) {
    // Levier tellement élevé que la position est déjà sous l'eau
    return entry;
  }
  return direction === 'BUY'
    ? entry * (1 - liqPct)
    : entry * (1 + liqPct);
}

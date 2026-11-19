/**
 * Sizing MT5 déterministe — conversion unités → lots et validation des
 * protections côté broker, à partir des specs réelles du contrat
 * (GET /contract/<symbol> du bridge).
 *
 * Règles :
 * - quantity est TOUJOURS en unités de base (pas de lots, pas d'heuristique)
 * - lots = floor(units / contract_size / volume_step) * volume_step
 *   → on n'augmente jamais le risque en arrondissant vers le haut
 * - un volume résultant < volume_min ou > volume_max REJETTE l'ordre
 *   (fail-closed — pas de clamp silencieux)
 * - SL/TP doivent respecter stops_level * point depuis le prix visé
 */

export interface Mt5Contract {
  contract_size: number;
  volume_min: number;
  volume_max: number;
  volume_step: number;
  point: number;
  digits: number;
  stops_level: number;
  tick_value?: number;
  tick_size?: number;
  margin_initial?: number;
  currency_profit?: string;
  currency_margin?: string;
}

export class Mt5SizingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'Mt5SizingError';
  }
}

function decimals(step: number): number {
  // volume_step 0.01 → 2 décimales ; 0.1 → 1 ; 1 → 0
  return Math.max(0, Math.round(-Math.log10(step)));
}

export function unitsToLots(units: number, c: Mt5Contract): number {
  if (!Number.isFinite(units) || units <= 0) {
    throw new Mt5SizingError('INVALID_QUANTITY', `quantité invalide: ${units}`);
  }
  for (const [k, v] of Object.entries({ contract_size: c.contract_size, volume_min: c.volume_min, volume_max: c.volume_max, volume_step: c.volume_step })) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new Mt5SizingError('INVALID_CONTRACT', `spec broker invalide: ${k}=${v}`);
    }
  }
  const rawLots = units / c.contract_size;
  const lots = Math.floor(rawLots / c.volume_step) * c.volume_step;
  const rounded = Number(lots.toFixed(decimals(c.volume_step)));
  if (rounded < c.volume_min) {
    throw new Mt5SizingError(
      'BELOW_VOLUME_MIN',
      `${units} unités → ${rounded} lot < minimum broker ${c.volume_min} ` +
      `(${c.contract_size} unités/lot — il faut ≥ ${c.volume_min * c.contract_size} unités)`,
    );
  }
  if (rounded > c.volume_max) {
    throw new Mt5SizingError('ABOVE_VOLUME_MAX', `${rounded} lot > maximum broker ${c.volume_max}`);
  }
  return rounded;
}

/** Valide les distances SL/TP par rapport au stops_level broker.
 *  price = prix d'exécution visé (ask pour BUY, bid pour SELL — le tick
 *  courant suffit, le requote reste géré par deviation). */
export function validateStops(
  side: 'BUY' | 'SELL',
  price: number,
  sl: number | undefined,
  tp: number | undefined,
  c: Mt5Contract,
): void {
  const minDist = (c.stops_level ?? 0) * c.point;
  for (const [label, level] of [['SL', sl], ['TP', tp]] as const) {
    if (level == null) continue;
    if (!Number.isFinite(level) || level <= 0) {
      throw new Mt5SizingError('INVALID_STOP', `${label} invalide: ${level}`);
    }
    const correctSide = label === 'SL'
      ? (side === 'BUY' ? level < price : level > price)
      : (side === 'BUY' ? level > price : level < price);
    if (!correctSide) {
      throw new Mt5SizingError('WRONG_SIDE', `${label}=${level} du mauvais côté du prix ${price} pour ${side}`);
    }
    if (Math.abs(level - price) < minDist) {
      throw new Mt5SizingError(
        'TOO_CLOSE',
        `${label}=${level} trop proche du prix ${price}: stops_level=${c.stops_level} pts ` +
        `(min ${minDist})`,
      );
    }
  }
}

/** Risque cash jusqu'au SL pour le volume calculé, quand tick_value/tick_size
 *  sont disponibles. Retourne null si les specs ne le permettent pas. */
export function riskToStop(lots: number, price: number, sl: number | undefined, c: Mt5Contract): number | null {
  if (sl == null || c.tick_value == null || c.tick_size == null || c.tick_size <= 0) return null;
  const ticks = Math.abs(price - sl) / c.tick_size;
  return Number((ticks * c.tick_value * lots).toFixed(2));
}

/** Estimation de marge quand le broker publie margin_initial (marge fixe
 *  par lot). null quand le mode de calcul est flottant (forex standard). */
export function marginRequired(lots: number, c: Mt5Contract): number | null {
  if (!c.margin_initial || c.margin_initial <= 0) return null;
  return Number((lots * c.margin_initial).toFixed(2));
}

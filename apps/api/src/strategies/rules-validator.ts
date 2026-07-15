import { BadRequestException } from '@nestjs/common';

/**
 * Validation du DSL JSON des règles de stratégie (Sprint 1).
 * Aligné sur `StrategyRules` de apps/engine/routers/strategy_eval.py.
 */

const VALID_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const VALID_TRIGGERS = ['BREAKOUT', 'RETEST', 'LIMIT', 'MOMENTUM_CONFIRMATION', 'VOLATILITY_EXPANSION'];
const VALID_MARKETS = ['CRYPTO', 'FOREX', 'METALS', 'SYNTHETIC', 'BRVM', 'COMMODITY'];
const VALID_PROFILES = ['INVESTOR', 'SWING', 'DAY', 'SCALPER'];
const VALID_REGIMES = ['TRENDING_BULL', 'TRENDING_BEAR', 'RANGING', 'VOLATILE', 'UNKNOWN'];

const NUMERIC_BOUNDS: Record<string, [number, number]> = {
  ema_fast: [2, 500],
  ema_slow: [2, 500],
  ema_trend: [2, 1000],
  rsi_period: [2, 100],
  rsi_oversold: [0, 100],
  rsi_overbought: [0, 100],
  rsi_bullish_zone: [0, 100],
  rsi_bearish_zone: [0, 100],
  min_confidence: [0, 100],
  volume_spike_min: [0, 20],
  atr_min_pct: [0, 50],
};

const BOOLEAN_FIELDS = ['use_price_action', 'use_sr_zones', 'use_patterns'];

const KNOWN_FIELDS = new Set([
  ...Object.keys(NUMERIC_BOUNDS),
  ...BOOLEAN_FIELDS,
  'timeframes',
  'analysis_timeframe',
  'entry_timeframe',
  'trigger',
  'markets',
  'profiles',
  'entry_rules',
  'filters',
  'invalidation',
  'exit_rules',
  // legacy format (seed 'EMA Trend + RSI')
  'conditions',
]);

function fail(errors: string[]): never {
  throw new BadRequestException({
    message: 'Règles de stratégie invalides',
    errors,
  });
}

export function validateStrategyRules(rules: Record<string, any>): void {
  const errors: string[] = [];

  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    fail(['`rules` doit être un objet JSON']);
  }

  for (const key of Object.keys(rules)) {
    if (!KNOWN_FIELDS.has(key)) {
      errors.push(`Champ inconnu : \`${key}\``);
    }
  }

  for (const [key, [min, max]] of Object.entries(NUMERIC_BOUNDS)) {
    const val = rules[key];
    if (val === undefined) continue;
    if (typeof val !== 'number' || Number.isNaN(val)) {
      errors.push(`\`${key}\` doit être un nombre`);
    } else if (val < min || val > max) {
      errors.push(`\`${key}\` doit être entre ${min} et ${max} (reçu : ${val})`);
    }
  }

  for (const key of BOOLEAN_FIELDS) {
    if (rules[key] !== undefined && typeof rules[key] !== 'boolean') {
      errors.push(`\`${key}\` doit être un booléen`);
    }
  }

  if (rules.timeframes !== undefined) {
    if (!Array.isArray(rules.timeframes) || rules.timeframes.length === 0) {
      errors.push('`timeframes` doit être un tableau non vide');
    } else {
      for (const tf of rules.timeframes) {
        if (!VALID_TIMEFRAMES.includes(tf)) {
          errors.push(`Timeframe invalide : \`${tf}\` (valides : ${VALID_TIMEFRAMES.join(', ')})`);
        }
      }
    }
  }

  for (const key of ['analysis_timeframe', 'entry_timeframe']) {
    if (rules[key] !== undefined && !VALID_TIMEFRAMES.includes(rules[key])) {
      errors.push(`\`${key}\` invalide : \`${rules[key]}\` (valides : ${VALID_TIMEFRAMES.join(', ')})`);
    }
  }

  if (rules.trigger !== undefined && !VALID_TRIGGERS.includes(rules.trigger)) {
    errors.push(`\`trigger\` invalide : \`${rules.trigger}\` (valides : ${VALID_TRIGGERS.join(', ')})`);
  }

  if (rules.markets !== undefined) {
    if (!Array.isArray(rules.markets)) {
      errors.push('`markets` doit être un tableau');
    } else {
      for (const m of rules.markets) {
        if (!VALID_MARKETS.includes(m)) {
          errors.push(`Marché invalide : \`${m}\` (valides : ${VALID_MARKETS.join(', ')})`);
        }
      }
    }
  }

  if (rules.profiles !== undefined) {
    if (!Array.isArray(rules.profiles)) {
      errors.push('`profiles` doit être un tableau');
    } else {
      for (const p of rules.profiles) {
        if (!VALID_PROFILES.includes(p)) {
          errors.push(`Profil invalide : \`${p}\` (valides : ${VALID_PROFILES.join(', ')})`);
        }
      }
    }
  }

  for (const key of ['entry_rules', 'filters', 'invalidation', 'exit_rules']) {
    if (rules[key] !== undefined && (typeof rules[key] !== 'object' || Array.isArray(rules[key]))) {
      errors.push(`\`${key}\` doit être un objet`);
    }
  }

  if (rules.filters?.regime !== undefined) {
    if (!Array.isArray(rules.filters.regime)) {
      errors.push('`filters.regime` doit être un tableau');
    } else {
      for (const r of rules.filters.regime) {
        if (!VALID_REGIMES.includes(r)) {
          errors.push(`Régime invalide : \`${r}\` (valides : ${VALID_REGIMES.join(', ')})`);
        }
      }
    }
  }

  if (rules.exit_rules) {
    for (const key of ['sl_atr', 'tp1_atr', 'tp2_atr']) {
      const val = rules.exit_rules[key];
      if (val !== undefined && (typeof val !== 'number' || val <= 0 || val > 20)) {
        errors.push(`\`exit_rules.${key}\` doit être un nombre entre 0 (exclus) et 20`);
      }
    }
  }

  // Cohérences croisées
  if (
    typeof rules.rsi_oversold === 'number' &&
    typeof rules.rsi_overbought === 'number' &&
    rules.rsi_oversold >= rules.rsi_overbought
  ) {
    errors.push('`rsi_oversold` doit être inférieur à `rsi_overbought`');
  }
  if (
    typeof rules.ema_fast === 'number' &&
    typeof rules.ema_slow === 'number' &&
    rules.ema_fast >= rules.ema_slow
  ) {
    errors.push('`ema_fast` doit être inférieur à `ema_slow`');
  }

  if (errors.length > 0) {
    fail(errors);
  }
}

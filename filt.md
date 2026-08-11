# Multi-Asset Trading Signal Framework
### Parameter Hierarchy, Market-Specific Calibration, and Hybrid Architecture

This framework is built for a bot that scans crypto, forex, precious metals, US equities, NASDAQ, BRVM, and volatility derivatives every 5 seconds, combining rule-based logic with discretionary/ML-weighted judgment. It separates **universal parameters** (apply everywhere, calibration changes) from **market-specific parameters** (structurally exist only in that market).

---

## PART 1 — Universal Core Parameters ("The Trader's Friends")

These five are the backbone. Everything else is a modifier on top of them.

### 1.1 Trend Identification

| Layer | Method | Notes |
|---|---|---|
| Bias (HTF) | EMA 50/200 relationship + ADX(14) | ADX > 25 = trending regime, trade with bias. ADX < 18–20 = range, fade extremes instead |
| Structure | Swing high/low sequence (HH/HL vs LH/LL) | More robust than MAs alone — MAs lag, structure is real-time |
| Confirmation | Multi-timeframe alignment | Require HTF (4H/D) trend direction to agree with entry TF (5–15min) at minimum |
| Anchor | Session/Daily/Weekly VWAP | Price above VWAP + rising = intraday bullish bias; use as dynamic S/R, not a trigger alone |

**Decisive vs. false-positive distinction:** a single MA crossover on one timeframe is a weak signal in isolation — it's one of the most common sources of false positives in automated systems. Requiring HTF/LTF agreement plus ADX regime confirmation is what separates a real trend signal from noise.

### 1.2 Liquidity Measurement

- **Spread as % of price** — the single most portable liquidity metric across asset classes.
- **Order book depth** — sum of resting size within 0.1–0.5% of mid-price (top 5–10 levels). Thin depth = signals are easily invalidated by a single large order.
- **Volume percentile vs. own history** — compare current 5–15min volume to the trailing 20-day distribution for that time-of-day (not a flat average — volume is highly time-of-day dependent).
- **Minimum thresholds before a signal is eligible to fire** (illustrative starting points, calibrate per instrument):

| Market | Minimum liquidity gate |
|---|---|
| Crypto majors (BTC/ETH) | 24h volume > $500M on aggregated venues |
| Forex majors | Spread < 1.5 pips, London/NY session active |
| Gold/Silver | Spread < $0.30/$0.03, COMEX or active Globex hours |
| US large-cap equities | ADV > $50M, spread < 0.05% |
| NASDAQ index products | Active regular session or liquid futures session |
| BRVM | Trade has occurred that day; avoid stocks with < 3 trades/week history |
| Vol derivatives (VIX futures) | Front two contracts only; avoid far-dated illiquid legs |

### 1.3 Volume Analysis

- **Confirmation rule:** a breakout without volume ≥ 1.3–1.5x the 20-period average is treated as low-conviction regardless of price action.
- **Divergence:** price makes a new high/low, cumulative volume delta (CVD) or OBV does not confirm → downgrade signal confidence, don't auto-reject (divergence can persist before resolving).
- **Institutional vs. retail flow proxies:**
  - Crypto: large single-print trades on order book tape, exchange net inflow/outflow, OI changes without proportional funding shift (accumulation signature).
  - Equities: block trade / dark pool print size and timing relative to price move.
  - Forex: no public volume — use tick volume + COT positioning as the closest proxy.
- **Volume profile:** Point of Control (POC), Value Area High/Low as structural magnets and mean-reversion targets, especially in range regimes.

### 1.4 Volatility Regime Classification

Classify every instrument into a regime before deciding entry logic or sizing — the same price pattern means something different in each regime.

| Regime | ATR percentile (rolling 100-period) | Behavior implication | Sizing multiplier |
|---|---|---|---|
| Low | < 25th pct | Breakout signals unreliable (compression → false starts common); range strategies favored | 1.0x (or accumulate for breakout watch) |
| Normal | 25th–65th pct | Standard rules apply | 1.0x |
| High | 65th–90th pct | Trend continuation more reliable, wider stops needed | 0.6–0.75x |
| Extreme | > 90th pct | News/event-driven; false breakout risk very high, spreads widen | 0.25–0.4x or stand aside |

- Use **realized vol vs. implied vol** (where an implied measure exists: VIX for equities, DVOL for crypto options, FX implied vol surfaces) — realized >> implied after the fact means the market was mispricing risk; realized << implied means premium was rich (fades tend to work).
- Position sizing should be **inverse to ATR**, not fixed contract size, so risk-per-trade stays constant across regimes.

### 1.5 Market Structure

- **Support/Resistance:** derived from swing points + volume profile nodes, not arbitrary round numbers (round numbers matter in FX and crypto specifically, less so elsewhere).
- **Order flow / delta:** net aggressive buy vs. sell volume at each price level; delta flips at a structural level are higher-quality entries than raw price crossing a line.
- **Liquidity pools / stop hunts:** clusters of stops above recent highs / below recent lows are frequent sweep targets before genuine moves — a wick through a level on a volume spike followed by fast reclaim is a classic manipulation signature, not a real breakout.
- **Fair value gaps / imbalance zones:** areas price moved through without two-sided trading — commonly revisited before continuation.

---

## PART 2 — Asset-Specific Parameter Calibration

### 2.1 Cryptocurrencies

- **24/7 continuous operation** — no session close to reset stats; use rolling windows (24h, 7d) rather than calendar-day resets.
- **Exchange fragmentation:** aggregate order book/CVD across Binance, OKX, Coinbase, Bybit rather than trusting a single venue — single-venue wicks are often not real.
- **Funding rate:** >0.03–0.05% per 8h sustained = crowded long, elevated long-squeeze risk; negative funding = crowded short, squeeze-up risk. Combine with OI: rising price + rising OI + rising funding = fresh leveraged longs (fragile); rising price + falling OI = short covering (can fade faster).
- **Whale wallet / on-chain flow:** large exchange inflows (>$1M+ single transfer to exchange) historically precede sell pressure; outflows to cold storage historically precede accumulation phases — useful as a bias filter, not a standalone trigger (too noisy at 5-second granularity).
- **Stablecoin supply ratio (SSR) / stablecoin exchange reserves:** rising stablecoin reserves on exchanges = dry powder for buying.
- **Halving cycle:** treat as a multi-month macro overlay only (bias, not a signal) — diminishing marginal effect each cycle is a real debate, don't over-weight it.
- **Weekend/holiday liquidity thinning:** widen liquidity gates and reduce size Saturday–Sunday UTC and around major TradFi holidays when crypto often decouples from normal volume support.

### 2.2 Forex

- **Session overlaps:** London–New York overlap (roughly 8am–12pm ET) is the deepest liquidity window; London open (3am ET) second-best. Avoid breakout signals in thin Asian-session hours on EUR/USD, GBP/USD-type pairs — false breaks are common there.
- **Central bank policy cycles:** rate-decision calendars, forward guidance language shifts are bigger drivers than technicals around meeting dates — flag a "no-new-signal" window ±30–60min around scheduled decisions.
- **Carry trade dynamics:** interest rate differential direction and trend, not just level — carry unwinds accelerate fast during risk-off/vol spikes (e.g., JPY-funded carry trades reversing sharply when volatility jumps).
- **COT positioning (weekly, futures-based proxy):** extreme net-long or net-short positioning by speculators is a contrarian input at multi-month extremes, not a timing tool.
- **Interbank liquidity windows / rollover:** 5pm ET rollover can produce artificial spread widening and small gaps — exclude from clean signal windows.

### 2.3 Precious Metals

- **COMEX pit hours (~8:20am–1:30pm ET) vs. near-continuous Globex electronic session:** liquidity and spread behavior differ; price discovery is deepest during COMEX-overlap hours.
- **Real yield correlation:** gold trades inversely with 10-year TIPS (real) yields more consistently than with nominal yields — a real-yield move against an unconfirmed gold move is a useful divergence flag.
- **Safe-haven flow triggers:** VIX spikes, DXY moves, geopolitical headlines — gold can decouple from its "normal" technical structure entirely during acute risk events.
- **Physical delivery mechanics:** open interest behavior into COMEX first notice day / delivery month can distort futures pricing versus spot — avoid over-weighting futures-only technicals right at contract roll/delivery windows.

### 2.4 US Equities

- **Open (9:30–10:00am ET):** highest volume and volatility, but also highest false-signal rate from opening imbalance/auction noise — many desks intentionally wait for the first 15–30 minutes to pass.
- **Close / closing auction:** large, sometimes non-price-driven imbalance flow — treat isolated last-10-minute moves cautiously.
- **Earnings season:** individual-name volatility regime shifts; index-level correlation to individual earnings rises when mega-caps report.
- **FOMC windows:** 2pm ET statement, 2:30pm press conference — classic "double move" pattern (initial reaction often reverses during the press conference); avoid fresh signals inside this window.
- **Options expiration (monthly 3rd Friday, weekly Fridays):** gamma-driven pinning toward high open-interest strikes into the close; breakout signals are less reliable near large gamma walls.
- **Dark pool prints:** reported with a lag, so treat as confirming/context information for a *prior* move, not a real-time trigger.

### 2.5 NASDAQ (Index/Futures specifically)

- **Mega-cap concentration:** a handful of names (mega-cap tech) can move the index disproportionately — a NASDAQ signal should be cross-checked against whether it's broad-based or single-name-driven.
- **VIX correlation:** typically strong inverse correlation; a NASDAQ move unconfirmed by the expected VIX reaction is a caution flag.
- **Gamma exposure (GEX):** dealer positioning (net long/short gamma) changes whether the market is likely to dampen moves (long gamma → mean-reverting, choppy) or amplify them (short/negative gamma → trending, volatile). This is one of the more decisive but least commonly modeled parameters for index products.
- **After-hours earnings volatility:** large-cap reports outside regular hours cause gaps that regular-session technical levels don't anticipate — treat the next session's open as a fresh structural reset rather than continuation of prior levels.

### 2.6 BRVM (Bourse Régionale des Valeurs Mobilières)

This market is structurally the most different from the others and needs the most conservative calibration:

- **Single daily session, limited hours (~9:05am–2:00pm GMT)** and often thin, sometimes non-continuous trading per stock — many listed names trade only a few times a week. Liquidity gates need to be far stricter than for any other asset class in this framework; a "signal" on an illiquid BRVM name is often just a stale/repriced last trade, not real market movement.
- **Price limit bands** (daily move limits) — signals near the limit should account for the fact that price discovery is artificially capped that session.
- **CFA franc (XOF) peg to EUR:** removes idiosyncratic FX risk versus the euro but ties the whole regional market's monetary conditions to ECB policy rather than local central bank action — treat EUR-driven macro as a background driver for the whole exchange.
- **Regional commodity exposure:** several BRVM economies are commodity exporters (cocoa, gold, oil) — commodity price macro is a more relevant driver for index-level moves than typical "trader" technicals.
- **Frontier-market specificities:** wider bid-ask, settlement (T+3), and political/regulatory risk premium — recommend rule-based, conservative signal logic over ML-driven models here, since historical data density is too low to train reliable ML feature importance (small-sample overfitting risk is high).

### 2.7 Volatility Derivatives

- **Term structure:** contango (near-term below far-term) is the "normal"/calm state; backwardation (near-term above far-term) signals acute stress — the shape itself is a regime signal independent of the outright level.
- **VIX futures roll yield:** in contango, holding long front-month vol products bleeds value on each roll — relevant if the bot trades vol products directly, not just uses VIX as a signal input.
- **Skew / term premium:** steepening put skew (downside puts pricing rich relative to calls) reflects rising hedging demand and often precedes realized-vol increases.
- **Variance swap fair value vs. realized:** persistent premium of implied over realized is the normal state (vol risk premium); large compressions of that premium are a caution signal for complacency.
- **Deriv synthetic volatility indices (Boom/Crash, Volatility 75/100, etc.):** structurally distinct — these are algorithmically generated stochastic processes, not real order-book markets. They have no genuine news-driven fundamental layer, no real liquidity/order-flow microstructure, and in some cases fixed-probability spike events baked into the generation model. Treat this category as its own signal universe: standard fundamentals (funding rates, COT, earnings, central banks) are irrelevant here, and the relevant "edge" is closer to statistical/probabilistic pattern behavior of the generating process than to trader-style technical analysis.

---

## PART 3 — Temporal & Cyclical Factors

**Intraday seasonality (illustrative, per asset class):**
- Crypto: relatively flatter distribution than TradFi, but US and Asian trading-desk hours still show elevated volume; weekend liquidity thins noticeably.
- Forex: London open and London/NY overlap are the volatility peaks; Asian session is typically range-bound on majors.
- Equities/NASDAQ: open (9:30–10am) and close (3:30–4pm ET) volume spikes; midday (12–1:30pm ET) "lunch lull" of thinner volume where breakout signals are less reliable.

**Weekly/monthly/annual cycles:**
- Quarterly index rebalancing and quarter-end institutional flows can distort short-term technicals around quarter boundaries.
- Tax-loss harvesting flows cluster in December for US equities; "January effect" and "sell in May" are debated seasonal patterns worth tracking as soft priors, not hard rules.
- Monthly options expiration (equities/NASDAQ) and, separately, crypto options expiries (notably month-end and quarterly) can both produce pinning/volatility effects.

**Event-driven windows:**
- FOMC, NFP (first Friday, 8:30am ET), CPI releases: recommend a pre-event "signal freeze" window (e.g., 15–30 minutes before) and a post-event "settling" window (15–30+ minutes after) before trusting new breakout signals, since the initial reaction frequently reverses.

**Cross-asset contagion timing:**
- Risk-off episodes: equities/crypto often move together during acute risk-off, with crypto sometimes showing higher beta/faster reaction; safe-haven bid (gold, JPY, CHF) and DXY strength typically confirm the same regime shift.
- A cross-asset check (is risk-off confirmed across at least 2 of: VIX, DXY, gold, JPY crosses?) is a strong filter against false single-asset signals during macro-driven moves.

---

## PART 4 — Signal Quality Filters

**Avoiding false breakouts in low-liquidity periods:**
- Require volume confirmation (≥1.3–1.5x average) before accepting any breakout signal.
- Automatically widen the "no-signal" liquidity gate during known thin windows (weekend crypto, Asian-session FX majors, midday equities, BRVM outside its narrow session).
- Penalize (don't necessarily reject) signals that occur via a single large wick with fast reclaim — classic stop-hunt signature.

**Multi-timeframe confluence:**
- Minimum: HTF bias timeframe + entry timeframe agree in direction.
- Stronger: require agreement across 3 timeframes (e.g., 4H bias, 1H structure, 15min trigger) before highest confidence tier.

**Correlation breakdown detection:**
- Maintain rolling correlation matrices for known relationships (gold/DXY, NASDAQ/VIX, crypto/NASDAQ during risk-on/off periods).
- Flag a regime shift when a normally stable correlation deviates beyond ~2 standard deviations of its trailing distribution — during breakdowns, reduce confidence in signals that rely on that cross-asset relationship as a filter.

**ML feature importance (differs meaningfully by market):**
- Crypto: funding rate, OI change, exchange net flow tend to rank highly.
- Forex: rate differential trend, COT extremes, session/liquidity window.
- Equities/NASDAQ: options positioning (gamma), earnings proximity, dark-pool-confirmed flow.
- BRVM: sample sizes are too small/thin for reliable ML feature importance — favor explicit rule-based logic over learned models here to avoid overfitting to sparse data.
- General practice: retrain/re-validate feature importance periodically per market rather than assuming a static global feature set — what's decisive in crypto is often noise in forex and vice versa.

---

## PART 5 — Hybrid Architecture Guidance

**When rules should override discretionary/ML input (non-negotiable, hard-coded):**
- Liquidity below the instrument's minimum gate.
- Volatility regime = "extreme" (unless explicitly event-trading with reduced size).
- Inside a defined event-window freeze (FOMC, NFP, CPI, scheduled central bank decisions).
- Any hard account-level risk limit (max drawdown, max concurrent exposure) — always wins over any signal, regardless of confidence score.

**When discretionary/qualitative input should carry more weight:**
- Macro narrative shifts not yet reflected in short-term technicals (e.g., early-stage central bank pivot signaling).
- Cross-asset correlation breakdown periods, where purely rule-based systems tend to misfire because their historical relationships have temporarily decoupled.
- Thin-data markets (BRVM) where rule-based judgment outperforms model-driven confidence.

**Confidence scoring methodology (composite, not binary):**
Build a weighted score from independent sub-scores (each normalized 0–1):
1. Trend/structure alignment across timeframes
2. Volume confirmation strength
3. Liquidity adequacy relative to gate
4. Volatility regime fit (is this a regime where this signal type historically works?)
5. Multi-timeframe confluence
6. Cross-asset/correlation confirmation (where relevant)

Combine into tiers (e.g., low/medium/high confidence) and gate position size and/or execution aggressiveness by tier rather than using a single pass/fail threshold — this lets the system take smaller size on marginal setups instead of a binary accept/reject.

**5-second scan optimization:**
- **Pre-compute on bar close** (1min/5min/higher): moving averages, ADX, ATR/volatility percentile, volume profile nodes, swing structure, correlation matrices — none of these need sub-minute recalculation and recomputing them every 5 seconds wastes cycles without adding signal value.
- **Real-time at 5-second granularity:** last price, top-of-book spread/depth, and any hard liquidity/volatility gate checks — these are the cheap, fast-changing inputs that actually justify high-frequency polling.
- **Slower-changing but important:** funding rates (poll every 1–5min, they don't change intra-minute), COT (weekly), options positioning/gamma (several times per session is sufficient), on-chain whale flow (event-driven push rather than polling).
- **Segment scan loops by asset class latency needs** rather than a single global 5-second loop for everything — crypto/forex genuinely benefit from tight polling, while BRVM (thin, single-session) gains nothing from 5-second granularity and should run on a much lower-frequency loop.
- **Event-driven triggers** (price crossing a pre-computed level, spread widening past gate, volume spike past threshold) are cheaper and more scalable than recalculating full indicator stacks every tick across every instrument.

---

## Summary: Universal vs. Market-Specific

| Category | Universal (recalibrate, don't reinvent) | Market-specific (structurally unique) |
|---|---|---|
| Trend/structure/volume/volatility/order-flow logic | ✅ Same core methods everywhere | Thresholds differ per instrument |
| Session/liquidity windows | ✅ Concept applies everywhere | Exact hours/overlaps differ per market |
| Funding rates, COT, gamma exposure, on-chain flow, physical delivery | — | ❌ Exist only in their respective markets |
| BRVM thin-liquidity handling, Deriv synthetic-index logic | — | ❌ Require dedicated, non-shared logic paths |

The biggest architectural risk in a hybrid multi-asset system is applying one market's decisive parameter (e.g., funding rate, gamma exposure) as if it generalizes elsewhere, or applying a liquidity/volatility threshold tuned on liquid majors to a structurally thin market like BRVM. The framework above is built specifically to keep the universal engine shared while keeping each market's unique inputs isolated and independently calibrated.





Je vais détailler chaque marché avec la même grille : horaires précis, ce qu'il faut privilégier, comment l'implémenter dans le bot, et pourquoi. J'ai vérifié les horaires officiels là où c'était nécessaire (BRVM, EIA, WASDE, London Fix) pour te donner des chiffres fiables plutôt qu'approximatifs.

---

## 1. Forex

**Horaires clés (UTC, hors ajustements DST)**

| Session | Horaire UTC | Caractère |
|---|---|---|
| Sydney | ~21h00–06h00 | Faible liquidité |
| Tokyo | ~00h00–09h00 | Actif surtout sur JPY |
| Londres | ~08h00–17h00 | Forte liquidité |
| New York | ~13h00–22h00 | Forte liquidité |
| **Chevauchement Londres/NY** | **13h00–17h00** | **Fenêtre reine** |
| Rollover | ~21h00–22h00 | Spreads élargis, à exclure |

**Ce qu'il faut privilégier** : le chevauchement Londres-NY pour les paires majeures ; sur les paires JPY, la session Tokyo reste exploitable.

**Comment** : un filtre binaire "session active/inactive" par paire (une paire EUR/JPY a une fenêtre utile différente d'un GBP/USD), plus une fenêtre d'exclusion dynamique autour des news macro majeures — NFP (1er vendredi du mois, 12h30 UTC), CPI (mi-mois, 12h30 UTC), décisions de banques centrales.

**Pourquoi** : hors chevauchement, le spread s'élargit et le carnet d'ordres s'amincit — un signal technique identique génère un coût d'exécution différent selon l'heure, ce qui fausse le ratio risque/rendement même si le signal "a l'air" bon sur le papier.

---

## 2. Cryptomonnaies

**Horaires clés** : marché 24/7, mais l'activité n'est pas uniforme.

| Fenêtre | UTC | Caractère |
|---|---|---|
| Pic asiatique | 00h00–08h00 | Actif, notamment sur les paires liées aux exchanges asiatiques |
| Pic US | 13h00–21h00 | Généralement le plus gros volume, aligné sur l'ouverture Wall Street |
| Week-end | — | Volumes souvent nettement plus faibles, spreads plus larges |

**Ce qu'il faut privilégier** : les heures US pour la meilleure liquidité ; le funding rate des perpétuels comme filtre de contexte ; la dominance BTC pour tout signal sur un altcoin.

**Comment** : seuil de funding rate anormal (ex. positionnement extrême sur plusieurs heures consécutives) comme signal contrarien plutôt que de confirmation ; croiser tout signal altcoin avec le mouvement simultané de BTC — si BTC ne confirme pas, pondérer le signal à la baisse.

**Pourquoi** : un funding extrême précède souvent des cascades de liquidations — ce sont des mouvements violents mais pas des "tendances propres" au sens technique, donc un piège classique pour un scan haute fréquence.

---

## 3. Matières premières

### Or

**Horaires clés**

| Repère | Heure | Caractère |
|---|---|---|
| Shanghai Gold Exchange | ~01h00–03h30 et ~05h30–07h30 UTC | Demande physique asiatique |
| London Fix AM | 10h30, heure de Londres | Fixing institutionnel |
| London Fix PM | 15h00, heure de Londres | Fixing institutionnel |
| **Chevauchement Londres/COMEX** | **~13h00–17h00 UTC (8h–12h ET)** | **Fenêtre reine** |
| Sydney / début Tokyo | — | Volumes faibles, spreads larges, à éviter |

**Ce qu'il faut privilégier** : le chevauchement Londres-New York pour l'exécution ; les taux réels US (rendement du 10 ans indexé inflation) et le DXY comme couche de validation macro, pas seulement la technique.

**Comment** : fenêtre horaire comme premier filtre, puis couche macro qui pondère ou bloque le signal technique s'il contredit la direction des taux réels/DXY sur la même période. Autour des fixings (10h30/15h00 Londres), soit tu exclus quelques minutes si la volatilité de fixing perturbe ton modèle, soit tu la traites comme une fenêtre d'opportunité dédiée si ta stratégie est conçue pour ça.

**Pourquoi** : l'or est piloté à 80% par des facteurs monétaires (taux réels, dollar) — un signal technique qui ignore cette couche génère un taux de faux positifs bien plus élevé que sur un actif purement technique.

### Pétrole (WTI/Brent)

**Horaires clés**

| Événement | Horaire | Fréquence |
|---|---|---|
| Rapport EIA (Weekly Petroleum Status Report) | 10h30 ET (jeudi si lundi férié) | Chaque mercredi |
| Réunions OPEP+ | Variable, connue à l'avance | Ponctuelle |

D'après les données officielles de l'EIA, le rapport hebdomadaire, publié chaque mercredi à 10h30 heure de l'Est, est la donnée qui fait le plus bouger le marché pétrolier mondial, avec des mouvements de 1 à 3 dollars par baril sur des surprises de chiffres.

**Ce qu'il faut privilégier** : isoler complètement cette fenêtre plutôt que d'essayer de la trader techniquement ; suivre le spread WTI-Brent comme filtre de cohérence entre les deux contrats.

**Comment** : règle d'exclusion automatique ±15-20 minutes autour de 10h30 ET chaque mercredi ; flag "jour de réunion OPEP+" qui élargit temporairement les seuils de tolérance de volatilité du bot plutôt que de générer un signal dessus.

**Pourquoi** : un mouvement post-publication est piloté par la donnée, pas par la structure technique — le "signal" que ton scan détecterait à ce moment-là est en réalité le bruit de l'annonce, pas un edge réel.

### Agricoles (blé, maïs, soja)

**Horaires clés**

| Événement | Horaire | Fréquence |
|---|---|---|
| WASDE (USDA) | 12h00 ET, entre le 8 et le 12 du mois | Mensuelle |
| Crop Progress | 16h00 ET, le lundi | Hebdomadaire (avril-novembre) |

**Ce qu'il faut privilégier** : la saisonnalité (semis au printemps, récolte à l'automne) comme filtre de régime de fond, en complément — pas en remplacement — de la technique.

**Comment** : calendrier d'exclusion mensuel (WASDE) et hebdomadaire en saison (Crop Progress) ; un flag saisonnier qui ajuste les seuils ATR selon la période de l'année agricole plutôt qu'un seuil fixe à l'année.

**Pourquoi** : ici, contrairement à l'or, la saisonnalité n'est pas un bonus — c'est un driver de fond aussi important que la tendance elle-même.

### Métaux industriels (cuivre)

**Ce qu'il faut privilégier** : le PMI manufacturier chinois comme filtre de contexte, et une logique de corrélation opposée à celle de l'or — corréler au risk-on des indices actions, pas au dollar.

**Pourquoi** : le cuivre reflète la demande industrielle réelle, pas la recherche de sécurité — appliquer le même filtre DXY que sur l'or produirait ici des faux signaux.

---

## 4. Actions US / Nasdaq

**Horaires clés (heure de New York, ET)**

| Session | Horaire | Caractère |
|---|---|---|
| Pre-market | 4h00–9h30 | Liquidité faible, spreads larges |
| Range d'ouverture | 9h30–10h00 | Volatil mais souvent piégeux (stops, ordres institutionnels) |
| Cœur de séance | 10h00–15h30 | Le plus "propre" techniquement |
| Clôture | 15h30–16h00 | Volume élevé, orienté par les flux de fin de journée |
| After-hours | 16h00–20h00 | Liquidité faible |

**Calendrier macro à isoler** : NFP (1er vendredi du mois, 8h30 ET), CPI (mi-mois, 8h30 ET), décision FOMC (8 fois/an, 14h00 ET + conférence 14h30 ET).

**Ce qu'il faut privilégier** : le cœur de séance (10h00–15h30 ET) pour la fiabilité technique ; les dates d'earnings par titre à exclure systématiquement.

**Comment** : pondérer différemment les trois sous-fenêtres de la séance plutôt qu'un seuil unique pour toute la journée ; base de données des dates de publication de résultats par titre, à croiser avant validation d'un signal.

**Pourquoi** : la microstructure change radicalement en 30 minutes — un même indicateur n'a pas la même fiabilité à 9h31 qu'à 11h00, et un signal généré juste avant des earnings ne dit rien sur ce qui va se passer après la publication.

---

## 5. BRVM

Les horaires ci-dessous sont ceux publiés officiellement sur le site de la BRVM (heure UTC = heure d'Abidjan, pas de changement d'heure) :

| Phase | Horaire (UTC) |
|---|---|
| Pré-ouverture | 09h00–09h45 |
| Fixing d'ouverture | 09h45 |
| **Cotation continue** | **09h45–14h00** |
| Pré-clôture | 14h00–14h30 |
| Fixing de clôture | 14h30 |
| Négociation au dernier cours | 14h30–15h00 |
| Clôture officielle | 15h00 |

Ces horaires peuvent être exceptionnellement réduits la veille des jours fériés, avec des changements annoncés par avis spécifique — dans ce cas, la cotation continue se termine dès 11h00 UTC.

**Ce qu'il faut privilégier** : les deux fixings (09h45 et 14h30) où se concentre l'essentiel du volume réel ; la cotation continue reste la fenêtre technique principale mais avec un filtre de volume nettement plus strict qu'ailleurs.

**Comment** : normaliser le volume par titre sur une moyenne propre (X jours glissants) plutôt que d'utiliser un seuil absolu, et pondérer plus fortement les signaux générés près des fixings.

**Pourquoi** : sur un marché aussi peu liquide, le prix peut bouger sur un seul ordre isolé en cotation continue ; les fixings sont les moments où le prix reflète le mieux un vrai consensus acheteurs/vendeurs plutôt qu'un accident de carnet d'ordres.

---

## 6. Deriv — Indices de volatilité synthétiques

**Horaires clés** : aucun. Disponibles 24h/24, 7j/7, y compris week-ends et jours fériés — la notion de "fenêtre horaire" ne s'applique tout simplement pas ici.

**Ce qu'il faut privilégier** : le choix de l'indice plutôt qu'un moment de la journée — Volatility 10/25/50/75/100/250 pour du suivi de tendance continu, Crash/Boom pour des entrées structurées autour d'événements statistiquement définis, Step pour des systèmes mécaniques bornés.

**Comment** : puisque la volatilité cible de chaque indice est fixe et connue (par exemple une volatilité annualisée cible autour de 75% pour Volatility 75), tu peux calibrer des seuils ATR/z-score stables par indice une fois pour toutes, sans recalibrage dynamique dans le temps — contrairement à tous les autres marchés de ta liste.

**Pourquoi** : absence totale de drivers fondamentaux ou de session — le filtre se réduit uniquement à la couche technique/statistique. Les couches "session", "macro" et "corrélation" de l'architecture qu'on a posée sont ici inapplicables par construction, pas juste secondaires.

---

## Tableau de synthèse

| Marché | Fenêtre reine | Fenêtre à éviter | Donnée à isoler |
|---|---|---|---|
| Forex | Londres/NY 13h–17h UTC | Rollover 21h–22h UTC | NFP, CPI, banques centrales |
| Crypto | Heures US 13h–21h UTC | Week-end | Funding rate, dominance BTC |
| Or | Londres/COMEX 13h–17h UTC | Sydney/début Tokyo | Taux réels US, DXY |
| Pétrole | Continu | ±15min autour de 10h30 ET mercredi | EIA, OPEP+ |
| Agricoles | Session CBOT jour | Autour du WASDE (12h ET) | WASDE, Crop Progress |
| Actions US | 10h–15h30 ET | Pre/after-market, autour des earnings | NFP, CPI, FOMC |
| BRVM | Fixings 09h45/14h30 UTC | Cotation continue à faible volume | Volume normalisé par titre |
| Deriv Vol. | Aucune (24/7) | Aucune | Choix de l'indice, pas d'horaire |

C'est beaucoup d'information dense — si tu veux, je peux te la compiler dans un document de référence (Word ou markdown) que tu gardes sous la main pendant que tu codes les configs par marché, plutôt que de la retrouver dans le fil de la conversation. Sinon, dis-moi sur quelle couche tu veux qu'on aille en profondeur technique maintenant : la structure JSON des seuils par marché, ou le module de détection des fenêtres d'exclusion (news/fixings/WASDE) ?





Je me mets dans cette double casquette : trader qui a vécu le marché de l'or et des matières premières au quotidien, et ingénieur qui traduit ça en logique de filtre. Voici une réponse plus approfondie, avec l'or en premier plan.

## L'or : l'actif hybride qui casse les modèles génériques

Le piège n°1 sur l'or, c'est de le traiter comme une matière première classique (offre/demande physique). En pratique, **l'or se comporte à 80% comme un actif monétaire/refuge et à 20% comme une commodity**. Un bot qui applique le même modèle qu'au pétrole ou au blé va générer beaucoup de faux signaux sur l'or.

### Les vrais moteurs de l'or, par ordre de poids

| Moteur | Ce qu'il faut suivre | Pourquoi c'est plus fiable que la technique pure |
|---|---|---|
| **Taux réels US** (rendement TIPS 10 ans) | Corrélation inverse forte, historiquement le driver n°1 | L'or ne rapporte pas d'intérêt — quand le rendement réel monte, le coût d'opportunité de détenir de l'or augmente |
| **Force du dollar (DXY)** | Corrélation inverse, mais moins stable que les taux réels | Utile comme filtre de confirmation, pas comme signal principal |
| **Achats des banques centrales** (surtout émergentes) | Flux structurel de fond, peu visible en intraday | Change le régime de fond sur plusieurs mois, pas exploitable sur un scan 5s mais utile pour calibrer un biais directionnel de fond |
| **Flux de risk-off** (stress actions, géopolitique) | Corrélation avec VIX, indices actions | Explique les pics soudains non liés à la technique |
| **Ratio or/argent** | Divergence entre les deux métaux | Un signal haussier sur l'or non confirmé par l'argent est un signal à pondérer plus faiblement |
| **Positionnement COT (CFTC)** | Rapport hebdomadaire (vendredi) sur le positionnement spéculatif | Un positionnement extrême (trop long) est un signal contrarien classique, utile en filtre de contexte plutôt qu'en signal direct |

### Ce que ça change concrètement pour ton filtre

Un vrai trader pro sur l'or ne fait jamais confiance à un signal technique pur sans vérifier au minimum la direction des taux réels et du DXY sur la même fenêtre de temps. Pour ton bot, ça veut dire ajouter une **couche de contexte macro** spécifique à l'or dans ton architecture :

- Récupérer un flux (même à basse fréquence, ex. toutes les heures) sur le rendement du 10 ans US et le DXY.
- Si le signal technique sur l'or est haussier mais que les taux réels montent et le DXY monte aussi → pondérer le signal à la baisse, ou l'ignorer.
- Si tous les moteurs sont alignés → c'est ce type de confluence qui distingue un signal "de qualité" d'un signal purement technique.

C'est exactement la logique de la Couche 5 (corrélation) de l'architecture qu'on a posée précédemment — sauf que sur l'or, cette couche n'est pas optionnelle, elle est **structurante**.

### Sessions et microstructure spécifiques à l'or

- **Ouverture Shanghai/Asie** : la demande physique chinoise et indienne peut créer des mouvements qui n'ont rien à voir avec la technique occidentale.
- **Ouverture COMEX (session US)** : c'est là que le volume papier (futures) domine — c'est la session la plus fiable pour un signal technique pur.
- **Chevauchement Londres/New York** : liquidité maximale, spreads les plus serrés, c'est ta fenêtre prioritaire pour valider un signal à haute fréquence.

---

## Les autres matières premières : chaque famille a sa propre logique

Un pro ne traite jamais "les matières premières" comme un bloc homogène. Trois familles, trois logiques de filtre :

### Énergie (pétrole WTI/Brent)

- **Rapport hebdomadaire des stocks (EIA, généralement le mercredi)** : c'est un événement à volatilité programmée — soit tu exclues la fenêtre de publication de ton scan, soit tu la traites comme un signal à part avec des seuils élargis.
- **Décisions OPEP+** : chocs d'offre imprévisibles, aucun modèle technique ne les anticipe — seul un filtre "pause sur annonce" protège le bot.
- **Structure du marché à terme (contango/backwardation)** : un marché en backwardation forte signale une tension physique réelle — un paramètre de contexte utile, pas un signal de trade en soi.
- **Spread WTI-Brent** : sa dynamique propre peut confirmer ou contredire un mouvement directionnel sur l'un des deux.

### Agricoles (blé, maïs, soja)

- **Rapports USDA (WASDE)** : mêmes principes que l'EIA pour le pétrole — volatilité programmée à isoler.
- **Saisonnalité forte** (semis, récolte) : contrairement à l'or ou au forex, la saisonnalité ici n'est pas un biais mineur, c'est un driver de fond qu'un bon système intègre comme filtre de régime saisonnier.
- **Météo** : impossible à capter par la technique pure — c'est une limite structurelle à assumer plutôt qu'à masquer par plus d'indicateurs techniques.

### Métaux industriels (cuivre notamment)

- **Proxy de croissance mondiale**, très corrélé aux PMI manufacturiers chinois — logique complètement différente de l'or : ici tu veux un régime "risk-on", pas un régime "risk-off".
- Peu de valeur refuge, donc le filtre de corrélation au DXY est plus faible et moins fiable que sur l'or.

### Le piège technique commun à toutes les commodities : le roulement des contrats

C'est le genre d'erreur qui plombe un bot en silence. Quand un contrat future approche de son échéance, la liquidité se déplace vers le contrat suivant. Si ton flux de données n'est pas construit en série continue correctement ajustée, **le roulement crée un gap artificiel que ton scan peut interpréter comme un signal**. Concrètement :

- Soit tu trades l'équivalent CFD/spot pour éviter le problème.
- Soit tu construis une règle explicite : pas de nouveau signal généré dans les jours entourant une date de roulement connue, sur le contrat qui expire.

---

## Retour à la question d'ensemble, avec ce regard de trader-ingénieur

Ce qui distingue un système *rentable* d'un système qui génère juste "des signaux techniquement corrects", c'est que chaque marché a une **couche de contexte non-technique dominante** qu'aucun indicateur de prix ne peut capter seul :

- Or → taux réels + DXY + positionnement
- Pétrole/agricoles → calendrier d'événements programmés (EIA/USDA/OPEP)
- Forex → sessions et calendrier macro
- Actions → sessions et earnings
- Crypto → funding rate et dominance BTC
- BRVM → normalisation du volume par titre (le seul marché où le problème est purement structurel, pas macro)
- Deriv → aucune couche macro, uniquement statistique/technique pure

Un vrai edge, ce n'est pas d'avoir plus d'indicateurs techniques — c'est de savoir **quelle couche de contexte est reine sur quel marché**, et de bloquer ou pondérer le signal technique quand cette couche le contredit. C'est ce qui réduit le plus les faux positifs, bien plus qu'ajouter un indicateur de plus sur un scan 5 secondes.

Un dernier réflexe de pro à intégrer : la qualité d'un signal ne se juge jamais indépendamment du ratio risque/rendement qu'il permet. Même un signal "propre" sur le papier ne vaut rien si le stop nécessaire (fonction de l'ATR du moment) mange plus que le take-profit visé — ça vaut la peine d'ajouter ce ratio comme filtre de sortie du pipeline, pas seulement les couches d'entrée qu'on a listées.

Tu veux qu'on descende sur la structure de données pour cette couche macro (or notamment), ou plutôt sur la règle de détection des fenêtres de roulement des futures ?






## Enhanced prompt (for reference)

*"I'm building a hybrid algorithmic trading bot (rule-based strategies reinforced by algorithmic filters) that scans multiple asset classes — crypto, forex, commodities, US equities/Nasdaq, BRVM, and Deriv synthetic volatility indices — every 5 seconds. I want a structured breakdown of: (1) universal signal-quality parameters that apply across all markets (trend, liquidity, volume, volatility, timing), and (2) market-specific parameters unique to each asset class, so I can build a false-signal filter layer that adapts its thresholds depending on which market is being scanned."*

---

# Paramètres de qualité de signal par marché

## 1. Les paramètres transversaux (le socle commun)

Avant les spécificités, voici les filtres qui doivent exister pour **tous** les marchés, avec des seuils qui, eux, varient par marché :

| Paramètre | Rôle dans le filtrage | Pourquoi il réduit les faux signaux |
|---|---|---|
| **Tendance** (ADX, structure HH/HL, MM 50/200) | Confirme la direction dominante | Un signal contre-tendance sur un scan 5s est souvent du bruit, pas un vrai retournement |
| **Volume relatif** (vs moyenne mobile du volume) | Confirme la conviction derrière le mouvement | Un breakout sans volume anormalement élevé est souvent un faux breakout |
| **Liquidité / profondeur de marché** (spread, order book) | Vérifie que l'exécution est fiable | Un signal valide sur un marché illiquide peut être inexécutable sans slippage important |
| **Régime de volatilité** (ATR, largeur des Bollinger) | Distingue "range mort" de "vraie impulsion" | Trop de volatilité = bruit/gap risk ; trop peu = chop, signaux qui se retournent aussitôt |
| **Multi-timeframe confluence** | Le signal 5s doit être aligné avec une TF supérieure (M15/H1) | Élimine une grande partie des faux signaux purement intra-tick |
| **Score de déviation statistique (z-score)** | Mesure à quel point le mouvement actuel s'écarte de sa norme récente | Permet de distinguer "signal" et "bruit statistique normal" |
| **Filtre spread/slippage attendu** | Rejette un signal si le spread dépasse X % du take-profit visé | Évite les trades théoriquement gagnants mais non rentables en pratique |
| **Calendrier économique / événements** | Suspend ou élargit les seuils autour des news à fort impact | Les mouvements post-news sont souvent erratiques avant stabilisation |
| **Corrélation avec un actif de référence** | Confirme ou contredit le signal via un actif lié | Un signal isolé, contredit par son actif de référence, est suspect |

---

## 2. Paramètres spécifiques par marché

### Forex

- **Sessions et chevauchements** : la fenêtre Londres–New York concentre l'essentiel de la liquidité sur les paires majeures ; la session asiatique est plus calme sauf sur les paires JPY.
- **Différentiel de taux d'intérêt** (carry) : influence les biais directionnels de fond.
- **DXY et corrélations croisées** : EUR/USD vs indice dollar, devises commodities (AUD, CAD, NZD) vs prix des matières premières associées.
- **Heure de rollover (~17h EST)** : spreads temporairement élargis, à exclure du scan.
- **Piège classique** : signaux générés pendant la session asiatique sur des paires non-JPY, souvent peu fiables faute de volume réel.

### Cryptomonnaies

- **Marché 24/7 mais pas homogène** : les heures US concentrent souvent plus de volume ; les week-ends sont statistiquement plus fins en liquidité.
- **Funding rate (perpétuels)** : un funding extrême signale un positionnement déséquilibré, facteur de retournement/squeeze.
- **Dominance BTC** : les altcoins suivent souvent BTC ; un signal altcoin contredit par BTC est à pondérer différemment.
- **Fragmentation de la liquidité** : le volume affiché dépend de l'exchange interrogé — vérifier la source des données de volume utilisées par le bot.
- **Sensibilité aux news réglementaires** : mouvements brusques et discontinus, moins prévisibles par la seule technique.

### Matières premières

- **Dates de roulement des contrats futures** : peuvent créer des distorsions de prix artificielles à exclure des signaux.
- **Rapports périodiques** (stocks EIA pour le pétrole, USDA pour l'agricole) : pics de volatilité prévisibles à encadrer.
- **Corrélation inverse au dollar** : un signal sur l'or ou le pétrole gagne à être croisé avec le DXY.
- **Statut refuge** (or notamment) : sensible aux risques géopolitiques, ce qui peut invalider une lecture purement technique.

### Actions US / Nasdaq

- **Segmentation horaire** : pre-market et after-hours ont une liquidité bien plus faible — spreads plus larges, signaux moins fiables.
- **Range d'ouverture** (les 15–30 premières minutes) : souvent bruité par les ordres institutionnels et les stops, à traiter avec prudence ou à exclure.
- **Saison des résultats (earnings)** : éviter ou fortement pondérer les signaux sur un titre proche de sa publication de résultats.
- **Bêta vs indice** : un signal sur une action isolée gagne à être confirmé (ou non) par le mouvement du secteur/indice (SPY, QQQ).

### BRVM

<br>

D'après les informations disponibles, la BRVM fonctionne en séance continue, du lundi au vendredi, environ de 9h à 15h30 (heure d'Abidjan, GMT), et une actualité récente souligne que le début 2026 a été marqué par un net ralentissement des volumes transactionnels, relançant le débat sur la profondeur et la soutenabilité de la liquidité du marché. Concrètement pour votre bot :

- **Liquidité structurellement faible** comparée aux marchés développés : un "gros volume" en absolu peut rester négligeable en absolu comparé au book réel — il faut normaliser le volume par rapport à la moyenne propre à chaque titre plutôt que d'utiliser un seuil fixe.
- **Spreads larges et carnets d'ordres minces** : un mouvement de prix peut résulter d'un seul ordre isolé plutôt que d'un vrai flux — filtre de volume relatif encore plus strict que sur les autres marchés.
- **Moins de présence algorithmique/HFT** : moins d'efficience mais aussi risque accru de mouvements non représentatifs (faible profondeur = prix facilement déplacé).
- **Vérifier la fraîcheur des flux de données** : les API/flux disponibles sur ce marché sont souvent moins temps réel que sur Nasdaq ou le forex — un signal basé sur une donnée légèrement décalée est un risque spécifique ici.

### Deriv — indices de volatilité synthétiques

C'est le cas le plus atypique de votre liste, et il change fondamentalement la logique du filtre. D'après la documentation de Deriv, ces indices sont générés par un moteur de nombres aléatoires cryptographiquement sécurisé, ce qui fait que chaque famille d'indices maintient un profil statistique stable et distinct, indépendant des news économiques, des politiques de banques centrales ou de la géopolitique. Autrement dit :

- **Volume et liquidité réels n'existent pas** au sens traditionnel — ce sont des paramètres non pertinents ici ; inutile de les intégrer dans le filtre pour cette classe d'actif.
- **Pas de calendrier économique à surveiller** : les news n'ont aucun effet, contrairement à tous les autres marchés de votre liste.
- **Le filtre doit devenir purement statistique/technique** : volatilité connue et fixe par indice (ex. Volatility 75 a un profil de volatilité annualisée cible d'environ 75 %), ce qui permet de calibrer des seuils ATR/z-score très précis et stables dans le temps, contrairement aux marchés réels où la volatilité elle-même est instable.
- **Indices Crash/Boom et Step** : logique différente encore — ils sont conçus pour des styles de trading spécifiques : les indices Volatility pour le suivi de tendance, les Crash/Boom pour des entrées structurées autour d'événements statistiquement définis, et les indices Step pour des systèmes mécaniques bornés — votre bot gagnerait à avoir un sous-module de filtre dédié à cette famille plutôt que de réutiliser le même filtre que pour "Volatility".
- **Risque de contrepartie** : Deriv est fabricant de marché sur ces instruments — un paramètre à garder en tête au niveau du risque global du bot, indépendamment du signal lui-même.

---

## 3. Comment articuler tout ça dans l'architecture du filtre

Pour un scan toutes les 5 secondes sur plusieurs classes d'actifs, une architecture en couches évite le sur-ajustement d'un filtre unique :

1. **Couche 1 — Filtre de régime** : rejette d'emblée les scans en volatilité anormalement basse (chop) ou anormalement haute (news spike), avec des seuils *par actif*, pas globaux.
2. **Couche 2 — Filtre de session/timing** : pondère ou bloque selon l'heure (rollover forex, pre-market actions, week-end crypto) — **non applicable** aux indices Deriv.
3. **Couche 3 — Filtre de liquidité** : seuil de volume relatif propre à chaque actif (critique sur BRVM, secondaire sur Deriv, majeur sur actions/forex).
4. **Couche 4 — Confluence multi-timeframe** : le signal 5s doit être validé par la tendance sur une TF supérieure.
5. **Couche 5 — Filtre de corrélation** : croise avec un actif de référence quand c'est pertinent (DXY, dominance BTC, indice sectoriel) — non applicable à Deriv.
6. **Couche 6 — Filtre d'exécution** : rejette si le spread/slippage attendu dépasse un seuil relatif au take-profit visé.

Chaque classe d'actif n'active pas forcément toutes les couches — c'est précisément ce qui rend le système hybride pertinent : le moteur reste commun, mais la configuration des seuils (et l'activation ou non de certaines couches) devient un paramètre par marché.

---

Une précision utile : je ne suis ni conseiller financier ni régulé pour donner des recommandations de trading — tout ce qui précède est une aide à la conception technique de votre système de filtrage, pas une garantie de performance. Aucun filtre n'élimine le risque de marché.

Si tu veux, je peux descendre au niveau du pseudo-code ou de la structure de données pour une des couches (par exemple le calcul du z-score par actif, ou la configuration JSON des seuils par marché) — dis-moi sur laquelle tu veux qu'on aille en profondeur en premier.





Système de génération de signaux de trading hybride (paramètres clés)
Paramètres universels (« amis du trader »)
Identification de tendance et horizons temporels : utiliser une analyse multi-échelles. Par exemple, combiner des moyennes mobiles (MA) ou oscillateurs (MACD, RSI) sur différentes unités de temps (1 min, 5 min, 1 h, 4 h, journalier) pour distinguer tendance de fond et mouvements intraday. Exiger la confirmation d’un retournement sur plusieurs timeframes réduit les faux signaux. On peut aussi recourir à des approches quantitatives (HMM, K-means) pour détecter automatiquement des régimes de tendance.

Mesure de la liquidité et seuils minimums : surveiller plusieurs métriques de liquidité simultanément. Outre la mesure traditionnelle du bid-ask spread et du volume total (par exemple ADTV – volume moyen quotidien), il faut analyser la profondeur du carnet (liens budgetées), le volume aux meilleurs prix, et surtout la qualité d’exécution (impact sur le prix). Par exemple, les études recommandent d’utiliser des indicateurs de prix d’impact ou de slippage plutôt que de se fier au seul volume affiché. Un faible volume au livre (spread étroit) n’est pas forcément illiquidité s’il se renouvelle vite. En pratique, on fixe par classe d’actif un seuil minimum : par ex. pour entrer un signal sur un titre d’actions, exiger que le volume actuel soit au moins, disons, 50–100 % du volume moyen sur la même bougie (Relative Volume) ou que le spread soit stable.

Analyse du volume (confirmation/divergence, flux institu./retail) : le volume valide souvent la direction du prix. Une hausse de prix accompagnée d’un volume croissant (confirmation) témoigne d’une dynamique saine. A contrario, une divergence prix/volume (prix montant sur volume décroissant) signale un risque d’affaiblissement. Des indicateurs comme VPT (Volume Price Trend) ou le Volume Flow Indicator aident à déceler ces divergences. On scrute aussi le profil de volume (« Volume by Price ») pour repérer les plages de liquidité (pivots, zones de congestion). Les trades massifs (>10k actions) sur plusieurs séances laissent percevoir l’accumulation institutionnelle, souvent révélée par les « print » dark pool ou les ratios d’achats/ventes dans les ATS. En pratique, la part de volume dark pool d’un actif et le « sentiment » dark pool (ratio achat/vente) peuvent signaler une force acheteuse cachée.

Classification des régimes de volatilité & sizing adaptatif : segmenter les marchés en régimes calmes vs volatils. Par exemple, calculer la volatilité réalisée (ATR, écart-type de returns) et détecter quand elle dépasse un seuil (« volatilité élevée »). Des méthodes de détection de regimes (Hidden Markov, clustering) montrent que les marchés passent typiquement par états faible chaos/intermédiaire/fort chaos. En phase de volatilité élevée, le sizing des positions doit être réduit (stop plus serrés, levier plus faible). On peut aussi recourir à la volatilité implicite (indices VIX/CBOE) pour adapter la taille du trade. En résumé, un stop initial à <0,5× ATR peut convenir en régime calme, alors qu’en volatilité haute on cherche <0,25× ATR et moins de levier.

Structure de marché (S/R, order flow, delta) : intégrer l’analyse des niveaux de support/résistance (points pivots, VWAP, lignes de tendance) pour repérer des zones-clés. L’étude de l’order flow (flux d’ordres) et du delta de volume permet d’estimer la pression acheteuse/vendeuse. Par exemple, les graphiques de type footprint montrent le volume acheteur vs vendeur par barre. Des déséquilibres acheteurs (plus de volume acheteur au marché) coïncident souvent avec un support potentiel, et l’inverse avec une résistance. On utilise aussi le cumulative delta (telle que définie chez TradingView) pour confirmer un mouvement : un net flux d’achat (delta positif) validant un break-out, etc. Sur actions, surveiller aussi les prints significatifs hors marché (dark pools) comme signal de flux institutionnels.

Calibrage par classe d’actifs
Cryptomonnaies (BTC, ETH, alts) : marché 24/7, global et fragmenté (de nombreux exchanges). Disponibilité permanente signifie absence d’heure de clôture, mais les volumes montent nettement lors des chevauchements des sessions principales (Asie/Europe/US). L’arbitrage inefficace entre plateformes peut créer des « bourses » locales temporaires de liquidité. Les cycles de halving (Bitcoin ~tous les 4 ans) sont cruciaux : ils réduisent l’offre de nouveaux coins, amplifiant la volatilité et souvent précèdent des rallies prix. En pratique, on suit l’historique de sentiment lors des halvings pour ajuster la sensibilité du bot (anticiper volatile). Sur blockchain, on peut traquer les mouvements de « whales » (gros portefeuilles) via des services (Whale Alert, Nansen, etc.) : transferts massifs vers exchanges signalent souvent des liquidations potentielles. Les taux de financement des perpétuels sont très suivis : un financement positif soutient les acheteurs (biais long), et des points extrêmes contiennent souvent des signaux de basculement. Par ailleurs, la métrique de flux de stablecoins (offre USDT, USDC) renseigne sur la demande institutionnelle. Par exemple, Amberdata note que l’offre de stablecoins USD dépassait $270 Mds début 2026, avec une légère hausse de USDT vs USDC suggérant des flux retail/offshore. Un afflux de stablecoins dans le système (minting) peut précéder des achats crypto à grande échelle. Ainsi, pour les crypto on privilégie les indicateurs on-chain (flux, soldes des exchanges, funding) en complément des signaux techniques classiques.

Forex (paires de devises) : marché OTC 24h (5j/semaine). Les chevauchements de sessions sont cruciaux : par exemple, le recoupement Londres–New York (13h–17h GMT) concentre près de 70 % des volumes FX. C’est le moment où les paires majeures bougent le plus et où un breakout a le plus de chances de tenir. En dehors, les sessions plus calmes (Asie seule) produisent beaucoup de “false breakout”. Les cycles de politique monétaire (décisions taux, conférences Fed/ECB) dominent l’agenda : il faut filtrer les signaux autour de ces annonces. Le carry trade (emprunter en devise faible taux, prêter en devise fort taux) est un facteur de plus long terme – on surveille l’écart de taux et le sentiment global « risk-on/risk-off » pour des opportunités de renversement lors de mouvements de flux massifs. Le rapport COT (Commitments of Traders) sur les futures de devises fournit une vue des positions speculatifs vs hedgers, utile pour repérer des extrêmes (« managers très longs EURUSD, extrême rachat de USD »). Enfin, les fenêtres interbancaires (horaires de règlement, liquidité bancaire) créent des gaps de liquidité (par ex. tôt le matin Asie, fin de journée Europe) que l’on doit connaître car le prix peut sauter lors du retour d’envergure liquidité. On accorde une attention particulière au module « cours interbancaire » (EBS, Reuters) qui fixe les prix de référence sur les paires majeures.

Métaux précieux (or, argent) : principalement traités via les contrats COMEX (NYMEX). On dispose d’un trading électronique quasi 24h/5 (COMEX Globex), avec une courte pause quotidienne. Ce quasi-continu permet d’ajuster les positions à toute nouvelle financière. L’or est un actif de réfuge/hedge macro : historiquement, son prix suit fortement les taux réels US (10 ans TIPS). Une hausse de 100 bps des taux réels fait chuter le prix de l’or ~18 % selon PIMCO. En pratique, on suit les taux nominaux et inflation pour déduire les taux réels et ajuster la taille, plutôt que de trader l’or isolément. Des flux acheteurs massifs (par ex. achats par des banques centrales ou flux ETF) sont des signaux puissants. Noter aussi l’effet livraison physique : en fin de mois ou mois de livraison, la disponibilité du métal peut faire varier les prix (deliverable volume limité). Enfin, comme pour les devises, traiter l’or demande de connaître la corrélation avec les taux réels et l’appétit de risque global – il n’est pas infaillible comme « refuge » (ex. crise 2008, or avait baissé à court terme car les taux réels ont bondi). Le bot doit calibrer la sensibilité aux annonces macro (inflation, PMI, etc.) : par ex. le FOMC influence fortement l’or (hausse taux = pression vendeuse).

Actions US (NYSE/NASDAQ) : marché organisé avec des heures précises (9h30–16h ET, auctions ouvert/fermeture, pré/post-market). Les ouvertures/clos sont très liquides et volatiles : l’ouverture digère les news de la nuit, la clôture (closing auction NYSE) représente ~9 % des volumes journaliers et jusqu’à 10× le niveau normal lors d’indices ou expirations (≥2,5 G actions aux clôtures « witching »). L’algorithme doit intégrer ces pic de volume (p. ex. ne pas déclencher un signal breakout dans les dernières minutes sans filtrer, car l’algorithme de clôture lisse beaucoup). Les saisons de publications trimestrielles génèrent des sauts de volatilité élevés sectoriels : on atténue ou rejette les signaux juste avant/après ces annonces. Les événements macro américains (FOMC, NFP, CPI) créent des fenêtres pré/post très volatiles; la littérature montre que la volatilité intraday explose aux annonces de politique monétaire. En pratique on applique une règle stricte d’évitement ou de slowdown autour de ces releases (p. ex. pas de nouveaux trades 5–10 min avant/après NFP/FOMC). Enfin, on suit les transactions hors marché : ~40 % du volume des actions US peut passer par les dark pools. Les big prints (>10k actions) répétés signalent accumulation/distribution institutionnelle. Un flux d’achat important en pool privé (Dark Pool Index élevé) a historiquement précédé des breaks haussiers dans ~60 % des cas. Combiné avec des données d’options (flux d’options call/put) cela affine la détection des signaux forts et filtre les faux.

NASDAQ (specifically) : l’indice Nasdaq est très concentré secteur techno, avec de grandes valeurs (FAANG, etc.) à bêta élevé. Il y a donc une forte corrélation avec la VIX et la volatilité des techs ; les contrats d’options sur indices et leur gamma exposent d’importants feedbacks. Par exemple, si les market makers sont « short gamma » (GEX négatif), ils achètent en hausse et vendent en baisse, amplifiant la tendance. En présence d’une forte exposition négative (bêta net négatif), on attend des mouvements plus explosifs et de fortes variations de VIX. En pratique, on surveille le profil gamma par strike (« walls ») pour anticiper des niveaux de support/résistance structurels. Les valorisations tech sont aussi très sensibles aux nouvelles d’entreprises hors heures (earnings after-hours), d’où une volatilité PM/AM souvent plus forte sur ces titres. Le bot Nasdaq devra donc consolider les flux post-market (volume acheté/vendu) pour ajuster les signaux du lendemain.

BRVM (Bourse régionale africaine) : la BRVM est une bourse régionale à faible capitalisation (~50 titres) pour 8 pays de l’UEMOA. La liquidité y est très limitée ; les volumes sont sporadiques et les spreads larges. Il faut donc des seuils de volume très bas pour considérer un signal valide (par ex. tout breakout sur un titre avec volume négligeable est suspect). La BRVM-30, index des 30 valeurs les plus liquides, guide la tendance générale. Les influences macroéconomiques locales (fixations de prix agricoles, budgets, élections) dominent les mouvements : ex. cours du cacao, du pétrole, politiques monétaires du BCEAO. Enfin, la devise commune (CFA) étant arrimée à l’euro, les mouvements EUR/USD importent aussi. Pour la BRVM, on intégrera dans le modèle des données macro UEMOA (croissance, inflation, prix matières premières) et on appliquera un filtering très strict (ex. ignorer les cassures hors circuits de vente actifs, attendre regroupement de plusieurs indicateurs avant de valider).

Volatilité (indices et dérivés) : inclut VIX, VIX futures, VIX options, swaps de variance, skew. On suit la structure par terme (futures VIX en contango ou backwardation). En temps normal, la courbe VIX est en contango (futures > spot), ce qui est un premium vendu chaque jour (futures convergent vers spot). Un retournement vers la backwardation signale un pic de stress. Par ex. une étude note que le fait qu’un « upward sloping VIX futures curve » (contango) implique souvent une hausse ultérieure du VIX. On surveille aussi le skew (la pente du smile d’options): un skew élevé (prix fort des puts profonds) signale forte aversion au risque. Les variances swaps, quant à eux, sont tarifiées sur l’espérance de variance (par intégration sur la surface d’options). Le bot peut calculer un forward variance implicite via l’inversion de la formule des variance swaps pour anticiper la volatilité réalisée. En pratique, un différentiel entre variance swap et volatilité réalisée (ex-ante vs ex-post) sert de filtre de confiance.

Facteurs temporels et cycliques
Saisonnalités intraday par classe d’actif : chaque marché a ses heures « calmes » et « chaudes ». Par ex., en actions US, un creux de volatilité survient souvent entre 11h et 13h ET, tandis que les premières et dernières heures sont très actives. En forex, les chevauchements Londres/NY sont les plus volatils. En cryptos, on peut observer des « routines » (par ex. creux le dimanche où les gros acteurs sont inactifs). On construit des poids horaires : exiger plus de volume ou désactiver certains systèmes durant les périodes très basses liquidités (fins de semaines pour la BRVM, heures de déjeuner dans les pays concernés).

Cycles hebdomadaires/mensuels/annuels : de nombreux effets récurrents existent. Effet janvier (« January effect ») en actions, notamment small caps qui surperforment en janvier. Rééquilibrages trimestriels (ETF, fonds) créent des flux à la fin de chaque trimestre. La dernière semaine de l’année voit souvent un « tax-loss harvesting » (vente de titres perdants). Chaque mois, on surveille la première séance (effet de sablier) et la dernière (position de fin de mois). Sur les marchés FX ou matières, les rendez-vous périodiques (fixing mensuel EUR/USD, livraison or du COMEX chaque mois) peuvent engendrer de la volatilité.

Fenêtres d’événements programmés : FOMC (8 fois/an) — l’annonce et le post-conférence (14h suivi de Q&A) créent des fenêtres de ±30 min très volatiles, à éviter ou filtrer. Les NFP (premier vendredi du mois, 8h30 ET) génèrent une explosion de volatilité inattendue; on ne trade pas le breakout initial de 2–5 min. Même traitement pour CPI, retail, PMI (prévus à 8h30 ET US) où un spike initial doit être ignoré comme « liquidity grab ». Ces règles évitent d’être piègé par les faux breakouts post-news. On peut automatiser des « cooldowns » systématiques aux heures fixées.

Contagion inter-actifs : la corrélation entre classes change selon le cycle. Par ex., en phases de risque, on observe souvent que le Bitcoin évolue de pair avec les actions technos (risk-on); en revanche, lors de paniques, les flux se tournent vers USD, JPY, or. Pour le bot, on peut monitorer une matrice de corrélation glissante crypto–actions/indices (ex. Bitcoin vs S&P500) et déclencher un recalibrage de stratégie si la corrélation s’effondre (indiquant entrée en régime « safe-haven »). Des études récentes montrent que Bitcoin n’est pas un refuge en crise mais bien un transmetteur de risque, aligné sur les actions en hausse. Ainsi, un pic de corrélation positive BTC–Nasdaq signale une bulle plutôt qu’un décalage comme valeur-refuge.

Filtres de qualité des signaux
Éviter les faux breakouts en faible liquidité : appliquer des règles strictes d’entrée. Par exemple, n’entrer un breakout qu’à la suite d’une bougie dont le volume est multiplié (≥1,5–2× le volume moyen). Sur instrument peu liquide, exiger un ratio wick/corps faible (pas de mèches trop longues) et une cassure d’une ampleur suffisante (≥0,5×ATR). Vérifier l’état du carnet : une largeur de spread anormale avant la cassure est un indice de piège (market makers retirent leur liquidité). De même, n’accepter une cassure dans l’« overlap » Londres-NY (plus probante) plutôt qu’en session nocturne tranquille. En fenêtre macro (NFP/FOMC), ne pas prendre d’entrées durant la bougie de réaction initiale.

Confluence multi-horizons : exiger qu’un signal se renforce sur au moins deux unités de temps (par ex. cassure sur 5 min confirmée sur 15 min). De même, combiner indicateurs différents : momentum + volumes + support statique. Un signal technique isolé (triangle percé sur 1 min) n’a de poids que si la tendance plus long terme est alignée. Cette approche filtra les signaux parasites. Par ex. si le trend daily est baissier, on privilégie uniquement les breakouts à la baisse sur les timeframes moindres.

Détection de rupture de corrélation : inclure un module de détection de régime (regime-shift). On peut faire un test de cointégration glissant ou observer les composantes principales des rendements : un changement brutal (angle important d’un vecteur propre) signale une déconnexion. Par exemple, une chute soudaine de corrélation entre actifs traditionnellement couplés (p. ex. pétrole vs matières premières) doit générer une alerte de changement de régime, contraignant à élargir les stops ou désactiver certains algos basés sur correlation historicale. L’apprentissage automatique peut être utilisé : par exemple, un cluster sur indicateurs macro+quantité relative pourrait signaler un nouveau régime.

Importance des facteurs en ML par type de marché : si un système comprend un module d’apprentissage, on exploitera les scores d’importance de variables pour chaque classe d’actif. Par ex. sur actions US, les variables du bilan (PER, ROE) et momentum ont souvent une grande importance pour la prévision de tendance à moyen terme; sur Forex, les différentiels de taux et COT peuvent dominer; sur crypto, des métriques on-chain (nouvelles adresses, liquidité de stablecoins) ajoutent de la valeur. On analysera ces feature importances pour identifier et éliminer les paramètres peu prédictifs, limitant ainsi les signaux spuriques. Cela aide aussi à comprendre pourquoi un signal a échoué (ex. un indicateur inadapté à la volatilité élevée).

Architecture hybride et pipeline de scanning
Algorithmes vs discrétionnaire : définir des règles claires de priorité. Les règles algorithmiques (quant) doivent traiter automatiquement les signaux objectifs (breakouts, volumes anormaux, volatilité) quand les conditions sont standards. Mais en cas d’événements extrêmes ou d’« anomalies fondamentales » (crash géo-politique, panique brutale), un « override » humain peut suspendre l’algorithme. Par exemple, si soudainement tous les marchés s’effondrent pour une raison imprévue, le bot rétrograde en mode « pilote automatique minimal » (fermeture de positions) en attendant analyse. Un score de confiance (voir ci-dessous) peut servir de pont : si un signal quant est fort (score >80 %) et que le risque de marché est normal, trader. S’il y a divergence (par ex. forte volatilité extrême détectée, score incertain), on réduit automatiquement la taille ou on attend.

Scoring de confiance : combiner facteurs quantitatifs (p. ex. probabilité du modèle, ratio volume vs bruit, nombre de filtres passés) et qualitatifs (sentiment news, recommandations analystes) pour donner un indice de fiabilité du signal. Par exemple, calculer un score 0–100 : +20 pour chaque critère technique validé (multi-frame, volume, absence de news), -30 si volatilité exceptionnelle ou écart macro-élevé. Les positions ne sont prises que si ce score dépasse un seuil (ex. 70). Ce mécanisme hybride maximise la probabilité de bons signaux.

Optimisation pour le scan 5 secondes : un cycle très court nécessite un pipeline optimisé. Beaucoup de calculs peuvent être pré-calculés/actualisés en parallèle :

Calculs pré-computés : caractéristiques techniques coûteuses (MAs lissées, ATR quotidien, profils de volume, indicateurs multi-timeframe) peuvent être mises à jour chaque minute ou même moins (rollback des tableaux). Les contraintes statiques (pivots de Fibonacci journaliers, seuils de volume moyens) sont fixées en avance.
Calculs en temps réel : seules les données frais arrivent au rythme du flux (prix live, volume cumulatif). On applique très rapidement des règles sur ces flux (détecter crossing de seuil ou pics de volume). Le bot maintient un état par actif, afin d’éviter tout recalcul complet : par ex. conserver l’ATR sur 14 périodes glissantes et le mettre à jour récursivement à chaque nouvelle bougie. Les algorithmes critiques sont écrits en version compilée ou proche-natif pour <5 ms de latence.
Infrastructure : utiliser une architecture multi-thread ou distribuée, où chaque thread surveille un groupe d’instruments, partageant une base de données mémoire (Redis, kdb+) pour les indicateurs communs (indices mondiaux, taux). Les requêtes de données externes (news, tweets) sont dissociées avec cache, car ces latences n’entrent pas dans la fenêtre 5 s d’exécution des règles principales.
Alerte asynchrone : dès qu’un critère est déclenché (breakout 5 s réel), initier immédiatement les contre-vérifications (volume, news pendante). Si confirmées en <5 s, alors ouverture de position. Sinon abandon.
Distinction universels vs spécifiques : dans l’architecture, on implémente un noyau commun (gestion du temps, execution d’ordres, suivi de P&L) et on « plug » les modules par actif. Par ex., la logique de filtre breakouts est identique partout, mais les seuils (min volume, ATR pour expansion zone, heures actives) varient : on définit un fichier de configuration par marché. Cette distinction claire évite de mélanger les signaux (un « stop-hunt » en Asie 500 gold ne vaut pas un faux-break en session US futures).

Éléments microstructurels moins connus : mentionnons par exemple que sur Nasdaq ou NYSE, les tick sizes (0,01$) et la présence de midpoint orders (passage d’ordre à la moitié du spread) modifient les patterns de prix comparé au Forex (où la notion de tick est plus rigide). Sur crypto, l’absence de réglementation unit inflige parfois des « glitches » : ex. volume fictif, bots prématurant le carnet. Sur le Forex interbancaire, l’absence de centre unique implique que le « prix » est une synthèse d’ECNs; on doit donc agréger les meilleurs bids/asks de plusieurs sources. Ces micro-détails (pas de market open, market makers vs Taker sur crypto; closing auction vs continuous sur actions; quote coloration en Forex) sont pris en compte dans le calibrage pour chaque marché afin d’améliorer la fiabilité des signaux.






I need to develop a comprehensive trading signal generation system that accounts for the deep logical and structural differences between financial markets. My project involves building a hybrid bot that combines professional trader strategies with algorithmic reinforcement, scanning all asset classes every 5 seconds. I need to identify which parameters are truly decisive for signal quality versus those that generate false positives, with specific attention to market-implied characteristics.

Please provide a detailed framework covering:

**Core Universal Parameters (the "trader's friends"):**
- Trend identification methods and timeframes
- Liquidity measurement techniques and minimum thresholds
- Volume analysis (confirmation, divergence, institutional vs. retail flow)
- Volatility regime classification and adaptive sizing
- Market structure (support/resistance, order flow, delta)

**Asset-Specific Parameter Calibration:**

For each market, specify:
- Cryptocurrencies (24/7, exchange fragmentation, halving cycles, whale wallet tracking, funding rates, stablecoin flow metrics)
- Forex (session overlaps, central bank policy cycles, carry trade dynamics, COT positioning, interbank liquidity windows)
- Precious metals (COMEX/NYMEX hours, safe-haven flow triggers, real yield correlation, physical delivery mechanics)
- US Equities (market open/close dynamics, earnings seasons, FOMC windows, options expiration effects, dark pool prints)
- NASDAQ specifically (tech sector concentration, VIX correlation, gamma exposure, after-hours earnings volatility)
- BRVM (West African regional liquidity constraints, local macro drivers, frontier market specificities, currency peg implications)
- Volatility derivatives (term structure analysis, skew/term premium, VIX futures contango/backwardation, variance swap pricing)

**Temporal & Cyclical Factors:**
- Intraday seasonality patterns per asset class
- Weekly/monthly/annual cycles (January effect, quarterly rebalancing, tax loss harvesting)
- Event-driven windows (FOMC, NFP, CPI releases with specific pre/post timing rules)
- Cross-asset contagion timing (crypto leading/lagging equities, forex safe-haven rotation)

**Signal Quality Filters:**
- How to avoid false breakouts in low-liquidity periods
- Confluence requirements across multiple timeframes
- Correlation breakdown detection during regime shifts
- Machine learning feature importance for each market type

**Hybrid Architecture Guidance:**
- When algorithmic rules should override vs. defer to discretionary inputs
- Confidence scoring methodology combining quantitative and qualitative factors
- 5-second scan optimization (which calculations can be pre-computed, which must be real-time)

Please structure responses with clear parameter hierarchies, specific threshold examples where applicable, and explicit distinction between universal principles and market-specific adaptations. Include any lesser-known microstructural elements that differentiate signal reliability across these asset classes.Recherche approfondie @Recherche approfondie







**Enhanced prompt (in English):**

> I am developing a hybrid trading signal generation and execution bot. It combines professional discretionary trader judgment/strategies with algorithmic reinforcement (in some cases fully hybrid). The bot scans all my assets every 5 seconds.  
>  
> Assets covered: cryptocurrencies, forex, commodities, US equities, Nasdaq, BRVM (West African regional exchange), and volatility derivatives.  
>  
> Core premise: trend, liquidity, volume (and related factors you will expand on) are a trader’s best friends. High-quality trade decisions are strongly facilitated and confirmed by market-specific optimal moments, cycles, timing windows, periods, and information flows.  
>  
> Goal: Identify the key parameters (some universal, many market-specific) that should be evaluated on every scan to filter out “false good signals” and only allow high-conviction setups. Provide clear, detailed, logically structured answers that map the most relevant parameters, optimal trading windows/cycles, liquidity/volume characteristics, news/event sensitivity, and practical filters for each market class so the bot can adapt its logic accordingly.

---

**Réponse détaillée (en français)**

Voici une cartographie claire et opérationnelle des paramètres clés, adaptés à chaque classe d’actifs, pour un bot qui scanne toutes les 5 secondes. L’objectif est de maximiser le ratio signal/bruit et d’éviter les « faux bons signaux ».

### 1. Paramètres universels (à évaluer sur presque tous les marchés)
- **Tendance** : direction et force (ADX, pente de moyennes mobiles multi-timeframes, structure de prix higher-highs/lower-lows).  
- **Liquidité** : spread bid-ask, profondeur du carnet, impact de marché estimé.  
- **Volume** (et volume relatif / volume profile) : confirmation ou divergence avec le prix.  
- **Volatilité réalisée et implicite** : ATR, bandes de Bollinger, VIX ou équivalents.  
- **Corrélations inter-marchés** et flux macro (USD, taux, risk-on/risk-off).  
- **Contexte de session / cycle** : ouverture, mid-session, clôture, overlap.  
- **Filtres anti-bruit** : éviter les signaux pendant les premières/ dernières minutes de session, pendant les news à fort impact non digérées, ou quand le volume est anormalement bas.

Ces éléments doivent être calculés en multi-timeframes (ex. 1 min + 5 min + 15 min + 1 h) même si le scan est à 5 s.

### 2. Cryptomonnaies
**Particularités** : marché 24/7, liquidité très variable selon les paires et les exchanges, forte influence des flux de stablecoins, des liquidations, et du sentiment on-chain/social.

**Paramètres prioritaires** :
- Liquidité réelle (order book depth + volume 24 h sur plusieurs exchanges).  
- Funding rate et open interest (surtout perpétuels).  
- Flux de stablecoins (USDT/USDC sur les exchanges) et net flows exchange.  
- Dominance BTC et corrélation BTC ↔ alts.  
- Sentiment et volume social (mais avec filtre de lag).  
- Cycles de volatilité : souvent plus élevés pendant les sessions asiatiques et américaines ; week-ends parfois plus calmes ou plus manipulés.

**Fenêtres / cycles utiles** :
- Overlaps Asie-Europe et Europe-US.  
- Événements : unlocks, listings, hard forks, FOMC, CPI (même si crypto « découple » parfois).  
- Éviter les signaux purement techniques quand le funding est extrême ou quand le volume est concentré sur un seul exchange.

**Filtres bot recommandés** : exiger confirmation de volume + profondeur + absence de funding extrême avant d’accepter un signal directionnel.

### 3. Forex
**Particularités** : marché le plus liquide au monde, sessions très marquées, spread qui explose hors des overlaps et pendant les news.

**Paramètres prioritaires** :
- Spread actuel vs moyenne de session.  
- Volume (tick volume ou volume broker) et momentum de session.  
- Corrélations (EURUSD ↔ DXY, AUDUSD ↔ commodities, etc.).  
- Positionnement COT (hebdomadaire) et flux de positions retail.  
- Calendrier économique à fort impact (NFP, FOMC, CPI, décisions de banques centrales).

**Fenêtres optimales** :
- Overlap Londres-New York (≈ 13h–17h UTC) = liquidité maximale et meilleurs setups tendance/range.  
- Session Londres (ouverture) souvent directionnelle.  
- Session asiatique plus range pour beaucoup de paires majeures.  
- Éviter les 30–60 minutes autour des news à fort impact sauf stratégie news dédiée.

**Filtres bot** : signal invalide si spread > seuil dynamique de session ou si on est dans une fenêtre de news non digérée.

### 4. Matières premières (commodities)
**Particularités** : influencées par l’offre/demande physique, stocks, météo, géopolitique, et corrélations avec le dollar et les devises productrices.

**Paramètres prioritaires** :
- Inventaires (EIA pour le pétrole, rapports agricoles, stocks métaux).  
- Contango / backwardation et structure de terme.  
- Corrélation avec USD et devises liées (AUD, CAD, NOK…).  
- Volume et open interest sur les contrats futures.  
- Saisonnalité (ex. gaz naturel, agricoles).

**Fenêtres** :
- Ouverture des sessions futures (CME, ICE) et overlaps avec les sessions physiques.  
- Publications de stocks et rapports USDA / OPEC.  
- Périodes de forte demande saisonnière.

**Filtres** : un signal technique pure doit être confirmé par le contexte d’offre/demande ou par un mouvement du dollar cohérent.

### 5. Actions US & Nasdaq
**Particularités** : liquidité très élevée pendant les heures de marché, gaps d’ouverture, influence massive des résultats d’entreprises, Fed, et flux institutionnels.

**Paramètres prioritaires** :
- Volume relatif (vs moyenne 20/50 jours) et volume profile.  
- Breadth du marché (advance/decline, % au-dessus de MM).  
- Secteurs et corrélations (tech vs value, etc.).  
- Implied volatility et skew options.  
- Flux de dark pools / block trades (quand disponible).  
- Calendrier earnings et événements Fed.

**Fenêtres optimales** :
- Première heure (ouverture) : forte volatilité directionnelle ou faux breakouts.  
- Mid-day : souvent plus calme.  
- Dernière heure / power hour : réaccélération possible.  
- Pre-market et after-hours : liquidité réduite → spreads plus larges, plus de bruit.

**Filtres bot** : exiger volume significatif + cohérence avec le breadth ou le secteur ; invalider les signaux purement techniques dans les 15–30 premières minutes sauf setup spécifique d’ouverture.

### 6. BRVM (Bourse Régionale des Valeurs Mobilières)
**Particularités** : marché africain régional (UEMOA), liquidité nettement plus faible, sessions limitées, influence forte des flux locaux, des nouvelles macro régionales et des annonces d’entreprises locales. Spreads plus larges, volumes parfois très concentrés sur quelques valeurs.

**Paramètres prioritaires** :
- Volume réel et concentration (beaucoup de titres peu échangés).  
- Spread et profondeur (souvent faibles).  
- Actualités locales / régionales (BCEAO, politiques nationales, résultats des grandes capitalisations).  
- Corrélation avec les devises régionales et le climat risk-on global (mais plus faible qu’ailleurs).  
- Saisonnalité et cycles de liquidité liés aux flux institutionnels locaux.

**Fenêtres** :
- Heures de cotation officielles de la BRVM (généralement matinées en heure locale).  
- Jours de publication de résultats ou d’annonces macro régionales.  
- Éviter les signaux sur titres à très faible volume moyen.

**Filtres bot critiques** : seuil de volume minimum strict + spread maximum + confirmation que le titre n’est pas « illiquide » ce jour-là. Un signal technique classique a beaucoup plus de chances d’être un faux positif ici.

### 7. Dérivés de volatilité (VIX, options sur indices, etc.)
**Particularités** : la volatilité est mean-reverting sur certains horizons mais peut rester élevée longtemps ; très sensible aux events et au positionnement.

**Paramètres prioritaires** :
- Term structure de la volatilité (contango / backwardation).  
- Skew et put/call ratios.  
- Niveau absolu vs historiques (percentile).  
- Corrélation avec le sous-jacent (souvent inverse pour le VIX vs S&P).  
- Positionnement (speculators vs hedgers).

**Fenêtres** :
- Autour des annonces macro majeures et des échéances d’options.  
- Périodes de stress de marché (quand la vol explose).  
- Mean-reversion plus fiable après des spikes extrêmes, mais avec timing prudent.

**Filtres** : ne pas trader purement la direction de la vol sans regarder la term structure et le contexte du sous-jacent.

### Recommandations concrètes pour ton bot (scan 5 s)
1. **Hiérarchie de filtres** :  
   Liquidité + spread → Volume / volume relatif → Tendance multi-TF → Contexte de session / cycle → News / events → Confirmation spécifique au marché.

2. **Adaptation dynamique** : le bot doit charger un « profil de marché » (crypto, forex, BRVM, etc.) qui active/désactive certains filtres et ajuste les seuils.

3. **Anti-faux-signaux** :  
   - Exiger confluence minimale (ex. 3–4 conditions).  
   - Pénaliser fortement les signaux hors fenêtres de liquidité optimale.  
   - Pour les marchés peu liquides (BRVM, certains alts, après-hours), augmenter fortement les exigences de volume et de profondeur.

4. **Cycles et timing** : même avec un scan ultra-fréquent, le bot doit savoir dans quelle phase de session/cycle il se trouve et adapter le poids des signaux (ou simplement les bloquer).

5. **Hybride** : l’algo peut générer le signal brut ; une couche de règles « pro trader » (ou un modèle qui imite le raisonnement) valide ou invalide selon les paramètres ci-dessus.

Tu peux maintenant structurer tes modules de filtrage par classe d’actifs en t’appuyant sur cette cartographie. Si tu veux, on peut descendre ensuite dans le détail d’implémentation (seuils concrets, indicateurs exacts, logique de scoring, etc.) pour un ou plusieurs marchés prioritaires.
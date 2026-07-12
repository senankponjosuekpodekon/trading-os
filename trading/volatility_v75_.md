## Volatility Market (Deriv V75, V100, Synthetic Volatility Indices): Data That Drive the Asset — From Macro to Detailed Level

First, an important distinction:

There are **two different worlds of volatility assets**:

1. **Traditional volatility markets**

   * Example: VIX Index, VIX futures, volatility options.
   * Driven by real financial markets, especially options pricing and investor expectations. ([Cboe Global Markets][1])

2. **Synthetic volatility markets**

   * Example: Deriv Volatility 75 Index, Volatility 100, Volatility 10, etc.
   * These are algorithmically generated instruments with predefined volatility characteristics. Deriv states that these indices are generated using cryptographically secure random-number systems and are not affected by economic news or traditional market events. ([Deriv][2])

Therefore, the data analysis framework is different.

For **V75/V100**, you are not analyzing GDP, inflation, earnings, or central banks. You are analyzing the **mathematical behavior of a stochastic process**.

---

# PART 1 — The Primary Driver: The Volatility Engine

## Level 1: The Algorithmic Generation Model

The fundamental driver is:

* Random number generation
* Price generation algorithm
* Volatility parameter
* Tick generation frequency
* Distribution of price changes

For Deriv synthetic volatility indices:

The number (10, 25, 50, 75, 100, 150, etc.) represents the intended volatility level.

Example:

* Volatility 10 → slower movements
* Volatility 75 → aggressive movements
* Volatility 100 → very high movement speed

Higher volatility means larger expected price fluctuations. ([Deriv][3])

The important variables:

### 1. Return distribution

You study:

* Average return per tick
* Standard deviation
* Variance
* Extreme movements
* Probability of large candles

Example:

A V75 trader asks:

> "What is the probability of a 200-point movement after a consolidation period?"

---

# Level 2 — Statistical Properties of the Asset

Because synthetic indices are mathematical systems, statistics become the "fundamental analysis."

## Historical Volatility

Measures:

* How much price moves
* How frequently movements occur

Metrics:

* Standard deviation
* Variance
* Average True Range (ATR)
* Historical volatility percentage

Formula:

Volatility = dispersion of returns around the average return.

---

## Distribution Analysis

Professional analysis studies:

### Normal behavior

* Average movement
* Typical candles
* Normal retracements

### Abnormal behavior

* Extreme candles
* Price shocks
* Long runs
* Fast reversals

Metrics:

* Skewness
* Kurtosis
* Fat tails

---

# Level 3 — Market Regime Analysis

Even synthetic markets have different "states."

A trader analyzes:

## Low volatility regime

Characteristics:

* Small candles
* Tight ranges
* Slow movement

Possible strategy:

* Mean reversion
* Range trading

## Expansion regime

Characteristics:

* Larger candles
* Increasing ATR
* Strong directional movement

Possible strategy:

* Momentum
* Breakout

## Exhaustion regime

Characteristics:

* Extreme movement
* Abnormal candles
* Increased reversal probability

---

# Level 4 — Price Action Data

This is where most V75/V100 traders operate.

## Candle Data

Analyze:

* Open
* High
* Low
* Close
* Candle size
* Candle speed
* Wick length

Important concepts:

* Impulse candles
* Compression candles
* Rejection candles
* Exhaustion candles

---

# Level 5 — Market Structure

Even synthetic indices are analyzed through structure.

Data:

## Trend

* Higher highs
* Higher lows
* Lower highs
* Lower lows

## Support / Resistance

Derived from:

* Previous reaction zones
* Liquidity areas
* Historical turning points

## Range

Measure:

* Consolidation zones
* Breakout probability
* Expansion potential

---

# Level 6 — Volatility-Specific Indicators

## ATR (Average True Range)

Measures:

* Average movement size

Used for:

* Stop-loss placement
* Target calculation
* Market condition

---

## Bollinger Bands

Measures:

* Price compression
* Expansion

Important signals:

* Band squeeze
* Band expansion

---

## Standard Deviation

Used to detect:

* Abnormal movement
* Overextension

---

## Historical Volatility

Compare:

Current volatility vs:

* 7-day volatility
* 30-day volatility
* 90-day volatility

---

# Level 7 — Time-Series Data

Professional quantitative traders analyze:

## Time

* Tick-by-tick movement
* Seconds
* Minutes
* Hours

Questions:

* When does volatility expand?
* How long do trends last?
* How long do reversals take?

---

# Level 8 — Tick Behavior

For synthetic indices, tick analysis is very important.

Data:

* Number of ticks before movement
* Average tick size
* Tick acceleration
* Tick clustering

Example:

A model may detect:

"After 80 ticks of compression, probability of expansion increases."

---

# Level 9 — Correlation Analysis

Unlike Forex or stocks:

V75 is generally not driven by:

* USD
* EUR
* Gold
* Oil
* S&P500

However, traders analyze relationships between:

* V75 and V100
* Different synthetic indices
* Different volatility levels

---

# Level 10 — Risk Data

Professional traders focus heavily on:

## Drawdown statistics

Measure:

* Maximum losing streak
* Maximum adverse movement
* Recovery time

## Position sizing

Based on:

* Account size
* Volatility
* Stop distance
* Probability

---

# Level 11 — Advanced Quantitative Data

Institutional-style analysis:

## Probability models

* Monte Carlo simulations
* Markov chains
* Bayesian probability

## Machine learning features

Examples:

Input:

* Previous 100 candles
* ATR
* RSI
* Candle patterns
* Volatility state

Output:

* Probability of upward movement
* Probability of reversal

---

# Level 12 — Sentiment Data

For synthetic indices:

Traditional sentiment does not matter.

No:

* News sentiment
* Economic calendar
* Earnings
* Central banks

But trader behavior matters:

* Strategy popularity
* Broker activity
* Community positioning

---

# Comparison: Traditional VIX vs Deriv V75

| Factor                 | VIX                         | Deriv V75                |
| ---------------------- | --------------------------- | ------------------------ |
| Driver                 | Options market              | Algorithm                |
| News impact            | High                        | None                     |
| Central banks          | Important                   | None                     |
| Investor fear          | Important                   | None                     |
| Volatility calculation | Options pricing             | Fixed volatility model   |
| Main data              | Options, futures, sentiment | Price statistics         |
| Analysis type          | Macro + derivatives         | Quantitative + technical |

([Cboe Global Markets][1])

---

# The "Asymmetric Analysis" Framework Applied to V75/V100

For synthetic volatility markets, an asymmetric approach would search for:

## 1. Statistical imbalance

Example:

Historical probability:

* 80% of similar conditions → upward expansion
* Current price has not reflected it

---

## 2. Volatility compression

Situation:

* Low movement period
* Reduced ATR
* Narrow range

Potential:

* Large expansion opportunity

---

## 3. Extreme deviation

Example:

Price moves:

* 5 standard deviations away from mean

Potential:

* Mean reversion opportunity

---

## 4. Pattern probability

Not:

"The candle looks bullish"

But:

"Historically, this exact sequence produced a 65% probability of continuation."

---

# Reliable Data Sources / Tools

For this type of market, the useful sources are:

### Official

* [Deriv Synthetic Indices Documentation](https://deriv.com/markets/derived-indices/synthetic-indices?utm_source=chatgpt.com)

### Statistical analysis

* Python
* NumPy
* Pandas
* SciPy
* TensorFlow/PyTorch

### Trading platforms

* MetaTrader 5
* Deriv Trader
* Deriv X

### Quantitative research

* Academic papers on stochastic processes
* Time-series analysis
* Probability theory

---

## The correct mental model

For V75/V100:

**Forex trader thinks:**

> "What economic event will move this currency?"

**Crypto trader thinks:**

> "What blockchain data shows adoption?"

**Volatility synthetic trader thinks:**

> "What statistical state is the algorithm currently in, and what probability distribution follows?"

The edge comes from **probability, statistics, pattern recognition, and risk management**, not fundamental economics.

[1]: https://www.cboe.com/tradable-products/vix/?utm_source=chatgpt.com "VIX Volatility Products | Cboe"
[2]: https://deriv.com/markets/derived-indices/synthetic-indices?utm_source=chatgpt.com "Synthetic indices trading | Derived indices | Deriv"
[3]: https://deriv.com/derived-indices/volatility-indices?utm_source=chatgpt.com "Volatility Indices - Trade at your preferred level 24/7 | Deriv"



















# Building an AI / Machine Learning Trading System for Volatility Indices (V75, V100, V50, etc.)

First, we need to define the problem correctly.

For **synthetic volatility indices (Deriv V10, V25, V50, V75, V100, V150, V250)**, you are not predicting a company, economy, or central bank decision. These instruments are generated from algorithmic processes designed to produce specific volatility behaviors and are not driven by economic news like traditional markets. ([Deriv][1])

Therefore, your AI system should not ask:

> "Will Bitcoin rise because institutions are buying?"

It should ask:

> "Given the current statistical state of this stochastic price process, what is the probability distribution of future movements?"

The objective is **not perfect prediction** (impossible). The objective is:

* increase probability advantage
* identify high-quality setups
* reduce bad entries
* optimize exits
* manage risk automatically

Machine learning in financial time series generally works better as a **probability engine and decision-support system**, not as a crystal ball. ([arXiv][2])

---

# 1. Data Architecture: The Complete Data Universe

A professional AI trading system is organized in layers.

```
DATA SOURCES
      |
      ↓
DATA ENGINEERING
      |
      ↓
FEATURE ENGINEERING
      |
      ↓
AI MODELS
      |
      ↓
SIGNAL GENERATION
      |
      ↓
RISK ENGINE
      |
      ↓
EXECUTION BOT
      |
      ↓
MONITORING & LEARNING
```

---

# Layer 1 — Raw Market Data (Foundation)

This is your "sensor".

## Price Data

Every tick:

* timestamp
* bid price
* ask price
* open
* high
* low
* close

Multiple timeframes:

* tick
* 1 second
* 5 seconds
* 1 minute
* 5 minutes
* 15 minutes
* 1 hour
* daily

Example:

```
Time       Open    High    Low     Close
10:00:01   7500    7515    7490    7508
```

---

# Layer 2 — Price Behavior Features

The AI does not understand candles directly.

You transform price into mathematical features.

## Candle Features

Calculate:

### Body size

```
Close - Open
```

### Wick size

* upper wick
* lower wick

### Candle strength

Example:

Large bullish candle:

Possible interpretation:

* momentum
* liquidity event
* volatility expansion

---

# Layer 3 — Volatility Features (Most Important)

Because the market itself is volatility-based.

## ATR

Measures average movement.

Features:

* ATR current
* ATR change
* ATR acceleration

Example:

```
ATR increasing = volatility expansion
ATR decreasing = compression
```

---

## Standard Deviation

Measures dispersion.

AI learns:

* normal movement
* abnormal movement

---

## Volatility Regime Classification

Your model should classify:

### Regime A

Low volatility

```
compression
small candles
low ATR
```

### Regime B

Expansion

```
large candles
momentum
high ATR
```

### Regime C

Extreme

```
abnormal movement
possible reversal
```

---

# Layer 4 — Market Structure Data

Even synthetic indices show statistical structures.

Features:

## Trend

AI variables:

* higher highs
* lower lows
* slope
* moving averages

## Support/Resistance

Calculated from:

* previous reactions
* price clusters
* volume-equivalent zones

## Range Detection

Features:

* distance from mean
* consolidation duration
* breakout probability

---

# Layer 5 — Technical Indicator Features

Not as simple "buy when RSI < 30".

AI uses indicators as numerical inputs.

Examples:

## Momentum

* RSI
* MACD
* Rate of Change

## Trend

* EMA
* SMA
* ADX

## Volatility

* Bollinger Bands
* ATR
* Keltner Channels

## Mean Reversion

* Z-score
* Distance from VWAP

---

# Layer 6 — Tick-Level Microstructure

For V75/V100, this is very important.

Features:

## Tick velocity

Question:

How fast is price moving?

Example:

```
10 ticks/minute
versus
100 ticks/minute
```

---

## Tick acceleration

Movement speed change.

Example:

```
Slow → Fast
```

Often signals volatility expansion.

---

## Movement sequences

AI studies:

```
Up
Up
Down
Up
Down
Down
?
```

Thousands of historical sequences.

---

# Layer 7 — Statistical Probability Features

This is where a serious system becomes different.

## Historical Pattern Matching

Question:

"When the last 1000 similar situations happened, what happened next?"

Example:

Historical:

```
Pattern X appeared 10,000 times

Next movement:

Up: 63%
Down: 37%
```

AI learns this.

---

## Monte Carlo Simulation

Generate thousands of possible futures.

Example:

Current state:

```
V75 = 8500
ATR = 50
Momentum = positive
```

Simulation:

```
Future 1
Future 2
Future 3
...
Future 10000
```

Estimate probabilities.

---

# Layer 8 — Machine Learning Models

Different models have different jobs.

---

# Model 1: Classification Model

Question:

"Next movement?"

Output:

```
BUY probability: 67%

SELL probability: 33%
```

Models:

* Random Forest
* XGBoost
* LightGBM

Good starting point.

---

# Model 2: Time-Series Deep Learning

Models:

## LSTM

Learns sequences.

Example:

```
Last 200 candles → Future probability
```

## Transformer Models

Advanced sequence understanding.

Used in:

* language
* financial sequences

---

# Model 3: Reinforcement Learning

The AI learns by trading.

Environment:

```
State:
market condition

Action:
buy/sell/wait

Reward:
profit/loss
```

Algorithms:

* PPO
* DQN
* A3C

---

# Layer 9 — Sentiment / External Data

For V75/V100:

Almost irrelevant.

Because synthetic indices are not driven by:

* news
* GDP
* interest rates
* earnings

Unlike crypto, stocks, forex. ([Deriv][3])

Focus on:

* price
* statistics
* probability
* execution.

---

# Layer 10 — Risk Management AI

This is where many systems fail.

The AI must decide:

## Position size

Inputs:

* account size
* volatility
* confidence

## Stop loss

Dynamic:

Based on:

* ATR
* volatility regime

## Take profit

Based on:

* expected value

Example:

Trade only if:

```
Probability win > 65%

Expected reward/risk > 2
```

---

# Complete AI Architecture

A serious autonomous system:

```
                MARKET DATA
                     |
                     |
             Data Collector
                     |
                     |
          Feature Engineering Engine
                     |
        ----------------------------
        |            |             |
   Technical     Statistical   Pattern
   Features      Features      Features
        |            |             |
        ----------------------------
                     |
              ML Prediction Engine
                     |
          Probability Calculation
                     |
             Decision Engine
                     |
        -----------------------
        |                     |
    Execute              Ignore
        |
    Risk Manager
        |
    Trade Management
        |
    Performance Feedback
        |
    Retraining
```

---

# How Successful Can It Be?

The realistic answer:

## Bad system

Possible result:

* overfitting
* false signals
* losses

---

## Good retail system

Possible advantages:

* removes emotions
* consistent execution
* faster analysis
* better discipline

---

## Professional quantitative system

Advantages:

* thousands of features
* continuous learning
* statistical validation
* risk optimization

But even professional systems do not achieve perfect prediction. Their edge is often small but repeated.

Example:

A system with:

```
55-60% winning probability
+
strict risk management
+
positive reward/risk ratio
```

can outperform.

---

# Development Roadmap (Realistic)

## Phase 1 — Data Laboratory

Build:

* tick data collector
* database
* visualization
* statistics engine

---

## Phase 2 — Research Engine

Build:

* backtesting system
* feature generator
* pattern analyzer

---

## Phase 3 — ML Prediction

Train:

* XGBoost
* LSTM
* Transformer

---

## Phase 4 — Autonomous Trader

Connect:

* Deriv API
* execution engine
* risk manager

---

# Final Concept

The winning architecture is not:

> "AI predicts the next candle."

It is:

> "AI continuously measures the probability distribution of future market states and only acts when statistical advantage exists."

For V75/V100, the strongest path is:

**Tick Data → Statistics → Feature Engineering → Probability Model → Risk Engine → Autonomous Execution**

This is closer to how quantitative trading systems are designed.

[1]: https://deriv.com/markets/derived-indices/synthetic-indices?utm_source=chatgpt.com "Synthetic indices trading | Derived indices | Deriv"
[2]: https://arxiv.org/abs/1706.00948?utm_source=chatgpt.com "Financial Series Prediction: Comparison Between Precision of Time Series Models and Machine Learning Methods"
[3]: https://deriv.com/academy/lessons/what-are-volatility-indices?utm_source=chatgpt.com "What are Volatility Indices | Beginner Courses | Deriv"

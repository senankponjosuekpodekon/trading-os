"""
BRVM scraper — Bourse Régionale des Valeurs Mobilières (UEMOA)
Récupère les cours de marché depuis brvm.org / Westbourse avec fallback.
Historique OHLCV accumulé en DB (brvm_daily_candles) car brvm-package
ne retourne des données que pour ~3 symboles sur 47.
"""
import httpx
from typing import List
from bs4 import BeautifulSoup
from datetime import date as _date

BRVM_BASE    = "https://www.brvm.org"
BRVM_ACTIONS = f"{BRVM_BASE}/fr/cours-actions/0"
BRVM_HISTORY = f"{BRVM_BASE}/fr/cours-history"

WESTBOURSE_BASE    = "https://www.westbourse.com"
WESTBOURSE_ACTIONS = f"{WESTBOURSE_BASE}/api/public/v1/actions"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
}

# Symboles BRVM les plus liquides (alignés sur brvm.org 2026)
BRVM_SYMBOLS = [
    "ONTBF", "SGBC", "BOABF", "ETIT", "SIVC",
    "PALC", "SOGC", "SNTS", "CIEC", "NSBC",
    "ORGT", "BICC", "CBIBF", "ABJC", "STAC",
]

# Alias legacy
TOP_SYMBOLS = BRVM_SYMBOLS


async def _fetch_westbourse_quotes() -> List[dict]:
    """Récupère les cours via l'API publique Westbourse."""
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            r = await client.get(WESTBOURSE_ACTIONS)
            r.raise_for_status()
            payload = r.json()
    except Exception:
        return []

    actions = payload.get("actions") or []
    quotes = []
    for a in actions:
        try:
            symbol = a.get("code", "")
            name   = a.get("nom", "")
            price  = float(a.get("cours", 0) or 0)
            chg_pct = float(a.get("variation_pct", 0) or 0)
            volume = int(a.get("volume", 0) or 0)
            if not symbol or price <= 0:
                continue
            quotes.append({
                "symbol":     symbol,
                "name":       name,
                "price":      price,
                "change":     round(price * chg_pct / 100, 2),
                "change_pct": chg_pct,
                "volume":     volume,
                "market":     "BRVM",
                "currency":   "XOF",
            })
        except (ValueError, TypeError):
            continue
    return quotes


async def _fetch_scraped_brvm_quotes() -> List[dict]:
    """Scrape la page des cours actions de la BRVM (fallback).
    Structure HTML (2026): table avec 7 colonnes:
    Symbole | Nom | Volume | Cours veille | Cours Ouverture | Cours Clôture | Variation (%)
    """
    try:
        async with httpx.AsyncClient(timeout=10, headers=HEADERS, follow_redirects=True) as client:
            r = await client.get(BRVM_ACTIONS)
            r.raise_for_status()
    except Exception:
        return []

    soup = BeautifulSoup(r.text, "lxml")
    quotes = []

    # La table principale contient toutes les actions (48+ rows, 7 colonnes)
    # Les tables top-five/flop-five n'ont que 3 colonnes — on les ignore
    tables = soup.find_all("table")
    table = None
    for t in tables:
        header_cols = t.find("tr")
        if header_cols:
            ths = header_cols.find_all("th")
            if len(ths) >= 6:
                table = t
                break

    if not table:
        return []

    for row in table.find_all("tr")[1:]:
        cols = row.find_all("td")
        if len(cols) < 6:
            continue
        try:
            symbol  = cols[0].get_text(strip=True)
            name    = cols[1].get_text(strip=True)
            volume  = int(cols[2].get_text(strip=True).replace(" ", "").replace("\u202f", "") or 0)
            open_p  = float(cols[4].get_text(strip=True).replace(" ", "").replace("\u202f", "").replace(",", ".") or 0)
            close_p = float(cols[5].get_text(strip=True).replace(" ", "").replace("\u202f", "").replace(",", ".") or 0)
            chg_pct = float(cols[6].get_text(strip=True).replace(" ", "").replace("\u202f", "").replace(",", ".").replace("%", "") or 0)
            price   = close_p if close_p > 0 else open_p
            if not symbol or price <= 0:
                continue
            quotes.append({
                "symbol":     symbol,
                "name":       name,
                "price":      price,
                "change":     round(price * chg_pct / 100, 2),
                "change_pct": chg_pct,
                "volume":     volume,
                "market":     "BRVM",
                "currency":   "XOF",
            })
        except (ValueError, IndexError):
            continue

    return quotes


async def fetch_brvm_quotes() -> List[dict]:
    """Cours BRVM : brvm.org en priorité, Westbourse en fallback.
    Persiste les cotations du jour dans brvm_daily_candles pour construire
    un historique OHLCV local au fil du temps."""
    quotes = await _fetch_scraped_brvm_quotes()
    if not quotes:
        quotes = await _fetch_westbourse_quotes()
    if quotes:
        await _persist_daily_candles(quotes)
    return quotes


def _mock_brvm_quotes() -> List[dict]:
    """Données de démo si le scraping échoue (marché fermé / indispo)."""
    import random
    random.seed(42)
    mock = []
    prices = {
        "ONTBF": 2150, "SGBC": 8500, "BOABF": 6200, "ETIT": 24, "SIVC": 755,
        "PALC": 7200, "SOGC": 1050, "SNTS": 28500, "CIEC": 680, "NSBC": 3200,
        "ORGT": 9100, "BICC": 29000, "CBIBF": 3700, "ABJC": 3180, "STAC": 11500,
    }
    names = {
        "ONTBF": "ONATEL Burkina Faso", "SGBC": "Société Générale BF",
        "BOABF": "Bank of Africa BF", "ETIT": "Ecobank Transnational",
        "SIVC": "SICOGI", "PALC": "Palm CI", "SOGC": "SOGB",
        "SNTS": "Sonatel", "CIEC": "CIE", "NSBC": "NSIA Banque CI",
        "ORGT": "Orange CI", "BICC": "BICI CI", "CBIBF": "Coris Bank",
        "ABJC": "Servair Abidjan", "STAC": "SOLIBRA",
    }
    for sym in TOP_SYMBOLS:
        p = prices.get(sym, 1000)
        chg_pct = round(random.uniform(-3.5, 4.5), 2)
        mock.append({
            "symbol":     sym,
            "name":       names.get(sym, sym),
            "price":      p,
            "change":     round(p * chg_pct / 100, 0),
            "change_pct": chg_pct,
            "volume":     random.randint(100, 50000),
            "market":     "BRVM",
            "currency":   "XOF",
        })
    return mock


def is_brvm_symbol(symbol: str) -> bool:
    return symbol in BRVM_SYMBOLS


async def _persist_daily_candles(quotes: List[dict]) -> None:
    """Upsert les cotations du jour dans brvm_daily_candles."""
    from utils.db_pool import get_shared_pool
    today = _date.today()
    try:
        pool = await get_shared_pool()
        async with pool.acquire() as conn:
            for q in quotes:
                sym = q.get("symbol", "")
                price = float(q.get("price", 0) or 0)
                if not sym or price <= 0:
                    continue
                vol = int(q.get("volume", 0) or 0)
                await conn.execute(
                    """INSERT INTO brvm_daily_candles (symbol, date, open, high, low, close, volume)
                       VALUES ($1, $2, $3, $3, $3, $3, $4)
                       ON CONFLICT (symbol, date) DO UPDATE SET
                         high   = GREATEST(brvm_daily_candles.high,  EXCLUDED.high),
                         low    = LEAST(brvm_daily_candles.low,     EXCLUDED.low),
                         close  = EXCLUDED.close,
                         volume = brvm_daily_candles.volume + EXCLUDED.volume""",
                    sym, today, price, vol,
                )
    except Exception:
        pass


async def _fetch_db_history(symbol: str, limit: int = 500) -> list[dict]:
    """Récupère l'historique OHLCV depuis brvm_daily_candles (accumulation locale)."""
    from utils.db_pool import get_shared_pool
    try:
        pool = await get_shared_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT date, open, high, low, close, volume
                   FROM brvm_daily_candles
                   WHERE symbol = $1
                   ORDER BY date ASC
                   LIMIT $2""",
                symbol, limit,
            )
        return [
            {
                "date": r["date"].isoformat(),
                "open": float(r["open"] or r["close"]),
                "high": float(r["high"] or r["close"]),
                "low": float(r["low"] or r["close"]),
                "close": float(r["close"]),
                "volume": int(r["volume"] or 0),
            }
            for r in rows
        ]
    except Exception:
        return []


async def fetch_brvm_history(symbol: str, period: str = "2y") -> list[dict]:
    """
    Fetch historical OHLCV for a BRVM symbol.
    Source 1: brvm_daily_candles (DB locale, accumulée au fil du temps)
    Source 2: brvm-package (fallback, ne marche que pour ~3 symboles)
    Returns list of dicts: [{date, open, high, low, close, volume}, ...]
    """
    # 1. DB locale d'abord
    limit = 500 if period == "2y" else 250
    db_rows = await _fetch_db_history(symbol, limit)
    if len(db_rows) >= 20:
        return db_rows

    # 2. Fallback brvm-package
    try:
        import brvm as brvm_pkg
        ticker = brvm_pkg.Ticker(symbol)
        df = ticker.history(period)
        if df is not None and len(df) > 0:
            df.columns = [c.lower() for c in df.columns]
            records = []
            for idx, row in df.iterrows():
                records.append({
                    "date": idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx),
                    "open": float(row.get("open", 0)),
                    "high": float(row.get("high", 0)),
                    "low": float(row.get("low", 0)),
                    "close": float(row.get("close", 0)),
                    "volume": int(row.get("volume", 0) or 0),
                })
            if records:
                return records
    except Exception:
        pass

    # 3. Retourner ce qu'on a en DB (même si < 20 rows)
    return db_rows

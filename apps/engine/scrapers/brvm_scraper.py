"""
BRVM scraper — Bourse Régionale des Valeurs Mobilières (UEMOA)
Récupère les cours de marché depuis brvm.org / Westbourse avec fallback.
"""
import httpx
from typing import List
from bs4 import BeautifulSoup

BRVM_BASE    = "https://www.brvm.org"
BRVM_ACTIONS = f"{BRVM_BASE}/fr/cours-actions/0"
BRVM_HISTORY = f"{BRVM_BASE}/fr/cours-history"

WESTBOURSE_BASE    = "https://www.westbourse.com"
WESTBOURSE_ACTIONS = f"{WESTBOURSE_BASE}/api/public/v1/actions"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
}

# Symboles BRVM les plus liquides
BRVM_SYMBOLS = [
    "ONTBF", "SGBF", "BOABF", "ETIT", "SIVC",
    "PALC", "SOGC", "SNTS", "CIEC", "NSIC",
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
    """Scrape la page des cours actions de la BRVM (fallback)."""
    try:
        async with httpx.AsyncClient(timeout=8, headers=HEADERS, follow_redirects=True) as client:
            r = await client.get(BRVM_ACTIONS)
            r.raise_for_status()
    except Exception:
        return []

    soup = BeautifulSoup(r.text, "lxml")
    quotes = []

    table = soup.find("table", {"id": "table-sm"}) or soup.find("table", class_=lambda c: c and "cours" in c.lower())
    if not table:
        tables = soup.find_all("table")
        table = tables[0] if tables else None

    if not table:
        return []

    for row in table.find_all("tr")[1:]:
        cols = row.find_all("td")
        if len(cols) < 5:
            continue
        try:
            symbol  = cols[0].get_text(strip=True)
            name    = cols[1].get_text(strip=True) if len(cols) > 1 else symbol
            price   = float(cols[2].get_text(strip=True).replace(" ", "").replace(",", ".") or 0)
            change  = float(cols[3].get_text(strip=True).replace(" ", "").replace(",", ".").replace("%", "") or 0)
            volume  = int(cols[4].get_text(strip=True).replace(" ", "") or 0)
            quotes.append({
                "symbol":     symbol,
                "name":       name,
                "price":      price,
                "change":     change * price / 100 if abs(change) < 100 else change,
                "change_pct": change if abs(change) < 100 else round(change / price * 100, 2),
                "volume":     volume,
                "market":     "BRVM",
                "currency":   "XOF",
            })
        except (ValueError, IndexError):
            continue

    return quotes


async def fetch_brvm_quotes() -> List[dict]:
    """Cours BRVM : Westbourse en priorité, scraping en fallback."""
    quotes = await _fetch_westbourse_quotes()
    if quotes:
        return quotes
    return await _fetch_scraped_brvm_quotes()


def _mock_brvm_quotes() -> List[dict]:
    """Données de démo si le scraping échoue (marché fermé / indispo)."""
    import random
    random.seed(42)
    mock = []
    prices = {
        "ONTBF": 2150, "SGBF": 8500, "BOABF": 6200, "ETIT": 24, "SIVC": 755,
        "PALC": 7200, "SOGC": 1050, "SNTS": 4800, "CIEC": 680, "NSIC": 3200,
        "ORGT": 9100, "BICC": 530, "CBIBF": 3700, "ABJC": 1850, "STAC": 11500,
    }
    names = {
        "ONTBF": "ONATEL Burkina Faso", "SGBF": "Société Générale BF",
        "BOABF": "Bank of Africa BF", "ETIT": "Ecobank Transnational",
        "SIVC": "SICOGI", "PALC": "Palm CI", "SOGC": "SOGB",
        "SNTS": "Sonatel", "CIEC": "CIE", "NSIC": "NSIA Banque CI",
        "ORGT": "Orange CI", "BICC": "BICI CI", "CBIBF": "Coris Bank",
        "ABJC": "Abidjan.net", "STAC": "SOLIBRA",
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

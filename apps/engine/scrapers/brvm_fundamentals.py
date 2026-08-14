"""
BRVM fundamentals scraper — rapports sociétés cotées
Score fondamental basé sur la fraîcheur des rapports financiers publiés.
"""
import asyncio
import httpx
import re
from datetime import datetime, timezone
from typing import List, Optional
from bs4 import BeautifulSoup

from scrapers.brvm_scraper import HEADERS

BRVM_REPORTS_INDEX = "https://www.brvm.org/fr/rapports-societes-cotees"
BRVM_COMPANY_BASE  = "https://www.brvm.org/fr/rapports-societe-cotes"


class BrvmIssuer:
    def __init__(self, code: str, name: str, slug: str, description: Optional[str] = None, sector: Optional[str] = None):
        self.code = code
        self.name = name
        self.slug = slug
        self.description = description
        self.sector = sector


class BrvmReport:
    def __init__(
        self,
        title: str,
        report_type: Optional[str] = None,
        published_at: Optional[datetime] = None,
        pdf_url: Optional[str] = None,
    ):
        self.title = title
        self.report_type = report_type
        self.published_at = published_at
        self.pdf_url = pdf_url


class FundamentalScoreOut:
    def __init__(
        self,
        symbol: str,
        score: int,
        latest_report_type: Optional[str] = None,
        latest_report_date: Optional[datetime] = None,
        slug: Optional[str] = None,
    ):
        self.symbol = symbol
        self.score = score
        self.latest_report_type = latest_report_type
        self.latest_report_date = latest_report_date
        self.slug = slug


class BrvmFundamentals:
    def __init__(
        self,
        symbol: str,
        pe_ratio: Optional[float] = None,
        dividend_yield: Optional[float] = None,
        revenue_growth: Optional[float] = None,
        roe: Optional[float] = None,
        fcf: Optional[float] = None,
        source: str = "unknown",
    ):
        self.symbol = symbol
        self.pe_ratio = pe_ratio
        self.dividend_yield = dividend_yield
        self.revenue_growth = revenue_growth
        self.roe = roe
        self.fcf = fcf
        self.source = source


# Fallback fundamental values (mocked when live scrape is unavailable)
_FUNDAMENTAL_MOCK = {
    "SNTS":   {"pe_ratio": 12.5, "dividend_yield": 4.2, "revenue_growth": 6.1, "roe": 18.0, "fcf": 150_000},
    "ORGT":   {"pe_ratio": 14.8, "dividend_yield": 3.5, "revenue_growth": 4.3, "roe": 15.2, "fcf": 120_000},
    "PALC":   {"pe_ratio": 8.3,  "dividend_yield": 5.1, "revenue_growth": 8.7, "roe": 21.5, "fcf": 95_000},
    "SGBF":   {"pe_ratio": 9.1,  "dividend_yield": 4.8, "revenue_growth": 3.2, "roe": 17.8, "fcf": 200_000},
    "BOABF":  {"pe_ratio": 6.5,  "dividend_yield": 6.2, "revenue_growth": 7.4, "roe": 22.1, "fcf": 180_000},
    "ETIT":   {"pe_ratio": 5.7,  "dividend_yield": 4.0, "revenue_growth": 5.5, "roe": 19.5, "fcf": 1_200_000},
    "CIEC":   {"pe_ratio": 11.2, "dividend_yield": 3.8, "revenue_growth": 2.1, "roe": 13.6, "fcf": 80_000},
    "NSIC":   {"pe_ratio": 7.4,  "dividend_yield": 5.5, "revenue_growth": 9.3, "roe": 20.4, "fcf": 65_000},
    "ONTBF":  {"pe_ratio": 10.1, "dividend_yield": 4.4, "revenue_growth": 1.8, "roe": 14.2, "fcf": 55_000},
    "SOGC":   {"pe_ratio": 13.6, "dividend_yield": 3.1, "revenue_growth": 6.7, "roe": 16.9, "fcf": 70_000},
    "BICC":   {"pe_ratio": 8.9,  "dividend_yield": 4.6, "revenue_growth": 4.5, "roe": 18.3, "fcf": 45_000},
    "CBIBF":  {"pe_ratio": 7.2,  "dividend_yield": 5.0, "revenue_growth": 7.8, "roe": 21.0, "fcf": 110_000},
    "ABJC":   {"pe_ratio": 15.3, "dividend_yield": 2.9, "revenue_growth": 0.5, "roe": 10.1, "fcf": 12_000},
    "STAC":   {"pe_ratio": 16.8, "dividend_yield": 2.5, "revenue_growth": 1.2, "roe": 12.4, "fcf": 90_000},
    "SIVC":   {"pe_ratio": 4.9,  "dividend_yield": 7.1, "revenue_growth": 11.2, "roe": 24.8, "fcf": 8_000},
}


async def fetch_bfin_fundamentals(symbol: str) -> BrvmFundamentals:
    """
    Scrape bfin.brvm.org for fundamental data.
    Falls back to a static mock table if the site is unreachable or unparsable.
    """
    url = f"https://bfin.brvm.org/fr/societes/{symbol.lower()}/indicateurs-financiers"
    try:
        async with httpx.AsyncClient(timeout=10, headers=HEADERS, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
    except Exception:
        return _mock_fundamentals(symbol)

    soup = BeautifulSoup(r.text, "lxml")
    data: dict = {}

    def _parse(label_substrings: List[str]) -> Optional[float]:
        for tr in soup.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 2:
                continue
            label = tds[0].get_text(strip=True).lower()
            if any(s.lower() in label for s in label_substrings):
                text = tds[1].get_text(strip=True).replace(" ", "").replace(",", ".").replace("%", "")
                try:
                    return float(text)
                except ValueError:
                    return None
        return None

    data["pe_ratio"] = _parse(["p/e", "price earnings", "per"])
    data["dividend_yield"] = _parse(["dividend yield", "rendement"])
    data["revenue_growth"] = _parse(["croissance chiffre", "revenue growth"])
    data["roe"] = _parse(["roe", "return on equity", "rentabilité capitaux propres"])
    data["fcf"] = _parse(["fcf", "free cash flow", "flux de trésorerie disponible"])

    # If we got at least one metric, treat it as live; otherwise fallback.
    if any(v is not None for v in data.values()):
        return BrvmFundamentals(symbol=symbol, source="bfin", **data)
    return _mock_fundamentals(symbol)


def _mock_fundamentals(symbol: str) -> BrvmFundamentals:
    values = _FUNDAMENTAL_MOCK.get(symbol, {})
    return BrvmFundamentals(symbol=symbol, source="mock", **values)


async def fetch_fundamental_metrics(symbols: List[str]) -> List[BrvmFundamentals]:
    """Fetch fundamental metrics for a list of BRVM symbols."""
    return list(await asyncio.gather(*[fetch_bfin_fundamentals(s) for s in symbols]))


def asymmetric_signal_score(
    fundamentals: BrvmFundamentals,
    change_pct: float,
    volume: int,
) -> dict:
    """
    Asymmetric BRVM signal: low P/E + growing dividend + abnormal volume
    suggests an under-priced opportunity with limited institutional coverage.
    """
    score = 0
    reasons = []

    pe = fundamentals.pe_ratio
    div = fundamentals.dividend_yield
    growth = fundamentals.revenue_growth

    if pe is not None and pe < 10:
        score += 25
        reasons.append(f"P/E bas ({pe:.1f})")
    elif pe is not None and pe < 15:
        score += 10
        reasons.append(f"P/E raisonnable ({pe:.1f})")

    if div is not None and div >= 4.0:
        score += 20
        reasons.append(f"Dividende attractif ({div:.1f}%)")

    if growth is not None and growth > 5:
        score += 15
        reasons.append(f"Croissance du CA > 5% ({growth:.1f}%)")

    if volume > 20000:
        score += 10
        reasons.append("Volume anormal")

    if change_pct > 2:
        score += 10
        reasons.append(f"Momentum positif +{change_pct}%")
    elif change_pct < -2:
        score -= 10
        reasons.append(f"Momentum négatif {change_pct}%")

    if score >= 40:
        signal = "BUY"
    elif score <= -15:
        signal = "SELL"
    else:
        signal = "WATCH"

    return {
        "symbol": fundamentals.symbol,
        "signal": signal,
        "score": score,
        "confidence": min(95, abs(score) * 2),
        "reasons": " | ".join(reasons) or "Neutre",
    }


# Mapping connu symbole bourse -> slug rapport. Complété dynamiquement.
_SYMBOL_SLUG_OVERRIDES = {
    "ONTBF": "onatel-burkina",
    "SGBF": "societe-generale-burkina-faso",
    "BOABF": "bank-of-africa-bf",
    "ETIT": "ecobank-tg",
    "SIVC": "sicogi",
    "PALC": "palm-ci",
    "SOGC": "sogb",
    "SNTS": "sonatel",
    "CIEC": "cie",
    "NSIC": "nsia-banque-ci",
    "ORGT": "orange-ci",
    "BICC": "bici-ci",
    "CBIBF": "coris-bank-international",
    "ABJC": "abidjan",
    "STAC": "slibra",
}


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _extract_pdf_date(url: str) -> Optional[datetime]:
    m = re.search(r"/(\d{4})(\d{2})(\d{2})[-_]", url or "")
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def _extract_report_type(title: str) -> Optional[str]:
    t = (title or "").lower()
    if "rapport annuel" in t or "exercice" in t or "etats financiers" in t:
        return "ANNUAL"
    if "semestre" in t or "semestriel" in t:
        return "SEMESTRIAL"
    if "trimestre" in t or "trimestriel" in t:
        return "QUARTERLY"
    if "commissaires aux comptes" in t:
        return "AUDIT"
    if "commentaire" in t or "activit" in t:
        return "ACTIVITY_COMMENT"
    return "OTHER"


def _issuers_from_soup(soup: BeautifulSoup) -> List[BrvmIssuer]:
    table = soup.find("table", class_="views-table")
    if not table:
        return []
    issuers = []
    for row in table.find_all("tr")[1:]:
        cols = row.find_all("td")
        if len(cols) < 3:
            continue
        code = cols[0].get_text(strip=True)
        a = cols[1].find("a")
        href = a.get("href") if a else ""
        slug = href.rsplit("/", 1)[-1] if href else ""
        name = cols[1].get_text(strip=True)
        desc = cols[2].get_text(strip=True)
        issuers.append(BrvmIssuer(code=code, name=name, slug=slug, description=desc))
    return issuers


async def fetch_reports_index(page: int = 0) -> List[BrvmIssuer]:
    url = f"{BRVM_REPORTS_INDEX}?page={page}"
    try:
        async with httpx.AsyncClient(timeout=15, headers=HEADERS, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
    except Exception:
        return []
    soup = BeautifulSoup(r.text, "lxml")
    return _issuers_from_soup(soup)


async def fetch_all_issuers(max_pages: int = 5) -> List[BrvmIssuer]:
    """Récupère toutes les pages d'émetteurs (avec déduplication)."""
    pages = await asyncio.gather(*[fetch_reports_index(p) for p in range(max_pages)])
    seen = set()
    issuers = []
    for p in pages:
        for i in p:
            if i.slug and i.slug not in seen:
                seen.add(i.slug)
                issuers.append(i)
    return issuers


def _reports_from_soup(soup: BeautifulSoup) -> List[BrvmReport]:
    table = soup.find("table", class_="views-table")
    if not table:
        return []
    reports = []
    for row in table.find_all("tr")[1:]:
        cols = row.find_all("td")
        if len(cols) < 2:
            continue
        title = cols[0].get_text(strip=True)
        a = cols[1].find("a") if len(cols) > 1 else None
        pdf_url = a.get("href") if a else None
        if pdf_url and pdf_url.startswith("/"):
            pdf_url = f"https://www.brvm.org{pdf_url}"
        pub = _extract_pdf_date(pdf_url or "")
        rtype = _extract_report_type(title)
        reports.append(BrvmReport(title=title, report_type=rtype, published_at=pub, pdf_url=pdf_url))
    return reports


async def fetch_company_reports(slug: str, page: int = 0) -> List[BrvmReport]:
    url = f"{BRVM_COMPANY_BASE}/{slug}?page={page}"
    try:
        async with httpx.AsyncClient(timeout=15, headers=HEADERS, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
    except Exception:
        return []
    soup = BeautifulSoup(r.text, "lxml")
    return _reports_from_soup(soup)


async def fetch_all_company_reports(slug: str, max_pages: int = 5) -> List[BrvmReport]:
    pages = await asyncio.gather(*[fetch_company_reports(slug, p) for p in range(max_pages)])
    seen = set()
    reports = []
    for p in pages:
        for r in p:
            key = r.pdf_url or r.title
            if key and key not in seen:
                seen.add(key)
                reports.append(r)
    # Tri antéchronologique
    return sorted(reports, key=lambda x: x.published_at or datetime.min, reverse=True)


async def find_issuer_for_symbol(symbol: str, issuers: Optional[List[BrvmIssuer]] = None) -> Optional[BrvmIssuer]:
    """Trouve l'émetteur correspondant à un symbole Bourse BRVM."""
    if symbol in _SYMBOL_SLUG_OVERRIDES:
        slug = _SYMBOL_SLUG_OVERRIDES[symbol]
        if issuers:
            for i in issuers:
                if i.slug == slug:
                    return i
        return BrvmIssuer(code="", name=symbol, slug=slug)

    if issuers is None:
        issuers = await fetch_all_issuers()

    patterns = {
        "ONTBF": ["onatel", "ontbf"],
        "SGBF": ["societe generale", "sg bf", "sgbf"],
        "BOABF": ["bank of africa bf", "boa bf", "boabf"],
        "ETIT": ["ecobank transnational", "etit"],
        "SIVC": ["sicogi", "sivc"],
        "PALC": ["palm ci", "palc"],
        "SOGC": ["sogb", "sogc"],
        "SNTS": ["sonatel", "snts"],
        "CIEC": ["cie", "cie "],
        "NSIC": ["nsia", "nsic"],
        "ORGT": ["orange ci", "orgt"],
        "BICC": ["bici ci", "bicc"],
        "CBIBF": ["coris", "cbibf"],
        "ABJC": ["abidjan.net", "abjc"],
        "STAC": ["solibra", "stac"],
    }
    prefs = patterns.get(symbol, [symbol.lower()])
    for i in issuers:
        haystack = _normalize(f"{i.name} {i.description}")
        for p in prefs:
            if _normalize(p) in haystack:
                return i
    return None


def fundamental_score(reports: List[BrvmReport]) -> int:
    """
    Score fondamental basé sur la fraîcheur des rapports.
    +20 si un rapport majeur publié dans les 7 jours.
    +10 si < 30 jours.
    +5  si < 90 jours.
    """
    if not reports:
        return 0
    latest = max(
        (r.published_at for r in reports if r.published_at),
        default=None,
    )
    if not latest:
        return 0
    days = (datetime.now(timezone.utc) - latest).days
    if days <= 7:
        return 20
    if days <= 30:
        return 10
    if days <= 90:
        return 5
    return 0


async def fetch_fundamental_scores(symbols: List[str]) -> List[FundamentalScoreOut]:
    """Récupère les scores fondamentaux pour une liste de symboles BRVM."""
    issuers = await fetch_all_issuers()

    async def _for_symbol(sym: str) -> FundamentalScoreOut:
        issuer = await find_issuer_for_symbol(sym, issuers)
        if not issuer or not issuer.slug:
            return FundamentalScoreOut(symbol=sym, score=0)
        try:
            reports = await asyncio.wait_for(
                fetch_all_company_reports(issuer.slug),
                timeout=8.0,
            )
        except Exception:
            reports = []
        score = fundamental_score(reports)
        latest = next((r for r in reports if r.published_at), None)
        return FundamentalScoreOut(
            symbol=sym,
            score=score,
            latest_report_type=latest.report_type if latest else None,
            latest_report_date=latest.published_at if latest else None,
            slug=issuer.slug,
        )

    return list(await asyncio.gather(*[_for_symbol(s) for s in symbols]))

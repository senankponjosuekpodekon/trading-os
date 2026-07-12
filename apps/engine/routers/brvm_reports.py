"""
BRVM Reports Scraper — rapports sociétés cotées
Récupère les rapports financiers publiés par les émetteurs BRVM :
- rapports annuels / semestriels / trimestriels
- états financiers
- commentaires d'activité
- rapports des commissaires aux comptes

Utilisation :
- /brvm/reports/issuers  -> liste des émetteurs avec slug
- /brvm/reports/{slug}   -> rapports d'un émetteur
- /brvm/reports/symbol/{symbol} -> rapports pour un symbole Bourse connu
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import asyncio
import httpx
import re
from datetime import datetime, timedelta
from bs4 import BeautifulSoup

from routers.brvm import BRVM_SYMBOLS, HEADERS

router = APIRouter()

BRVM_REPORTS_INDEX = "https://www.brvm.org/fr/rapports-societes-cotees"
BRVM_COMPANY_BASE  = "https://www.brvm.org/fr/rapports-societe-cotes"


class BrvmIssuer(BaseModel):
    code: str
    name: str
    slug: str
    description: Optional[str] = None
    sector: Optional[str] = None


class BrvmReport(BaseModel):
    title: str
    report_type: Optional[str] = None
    published_at: Optional[datetime] = None
    pdf_url: Optional[str] = None


class BrvmIssuerReports(BaseModel):
    issuer: BrvmIssuer
    reports: List[BrvmReport]


class FundamentalScoreOut(BaseModel):
    symbol: str
    score: int
    latest_report_type: Optional[str] = None
    latest_report_date: Optional[datetime] = None
    slug: Optional[str] = None


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
        issuers.append(
            BrvmIssuer(code=code, name=name, slug=slug, description=desc)
        )
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
        reports.append(
            BrvmReport(title=title, report_type=rtype, published_at=pub, pdf_url=pdf_url)
        )
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

    # fallback par nom normalisé (ex: Ecobank Transnational)
    # On utilise une petite table de correspondance symbole -> patterns
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
    days = (datetime.utcnow() - latest).days
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


@router.get("/brvm/reports/issuers", response_model=List[BrvmIssuer])
async def list_issuers():
    """Liste tous les émetteurs ayant une page de rapports."""
    return await fetch_all_issuers()


@router.post("/brvm/reports/scores", response_model=List[FundamentalScoreOut])
async def get_fundamental_scores_endpoint(symbols: List[str]):
    """Scores fondamentaux (fraîcheur des rapports) pour les symboles donnés."""
    return await fetch_fundamental_scores(symbols)


@router.get("/brvm/reports/{slug}", response_model=BrvmIssuerReports)
async def get_company_reports(slug: str):
    """Rapports publiés par un émetteur (identifié par son slug)."""
    # Récupère aussi les infos émetteur pour enrichir la réponse
    issuers = await fetch_all_issuers()
    issuer = next((i for i in issuers if i.slug == slug), None)
    if not issuer:
        issuer = BrvmIssuer(code="", name=slug.replace("-", " ").upper(), slug=slug)
    reports = await fetch_all_company_reports(slug)
    return BrvmIssuerReports(issuer=issuer, reports=reports)


@router.get("/brvm/reports/symbol/{symbol}", response_model=BrvmIssuerReports)
async def get_reports_by_symbol(symbol: str):
    """Rapports pour un symbole bourse BRVM connu (ex: SNTS, BOABF)."""
    if symbol not in BRVM_SYMBOLS:
        raise HTTPException(status_code=404, detail=f"Symbole {symbol} inconnu")
    issuer = await find_issuer_for_symbol(symbol)
    if not issuer or not issuer.slug:
        raise HTTPException(
            status_code=404,
            detail=f"Aucun émetteur trouvé pour {symbol}",
        )
    reports = await fetch_all_company_reports(issuer.slug)
    return BrvmIssuerReports(issuer=issuer, reports=reports)

"""Developer activity router — GitHub health for tokens and projects."""
from __future__ import annotations

import os
import re
import structlog
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter()
logger = structlog.get_logger()


def _extract_github_repo(website: str, name: str) -> Optional[str]:
    """Try to extract github.com/owner/repo from a project website."""
    if not website:
        return None
    m = re.search(r"github\.com/([^\s\"<>/]+/[^\s\"<>/]+)", website)
    if m:
        return m.group(1).rstrip("/")
    # try common docs link
    if "github.com" in website:
        m = re.search(r"github\.com/([^?/]+)/([^?/]+)", website)
        if m:
            return f"{m.group(1)}/{m.group(2)}".rstrip("/")
    # fallback search on name
    return None


async def _fetch_github_repo(repo: str) -> Optional[Dict[str, Any]]:
    """Fetch basic GitHub repo metadata."""
    headers = {}
    token = os.getenv("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"https://api.github.com/repos/{repo}",
                headers=headers,
            )
            if r.status_code != 200:
                return None
            data = r.json()
            return {
                "stars": data.get("stargazers_count", 0),
                "forks": data.get("forks_count", 0),
                "open_issues": data.get("open_issues_count", 0),
                "language": data.get("language", ""),
                "updated_at": data.get("updated_at", ""),
                "created_at": data.get("created_at", ""),
            }
    except Exception as exc:
        logger.debug("github_repo_failed", repo=repo, error=str(exc))
        return None


async def _fetch_github_commits(repo: str, since: datetime) -> List[Dict[str, Any]]:
    """Fetch commits since a given date."""
    headers = {}
    token = os.getenv("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    params = {
        "since": since.isoformat(),
        "per_page": 100,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"https://api.github.com/repos/{repo}/commits",
                headers=headers,
                params=params,
            )
            if r.status_code != 200:
                return []
            return r.json()
    except Exception as exc:
        logger.debug("github_commits_failed", repo=repo, error=str(exc))
        return []


def _compute_dev_score(
    stars: int,
    commits_30d: int,
    open_issues: int,
    last_commit_days: Optional[int],
) -> int:
    """Compute a 0-100 developer health score."""
    score = 50
    if stars >= 1000:
        score += 15
    elif stars >= 100:
        score += 10
    elif stars > 0:
        score += 5

    if commits_30d >= 30:
        score += 25
    elif commits_30d >= 10:
        score += 15
    elif commits_30d > 0:
        score += 5
    else:
        score -= 10

    if last_commit_days is not None:
        if last_commit_days <= 7:
            score += 10
        elif last_commit_days <= 30:
            score += 5
        else:
            score -= 10

    # Penalize stale repos with many open issues
    if open_issues > 100 and commits_30d < 5:
        score -= 10

    return max(0, min(100, score))


@router.get("/developer-activity")
async def get_developer_activity(
    name: str = Query(..., description="Project name"),
    website: Optional[str] = Query(None, description="Project website URL"),
    github: Optional[str] = Query(None, description="GitHub repo owner/repo"),
):
    """Return GitHub developer activity metrics and a 0-100 health score."""
    repo = github or _extract_github_repo(website or "", name)
    if not repo:
        raise HTTPException(status_code=400, detail="Could not resolve GitHub repo")

    # Clean repo string
    repo = repo.replace("https://", "").replace("http://", "").lstrip("/")
    repo = re.sub(r"^github\.com/", "", repo).split("?")[0].rstrip("/")

    repo_info = await _fetch_github_repo(repo)
    if not repo_info:
        raise HTTPException(status_code=404, detail=f"GitHub repo not found: {repo}")

    since = datetime.now(timezone.utc) - timedelta(days=30)
    commits = await _fetch_github_commits(repo, since)
    commits_30d = len(commits)

    last_commit_days = None
    if commits:
        try:
            last_commit = commits[0].get("commit", {}).get("committer", {}).get("date", "")
            if last_commit:
                last_dt = datetime.fromisoformat(last_commit.replace("Z", "+00:00"))
                last_commit_days = (datetime.now(timezone.utc) - last_dt).days
        except Exception:
            pass

    score = _compute_dev_score(
        stars=repo_info.get("stars", 0),
        commits_30d=commits_30d,
        open_issues=repo_info.get("open_issues", 0),
        last_commit_days=last_commit_days,
    )

    return {
        "repo": repo,
        "stars": repo_info.get("stars", 0),
        "forks": repo_info.get("forks", 0),
        "open_issues": repo_info.get("open_issues", 0),
        "language": repo_info.get("language", ""),
        "commits_30d": commits_30d,
        "last_commit_days_ago": last_commit_days,
        "dev_score": score,
        "assessment": (
            "Active development" if score >= 70
            else "Moderate activity" if score >= 40
            else "Low or stale development"
        ),
    }

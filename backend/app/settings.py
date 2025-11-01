import os
import re
from typing import Optional
from urllib.parse import quote

from .utils.cache import get_cache
from .utils.rate_limit import get_rate_limiter

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
CACHE_TTL = int(os.getenv("CACHE_TTL", "900"))
MAX_IDS_PER_CHUNK = int(os.getenv("MAX_IDS_PER_CHUNK", "200"))
ARCGIS_TIMEOUT = int(os.getenv("ARCGIS_TIMEOUT_S", "20"))
RATE_LIMIT_MAX_REQUESTS = int(os.getenv("RATE_LIMIT_MAX_REQUESTS", "100"))
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))

cache = get_cache(ttl=CACHE_TTL)
rate_limiter = get_rate_limiter(
    max_requests=RATE_LIMIT_MAX_REQUESTS,
    window_seconds=RATE_LIMIT_WINDOW_SECONDS,
)

_FILENAME_SANITIZE_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


def sanitize_export_filename(value: Optional[str], extension: str) -> Optional[str]:
    if not value:
        return None

    trimmed = value.strip()
    if not trimmed:
        return None

    if trimmed.lower().endswith(extension.lower()):
        trimmed = trimmed[: -len(extension)]

    cleaned = _FILENAME_SANITIZE_PATTERN.sub("-", trimmed)
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    cleaned = cleaned.strip("-_.")

    if not cleaned:
        return None

    cleaned = cleaned[:100]

    return f"{cleaned}{extension}"


def build_content_disposition(filename: str) -> str:
    safe = filename.replace('"', "")
    utf8 = quote(safe)
    return f'attachment; filename="{safe}"; filename*=UTF-8\'\'{utf8}'

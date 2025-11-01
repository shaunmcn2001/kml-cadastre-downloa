import asyncio
import io
import zipfile
from dataclasses import dataclass
from typing import Iterable, List, Sequence, Tuple

import httpx

from .models import ParsedParcel

SMARTMAP_BASE_URL = "https://apps.information.qld.gov.au/data/cadastre/GenerateSmartMap"
DEFAULT_TIMEOUT = 45  # seconds


@dataclass
class SmartMapResult:
    lot: str
    plan: str
    file_name: str
    content: bytes


class SmartMapDownloadError(Exception):
    pass


def _build_query_code(lot: str, plan: str) -> str:
    lot_clean = lot.strip().upper()
    plan_clean = plan.strip().upper()
    if not lot_clean or not plan_clean:
        raise SmartMapDownloadError("Missing lot or plan component")
    return f"{lot_clean}%5C{plan_clean}"


async def _download_single(client: httpx.AsyncClient, lot: str, plan: str) -> SmartMapResult:
    code = _build_query_code(lot, plan)
    url = f"{SMARTMAP_BASE_URL}?q={code}"
    response = await client.get(url)
    if response.status_code != 200:
        raise SmartMapDownloadError(f"HTTP {response.status_code}")

    content_type = response.headers.get("content-type", "").lower()
    content = response.content
    if not content:
        raise SmartMapDownloadError("Empty response")
    if "pdf" not in content_type and not content.startswith(b"%PDF"):
        raise SmartMapDownloadError(f"Unexpected content ({content_type or 'unknown type'})")

    file_name = f"{lot.strip().upper()}_{plan.strip().upper()}.pdf"
    return SmartMapResult(lot=lot, plan=plan, file_name=file_name, content=content)


async def generate_smartmap_zip(
    parcels: Sequence[ParsedParcel],
    *,
    timeout: int = DEFAULT_TIMEOUT,
) -> Tuple[bytes, List[str]]:
    if not parcels:
        raise ValueError("At least one parcel must be supplied")

    buffer = io.BytesIO()
    failures: List[str] = []

    # Deduplicate by canonical plan + lot to avoid duplicate downloads
    seen: set[Tuple[str, str]] = set()
    tasks: List[Tuple[ParsedParcel, asyncio.Task]] = []

    async with httpx.AsyncClient(timeout=timeout) as client:
        for parcel in parcels:
            lot = (parcel.lot or "").strip().upper()
            plan = (parcel.plan or "").strip().upper()
            if not lot or not plan:
                failures.append(parcel.raw or parcel.id)
                continue

            key = (lot, plan)
            if key in seen:
                continue
            seen.add(key)

            task = asyncio.create_task(_download_single(client, lot, plan))
            tasks.append((parcel, task))

        successes: List[SmartMapResult] = []
        for parcel, task in tasks:
            try:
                result = await task
                successes.append(result)
            except Exception as exc:  # noqa: BLE001
                reason = str(exc) if str(exc) else exc.__class__.__name__
                identifier = parcel.raw or parcel.id
                failures.append(f"{identifier} — {reason}")

    if not successes:
        first_failure = failures[0] if failures else "unknown reason"
        raise SmartMapDownloadError(f"No SmartMap documents could be retrieved ({first_failure})")

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zipf:
        for result in successes:
            zipf.writestr(result.file_name, result.content)

        if failures:
            failure_report = "Failed to download the following entries:\n" + "\n".join(f"- {entry}" for entry in failures)
            zipf.writestr("smartmap_failures.txt", failure_report)

    buffer.seek(0)
    return buffer.getvalue(), failures

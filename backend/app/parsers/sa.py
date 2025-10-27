import re
from typing import List, Tuple

from ..models import MalformedEntry, ParcelState, ParsedParcel

_TITLE_REF_PATTERN = re.compile(r"^[A-Z]{1,3}\d{1,6}/\d{1,6}$")
_PLAN_PATTERN = re.compile(r"^[A-Z]+\d+[A-Z0-9]*$")
_LOT_PATTERN = re.compile(r"^[A-Z0-9]+$")


def _normalise_title_ref(raw: str) -> Tuple[str, str, str]:
    cleaned = raw.upper().replace(" ", "").strip()
    if not _TITLE_REF_PATTERN.fullmatch(cleaned):
        raise ValueError("Invalid SA title reference. Expected format like CT6204/831")

    volume, folio = cleaned.split("/")
    return cleaned, volume, folio


def _normalise_plan_parcel(raw: str) -> Tuple[str, str, str]:
    cleaned = raw.upper().replace("/", " ")
    cleaned = re.sub(r"[,;]+", " ", cleaned)
    cleaned = re.sub(r"\b(LOT|PLAN|PARCEL)\b", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    if not cleaned:
        raise ValueError("Invalid SA plan parcel. Expected plan and lot values")

    parts = cleaned.split(" ")
    if len(parts) < 2:
        raise ValueError("Invalid SA plan parcel. Expected plan and lot values")

    def is_plan(token: str) -> bool:
        return _PLAN_PATTERN.fullmatch(token or "") is not None

    def is_lot(token: str) -> bool:
        return _LOT_PATTERN.fullmatch(token or "") is not None

    plan = None
    lot = None

    first, last = parts[0], parts[-1]
    if is_plan(first) and is_lot(last):
        plan, lot = first, last
    elif is_plan(last) and is_lot(first):
        plan, lot = last, first
    else:
        joined_front = "".join(parts[:-1])
        if is_plan(joined_front) and is_lot(last):
            plan, lot = joined_front, last
        else:
            joined_back = "".join(parts[1:])
            if is_plan(joined_back) and is_lot(first):
                plan, lot = joined_back, first

    if not plan or not lot:
        raise ValueError("Invalid SA plan parcel. Expected format like 'D117877 A22'")

    canonical = f"{plan} {lot}"
    return canonical, plan, lot


def parse_sa(raw_text: str) -> Tuple[List[ParsedParcel], List[MalformedEntry]]:
    """Parse SA parcel identifiers supporting title references and plan parcels."""

    valid: List[ParsedParcel] = []
    malformed: List[MalformedEntry] = []

    lines = [line.strip() for line in raw_text.split("\n") if line.strip()]

    for line in lines:
        try:
            try:
                title_ref, volume, folio = _normalise_title_ref(line)
                valid.append(
                    ParsedParcel(
                        id=title_ref,
                        state=ParcelState.SA,
                        raw=line,
                        volume=volume,
                        folio=folio,
                    )
                )
                continue
            except ValueError:
                canonical, plan, lot = _normalise_plan_parcel(line)
                valid.append(
                    ParsedParcel(
                        id=canonical,
                        state=ParcelState.SA,
                        raw=line,
                        plan=plan,
                        lot=lot,
                    )
                )
        except Exception as exc:
            malformed.append(
                MalformedEntry(
                    raw=line,
                    error=str(exc),
                )
            )

    return valid, malformed

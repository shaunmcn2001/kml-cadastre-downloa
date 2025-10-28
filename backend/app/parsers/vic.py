import re
from typing import List, Tuple

from ..models import MalformedEntry, ParcelState, ParsedParcel

_PLAN_PATTERN = re.compile(r"^[A-Z]{1,4}\d+[A-Z0-9]*$")
_LOT_PATTERN = re.compile(r"^[A-Z0-9]+$")


def _normalise_spi(value: str) -> Tuple[str, str, str]:
    cleaned = value.strip().upper()
    if not cleaned:
        raise ValueError("Empty VIC parcel identifier")

    if "\\" in cleaned:
        lot, plan = [part.strip() for part in cleaned.split("\\", 1)]
        return _canonical_spi(lot, plan)

    cleaned = cleaned.replace("/", " ")
    cleaned = re.sub(r"[,;]+", " ", cleaned)
    cleaned = re.sub(r"\bLOT\b", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    if not cleaned:
        raise ValueError("Invalid VIC parcel identifier")

    tokens = cleaned.split(" ")

    # Identify plan token starting from the right
    plan = None
    plan_index = None
    for idx in range(len(tokens) - 1, -1, -1):
        token = tokens[idx]
        if _PLAN_PATTERN.fullmatch(token):
            plan = token
            plan_index = idx
            break

    if plan is None:
        raise ValueError("Missing plan component (e.g. PS433970)")

    lot_candidates = tokens[:plan_index] + tokens[plan_index + 1 :]
    lot_candidates = [candidate for candidate in lot_candidates if candidate]

    if not lot_candidates:
        raise ValueError("Missing lot component")

    lot = lot_candidates[0]
    if not _LOT_PATTERN.fullmatch(lot):
        raise ValueError("Invalid lot component")

    return _canonical_spi(lot, plan)


def _canonical_spi(lot: str, plan: str) -> Tuple[str, str, str]:
    lot_clean = lot.strip().upper()
    plan_clean = plan.strip().upper()

    if not lot_clean or not _LOT_PATTERN.fullmatch(lot_clean):
        raise ValueError("Invalid lot component")
    if not plan_clean or not _PLAN_PATTERN.fullmatch(plan_clean):
        raise ValueError("Invalid plan component")

    return f"{lot_clean}\\{plan_clean}", lot_clean, plan_clean


def normalize_vic_spi(raw: str) -> Tuple[str, str, str]:
    return _normalise_spi(raw)


def parse_vic(raw_text: str) -> Tuple[List[ParsedParcel], List[MalformedEntry]]:
    valid: List[ParsedParcel] = []
    malformed: List[MalformedEntry] = []

    lines = [line.strip() for line in raw_text.split("\n") if line.strip()]

    for line in lines:
        try:
            identifier, lot, plan = _normalise_spi(line)
            valid.append(
                ParsedParcel(
                    id=identifier,
                    state=ParcelState.VIC,
                    raw=line,
                    lot=lot,
                    plan=plan,
                )
            )
        except Exception as exc:
            malformed.append(MalformedEntry(raw=line, error=str(exc)))

    return valid, malformed

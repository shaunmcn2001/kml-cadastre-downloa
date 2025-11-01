import re
from typing import List, Optional, Tuple

from ..models import MalformedEntry, ParcelState, ParsedParcel

_LOT_SECTION_PATTERN = re.compile(r"^[A-Z0-9]+$")
_PLAN_PATTERN = re.compile(r"^[A-Z]+[A-Z0-9]*$")

_CANONICAL_PATTERN = re.compile(
    r"^(?P<lot>[A-Z0-9]+)(?:/(?P<section>[A-Z0-9]+))?//(?P<plan>[A-Z]+[A-Z0-9]*)$"
)
_SINGLE_SLASH_PATTERN = re.compile(
    r"^(?P<lot>[A-Z0-9]+)(?:/(?P<section>[A-Z0-9]+))?/(?P<plan>[A-Z]+[A-Z0-9]*)$"
)
_LOT_PLAN_SENTENCE = re.compile(
    r"^LOT\s+(?P<lot>[A-Z0-9]+)"
    r"(?:\s+(?:SEC|SECTION)\s+(?P<section>[A-Z0-9]+))?"
    r"\s+(?P<plan>[A-Z]+[A-Z0-9]*)$",
    re.IGNORECASE,
)

_NOISE_TOKENS = {"LOT", "LOTS", "SEC", "SECTION", "SECT", "PLAN"}


def _normalize_lot_section(value: str, label: str) -> str:
    cleaned = re.sub(r"\s+", "", value.upper())
    if not cleaned or not _LOT_SECTION_PATTERN.fullmatch(cleaned):
        raise ValueError(f"Invalid NSW {label} '{value}'")
    return cleaned


def _normalize_plan(value: str) -> str:
    cleaned = re.sub(r"\s+", "", value.upper())
    if not cleaned or not _PLAN_PATTERN.fullmatch(cleaned):
        raise ValueError(f"Invalid NSW plan '{value}'")
    return cleaned


def _canonical_id(lot: str, plan: str, section: Optional[str] = None) -> Tuple[str, str, Optional[str], str]:
    lot_clean = _normalize_lot_section(lot, "lot")
    section_clean = _normalize_lot_section(section, "section") if section else None
    plan_clean = _normalize_plan(plan)
    if section_clean:
        identifier = f"{lot_clean}/{section_clean}//{plan_clean}"
    else:
        identifier = f"{lot_clean}//{plan_clean}"
    return identifier, lot_clean, section_clean, plan_clean


def _join_plan_tokens(tokens: List[str]) -> Tuple[List[str], str]:
    if not tokens:
        raise ValueError("Missing NSW plan value")

    remaining = tokens[:-1]
    suffix = tokens[-1]

    # Handle split plan such as ["DP", "30493"]
    if remaining and re.fullmatch(r"\d+", suffix) and re.fullmatch(r"[A-Z]+", remaining[-1]):
        plan = remaining[-1] + suffix
        remaining = remaining[:-1]
    else:
        plan = suffix

    return remaining, plan


def _parse_fragment(raw: str) -> Tuple[str, Optional[str], str]:
    upper = raw.strip().upper()
    if not upper:
        raise ValueError("Empty NSW parcel token")

    upper = upper.replace("\\", "/")
    upper = re.sub(r"\bSECTION\b", "SEC", upper)
    upper = re.sub(r"\s+", " ", upper)
    upper = re.sub(r"\b([A-Z]{2,})\s+(\d+)\b", r"\1\2", upper)

    match = _CANONICAL_PATTERN.fullmatch(upper)
    if match:
        lot = match.group("lot")
        section = match.group("section")
        plan = match.group("plan")
        return _canonical_id(lot, plan, section)

    match = _SINGLE_SLASH_PATTERN.fullmatch(upper)
    if match:
        lot = match.group("lot")
        section = match.group("section")
        plan = match.group("plan")
        return _canonical_id(lot, plan, section)

    match = _LOT_PLAN_SENTENCE.fullmatch(upper)
    if match:
        lot = match.group("lot")
        section = match.group("section")
        plan = match.group("plan")
        return _canonical_id(lot, plan, section)

    tokens = [tok for tok in re.split(r"[\s,;/]+", upper) if tok]
    tokens = [tok for tok in tokens if tok not in _NOISE_TOKENS]

    if not tokens:
        raise ValueError("Unable to parse NSW lot/plan")

    tokens, plan = _join_plan_tokens(tokens)

    if not tokens:
        raise ValueError("Missing NSW lot value")

    lot = tokens[0]
    section = tokens[1] if len(tokens) > 1 else None

    return _canonical_id(lot, plan, section)


def normalize_nsw_identifier(raw: str) -> Tuple[str, str, Optional[str], str]:
    return _parse_fragment(raw)


def parse_nsw(raw_text: str) -> Tuple[List[ParsedParcel], List[MalformedEntry]]:
    valid: List[ParsedParcel] = []
    malformed: List[MalformedEntry] = []

    lines = [line.strip() for line in raw_text.split("\n") if line.strip()]

    for line in lines:
        try:
            range_match = re.fullmatch(r"^(?P<start>[A-Z0-9]+)-(?:\s*)(?P<end>[A-Z0-9]+)//(?P<plan>.+)$", line, re.IGNORECASE)
            if range_match and range_match.group("start").isdigit() and range_match.group("end").isdigit():
                start = int(range_match.group("start"))
                end = int(range_match.group("end"))
                plan = _normalize_plan(range_match.group("plan"))

                if end < start or end - start > 200:
                    raise ValueError("Range too large or invalid (max 200 lots)")

                for value in range(start, end + 1):
                    identifier, lot, _, plan_clean = _canonical_id(str(value), plan)
                    valid.append(
                        ParsedParcel(
                            id=identifier,
                            state=ParcelState.NSW,
                            raw=line,
                            lot=lot,
                            plan=plan_clean,
                        )
                    )
                continue

            identifier, lot, section, plan = _parse_fragment(line)
            valid.append(
                ParsedParcel(
                    id=identifier,
                    state=ParcelState.NSW,
                    raw=line,
                    lot=lot,
                    section=section,
                    plan=plan,
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

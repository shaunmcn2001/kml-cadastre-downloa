import re
from typing import List, Tuple

from ..models import MalformedEntry, ParcelState, ParsedParcel

_TITLE_REF_PATTERN = re.compile(r"^[A-Z]{1,3}\d{1,6}/\d{1,6}$")
_PLAN_PATTERN = re.compile(r"^[A-Z]+\d+[A-Z0-9]*$")
_LOT_PATTERN = re.compile(r"^[A-Z0-9]+$")
_DCDB_PATTERN = re.compile(r"^(?P<plan>[A-Z]+[0-9A-Z]*\d)(?P<lot>[A-Z]+[0-9A-Z]*\d)$")

_SA_NOISE_WORDS = {
    "LOT",
    "LOTS",
    "PLAN",
    "PARCEL",
    "ON",
    "OF",
    "THE",
    "SEC",
    "SECTION",
    "ALLOTMENT",
    "ALLOT",
    "UNIT",
    "STAGE",
    "PT",
    "PART",
    "HUNDRED",
    "HD",
    "DP",
    "ID",
}


def _split_input(raw_text: str) -> List[str]:
    fragments: List[str] = []
    for line in raw_text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [part.strip() for part in re.split(r"[;,]+", line) if part.strip()]
        if parts:
            fragments.extend(parts)
        else:
            fragments.append(line)
    return fragments


def _tokenise_sa(raw: str) -> Tuple[List[str], str, str]:
    text = raw.upper()
    text = re.sub(r"[\-_/]+", " ", text)
    text = re.sub(r"[,.;]+", " ", text)
    for noise in _SA_NOISE_WORDS:
        text = re.sub(rf"\b{noise}\b", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    tokens = [token for token in text.split(" ") if token]
    compact = text.replace(" ", "")
    return tokens, text, compact


def _extract_plan_lot(raw: str) -> Tuple[str, str]:
    tokens, _, compact = _tokenise_sa(raw)
    if not compact:
        raise ValueError("Invalid SA identifier")

    match = _DCDB_PATTERN.fullmatch(compact)
    plan = None
    lot = None
    if match:
        plan = match.group("plan")
        lot = match.group("lot")
    else:
        plan_candidates = [token for token in tokens if _PLAN_PATTERN.fullmatch(token)]
        lot_candidates = [token for token in tokens if _LOT_PATTERN.fullmatch(token)]

        if plan_candidates and lot_candidates:
            plan = max(plan_candidates, key=lambda t: (len(t), sum(ch.isdigit() for ch in t)))
            remaining_lots = [token for token in lot_candidates if token != plan]
            if remaining_lots:
                lot = max(remaining_lots, key=lambda t: (sum(ch.isdigit() for ch in t), len(t)))
        if (plan is None or lot is None) and len(tokens) >= 2:
            sorted_tokens = sorted(tokens, key=lambda t: (len(t), sum(ch.isdigit() for ch in t)), reverse=True)
            plan = sorted_tokens[0]
            if len(sorted_tokens) > 1:
                lot = sorted_tokens[1]
        if (plan is None or lot is None) and len(tokens) == 1:
            segments = re.findall(r"[A-Z]+\d+", tokens[0])
            if len(segments) >= 2:
                plan = segments[0]
                lot = segments[1]

    if not plan or not lot:
        raise ValueError("Invalid SA plan/lot combination")

    plan = plan.strip()
    lot = lot.strip()
    if len(plan) < len(lot):
        plan, lot = lot, plan
    return plan, lot


def _normalise_title_ref(raw: str) -> Tuple[str, str, str]:
    cleaned = raw.upper().replace(" ", "").strip()
    if not _TITLE_REF_PATTERN.fullmatch(cleaned):
        raise ValueError("Invalid SA title reference. Expected format like CT6204/831")

    volume, folio = cleaned.split("/")
    return cleaned, volume, folio


def _normalise_plan_parcel(raw: str) -> Tuple[str, str, str]:
    plan, lot = _extract_plan_lot(raw)
    canonical = f"{plan} {lot}"
    return canonical, plan, lot


def _normalise_dcdb_id(raw: str) -> Tuple[str, str, str]:
    plan, lot = _extract_plan_lot(raw)
    canonical = f"{plan}{lot}"
    return canonical, plan, lot


def parse_sa(raw_text: str) -> Tuple[List[ParsedParcel], List[MalformedEntry]]:
    """Parse SA parcel identifiers supporting title, plan parcel, and DCDB formats."""

    valid: List[ParsedParcel] = []
    malformed: List[MalformedEntry] = []
    seen: set[str] = set()

    for fragment in _split_input(raw_text):
        if not fragment:
            continue
        try:
            try:
                title_ref, volume, folio = _normalise_title_ref(fragment)
                identifier = f"SA:TITLE:{title_ref}"
                if identifier in seen:
                    continue
                seen.add(identifier)
                valid.append(
                    ParsedParcel(
                        id=identifier,
                        state=ParcelState.SA,
                        raw=fragment,
                        volume=volume,
                        folio=folio,
                    )
                )
                continue
            except ValueError:
                pass

            dcdb_id, plan, lot = _normalise_dcdb_id(fragment)
            identifier = f"SA:DCDB:{dcdb_id}"
            if identifier in seen:
                continue
            seen.add(identifier)
            valid.append(
                ParsedParcel(
                    id=identifier,
                    state=ParcelState.SA,
                    raw=fragment,
                    plan=plan,
                    lot=lot,
                )
            )
        except Exception as exc:
            malformed.append(
                MalformedEntry(
                    raw=fragment,
                    error=str(exc),
                )
            )

    return valid, malformed

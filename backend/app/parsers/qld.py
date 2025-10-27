import re
from typing import List, Optional, Tuple

from ..models import ParsedParcel, MalformedEntry, ParcelState

# Patterns adapted from QLD Quote Mapper implementation to robustly parse lot/plan tokens
_LOTPLAN_WITH_SPACES = re.compile(
    r"^(?P<lot>\d+[A-Z]?)\s+(?P<prefix>[A-Z]{1,4})\s*(?P<number>\d+)$",
    re.IGNORECASE,
)
_LOTPLAN_COMPACT = re.compile(
    r"^(?P<lot>\d+[A-Z]?)(?P<prefix>[A-Z]{1,4})(?P<number>\d+)$",
    re.IGNORECASE,
)
_PLAN_ONLY = re.compile(r"^(?P<prefix>[A-Z]{1,4})\s*(?P<number>\d+)$", re.IGNORECASE)
_NOISE_TOKENS = {"LOT", "PLAN", "ON", "OF", "NUMBER", "NO", "NO.", "STAGE", "UNIT"}


def _normalise_token(raw: str) -> str:
    """Normalise a user-supplied lot/plan fragment for easier parsing."""
    cleaned = raw.strip().upper()
    if not cleaned:
        return ""

    # Replace separators with spaces
    cleaned = re.sub(r"[\\/\-]+", " ", cleaned)
    cleaned = re.sub(r"[,\t]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)

    tokens = [
        token
        for token in cleaned.split(" ")
        if token and token not in _NOISE_TOKENS
    ]
    return " ".join(tokens)


def _parse_lotplan_fragment(fragment: str) -> Optional[Tuple[str, str, str]]:
    """
    Parse a single fragment of text into a normalised lotplan identifier.
    Returns tuple (lotplan, lot, plan) on success.
    """
    normalised = _normalise_token(fragment)
    if not normalised:
        return None

    match = _LOTPLAN_WITH_SPACES.match(normalised)
    if not match:
        compact = normalised.replace(" ", "")
        match = _LOTPLAN_COMPACT.match(compact)

    if not match:
        # Attempt to reconcile cases like "1 RP 12345" after removing filler words
        parts = normalised.split(" ")
        if len(parts) >= 2:
            # Try pairwise combinations (lot + plan)
            for idx in range(len(parts) - 1):
                candidate = f"{parts[idx]} {parts[idx + 1]}"
                match = _LOTPLAN_WITH_SPACES.match(candidate)
                if match:
                    break

        if not match and len(parts) >= 3:
            # Handle sequences like "1 RP 12345" explicitly
            lot_candidate = parts[0]
            plan_candidate = " ".join(parts[1:])
            match = _LOTPLAN_WITH_SPACES.match(f"{lot_candidate} {plan_candidate}")

    if not match:
        # Fallback: look for a plan token and pair with preceding lot digits
        parts = normalised.split(" ")
        for idx, part in enumerate(parts):
            plan_match = _PLAN_ONLY.match(part)
            if plan_match:
                preceding = parts[idx - 1] if idx > 0 else ""
                if preceding and re.fullmatch(r"\d+[A-Z]?", preceding):
                    lot = preceding.upper()
                    prefix = plan_match.group("prefix").upper()
                    number = plan_match.group("number")
                    return f"{lot}{prefix}{number}", lot, f"{prefix}{number}"
        return None

    lot = match.group("lot").upper()
    prefix = match.group("prefix").upper()
    number = match.group("number")
    plan = f"{prefix}{number}"
    lotplan = f"{lot}{plan}"
    return lotplan, lot, plan


def _split_input(raw_text: str) -> List[str]:
    """Split free-form input into candidate tokens for parsing."""
    # Break on common separators while preserving inline phrases
    fragments: List[str] = []
    for line in re.split(r"[\n;]+", raw_text):
        line = line.strip()
        if not line:
            continue
        parts = [part.strip() for part in re.split(r",|\band\b|&", line, flags=re.IGNORECASE) if part.strip()]
        fragments.extend(parts if parts else [line])
    return fragments


def parse_qld(raw_text: str) -> Tuple[List[ParsedParcel], List[MalformedEntry]]:
    """Parse QLD parcel identifiers, accepting a wide range of lot/plan formats."""
    valid: List[ParsedParcel] = []
    malformed: List[MalformedEntry] = []
    seen: set[str] = set()

    for fragment in _split_input(raw_text):
        try:
            parsed = _parse_lotplan_fragment(fragment)
            if not parsed:
                raise ValueError(
                    "Expected formats like '1RP912949', '1 RP 912949', or 'Lot 1 on RP912949'"
                )

            lotplan, lot, plan = parsed
            if lotplan in seen:
                continue
            seen.add(lotplan)

            valid.append(
                ParsedParcel(
                    id=lotplan,
                    state=ParcelState.QLD,
                    raw=fragment,
                    lot=lot,
                    plan=plan,
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

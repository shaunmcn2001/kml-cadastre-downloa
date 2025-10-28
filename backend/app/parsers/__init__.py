from .nsw import parse_nsw
from .qld import parse_qld
from .sa import parse_sa
from .vic import parse_vic
from ..models import ParcelState

def parse_parcel_input(state: ParcelState, raw_text: str):
    """Parse parcel identifiers for the given state."""
    if state == ParcelState.NSW:
        return parse_nsw(raw_text)
    elif state == ParcelState.QLD:
        return parse_qld(raw_text)
    elif state == ParcelState.SA:
        return parse_sa(raw_text)
    elif state == ParcelState.VIC:
        return parse_vic(raw_text)
    else:
        raise ValueError(f"Unsupported state: {state}")

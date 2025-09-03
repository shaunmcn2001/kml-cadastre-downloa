import re
from typing import List, Tuple
from ..models import ParsedParcel, MalformedEntry, ParcelState

def parse_sa(raw_text: str) -> Tuple[List[ParsedParcel], List[MalformedEntry]]:
    """Parse SA parcel identifiers from raw text input."""
    valid = []
    malformed = []
    
    lines = [line.strip() for line in raw_text.split('\n') if line.strip()]
    
    for line in lines:
        try:
            # Handle PARCEL//PLAN format
            sa_match = re.match(r'^([^/]+)//(.+)$', line)
            if sa_match:
                parcel_part, plan_part = sa_match.groups()
                
                # Check for VOLUME/FOLIO in parcel part
                volume_folio_match = re.match(r'^(\d+)/(\d+)$', parcel_part.strip())
                if volume_folio_match:
                    volume, folio = volume_folio_match.groups()
                    valid.append(ParsedParcel(
                        id=line,
                        state=ParcelState.SA,
                        raw=line,
                        volume=volume,
                        folio=folio,
                        plan=plan_part.strip()
                    ))
                else:
                    # Simple parcel//plan format
                    valid.append(ParsedParcel(
                        id=line,
                        state=ParcelState.SA,
                        raw=line,
                        lot=parcel_part.strip(),
                        plan=plan_part.strip()
                    ))
                continue
            
            malformed.append(MalformedEntry(
                raw=line,
                error="Invalid SA format. Expected PARCEL//PLAN or VOLUME/FOLIO//PLAN"
            ))
            
        except Exception as e:
            malformed.append(MalformedEntry(
                raw=line,
                error=f"Parse error: {str(e)}"
            ))
    
    return valid, malformed
import re
from typing import List, Tuple
from ..models import ParsedParcel, MalformedEntry, ParcelState

def parse_qld(raw_text: str) -> Tuple[List[ParsedParcel], List[MalformedEntry]]:
    """Parse QLD lotidstring identifiers from raw text input."""
    valid = []
    malformed = []
    
    lines = [line.strip() for line in raw_text.split('\n') if line.strip()]
    
    for line in lines:
        try:
            # QLD format: numbers followed by 1-3 letters followed by numbers
            # Examples: 1RP912949, 13SP12345, 245GTP4567
            qld_match = re.match(r'^(\d+)([A-Z]{1,3})(\d+)$', line.upper())
            if qld_match:
                lot_num, plan_type, plan_num = qld_match.groups()
                valid.append(ParsedParcel(
                    id=f"{lot_num}{plan_type}{plan_num}",
                    state=ParcelState.QLD,
                    raw=line,
                    lot=lot_num,
                    plan=f"{plan_type}{plan_num}"
                ))
                continue
            
            malformed.append(MalformedEntry(
                raw=line,
                error="Invalid QLD format. Expected format like '1RP912949' or '13SP12345'"
            ))
            
        except Exception as e:
            malformed.append(MalformedEntry(
                raw=line,
                error=f"Parse error: {str(e)}"
            ))
    
    return valid, malformed
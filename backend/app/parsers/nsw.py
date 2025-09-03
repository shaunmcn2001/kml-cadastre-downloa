import re
from typing import List, Tuple
from ..models import ParsedParcel, MalformedEntry, ParcelState

def parse_nsw(raw_text: str) -> Tuple[List[ParsedParcel], List[MalformedEntry]]:
    """Parse NSW parcel identifiers from raw text input."""
    valid = []
    malformed = []
    
    lines = [line.strip() for line in raw_text.split('\n') if line.strip()]
    
    for line in lines:
        try:
            # Handle ranges like "1-3//DP131118"
            range_match = re.match(r'^(\d+)-(\d+)//(.+)$', line)
            if range_match:
                start, end, plan = range_match.groups()
                start_num, end_num = int(start), int(end)
                
                if start_num <= end_num <= start_num + 100:  # Reasonable range limit
                    for i in range(start_num, end_num + 1):
                        valid.append(ParsedParcel(
                            id=f"{i}//{plan}",
                            state=ParcelState.NSW,
                            raw=line,
                            lot=str(i),
                            plan=plan.strip()
                        ))
                    continue
                else:
                    malformed.append(MalformedEntry(
                        raw=line,
                        error="Range too large or invalid (max 100 lots)"
                    ))
                    continue
            
            # Handle "LOT 13 DP1242624" format
            token_match = re.match(r'^LOT\s+(\d+)\s+(DP\d+)$', line, re.IGNORECASE)
            if token_match:
                lot, plan = token_match.groups()
                valid.append(ParsedParcel(
                    id=f"{lot}//{plan}",
                    state=ParcelState.NSW,
                    raw=line,
                    lot=lot,
                    plan=plan
                ))
                continue
            
            # Handle LOT/SECTION//PLAN format
            section_match = re.match(r'^(\d+)/(\d+)//(.+)$', line)
            if section_match:
                lot, section, plan = section_match.groups()
                valid.append(ParsedParcel(
                    id=line,
                    state=ParcelState.NSW,
                    raw=line,
                    lot=lot,
                    section=section,
                    plan=plan.strip()
                ))
                continue
            
            # Handle simple LOT//PLAN format
            simple_match = re.match(r'^(\d+)//(.+)$', line)
            if simple_match:
                lot, plan = simple_match.groups()
                valid.append(ParsedParcel(
                    id=line,
                    state=ParcelState.NSW,
                    raw=line,
                    lot=lot,
                    plan=plan.strip()
                ))
                continue
            
            malformed.append(MalformedEntry(
                raw=line,
                error="Invalid NSW format. Expected LOT//PLAN, LOT/SECTION//PLAN, ranges, or 'LOT # DP#'"
            ))
            
        except Exception as e:
            malformed.append(MalformedEntry(
                raw=line,
                error=f"Parse error: {str(e)}"
            ))
    
    return valid, malformed
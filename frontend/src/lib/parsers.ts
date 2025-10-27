import type { ParcelState, ParsedParcel } from './types';

// NSW Parser - handles LOT//PLAN, LOT/SECTION//PLAN formats
export function parseNSW(rawText: string): {
  valid: ParsedParcel[];
  malformed: Array<{ raw: string; error: string }>;
} {
  const valid: ParsedParcel[] = [];
  const malformed: Array<{ raw: string; error: string }> = [];
  
  const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
  
  for (const line of lines) {
    try {
      // Handle ranges like "1-3//DP131118"
      if (line.includes('-') && line.includes('//')) {
        const rangeMatch = line.match(/^(\d+)-(\d+)\/\/(.+)$/);
        if (rangeMatch) {
          const [, start, end, plan] = rangeMatch;
          const startNum = parseInt(start);
          const endNum = parseInt(end);
          
          if (startNum <= endNum && endNum - startNum <= 100) { // Reasonable range limit
            for (let i = startNum; i <= endNum; i++) {
              valid.push({
                id: `${i}//${plan}`,
                state: 'NSW',
                raw: line,
                lot: i.toString(),
                plan: plan.trim()
              });
            }
            continue;
          }
        }
      }
      
      // Handle "LOT 13 DP1242624" format
      const tokenMatch = line.match(/^LOT\s+(\d+)\s+(DP\d+)$/i);
      if (tokenMatch) {
        const [, lot, plan] = tokenMatch;
        valid.push({
          id: `${lot}//${plan}`,
          state: 'NSW',
          raw: line,
          lot,
          plan
        });
        continue;
      }
      
      // Handle LOT/SECTION//PLAN format
      const sectionMatch = line.match(/^(\d+)\/(\d+)\/\/(.+)$/);
      if (sectionMatch) {
        const [, lot, section, plan] = sectionMatch;
        valid.push({
          id: line,
          state: 'NSW',
          raw: line,
          lot,
          section,
          plan: plan.trim()
        });
        continue;
      }
      
      // Handle simple LOT//PLAN format
      const simpleMatch = line.match(/^(\d+)\/\/(.+)$/);
      if (simpleMatch) {
        const [, lot, plan] = simpleMatch;
        valid.push({
          id: line,
          state: 'NSW',
          raw: line,
          lot,
          plan: plan.trim()
        });
        continue;
      }
      
      malformed.push({ raw: line, error: 'Invalid NSW format. Expected LOT//PLAN or LOT/SECTION//PLAN' });
    } catch (error) {
      malformed.push({ raw: line, error: `Parse error: ${error}` });
    }
  }
  
  return { valid, malformed };
}

// QLD Parser - accepts flexible Lot/Plan formats and normalises to lotplan (e.g., 1RP912949)
const LOTPLAN_WITH_SPACES = /^(\d+[A-Z]?)\s+([A-Z]{1,4})\s*(\d+)$/i;
const LOTPLAN_COMPACT = /^(\d+[A-Z]?)([A-Z]{1,4})(\d+)$/i;
const PLAN_ONLY = /^([A-Z]{1,4})\s*(\d+)$/i;
const NOISE_TOKENS = new Set(['LOT', 'PLAN', 'ON', 'OF', 'NUMBER', 'NO', 'NO.', 'STAGE', 'UNIT']);

function normaliseToken(raw: string): string {
  let cleaned = raw.trim().toUpperCase();
  if (!cleaned) return '';

  cleaned = cleaned.replace(/[\\/\-]+/g, ' ');
  cleaned = cleaned.replace(/[\,\t]+/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ');

  const tokens = cleaned
    .split(' ')
    .filter(token => token && !NOISE_TOKENS.has(token));

  return tokens.join(' ');
}

function parseLotplanFragment(fragment: string): null | { lotplan: string; lot: string; plan: string } {
  const normalised = normaliseToken(fragment);
  if (!normalised) {
    return null;
  }

  let match = normalised.match(LOTPLAN_WITH_SPACES);
  if (!match) {
    const compact = normalised.replace(/\s+/g, '');
    match = compact.match(LOTPLAN_COMPACT);
  }

  if (!match) {
    const parts = normalised.split(' ');

    if (parts.length >= 2) {
      for (let idx = 0; idx < parts.length - 1; idx++) {
        const candidate = `${parts[idx]} ${parts[idx + 1]}`;
        match = candidate.match(LOTPLAN_WITH_SPACES);
        if (match) break;
      }
    }

    if (!match && parts.length >= 3) {
      const lotCandidate = parts[0];
      const planCandidate = parts.slice(1).join(' ');
      match = `${lotCandidate} ${planCandidate}`.match(LOTPLAN_WITH_SPACES);
    }

    if (!match) {
      for (let idx = 0; idx < parts.length; idx++) {
        const planMatch = parts[idx].match(PLAN_ONLY);
        if (planMatch) {
          const preceding = idx > 0 ? parts[idx - 1] : '';
          if (preceding && /\d+[A-Z]?/i.test(preceding)) {
            const lot = preceding.toUpperCase();
            const prefix = planMatch[1].toUpperCase();
            const number = planMatch[2];
            return {
              lotplan: `${lot}${prefix}${number}`,
              lot,
              plan: `${prefix}${number}`
            };
          }
        }
      }
      return null;
    }
  }

  const lot = match[1].toUpperCase();
  const prefix = match[2].toUpperCase();
  const number = match[3];
  const plan = `${prefix}${number}`;
  return {
    lotplan: `${lot}${plan}`,
    lot,
    plan
  };
}

function splitQLDInput(rawText: string): string[] {
  const fragments: string[] = [];

  for (const line of rawText.split(/\n|;/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const parts = trimmedLine.split(/,|\band\b|&/i).map(part => part.trim()).filter(Boolean);
    if (parts.length > 0) {
      fragments.push(...parts);
    } else {
      fragments.push(trimmedLine);
    }
  }

  return fragments;
}

export function parseQLD(rawText: string): {
  valid: ParsedParcel[];
  malformed: Array<{ raw: string; error: string }>;
} {
  const valid: ParsedParcel[] = [];
  const malformed: Array<{ raw: string; error: string }> = [];
  const seen = new Set<string>();

  for (const fragment of splitQLDInput(rawText)) {
    try {
      const parsed = parseLotplanFragment(fragment);
      if (!parsed) {
        throw new Error("Expected formats like '1RP912949', '1 RP 912949', or 'Lot 1 on RP912949'");
      }

      const { lotplan, lot, plan } = parsed;
      if (seen.has(lotplan)) {
        continue;
      }
      seen.add(lotplan);

      valid.push({
        id: lotplan,
        state: 'QLD',
        raw: fragment,
        lot,
        plan
      });
    } catch (error) {
      malformed.push({
        raw: fragment,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { valid, malformed };
}

// SA Parser - handles PARCEL//PLAN format with optional VOLUME/FOLIO
export function parseSA(rawText: string): {
  valid: ParsedParcel[];
  malformed: Array<{ raw: string; error: string }>;
} {
  const valid: ParsedParcel[] = [];
  const malformed: Array<{ raw: string; error: string }> = [];
  
  const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
  
  for (const line of lines) {
    try {
      // Handle PARCEL//PLAN format
      const saMatch = line.match(/^([^\/]+)\/\/(.+)$/);
      if (saMatch) {
        const [, parcel, plan] = saMatch;
        
        // Check for VOLUME/FOLIO in parcel part
        const volumeFolioMatch = parcel.match(/^(\d+)\/(\d+)$/);
        if (volumeFolioMatch) {
          const [, volume, folio] = volumeFolioMatch;
          valid.push({
            id: line,
            state: 'SA',
            raw: line,
            volume,
            folio,
            plan: plan.trim()
          });
        } else {
          valid.push({
            id: line,
            state: 'SA',
            raw: line,
            lot: parcel.trim(),
            plan: plan.trim()
          });
        }
        continue;
      }
      
      malformed.push({ raw: line, error: 'Invalid SA format. Expected PARCEL//PLAN or VOLUME/FOLIO//PLAN' });
    } catch (error) {
      malformed.push({ raw: line, error: `Parse error: ${error}` });
    }
  }
  
  return { valid, malformed };
}

export function parseParcelInput(state: ParcelState, rawText: string) {
  switch (state) {
    case 'NSW':
      return parseNSW(rawText);
    case 'QLD':
      return parseQLD(rawText);
    case 'SA':
      return parseSA(rawText);
    default:
      throw new Error(`Unsupported state: ${state}`);
  }
}

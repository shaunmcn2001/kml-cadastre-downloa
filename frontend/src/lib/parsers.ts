import type { ParcelState, ParsedParcel } from './types';

const NSW_LOT_SECTION_PATTERN = /^[A-Z0-9]+$/;
const NSW_PLAN_PATTERN = /^[A-Z]+[A-Z0-9]*$/;
const NSW_CANONICAL_PATTERN = /^(?<lot>[A-Z0-9]+)(?:\/(?<section>[A-Z0-9]+))?\/(?<slashes>\/?)(?<plan>[A-Z]+[A-Z0-9]*)$/;
const NSW_NOISE_TOKENS = new Set(['LOT', 'LOTS', 'SEC', 'SECTION', 'SECT', 'PLAN']);

function normalizeNSWLotSection(value: string, label: string): string {
  const cleaned = value.replace(/\s+/g, '').toUpperCase();
  if (!cleaned || !NSW_LOT_SECTION_PATTERN.test(cleaned)) {
    throw new Error(`Invalid NSW ${label} '${value}'`);
  }
  return cleaned;
}

function normalizeNSWPlan(value: string): string {
  const cleaned = value.replace(/\s+/g, '').toUpperCase();
  if (!cleaned || !NSW_PLAN_PATTERN.test(cleaned)) {
    throw new Error(`Invalid NSW plan '${value}'`);
  }
  return cleaned;
}

function canonicalNSWId(lot: string, plan: string, section?: string) {
  const lotClean = normalizeNSWLotSection(lot, 'lot');
  const sectionClean = section ? normalizeNSWLotSection(section, 'section') : undefined;
  const planClean = normalizeNSWPlan(plan);
  const id = sectionClean ? `${lotClean}/${sectionClean}//${planClean}` : `${lotClean}//${planClean}`;
  return { id, lot: lotClean, section: sectionClean, plan: planClean };
}

function joinNSWPlanTokens(tokens: string[]): { remaining: string[]; plan: string } {
  if (tokens.length === 0) {
    throw new Error('Missing NSW plan value');
  }

  let remaining = tokens.slice(0, -1);
  let plan = tokens[tokens.length - 1];

  if (/^\d+$/.test(plan) && remaining.length > 0 && /^[A-Z]+$/.test(remaining[remaining.length - 1])) {
    plan = `${remaining[remaining.length - 1]}${plan}`;
    remaining = remaining.slice(0, -1);
  }

  return { remaining, plan };
}

function parseNSWFragment(raw: string) {
  let token = raw.trim();
  if (!token) {
    throw new Error('Empty NSW parcel token');
  }

  token = token.replace(/\\/g, '/').toUpperCase();
  token = token.replace(/\bSECTION\b/g, 'SEC');
  token = token.replace(/\s+/g, ' ');
  token = token.replace(/\b([A-Z]{2,})\s+(\d+)\b/g, (_, word: string, digits: string) => `${word}${digits}`);

  const canonicalMatch = NSW_CANONICAL_PATTERN.exec(token);
  if (canonicalMatch?.groups) {
    const lot = canonicalMatch.groups.lot;
    const section = canonicalMatch.groups.section ?? undefined;
    const plan = canonicalMatch.groups.plan;
    const slashes = canonicalMatch.groups.slashes;

    if (slashes === '//' || slashes === '/') {
      return canonicalNSWId(lot, plan, section);
    }
  }

  const parts = token
    .split(/[\s,;/]+/)
    .map((piece) => piece.trim())
    .filter((piece) => !!piece && !NSW_NOISE_TOKENS.has(piece));

  if (parts.length === 0) {
    throw new Error('Unable to parse NSW lot/plan');
  }

  const { remaining, plan } = joinNSWPlanTokens(parts);
  if (remaining.length === 0) {
    throw new Error('Missing NSW lot value');
  }

  const lot = remaining[0];
  const section = remaining.length > 1 ? remaining[1] : undefined;

  return canonicalNSWId(lot, plan, section);
}

export function normalizeNSWIdentifier(raw: string) {
  return parseNSWFragment(raw);
}

// NSW Parser - supports lettered sections and flexible formats
export function parseNSW(rawText: string): {
  valid: ParsedParcel[];
  malformed: Array<{ raw: string; error: string }>;
} {
  const valid: ParsedParcel[] = [];
  const malformed: Array<{ raw: string; error: string }> = [];

  const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    try {
      const rangeMatch = line.match(/^(?<start>\d+)-(?:\s*)(?<end>\d+)\/\/(?<plan>.+)$/i);
      if (rangeMatch) {
        const start = Number.parseInt(rangeMatch.groups!.start!, 10);
        const end = Number.parseInt(rangeMatch.groups!.end!, 10);
        const plan = normalizeNSWPlan(rangeMatch.groups!.plan!);

        if (end < start || end - start > 100) {
          throw new Error('Range too large or invalid (max 100 lots)');
        }

        for (let value = start; value <= end; value += 1) {
          const canon = canonicalNSWId(String(value), plan);
          valid.push({
            id: canon.id,
            state: 'NSW',
            raw: line,
            lot: canon.lot,
            plan: canon.plan,
          });
        }
        continue;
      }

      const canon = parseNSWFragment(line);
      valid.push({
        id: canon.id,
        state: 'NSW',
        raw: line,
        lot: canon.lot,
        section: canon.section,
        plan: canon.plan,
      });
    } catch (error) {
      malformed.push({ raw: line, error: error instanceof Error ? error.message : String(error) });
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

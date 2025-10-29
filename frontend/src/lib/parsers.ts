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

const SA_TITLE_REF_PATTERN = /^[A-Z]{1,3}\d{1,6}\/\d{1,6}$/;
const SA_PLAN_PATTERN = /^[A-Z]+\d+[A-Z0-9]*$/;
const SA_LOT_PATTERN = /^[A-Z0-9]+$/;
const SA_DCDB_PATTERN = /^(?<plan>[A-Z]+[0-9A-Z]*\d)(?<lot>[A-Z]+[0-9A-Z]*\d)$/;
const SA_NOISE_WORDS = new Set([
  'LOT',
  'LOTS',
  'PLAN',
  'PARCEL',
  'ON',
  'OF',
  'THE',
  'SEC',
  'SECTION',
  'ALLOTMENT',
  'ALLOT',
  'UNIT',
  'STAGE',
  'PT',
  'PART',
  'HUNDRED',
  'HD',
  'DP',
  'ID',
]);

function normaliseSATitleRef(raw: string) {
  const cleaned = raw.toUpperCase().replace(/\s+/g, '').trim();
  if (!SA_TITLE_REF_PATTERN.test(cleaned)) {
    throw new Error('Invalid SA title reference. Expected format like CT6204/831');
  }
  const [volume, folio] = cleaned.split('/');
  return { id: cleaned, volume, folio };
}

function splitSaInput(rawText: string): string[] {
  const entries: string[] = [];
  rawText.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/[;,]+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length) {
      entries.push(...parts);
    } else {
      entries.push(trimmed);
    }
  });
  return entries;
}

function tokeniseSa(raw: string) {
  let text = raw.toUpperCase();
  text = text.replace(/[\-_/]+/g, ' ');
  text = text.replace(/[,.;]+/g, ' ');
  SA_NOISE_WORDS.forEach((word) => {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), ' ');
  });
  text = text.replace(/\s+/g, ' ').trim();
  const tokens = text ? text.split(' ').filter(Boolean) : [];
  const compact = text.replace(/\s+/g, '');
  return { tokens, compact };
}

function extractSaPlanLot(raw: string) {
  const { tokens, compact } = tokeniseSa(raw);
  if (!compact) {
    throw new Error('Invalid SA plan parcel. Expected plan and lot values');
  }

  let plan: string | undefined;
  let lot: string | undefined;

  const match = SA_DCDB_PATTERN.exec(compact);
  if (match?.groups) {
    plan = match.groups.plan;
    lot = match.groups.lot;
  } else {
    const planCandidates = tokens.filter((token) => SA_PLAN_PATTERN.test(token));
    const lotCandidates = tokens.filter((token) => SA_LOT_PATTERN.test(token));

    if (planCandidates.length && lotCandidates.length) {
      plan = [...planCandidates].sort((a, b) => (b.length - a.length) || (b.match(/\d/g)?.length ?? 0) - (a.match(/\d/g)?.length ?? 0))[0];
      lot = lotCandidates.find((token) => token !== plan) ?? lotCandidates[0];
    }

    if ((!plan || !lot) && tokens.length >= 2) {
      const [first, second] = [...tokens].sort((a, b) => (b.length - a.length) || (b.match(/\d/g)?.length ?? 0) - (a.match(/\d/g)?.length ?? 0));
      plan = plan ?? first;
      lot = lot ?? second;
    }

    if ((!plan || !lot) && tokens.length === 1) {
      const segments = tokens[0].match(/[A-Z]+\d+/g);
      if (segments && segments.length >= 2) {
        [plan, lot] = segments;
      }
    }
  }

  if (!plan || !lot) {
    throw new Error("Invalid SA plan parcel. Expected format like 'D117877 A22'");
  }

  if (plan.length < lot.length) {
    [plan, lot] = [lot, plan];
  }

  return { plan, lot };
}

function normaliseSADCDB(raw: string) {
  const { plan, lot } = extractSaPlanLot(raw);
  return { id: `${plan}${lot}`, plan, lot };
}

function normaliseSAPlanParcel(raw: string) {
  const { plan, lot } = extractSaPlanLot(raw);
  return { id: `${plan} ${lot}`, plan, lot };
}

// SA Parser - supports title references and DCDB identifiers
export function parseSA(rawText: string): {
  valid: ParsedParcel[];
  malformed: Array<{ raw: string; error: string }>;
} {
  const valid: ParsedParcel[] = [];
  const malformed: Array<{ raw: string; error: string }> = [];

  const seen = new Set<string>();
  const entries = splitSaInput(rawText);

  for (const line of entries) {
    try {
      try {
        const { id, volume, folio } = normaliseSATitleRef(line);
        const identifier = `SA:TITLE:${id}`;
        if (seen.has(identifier)) {
          continue;
        }
        seen.add(identifier);
        valid.push({
          id: identifier,
          state: 'SA',
          raw: line,
          volume,
          folio,
        });
        continue;
      } catch (err) {
        const { id, plan, lot } = normaliseSADCDB(line);
        const identifier = `SA:DCDB:${id}`;
        if (seen.has(identifier)) {
          continue;
        }
        seen.add(identifier);
        valid.push({
          id: identifier,
          state: 'SA',
          raw: line,
          plan,
          lot,
        });
      }
    } catch (error) {
      malformed.push({ raw: line, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { valid, malformed };
}

const VIC_PLAN_PATTERN = /^[A-Z]{1,4}\d+[A-Z0-9]*$/;
const VIC_LOT_PATTERN = /^[A-Z0-9]+$/;

function normaliseVicIdentifier(raw: string) {
  let cleaned = raw.trim().toUpperCase();
  if (!cleaned) {
    throw new Error('Empty VIC parcel identifier');
  }

  if (cleaned.includes('\\')) {
    const [lotRaw, planRaw] = cleaned.split('\\', 2).map((part) => part.trim());
    return canonicalVic(lotRaw, planRaw);
  }

  cleaned = cleaned.replace(/\//g, ' ');
  cleaned = cleaned.replace(/[,;]+/g, ' ');
  cleaned = cleaned.replace(/\bLOT\b/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  if (!cleaned) {
    throw new Error('Invalid VIC parcel identifier');
  }

  const tokens = cleaned.split(' ');

  let plan: string | undefined;
  let planIndex = -1;
  for (let idx = tokens.length - 1; idx >= 0; idx -= 1) {
    if (VIC_PLAN_PATTERN.test(tokens[idx])) {
      plan = tokens[idx];
      planIndex = idx;
      break;
    }
  }

  if (!plan) {
    throw new Error('Missing plan component (e.g. PS433970)');
  }

  const lotCandidates = tokens.filter((_, index) => index !== planIndex && tokens[index]);
  if (lotCandidates.length === 0) {
    throw new Error('Missing lot component');
  }

  const lot = lotCandidates[0];
  return canonicalVic(lot, plan);
}

function canonicalVic(lot: string, plan: string) {
  const lotClean = lot.trim().toUpperCase();
  const planClean = plan.trim().toUpperCase();

  if (!lotClean || !VIC_LOT_PATTERN.test(lotClean)) {
    throw new Error('Invalid lot component');
  }
  if (!planClean || !VIC_PLAN_PATTERN.test(planClean)) {
    throw new Error('Invalid plan component');
  }

  return {
    id: `${lotClean}\\${planClean}`,
    lot: lotClean,
    plan: planClean,
  };
}

export function parseVIC(rawText: string): {
  valid: ParsedParcel[];
  malformed: Array<{ raw: string; error: string }>;
} {
  const valid: ParsedParcel[] = [];
  const malformed: Array<{ raw: string; error: string }> = [];

  const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    try {
      const { id, lot, plan } = normaliseVicIdentifier(line);
      valid.push({
        id,
        state: 'VIC',
        raw: line,
        lot,
        plan,
      });
    } catch (error) {
      malformed.push({ raw: line, error: error instanceof Error ? error.message : String(error) });
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
    case 'VIC':
      return parseVIC(rawText);
    default:
      throw new Error(`Unsupported state: ${state}`);
  }
}

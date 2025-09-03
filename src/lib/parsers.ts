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

// QLD Parser - handles lotidstring format (e.g., 1RP912949, 13SP12345)
export function parseQLD(rawText: string): {
  valid: ParsedParcel[];
  malformed: Array<{ raw: string; error: string }>;
} {
  const valid: ParsedParcel[] = [];
  const malformed: Array<{ raw: string; error: string }> = [];
  
  const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
  
  for (const line of lines) {
    try {
      // QLD format: numbers followed by letters and numbers
      const qldMatch = line.match(/^(\d+)([A-Z]{1,3})(\d+)$/);
      if (qldMatch) {
        valid.push({
          id: line,
          state: 'QLD',
          raw: line
        });
        continue;
      }
      
      malformed.push({ raw: line, error: 'Invalid QLD format. Expected format like 1RP912949 or 13SP12345' });
    } catch (error) {
      malformed.push({ raw: line, error: `Parse error: ${error}` });
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
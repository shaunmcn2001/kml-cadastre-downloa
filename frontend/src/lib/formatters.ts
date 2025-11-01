const STATE_CODES = new Set(['NSW', 'QLD', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT']);

const STREET_TYPES = new Set([
  'RD',
  'ROAD',
  'ST',
  'STREET',
  'AVE',
  'AVENUE',
  'DR',
  'DRIVE',
  'CT',
  'COURT',
  'CRES',
  'CRESCENT',
  'HWY',
  'HIGHWAY',
  'WAY',
  'CIRCUIT',
  'PL',
  'PLACE',
  'LN',
  'LANE',
  'TCE',
  'TERRACE',
  'BLVD',
  'BOULEVARD',
  'PKWY',
  'PARKWAY',
  'PDE',
  'PARADE',
  'CLOSE',
  'HILL',
  'GROVE',
  'TRACK',
  'VIEW',
  'VISTA',
]);

const LOWERCASE_WORDS = new Set(['and', 'of', 'the', 'for', 'at', 'on', 'to', 'in']);

const ALWAYS_UPPERCASE = new Set<string>([...STATE_CODES, 'PO', 'BOX']);

function titleCaseWord(word: string, index: number): string {
  if (!word) {
    return word;
  }

  const upper = word.toUpperCase();

  if (ALWAYS_UPPERCASE.has(upper)) {
    return upper;
  }

  if (/^\d+$/.test(word)) {
    return word;
  }

  if (/[0-9]/.test(word)) {
    return upper;
  }

  if (word.includes('/')) {
    return upper;
  }

  const lower = word.toLowerCase();

  if (LOWERCASE_WORDS.has(lower) && index !== 0) {
    return lower;
  }

  return lower
    .split(/([-'])/)
    .map((segment, i) => {
      if (segment === '-' || segment === "'") {
        return segment;
      }
      if (!segment) {
        return segment;
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join('');
}

function titleCaseTokens(tokens: string[]): string {
  return tokens
    .map((token, index) => titleCaseWord(token, index))
    .filter(Boolean)
    .join(' ')
    .trim();
}

function normaliseSpacing(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/,+/g, ',').trim();
}

function findStateIndex(tokens: string[]): number {
  for (let i = 0; i < tokens.length; i += 1) {
    const upper = tokens[i].toUpperCase();
    if (STATE_CODES.has(upper)) {
      return i;
    }
    const lettersOnly = upper.replace(/[^A-Z]/g, '');
    if (STATE_CODES.has(lettersOnly)) {
      return i;
    }
  }
  return -1;
}

function splitStreetAndSuburb(tokens: string[]): { street: string[]; suburb: string[] } {
  if (tokens.length <= 1) {
    return { street: tokens, suburb: [] };
  }

  let streetEndIndex = -1;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const upper = tokens[i].toUpperCase().replace(/[^A-Z]/g, '');
    if (STREET_TYPES.has(upper)) {
      streetEndIndex = i;
      break;
    }
  }

  if (streetEndIndex === -1) {
    streetEndIndex = Math.max(0, tokens.length - 2);
  }

  const street = tokens.slice(0, streetEndIndex + 1);
  const suburb = tokens.slice(streetEndIndex + 1);

  return { street, suburb };
}

export function formatFolderName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  const spaced = normaliseSpacing(trimmed);
  const tokensForDetection = spaced.replace(/,/g, ' ').split(' ').filter(Boolean);
  if (tokensForDetection.length === 0) {
    return '';
  }

  const stateIndex = findStateIndex(tokensForDetection);

  if (stateIndex === -1) {
    const segments = spaced.split(',').map((segment) => segment.trim()).filter(Boolean);
    if (segments.length <= 1) {
      return titleCaseTokens(tokensForDetection);
    }
    return segments.map((segment) => titleCaseTokens(segment.split(' ').filter(Boolean))).join(', ');
  }

  const stateToken = tokensForDetection[stateIndex].toUpperCase().replace(/[^A-Z]/g, '');
  const postcodeTokens = tokensForDetection.slice(stateIndex + 1);
  const priorTokens = tokensForDetection.slice(0, stateIndex);

  if (priorTokens.length === 0) {
    const tail = [stateToken, ...postcodeTokens.map((token) => (/^\d+$/.test(token) ? token : token.toUpperCase()))]
      .join(' ')
      .trim();
    return tail;
  }

  const { street, suburb } = splitStreetAndSuburb(priorTokens);
  const streetFormatted = titleCaseTokens(street);
  const suburbFormatted = titleCaseTokens(suburb);
  const postcode = postcodeTokens
    .map((token) => {
      if (/^\d+$/.test(token)) {
        return token;
      }
      return titleCaseTokens([token]);
    })
    .filter(Boolean)
    .join(' ');

  let result = streetFormatted;

  if (suburbFormatted) {
    result = `${result}, ${suburbFormatted}`;
  }

  if (stateToken) {
    if (suburbFormatted) {
      result = `${result} ${stateToken}`;
    } else if (result) {
      result = `${result}, ${stateToken}`;
    } else {
      result = stateToken;
    }
  }

  if (postcode) {
    result = `${result} ${postcode}`;
  }

  return result.replace(/\s+/g, ' ').trim();
}

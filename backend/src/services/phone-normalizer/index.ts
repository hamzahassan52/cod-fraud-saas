/**
 * Pakistani Phone Number Normalizer
 *
 * Handles all Pakistani phone formats:
 * - 03001234567
 * - +923001234567
 * - 923001234567
 * - 0300-1234567
 * - 0300 123 4567
 * - 03001234567 (with Urdu digits)
 *
 * Detects carrier from prefix.
 */

// Pakistani mobile prefixes -> carrier mapping
const CARRIER_MAP: Record<string, string> = {
  '300': 'Jazz', '301': 'Jazz', '302': 'Jazz',
  '303': 'Ufone', '304': 'Ufone',
  '305': 'SCO',
  '306': 'Telenor', '307': 'Warid/Jazz', '308': 'Zong',
  '309': 'Ufone',
  '310': 'SCO', '311': 'Ufone', '312': 'Ufone',
  '313': 'Zong', '314': 'Zong', '315': 'Zong',
  '316': 'Zong', '317': 'Warid/Jazz', '318': 'Zong',
  '319': 'Telenor',
  '320': 'Jazz', '321': 'Jazz', '322': 'Jazz', '323': 'Jazz', '324': 'Jazz',
  '325': 'SCO',
  '330': 'Jazz', '331': 'Zong', '332': 'Jazz',
  '333': 'Ufone', '334': 'Telenor', '335': 'Jazz',
  '336': 'Ufone', '337': 'Telenor',
  '340': 'Telenor', '341': 'Telenor', '342': 'Telenor',
  '343': 'Telenor', '344': 'Telenor', '345': 'Telenor',
  '346': 'Telenor', '347': 'Telenor', '348': 'Telenor', '349': 'Telenor',
};

// Urdu/Arabic digits to Latin
const URDU_DIGIT_MAP: Record<string, string> = {
  '\u06F0': '0', '\u06F1': '1', '\u06F2': '2', '\u06F3': '3',
  '\u06F4': '4', '\u06F5': '5', '\u06F6': '6', '\u06F7': '7',
  '\u06F8': '8', '\u06F9': '9',
  '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3',
  '\u0664': '4', '\u0665': '5', '\u0666': '6', '\u0667': '7',
  '\u0668': '8', '\u0669': '9',
};

export interface NormalizedPhone {
  original: string;
  normalized: string;     // +923001234567 format
  local: string;          // 03001234567 format
  carrier: string | null;
  isValid: boolean;
  isMobile: boolean;
  prefix: string;
}

export function normalizePhone(raw: string): NormalizedPhone {
  const original = raw;

  // Step 1: Convert Urdu/Arabic digits to Latin
  let cleaned = raw;
  for (const [urdu, latin] of Object.entries(URDU_DIGIT_MAP)) {
    cleaned = cleaned.replace(new RegExp(urdu, 'g'), latin);
  }

  // Step 2: Remove all non-digit characters except leading +
  const hasPlus = cleaned.startsWith('+');
  cleaned = cleaned.replace(/\D/g, '');

  // Step 3: Normalize to international format
  let normalized: string;
  let local: string;

  if (cleaned.startsWith('92') && cleaned.length === 12) {
    // Already international without +: 923001234567
    normalized = `+${cleaned}`;
    local = `0${cleaned.substring(2)}`;
  } else if (hasPlus && cleaned.startsWith('92') && cleaned.length === 12) {
    // International with +: +923001234567
    normalized = `+${cleaned}`;
    local = `0${cleaned.substring(2)}`;
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    // Local format: 03001234567
    normalized = `+92${cleaned.substring(1)}`;
    local = cleaned;
  } else if (cleaned.length === 10 && cleaned.startsWith('3')) {
    // Without leading 0: 3001234567
    normalized = `+92${cleaned}`;
    local = `0${cleaned}`;
  } else {
    // Invalid
    return {
      original,
      normalized: cleaned,
      local: cleaned,
      carrier: null,
      isValid: false,
      isMobile: false,
      prefix: '',
    };
  }

  // Step 4: Extract prefix and detect carrier
  const prefix = local.substring(1, 4); // 300 from 03001234567
  const carrier = CARRIER_MAP[prefix] || null;
  const isMobile = carrier !== null;

  // Step 5: Validate length
  const isValid = normalized.length === 13; // +92XXXXXXXXXX

  return {
    original,
    normalized,
    local,
    carrier,
    isValid,
    isMobile,
    prefix,
  };
}

export function isBlacklistedCarrier(carrier: string | null): boolean {
  // SCO numbers (Special Communications Organization - AJK/GB)
  // Higher fraud rates observed
  return carrier === 'SCO';
}

export function isPrepaidLikely(prefix: string): boolean {
  // In Pakistan, nearly all mobile numbers are prepaid
  // This is a placeholder for future postpaid detection
  return true;
}

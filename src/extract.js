// Finds the most likely one-time code in an email's subject + body.
// Pure function, no Chrome APIs, so it can be unit tested in Node.

const KEYWORDS = /\b(code|otp|one[- ]?time|passcode|pass code|verification|verify|security|sign[- ]?in|log[- ]?in|login|2fa|mfa|two[- ]factor|authenticat\w*|confirm\w*|pin)\b/gi;

// Text that usually sits next to numbers that are NOT codes.
const NOT_CODE_BEFORE = /(\$|€|£|#|no\.?|order|invoice|account|acct|ending in|ext\.?|suite|apt|ref\w*|ticket|case|zip|phone|tel|call)\s*:?\s*$/i;
const NOT_CODE_AFTER = /^\s*(%|px|am|pm|usd|dollars|minutes|mins|hours|days|seconds|secs|st|nd|rd|th)\b/i;

export function htmlToText(html) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ');
}

export function extractCode(subject = '', body = '') {
  const text = `${subject}\n${body}`.replace(/ /g, ' ');
  if (!/\b(code|otp|passcode|verif|sign[- ]?in|log[- ]?in|login|2fa|mfa|authenticat|security|one[- ]?time|pin)\b/i.test(text)) {
    return null;
  }

  // Keyword positions, used to score how close a candidate sits to them.
  const kwPos = [];
  for (const m of text.matchAll(KEYWORDS)) kwPos.push(m.index);

  const candidates = [];
  // Digits, optionally split "123 456" or "123-456", or prefixed like "G-123456".
  const re = /(?<![\w$#.,/:-])(?:[A-Z]{1,3}-)?(\d{3}[ -]\d{3}|\d{4,8})(?![\w%/:.,]\d|\w)/g;
  for (const m of text.matchAll(re)) {
    const raw = m[1];
    const code = raw.replace(/[ -]/g, '');
    const start = m.index;
    const before = text.slice(Math.max(0, start - 20), start);
    const after = text.slice(start + m[0].length, start + m[0].length + 12);

    if (NOT_CODE_BEFORE.test(before) || NOT_CODE_AFTER.test(after)) continue;
    if (code.length === 4 && /^(19|20)\d\d$/.test(code)) continue; // years
    if (/^0+$/.test(code)) continue;

    const nearest = kwPos.length
      ? Math.min(...kwPos.map((p) => Math.abs(p - start)))
      : 1000;
    let score = 0;
    score -= Math.min(nearest, 400) / 4;      // closer to a keyword is better
    if (code.length === 6) score += 25;        // most codes are 6 digits
    else if (code.length >= 4 && code.length <= 8) score += 10;
    if (start < subject.length + 1) score += 15; // in the subject
    if (/:\s*$|is\s*$|\bcode\b[^.\n]{0,15}$/i.test(before)) score += 20;
    if (/^\s*(\n|$|\.|\s{2,}|is your|is the)/i.test(after)) score += 5;
    candidates.push({ code, score });
  }

  // Alphanumeric codes (e.g. "Your code: AB3D9K") — only when clearly labelled.
  for (const m of text.matchAll(/\b(?:code|passcode|otp)\b[^\n]{0,12}?[:\s]\s*([A-Z0-9]{5,8})\b/gi)) {
    const code = m[1];
    if (/\d/.test(code) && /[A-Z]/.test(code) && code === code.toUpperCase()) {
      candidates.push({ code, score: 30 });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].score > -60 ? candidates[0].code : null;
}

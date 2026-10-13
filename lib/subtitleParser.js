const jschardet = require('jschardet');
const iconv = require('iconv-lite');
const { timeToSeconds } = require('./timeUtils');

/**
 * Decode buffer to string using charset auto-detection (UTF-8, CP949/EUC-KR)
 * @param {Buffer} buffer
 * @returns {{ text: string, encoding: string }}
 */
function decodeSubtitleBuffer(buffer) {
  // Check UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      text: buffer.slice(3).toString('utf8'),
      encoding: 'UTF-8-BOM'
    };
  }

  const detected = jschardet.detect(buffer);
  let encoding = (detected.encoding || 'utf-8').toLowerCase();

  // Standardize Korean encodings
  if (['euc-kr', 'windows-949', 'cp949', 'ks_c_5601-1987', 'uhc'].includes(encoding)) {
    try {
      const decoded = iconv.decode(buffer, 'cp949');
      return { text: decoded, encoding: 'CP949' };
    } catch (e) {
      // fallback
    }
  }

  // Try utf-8 first
  const utf8String = buffer.toString('utf8');
  // Check for common UTF-8 decoding anomalies (e.g., replacement character \uFFFD)
  if (utf8String.includes('\uFFFD')) {
    // If invalid UTF-8 and contains non-ascii, try CP949
    try {
      const cp949String = iconv.decode(buffer, 'cp949');
      return { text: cp949String, encoding: 'CP949 (Fallback)' };
    } catch (e) {}
  }

  return { text: utf8String, encoding: encoding.toUpperCase() };
}

/**
 * Clean HTML tags and decode common HTML entities for SAMI
 * @param {string} html
 * @returns {string}
 */
function cleanSamiText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '') // remove remaining HTML tags like <font>, <b>, etc.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * Parse SAMI (.smi) subtitle format
 * @param {string} text
 * @returns {Array<{ id: number, start: number, end: number, text: string }>}
 */
function parseSMI(text) {
  const items = [];
  // Find all <SYNC Start=\d+> tags
  const syncRegex = /<SYNC\s+Start\s*=\s*['"]?(\d+)['"]?[^>]*>([\s\S]*?)(?=(?:<SYNC|\s*<\/BODY>|\s*<\/SAMI>|$))/gi;
  let match;
  const rawCues = [];

  while ((match = syncRegex.exec(text)) !== null) {
    const startMs = parseInt(match[1], 10);
    const content = match[2];
    const cleaned = cleanSamiText(content);
    rawCues.push({
      startMs,
      text: cleaned
    });
  }

  let idCounter = 1;
  for (let i = 0; i < rawCues.length; i++) {
    const current = rawCues[i];
    // If current text is empty, it was a closing sync for previous cue
    if (!current.text) continue;

    const startSec = current.startMs / 1000;
    let endSec = null;

    // Look for the next cue to determine end time
    if (i + 1 < rawCues.length) {
      const next = rawCues[i + 1];
      const nextStartSec = next.startMs / 1000;
      // If next cue is empty (a clearing tag)
      if (!next.text) {
        endSec = nextStartSec;
      } else {
        // Next cue has text, so this cue ends when next starts, capped at startSec + 5s
        endSec = Math.min(nextStartSec, startSec + 5.0);
      }
    }

    if (endSec === null || endSec <= startSec) {
      // Default duration: 3.0s or based on character count
      const estimatedDuration = Math.max(1.5, Math.min(6.0, current.text.length * 0.15));
      endSec = startSec + estimatedDuration;
    }

    items.push({
      id: idCounter++,
      start: Number(startSec.toFixed(3)),
      end: Number(endSec.toFixed(3)),
      text: current.text
    });
  }

  return items;
}

/**
 * Parse SubRip (.srt) subtitle format
 * @param {string} text
 * @returns {Array<{ id: number, start: number, end: number, text: string }>}
 */
function parseSRT(text) {
  const items = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  let idCounter = 1;

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLineIdx = i;
        break;
      }
    }

    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const timeMatch = timeLine.match(/([0-9:.,]+)\s*-->\s*([0-9:.,]+)/);
    if (!timeMatch) continue;

    const start = timeToSeconds(timeMatch[1]);
    const end = timeToSeconds(timeMatch[2]);
    const cueText = lines.slice(timeLineIdx + 1).join('\n').replace(/\n\s*\n+/g, '\n').trim();

    if (!cueText) continue;

    items.push({
      id: idCounter++,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      text: cueText
    });
  }

  return items;
}

/**
 * Parse WebVTT (.vtt) subtitle format
 * @param {string} text
 * @returns {Array<{ id: number, start: number, end: number, text: string }>}
 */
function parseVTT(text) {
  // WebVTT format is mostly identical to SRT, except header "WEBVTT"
  const cleanText = text.replace(/^WEBVTT[^\n]*\n+/i, '');
  return parseSRT(cleanText);
}

/**
 * Automatically detect format and parse subtitle content
 * @param {string} content
 * @returns {{ format: string, items: Array<{ id: number, start: number, end: number, text: string }> }}
 */
function parseSubtitle(content) {
  const trimmed = content.trim();

  if (/<SAMI|<SYNC/i.test(trimmed)) {
    return {
      format: 'SMI',
      items: parseSMI(trimmed)
    };
  }

  if (/^WEBVTT/i.test(trimmed)) {
    return {
      format: 'VTT',
      items: parseVTT(trimmed)
    };
  }

  // Default to SRT
  return {
    format: 'SRT',
    items: parseSRT(trimmed)
  };
}

module.exports = {
  decodeSubtitleBuffer,
  parseSubtitle,
  parseSRT,
  parseSMI,
  parseVTT
};

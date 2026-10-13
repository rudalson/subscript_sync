const { secondsToTime } = require('./timeUtils');

/**
 * Format subtitles to SRT (SubRip) format
 * @param {Array<{ id: number, start: number, end: number, text: string }>} items
 * @returns {string}
 */
function toSRT(items) {
  let output = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const startTimeStr = secondsToTime(Math.max(0, item.start), ',');
    const endTimeStr = secondsToTime(Math.max(0, item.end), ',');
    output += `${i + 1}\n${startTimeStr} --> ${endTimeStr}\n${item.text}\n\n`;
  }
  return output.trim() + '\n';
}

/**
 * Format subtitles to WebVTT format
 * @param {Array<{ id: number, start: number, end: number, text: string }>} items
 * @returns {string}
 */
function toVTT(items) {
  let output = 'WEBVTT\n\n';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const startTimeStr = secondsToTime(Math.max(0, item.start), '.');
    const endTimeStr = secondsToTime(Math.max(0, item.end), '.');
    output += `${i + 1}\n${startTimeStr} --> ${endTimeStr}\n${item.text}\n\n`;
  }
  return output.trim() + '\n';
}

/**
 * Format subtitles to SAMI (.smi) format
 * @param {Array<{ id: number, start: number, end: number, text: string }>} items
 * @param {string} title
 * @returns {string}
 */
function toSMI(items, title = 'SubSync Subtitle') {
  let output = `<SAMI>\n<HEAD>\n<TITLE>${escapeXml(title)}</TITLE>\n<STYLE TYPE="text/css">\n<!--\nP { font-family: sans-serif; font-size: 16pt; text-align: center; color: white; }\n.KRCC { Name: 한국어; lang: ko-KR; SAMIType: CC; }\n-->\n</STYLE>\n</HEAD>\n<BODY>\n`;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const startMs = Math.round(Math.max(0, item.start) * 1000);
    const endMs = Math.round(Math.max(0, item.end) * 1000);
    const formattedText = item.text.replace(/\r\n/g, '<br>').replace(/\n/g, '<br>');

    output += `<SYNC Start=${startMs}><P Class=KRCC>${formattedText}\n`;
    output += `<SYNC Start=${endMs}><P Class=KRCC>&nbsp;\n`;
  }

  output += `</BODY>\n</SAMI>\n`;
  return output;
}

function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * Serialize subtitle items based on specified format
 * @param {Array<{ id: number, start: number, end: number, text: string }>} items
 * @param {string} format - 'SRT', 'SMI', 'VTT'
 * @param {object} options
 * @returns {string}
 */
function serializeSubtitle(items, format = 'SRT', options = {}) {
  const normalizedFormat = (format || 'SRT').toUpperCase();
  switch (normalizedFormat) {
    case 'SMI':
      return toSMI(items, options.title);
    case 'VTT':
      return toVTT(items);
    case 'SRT':
    default:
      return toSRT(items);
  }
}

module.exports = {
  toSRT,
  toVTT,
  toSMI,
  serializeSubtitle
};

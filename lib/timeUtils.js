/**
 * Time utility functions for subtitle synchronization
 */

function pad(num, size = 2) {
  let s = Math.floor(Math.abs(num)).toString();
  while (s.length < size) s = '0' + s;
  return s;
}

/**
 * Convert seconds (float) to time string: HH:MM:SS,mmm or HH:MM:SS.mmm
 * @param {number} sec - Time in seconds
 * @param {string} delimiter - Millisecond delimiter (',' for SRT, '.' for VTT)
 * @returns {string} Formatted time string
 */
function secondsToTime(sec, delimiter = ',') {
  if (isNaN(sec) || sec === null || sec === undefined) return `00:00:00${delimiter}000`;
  const isNegative = sec < 0;
  let totalSec = Math.abs(sec);

  const hours = Math.floor(totalSec / 3600);
  totalSec %= 3600;
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.floor(totalSec % 60);
  const milliseconds = Math.round((totalSec - Math.floor(totalSec)) * 1000);

  const formatted = `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${delimiter}${pad(milliseconds, 3)}`;
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Convert time string (SRT, VTT, or plain seconds/ms) to seconds float
 * @param {string|number} timeStr
 * @returns {number} Seconds as float
 */
function timeToSeconds(timeStr) {
  if (typeof timeStr === 'number') return timeStr;
  if (!timeStr) return 0;

  const str = String(timeStr).trim();

  // If pure integer (likely SMI milliseconds)
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10) / 1000;
  }

  // Handle standard HH:MM:SS,mmm or HH:MM:SS.mmm or MM:SS.mmm
  const parts = str.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const secParts = parts[2].replace(',', '.');
    const seconds = parseFloat(secParts);
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]);
    const secParts = parts[1].replace(',', '.');
    const seconds = parseFloat(secParts);
    return minutes * 60 + seconds;
  } else if (parts.length === 1) {
    return parseFloat(parts[0].replace(',', '.')) || 0;
  }

  return 0;
}

module.exports = {
  secondsToTime,
  timeToSeconds
};

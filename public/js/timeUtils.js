/**
 * Client-side time utility helpers
 */

function pad(num, size = 2) {
  let s = Math.floor(Math.abs(num)).toString();
  while (s.length < size) s = '0' + s;
  return s;
}

function formatTime(sec, delimiter = '.') {
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

function parseTimeToSec(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const s = String(str).trim();

  const parts = s.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const sec = parseFloat(parts[2].replace(',', '.'));
    return h * 3600 + m * 60 + sec;
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0]);
    const sec = parseFloat(parts[1].replace(',', '.'));
    return m * 60 + sec;
  }
  return parseFloat(s.replace(',', '.')) || 0;
}

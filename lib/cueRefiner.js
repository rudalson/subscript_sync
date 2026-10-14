/**
 * Per-cue timing refinement: after global (linear) alignment, snap each subtitle's start to the
 * nearby speech onset that best agrees with how its neighbors moved. Cues without a convincing
 * onset (e.g. the second sentence inside one continuous speech run) follow their neighbors' shift.
 */

/**
 * Extract speech onset times (seconds) from a binary VAD. When per-bucket speech probabilities
 * are given, the onset is interpolated to where the probability crosses the threshold.
 * @param {Uint8Array} vad
 * @param {Float32Array|null} speechProb
 * @param {number} bucketsPerSec
 * @param {number} minRunBuckets speech runs shorter than this are not treated as onsets
 * @returns {number[]}
 */
function findSpeechOnsets(vad, speechProb, bucketsPerSec, minRunBuckets = 3) {
  const onsets = [];
  const crossing = 0.5;
  for (let i = 0; i < vad.length; i++) {
    if (vad[i] !== 1 || (i > 0 && vad[i - 1] === 1)) continue;

    let runEnd = i;
    while (runEnd < vad.length && vad[runEnd] === 1) runEnd++;
    if (runEnd - i < minRunBuckets) continue;

    // Bucket i spans [i, i+1); by default the onset is its start
    let t = i / bucketsPerSec;
    if (speechProb && i > 0) {
      const p0 = speechProb[i - 1];
      const p1 = speechProb[i];
      if (p1 > p0 && p0 < crossing && p1 >= crossing) {
        // Interpolate between bucket centers
        const frac = (crossing - p0) / (p1 - p0);
        t = (i - 0.5 + frac) / bucketsPerSec;
      }
    }
    onsets.push(t);
  }
  return onsets;
}

/**
 * Index of the first element >= value in a sorted array
 */
function lowerBound(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Refine individual cue timings against detected speech onsets.
 * @param {Array<{ id: number, start: number, end: number, text: string }>} items globally aligned cues
 * @param {Uint8Array} vad binary speech activity per bucket
 * @param {object} options
 * @returns {{ items: Array<{ id: number, start: number, end: number, text: string }>, stats: { snapped: number, followed: number, medianShift: number } }}
 */
function refineCueTimings(items, vad, options = {}) {
  const bucketsPerSec = options.bucketsPerSec || 10;
  const searchWindow = options.searchWindow !== undefined ? options.searchWindow : 1.5;   // seconds around current start
  const neighborRadius = options.neighborRadius || 5;                                    // cues on each side for the local trend
  const tolerance = options.tolerance !== undefined ? options.tolerance : 0.5;           // max deviation from local trend
  const minGap = options.minGap !== undefined ? options.minGap : 0.05;                   // gap kept between consecutive cues
  const onsets = findSpeechOnsets(vad, options.speechProb || null, bucketsPerSec);

  const order = items.map((_, i) => i).sort((a, b) => items[a].start - items[b].start);
  const cues = order.map(i => items[i]);
  const n = cues.length;

  // Candidate onset shifts for each cue, and the nearest one as a raw local estimate
  const candidates = cues.map(cue => {
    const from = lowerBound(onsets, cue.start - searchWindow);
    const shifts = [];
    for (let k = from; k < onsets.length && onsets[k] <= cue.start + searchWindow; k++) {
      shifts.push(onsets[k] - cue.start);
    }
    return shifts;
  });
  const nearest = candidates.map(shifts =>
    shifts.length === 0 ? null : shifts.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a))
  );

  // Local trend: median of neighbors' nearest shifts (robust to individual mismatches)
  const shifts = new Array(n);
  let snapped = 0;
  for (let i = 0; i < n; i++) {
    const neighborhood = [];
    for (let j = Math.max(0, i - neighborRadius); j <= Math.min(n - 1, i + neighborRadius); j++) {
      if (nearest[j] !== null) neighborhood.push(nearest[j]);
    }
    const trend = median(neighborhood);

    let best = null;
    for (const s of candidates[i]) {
      if (best === null || Math.abs(s - trend) < Math.abs(best - trend)) best = s;
    }
    if (best !== null && Math.abs(best - trend) <= tolerance) {
      shifts[i] = best;
      snapped++;
    } else {
      shifts[i] = trend;
    }
  }

  // Apply shifts keeping each cue's duration, then resolve ordering/overlaps introduced by the shift
  const refined = cues.map((cue, i) => ({ ...cue, start: cue.start + shifts[i], end: cue.end + shifts[i] }));
  for (let i = 1; i < n; i++) {
    const prev = refined[i - 1];
    const cur = refined[i];
    if (cur.start < prev.start + 0.1) {
      const delta = prev.start + 0.1 - cur.start;
      cur.start += delta;
      cur.end += delta;
    }
    // Only trim overlaps that the original timing did not have
    const originallyOverlapping = cues[i - 1].end > cues[i].start;
    if (!originallyOverlapping && prev.end > cur.start - minGap) {
      prev.end = Math.max(prev.start + 0.1, cur.start - minGap);
    }
  }

  const result = new Array(n);
  refined.forEach((cue, i) => {
    const start = Math.max(0, cue.start);
    result[order[i]] = {
      ...cue,
      start: Number(start.toFixed(3)),
      end: Number(Math.max(start + 0.1, cue.end).toFixed(3))
    };
  });

  return {
    items: result,
    stats: {
      snapped,
      followed: n - snapped,
      medianShift: Number(median(shifts.map(Math.abs)).toFixed(3))
    }
  };
}

module.exports = {
  refineCueTimings
};

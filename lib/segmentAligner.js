/**
 * Piecewise (segment-wise) alignment on top of a global linear sync.
 * Subtitles made for a different release often shift by several seconds partway through
 * (different logos/title sequence, cut scenes). Each cue gets an offset state; a Viterbi pass
 * finds the offset path that best matches speech activity while penalizing offset changes:
 * small gradual changes are cheap (drift), jumps cost a split penalty that is lowered across
 * long pauses between cues (scene changes, title cards) where cuts usually happen.
 */

/**
 * @param {Array<{ id: number, start: number, end: number, text: string }>} items globally aligned cues
 * @param {Uint8Array} vad binary speech activity per bucket
 * @param {object} options
 * @returns {{ items: Array<{ id: number, start: number, end: number, text: string }>, segments: Array<{ fromIndex: number, toIndex: number, startTime: number, offset: number }>, stats: { splits: number, maxAbsOffset: number } }}
 */
function alignSegments(items, vad, options = {}) {
  const bucketsPerSec = options.bucketsPerSec || 10;
  const maxShift = options.maxShift !== undefined ? options.maxShift : 10.0;    // seconds searched around global sync
  const step = options.step || 0.1;                                             // offset resolution (seconds)
  const splitPenalty = options.splitPenalty !== undefined ? options.splitPenalty : 60;
  const driftCost = options.driftCost !== undefined ? options.driftCost : 0.5; // per offset step for gradual change
  const driftSteps = options.driftSteps || 3;                                   // max steps per cue treated as drift
  const maxCueDur = options.maxCueDur || 5.0;
  const minSegmentShift = options.minSegmentShift !== undefined ? options.minSegmentShift : 0.5;

  const n = items.length;
  if (n === 0 || vad.length === 0) {
    return { items: items.map(it => ({ ...it })), segments: [], stats: { splits: 0, maxAbsOffset: 0 } };
  }

  // Prefix sum of mean-centered VAD: a cue's score = speech minus expected speech inside it
  const len = vad.length;
  let mean = 0;
  for (let i = 0; i < len; i++) mean += vad[i];
  mean /= len;
  const prefix = new Float64Array(len + 1);
  for (let i = 0; i < len; i++) prefix[i + 1] = prefix[i] + vad[i] - mean;
  const prefixAt = x => {
    if (x <= 0) return 0;
    if (x >= len) return prefix[len];
    const i = Math.floor(x);
    return prefix[i] + (x - i) * (vad[i] - mean);
  };

  const order = items.map((_, i) => i).sort((a, b) => items[a].start - items[b].start);
  const cues = order.map(i => items[i]);

  const K = Math.round((2 * maxShift) / step) + 1;
  const offsetOf = k => -maxShift + k * step;
  const back = new Int16Array(n * K);
  let prev = new Float64Array(K);
  let cur = new Float64Array(K);

  const emission = (cue, k) => {
    const d = offsetOf(k);
    const end = Math.min(cue.end, cue.start + maxCueDur);
    return prefixAt((end + d) * bucketsPerSec) - prefixAt((cue.start + d) * bucketsPerSec);
  };

  for (let k = 0; k < K; k++) prev[k] = emission(cues[0], k);

  for (let i = 1; i < n; i++) {
    let bestPrev = -Infinity;
    let bestPrevK = 0;
    for (let k = 0; k < K; k++) {
      if (prev[k] > bestPrev) { bestPrev = prev[k]; bestPrevK = k; }
    }

    // Jumps are cheaper across long pauses, where cuts between releases usually are
    const gap = cues[i].start - cues[i - 1].end;
    const penalty = splitPenalty * (gap >= 5 ? 0.25 : gap >= 2 ? 0.5 : 1);

    for (let k = 0; k < K; k++) {
      let best = bestPrev - penalty;
      let from = bestPrevK;
      for (let dk = -driftSteps; dk <= driftSteps; dk++) {
        const pk = k + dk;
        if (pk < 0 || pk >= K) continue;
        const v = prev[pk] - driftCost * Math.abs(dk);
        if (v > best) { best = v; from = pk; }
      }
      cur[k] = best + emission(cues[i], k);
      back[i * K + k] = from;
    }
    [prev, cur] = [cur, prev];
  }

  // Backtrack the best offset path
  const path = new Int16Array(n);
  let bestK = 0;
  for (let k = 1; k < K; k++) if (prev[k] > prev[bestK]) bestK = k;
  path[n - 1] = bestK;
  for (let i = n - 1; i > 0; i--) path[i - 1] = back[i * K + path[i]];

  // Smooth tiny jitter: the path is only meaningful at segment level, so take a running median
  const offsets = Array.from(path, offsetOf);
  const radius = options.smoothRadius || 3;
  const smoothed = offsets.map((_, i) => {
    const window = offsets.slice(Math.max(0, i - radius), i + radius + 1).sort((a, b) => a - b);
    return window[window.length >> 1];
  });

  // Report segments where the offset jumps (not gradual drift)
  const segments = [];
  let segStart = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || Math.abs(smoothed[i] - smoothed[i - 1]) >= minSegmentShift) {
      const segOffsets = smoothed.slice(segStart, i).sort((a, b) => a - b);
      segments.push({
        fromIndex: segStart,
        toIndex: i - 1,
        startTime: Number((cues[segStart].start + smoothed[segStart]).toFixed(3)),
        offset: Number(segOffsets[segOffsets.length >> 1].toFixed(2))
      });
      segStart = i;
    }
  }

  const result = new Array(n);
  cues.forEach((cue, i) => {
    const start = Math.max(0, cue.start + smoothed[i]);
    result[order[i]] = {
      ...cue,
      start: Number(start.toFixed(3)),
      end: Number(Math.max(start + 0.1, cue.end + smoothed[i]).toFixed(3))
    };
  });

  return {
    items: result,
    segments,
    stats: {
      splits: segments.length - 1,
      maxAbsOffset: Number(Math.max(...smoothed.map(Math.abs)).toFixed(2))
    }
  };
}

module.exports = {
  alignSegments
};

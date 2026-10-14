const { spawn } = require('child_process');
const { identifyFpsPattern } = require('./syncEngine');
const { SAMPLE_RATE: NEURAL_SAMPLE_RATE, createSileroStream, framesToBuckets } = require('./neuralVad');

// Bump when the extraction pipeline changes so cached envelopes are invalidated
const ANALYSIS_VERSION = 3;

// Speech band used to suppress low rumble (music bass, explosions) and high-frequency effects
const SPEECH_BAND = { low: 300, high: 3400 };

/**
 * Probe the first audio stream's channel layout using ffprobe
 * @param {string} videoPath
 * @returns {Promise<{ channels: number, layout: string }|null>}
 */
function probeAudioChannels(videoPath) {
  return new Promise(resolve => {
    const args = [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=channels,channel_layout',
      '-of', 'json',
      videoPath
    ];
    const proc = spawn('ffprobe', args, { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      try {
        const stream = JSON.parse(out).streams[0];
        if (!stream) return resolve(null);
        resolve({ channels: Number(stream.channels) || 0, layout: stream.channel_layout || '' });
      } catch (_) {
        resolve(null);
      }
    });
  });
}

/**
 * Build an FFmpeg audio filter that isolates the dialogue channel:
 * - Surround (has a front-center channel): take FC only, where film dialogue is mixed
 * - Stereo: take the mid (L+R) signal, which emphasizes center-panned dialogue
 * Band-passing is done afterwards in JS so the neural VAD still receives full-band speech.
 * @param {{ channels: number, layout: string }|null} audioInfo
 * @returns {{ filter: string|null, source: string }}
 */
function buildDialogueFilter(audioInfo) {
  const channels = audioInfo ? audioInfo.channels : 0;
  const layout = audioInfo ? audioInfo.layout : '';

  if (channels >= 3 && /^(3\.0|3\.1|4\.0|4\.1|5\.0|5\.1|6\.0|6\.1|7\.0|7\.1)/.test(layout)) {
    return { filter: 'pan=mono|c0=FC', source: `center (${layout})` };
  }
  if (channels === 2) {
    return { filter: 'pan=mono|c0=0.5*c0+0.5*c1', source: 'stereo mid' };
  }
  // Mono or unknown layout: let FFmpeg downmix
  return { filter: null, source: channels === 1 ? 'mono' : 'downmix' };
}

/**
 * Second-order (RBJ cookbook) biquad filter with persistent state for streaming
 * @param {'highpass'|'lowpass'} type
 * @param {number} freq
 * @param {number} sampleRate
 */
function createBiquad(type, freq, sampleRate) {
  const w0 = 2 * Math.PI * freq / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2); // Q = 0.707 (Butterworth)
  const a0 = 1 + alpha;
  const b0 = (type === 'highpass' ? (1 + cos) / 2 : (1 - cos) / 2) / a0;
  const b1 = (type === 'highpass' ? -(1 + cos) : 1 - cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    return y;
  };
}

/**
 * Collapse a per-bucket envelope into a fixed number of peak points for the UI waveform
 * @param {Float32Array} envelope
 * @returns {number[]}
 */
function buildWaveformOverview(envelope) {
  const totalBuckets = envelope.length;
  const overviewPoints = Math.min(1200, totalBuckets);
  const waveformOverview = [];
  if (totalBuckets === 0) return waveformOverview;
  const step = totalBuckets / overviewPoints;
  for (let i = 0; i < overviewPoints; i++) {
    const startIdx = Math.floor(i * step);
    const endIdx = Math.min(totalBuckets, Math.floor((i + 1) * step));
    let maxVal = 0;
    for (let j = startIdx; j < endIdx; j++) {
      if (envelope[j] > maxVal) maxVal = envelope[j];
    }
    waveformOverview.push(Number(maxVal.toFixed(3)));
  }
  return waveformOverview;
}

/**
 * Decode the dialogue channel once (16kHz mono) and derive, in a single streaming pass:
 * - speech-band RMS envelope (100ms buckets) for the waveform and energy-based VAD
 * - Silero VAD speech probability (100ms buckets) when the neural model is available
 * @param {string} videoPath
 * @param {{ neural?: boolean }} options
 * @returns {Promise<{ envelope: Float32Array, speechProb: Float32Array|null, vad: Uint8Array, vadSource: string, bucketDurationMs: number, bucketsPerSec: number, duration: number, waveformOverview: number[], audioSource: string }>}
 */
async function extractAudioEnvelope(videoPath, options = {}) {
  const audioInfo = await probeAudioChannels(videoPath);
  const { filter, source } = buildDialogueFilter(audioInfo);
  const silero = options.neural === false ? null : await createSileroStream();

  const sampleRate = NEURAL_SAMPLE_RATE; // 16000
  const bucketDurationMs = 100;
  const samplesPerBucket = (sampleRate * bucketDurationMs) / 1000; // 1600

  const ffmpegArgs = ['-nostdin', '-loglevel', 'error', '-i', videoPath, '-vn'];
  if (filter) ffmpegArgs.push('-af', filter);
  ffmpegArgs.push('-ac', '1', '-ar', String(sampleRate), '-f', 's16le', 'pipe:1');

  const proc = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });
  let stderrData = '';
  proc.stderr.on('data', data => { stderrData += data.toString(); });
  const exited = new Promise(resolve => {
    proc.on('error', err => resolve({ error: err }));
    proc.on('close', code => resolve({ code }));
  });

  const highpass = createBiquad('highpass', SPEECH_BAND.low, sampleRate);
  const lowpass = createBiquad('lowpass', SPEECH_BAND.high, sampleRate);
  const rmsBuckets = [];
  let sumSquares = 0;
  let bucketFill = 0;
  let leftover = null;
  let neuralQueue = Promise.resolve();
  let queuedSamples = 0;
  const maxQueuedSamples = sampleRate * 120; // at most ~2 minutes of audio waiting for the model

  for await (const chunk of proc.stdout) {
    const data = leftover ? Buffer.concat([leftover, chunk]) : chunk;
    const sampleCount = data.length >> 1;
    leftover = data.length & 1 ? Buffer.from(data.subarray(data.length - 1)) : null;

    // Typed-array view needs 2-byte alignment; copy only when the pooled buffer is misaligned
    const aligned = data.byteOffset & 1 ? Buffer.from(data.subarray(0, sampleCount * 2)) : data;
    const pcm = new Int16Array(aligned.buffer, aligned.byteOffset, sampleCount);
    const samples = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const s = pcm[i] / 32768.0;
      samples[i] = s;
      const band = lowpass(highpass(s));
      sumSquares += band * band;
      if (++bucketFill === samplesPerBucket) {
        rmsBuckets.push(Math.sqrt(sumSquares / samplesPerBucket));
        sumSquares = 0;
        bucketFill = 0;
      }
    }

    if (silero) {
      // Run inference concurrently with decoding; only wait (backpressure) when too much is queued
      queuedSamples += samples.length;
      neuralQueue = neuralQueue.then(() => silero.push(samples)).then(() => { queuedSamples -= samples.length; });
      if (queuedSamples > maxQueuedSamples) await neuralQueue;
    }
  }

  await neuralQueue;
  const result = await exited;
  if (result.error) throw new Error(`FFmpeg 실행 실패: ${result.error.message}`);
  if (result.code !== 0 && rmsBuckets.length === 0) {
    throw new Error(`FFmpeg 오디오 추출 오류 (code ${result.code}): ${stderrData}`);
  }

  const envelope = new Float32Array(rmsBuckets);
  const speechProb = silero
    ? framesToBuckets(await silero.finish(), bucketDurationMs, envelope.length)
    : null;

  return {
    envelope,
    speechProb,
    vad: speechProb ? computeNeuralVAD(speechProb) : computeVAD(envelope),
    vadSource: speechProb ? 'silero' : 'energy',
    bucketDurationMs,
    bucketsPerSec: 1000 / bucketDurationMs, // 10
    duration: envelope.length * (bucketDurationMs / 1000),
    waveformOverview: buildWaveformOverview(envelope),
    audioSource: source
  };
}

/**
 * Percentile of a numeric array (copies and sorts)
 * @param {ArrayLike<number>} values
 * @param {number} p 0.0 ~ 1.0
 */
function percentile(values, p) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * Perform Voice Activity Detection (VAD) on RMS envelope using a locally adaptive threshold.
 * A sliding noise floor (low percentile of the surrounding window) is estimated in dB so that
 * sustained music/ambience raises the floor and is not flagged, while quiet-scene dialogue
 * is still detected relative to its own surroundings.
 * Returns binary array (1 for speech, 0 for silence)
 * @param {Float32Array} envelope
 * @param {object} options
 * @returns {Uint8Array} vadSignal
 */
function computeVAD(envelope, options = {}) {
  const len = envelope.length;
  if (len === 0) return new Uint8Array(0);

  const windowBuckets = options.windowBuckets || 80; // ±8s neighborhood
  const gridStep = options.gridStep || 10;           // estimate floor every 1s, interpolate between
  const floorPercentile = options.floorPercentile !== undefined ? options.floorPercentile : 0.2;
  const onDb = options.onDb !== undefined ? options.onDb : 9;   // rise above floor to start speech
  const offDb = options.offDb !== undefined ? options.offDb : 5; // fall below this to end speech
  const minSpeechBuckets = options.minSpeechBuckets || 2;        // 200ms
  const maxGapBuckets = options.maxGapBuckets || 3;              // bridge gaps up to 300ms

  const db = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    db[i] = 20 * Math.log10(Math.max(envelope[i], 1e-5)); // floor at -100dB
  }

  // Global gate: anything near the overall quietest level is never speech
  const sampleStep = Math.max(1, Math.floor(len / 20000));
  const sampled = [];
  for (let i = 0; i < len; i += sampleStep) sampled.push(db[i]);
  const globalGate = percentile(sampled, 0.1) + 6;

  // Local noise floor on a coarse grid
  const gridCount = Math.ceil(len / gridStep) + 1;
  const gridFloor = new Float32Array(gridCount);
  for (let g = 0; g < gridCount; g++) {
    const center = Math.min(len - 1, g * gridStep);
    const from = Math.max(0, center - windowBuckets);
    const to = Math.min(len, center + windowBuckets + 1);
    gridFloor[g] = percentile(db.subarray(from, to), floorPercentile);
  }

  const vad = new Uint8Array(len);
  let active = false;
  for (let i = 0; i < len; i++) {
    const g = Math.floor(i / gridStep);
    const frac = (i - g * gridStep) / gridStep;
    const floor = gridFloor[g] + (gridFloor[Math.min(gridCount - 1, g + 1)] - gridFloor[g]) * frac;

    if (db[i] < globalGate) {
      active = false;
    } else if (active) {
      active = db[i] >= floor + offDb;
    } else {
      active = db[i] >= floor + onDb;
    }
    vad[i] = active ? 1 : 0;
  }

  return smoothVAD(vad, minSpeechBuckets, maxGapBuckets);
}

/**
 * Convert neural speech probabilities (per bucket) into a binary VAD with hysteresis
 * @param {Float32Array} speechProb
 * @param {object} options
 * @returns {Uint8Array}
 */
function computeNeuralVAD(speechProb, options = {}) {
  const onProb = options.onProb !== undefined ? options.onProb : 0.5;
  const offProb = options.offProb !== undefined ? options.offProb : 0.35;
  const len = speechProb.length;
  const vad = new Uint8Array(len);
  let active = false;
  for (let i = 0; i < len; i++) {
    active = active ? speechProb[i] >= offProb : speechProb[i] >= onProb;
    vad[i] = active ? 1 : 0;
  }
  return smoothVAD(vad, options.minSpeechBuckets || 2, options.maxGapBuckets || 3);
}

/**
 * Bridge short gaps and drop isolated blips (in place)
 * @param {Uint8Array} vad
 * @param {number} minSpeechBuckets
 * @param {number} maxGapBuckets
 * @returns {Uint8Array}
 */
function smoothVAD(vad, minSpeechBuckets, maxGapBuckets) {
  const len = vad.length;

  // Bridge short gaps between speech runs
  let lastOn = -1;
  for (let i = 0; i < len; i++) {
    if (vad[i] === 1) {
      if (lastOn >= 0 && i - lastOn - 1 > 0 && i - lastOn - 1 <= maxGapBuckets) {
        for (let j = lastOn + 1; j < i; j++) vad[j] = 1;
      }
      lastOn = i;
    }
  }

  // Remove isolated blips shorter than the minimum speech length
  let runStart = -1;
  for (let i = 0; i <= len; i++) {
    const on = i < len && vad[i] === 1;
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      if (i - runStart < minSpeechBuckets) {
        for (let j = runStart; j < i; j++) vad[j] = 0;
      }
      runStart = -1;
    }
  }

  return vad;
}

/**
 * In-place iterative radix-2 complex FFT
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @param {boolean} inverse
 */
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const ang = (inverse ? 2 : -2) * Math.PI / size;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let start = 0; start < n; start += size) {
      let cRe = 1;
      let cIm = 0;
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const tRe = re[b] * cRe - im[b] * cIm;
        const tIm = re[b] * cIm + im[b] * cRe;
        re[b] = re[a] - tRe; im[b] = im[a] - tIm;
        re[a] += tRe; im[a] += tIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = nRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

/**
 * Automatically find optimal scale factor and offset.
 * Score = normalized cross-correlation between the subtitle on/off mask and the mean-centered
 * VAD signal, so speech outside subtitles and silence inside subtitles both lower the score.
 * Coarse search evaluates every offset per scale via FFT; a fine 2D search then refines
 * scale and offset together around the best candidate.
 * @param {Float32Array} envelope
 * @param {Array<{ start: number, end: number }>} subtitles
 * @param {object} options
 * @returns {{ scale: number, offset: number, confidence: number, pattern: string, correlation: number, peakRatio: number }}
 */
function findOptimalSync(envelope, subtitles, options = {}) {
  if (!subtitles || subtitles.length === 0 || envelope.length === 0) {
    return { scale: 1.0, offset: 0.0, confidence: 0, pattern: '자막 또는 오디오 데이터 없음' };
  }

  const bucketsPerSec = 10; // 100ms buckets
  const vad = options.vad || computeVAD(envelope);
  const totalBuckets = vad.length;
  const videoDuration = totalBuckets / bucketsPerSec;

  // SMI cues have no explicit end (estimated from the next cue), so cap cue length to limit its influence
  const maxCueDur = options.maxCueDur || 5.0;
  const validSubs = subtitles
    .filter(s => s.end > s.start && s.end - s.start <= 10 && s.start < videoDuration * 1.5)
    .map(s => ({ start: s.start, end: Math.min(s.end, s.start + maxCueDur) }));

  if (validSubs.length === 0) {
    return { scale: 1.0, offset: 0.0, confidence: 0, pattern: '유효한 자막 대사 없음' };
  }

  // Mean-centered VAD: correlation with a 0/1 mask then equals covariance
  let vadMean = 0;
  for (let i = 0; i < totalBuckets; i++) vadMean += vad[i];
  vadMean /= totalBuckets;
  const vc = new Float64Array(totalBuckets);
  let vNorm = 0;
  for (let i = 0; i < totalBuckets; i++) {
    vc[i] = vad[i] - vadMean;
    vNorm += vc[i] * vc[i];
  }
  vNorm = Math.sqrt(vNorm) || 1;

  const minOffset = options.minOffset !== undefined ? options.minOffset : -600.0;
  const maxOffset = options.maxOffset !== undefined ? options.maxOffset : 600.0;
  const minLag = Math.round(minOffset * bucketsPerSec);
  const maxLag = Math.round(maxOffset * bucketsPerSec);

  // Candidate scale factors: standard framerate conversions + fine sweep around 1.0
  const scaleCandidates = new Set([
    1.0,
    25 / 23.976, 23.976 / 25,
    25 / 24, 24 / 25,
    24 / 23.976, 23.976 / 24,
    29.97 / 23.976, 23.976 / 29.97
  ]);
  for (let i = -50; i <= 50; i++) {
    scaleCandidates.add(Number((1 + i * 0.001).toFixed(6)));
  }
  // Ratios far from 1.0 (NTSC <-> Film speed-up) need their own fine sweep
  for (const ratio of [29.97 / 23.976, 23.976 / 29.97]) {
    for (let i = -5; i <= 5; i++) {
      scaleCandidates.add(Number((ratio + i * 0.001).toFixed(6)));
    }
  }

  const maxSubEnd = Math.max(...validSubs.map(s => s.end));
  const maxScale = Math.max(...scaleCandidates);
  const maskLen = Math.ceil(maxSubEnd * maxScale * bucketsPerSec) + 2;
  let fftSize = 1;
  while (fftSize < totalBuckets + maskLen + Math.max(Math.abs(minLag), Math.abs(maxLag))) fftSize <<= 1;

  // FFT of the centered VAD is shared by every scale
  const vRe = new Float64Array(fftSize);
  const vIm = new Float64Array(fftSize);
  vRe.set(vc);
  fft(vRe, vIm, false);

  const mRe = new Float64Array(fftSize);
  const mIm = new Float64Array(fftSize);

  let best = { score: -Infinity, scale: 1.0, lag: 0 };

  for (const scale of scaleCandidates) {
    mRe.fill(0);
    mIm.fill(0);
    let maskCount = 0;
    for (const sub of validSubs) {
      const k1 = Math.max(0, Math.floor(scale * sub.start * bucketsPerSec));
      const k2 = Math.min(maskLen - 1, Math.floor(scale * sub.end * bucketsPerSec));
      for (let k = k1; k <= k2; k++) {
        if (mRe[k] === 0) { mRe[k] = 1; maskCount++; }
      }
    }
    if (maskCount < 50) continue;

    fft(mRe, mIm, false);
    // corr[L] = sum_k m[k] * v[k + L]  ->  IFFT(conj(M) * V)
    for (let i = 0; i < fftSize; i++) {
      const re = mRe[i] * vRe[i] + mIm[i] * vIm[i];
      const im = mRe[i] * vIm[i] - mIm[i] * vRe[i];
      mRe[i] = re;
      mIm[i] = im;
    }
    fft(mRe, mIm, true);

    const norm = vNorm * Math.sqrt(maskCount);
    let localBest = -Infinity;
    let localLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const idx = lag >= 0 ? lag : fftSize + lag;
      const score = mRe[idx] / norm;
      if (score > localBest) {
        localBest = score;
        localLag = lag;
      }
    }

    // Prefer scales closer to 1.0 on (near) ties
    const tieBreak = Math.abs(scale - 1.0) < Math.abs(best.scale - 1.0);
    if (localBest > best.score + 1e-9 || (Math.abs(localBest - best.score) <= 1e-9 && tieBreak)) {
      best = { score: localBest, scale, lag: localLag };
    }
  }

  if (best.score <= 0) {
    return { scale: 1.0, offset: 0.0, confidence: 0, pattern: '오디오와 자막의 상관관계를 찾지 못함', correlation: 0, peakRatio: 1 };
  }

  // Fine 2D refinement (scale & offset) with sub-bucket precision using a prefix sum of centered VAD.
  // Parameterize around the median subtitle time so scale changes don't swing the offset.
  const prefix = new Float64Array(totalBuckets + 1);
  for (let i = 0; i < totalBuckets; i++) prefix[i + 1] = prefix[i] + vc[i];
  const prefixAt = x => {
    if (x <= 0) return 0;
    if (x >= totalBuckets) return prefix[totalBuckets];
    const i = Math.floor(x);
    return prefix[i] + (x - i) * vc[i];
  };

  const pivot = validSubs[Math.floor(validSubs.length / 2)].start;
  const evalFine = (scale, pivotTarget) => {
    let sum = 0;
    let len = 0;
    for (const sub of validSubs) {
      const x1 = (scale * (sub.start - pivot) + pivotTarget) * bucketsPerSec;
      const x2 = (scale * (sub.end - pivot) + pivotTarget) * bucketsPerSec;
      if (x2 <= 0 || x1 >= totalBuckets) continue;
      sum += prefixAt(x2) - prefixAt(x1);
      len += x2 - x1;
    }
    return len > 0 ? sum / (vNorm * Math.sqrt(len)) : -Infinity;
  };

  let bestScale = best.scale;
  let bestPivotTarget = best.scale * pivot + best.lag / bucketsPerSec;
  let fineScore = evalFine(bestScale, bestPivotTarget);
  const coarseScale = bestScale;
  const coarsePivotTarget = bestPivotTarget;
  for (let ds = -0.002; ds <= 0.002 + 1e-9; ds += 0.0001) {
    const scale = coarseScale + ds;
    for (let dt = -3.0; dt <= 3.0 + 1e-9; dt += 0.05) {
      const score = evalFine(scale, coarsePivotTarget + dt);
      if (score > fineScore + 1e-9) {
        fineScore = score;
        bestScale = scale;
        bestPivotTarget = coarsePivotTarget + dt;
      }
    }
  }
  const bestOffset = bestPivotTarget - bestScale * pivot;

  // Peak prominence at the refined scale: best peak vs. the strongest competing offset at least 3s away.
  // (Measured after refinement because a slightly wrong coarse scale smears the peak with drift.)
  // Only true local maxima count, so the main peak's own sloping shoulder is not mistaken for a rival.
  const exclusionSec = 3.0;
  const offsets = [];
  const scores = [];
  for (let offset = minOffset; offset <= maxOffset + 1e-9; offset += 1 / bucketsPerSec) {
    offsets.push(offset);
    scores.push(evalFine(bestScale, bestScale * pivot + offset));
  }
  let secondPeak = 0;
  for (let i = 1; i < scores.length - 1; i++) {
    if (Math.abs(offsets[i] - bestOffset) <= exclusionSec) continue;
    if (scores[i] >= scores[i - 1] && scores[i] >= scores[i + 1] && scores[i] > secondPeak) {
      secondPeak = scores[i];
    }
  }
  const peakRatio = fineScore > 0 ? secondPeak / fineScore : 1;

  // Confidence from peak prominence: a peak twice as strong as any competitor => 100%
  const confidence = Math.min(100, Math.max(0, Math.round((1 - peakRatio) * 200)));

  return {
    scale: Number(bestScale.toFixed(6)),
    offset: Number(bestOffset.toFixed(3)),
    confidence,
    pattern: identifyFpsPattern(bestScale),
    correlation: Number(fineScore.toFixed(4)),
    peakRatio: Number(peakRatio.toFixed(3))
  };
}

module.exports = {
  ANALYSIS_VERSION,
  probeAudioChannels,
  buildDialogueFilter,
  extractAudioEnvelope,
  computeVAD,
  computeNeuralVAD,
  findOptimalSync
};

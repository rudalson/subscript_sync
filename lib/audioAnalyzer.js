const { spawn } = require('child_process');
const { FPS_PRESETS, identifyFpsPattern } = require('./syncEngine');

/**
 * Extract audio RMS envelope from video file using FFmpeg
 * @param {string} videoPath
 * @param {object} options
 * @returns {Promise<{ envelope: Float32Array, sampleRate: number, duration: number, waveformOverview: number[] }>}
 */
function extractAudioEnvelope(videoPath, options = {}) {
  return new Promise((resolve, reject) => {
    // 8000Hz mono 16-bit PCM (little endian)
    // 800 samples = 100ms (10 buckets per second)
    const pcmSampleRate = 8000;
    const bucketDurationMs = 100;
    const samplesPerBucket = (pcmSampleRate * bucketDurationMs) / 1000; // 800 samples = 1600 bytes
    const bytesPerBucket = samplesPerBucket * 2;

    const ffmpegArgs = [
      '-nostdin',
      '-loglevel', 'error',
      '-i', videoPath,
      '-vn',
      '-ac', '1',
      '-ar', String(pcmSampleRate),
      '-f', 's16le',
      'pipe:1'
    ];

    const proc = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });

    let leftover = Buffer.alloc(0);
    const rmsBuckets = [];
    let totalSamplesRead = 0;

    proc.stdout.on('data', chunk => {
      const buffer = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk;
      let offset = 0;

      while (offset + bytesPerBucket <= buffer.length) {
        // Compute RMS for this 100ms bucket
        let sumSquares = 0;
        for (let i = 0; i < samplesPerBucket; i++) {
          const sample = buffer.readInt16LE(offset + i * 2);
          sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / samplesPerBucket) / 32768.0; // normalize 0.0 ~ 1.0
        rmsBuckets.push(rms);
        totalSamplesRead += samplesPerBucket;
        offset += bytesPerBucket;
      }

      leftover = buffer.slice(offset);
    });

    let stderrData = '';
    proc.stderr.on('data', data => {
      stderrData += data.toString();
    });

    proc.on('error', err => {
      reject(new Error(`FFmpeg 실행 실패: ${err.message}`));
    });

    proc.on('close', code => {
      if (code !== 0 && rmsBuckets.length === 0) {
        return reject(new Error(`FFmpeg 오디오 추출 오류 (code ${code}): ${stderrData}`));
      }

      const totalBuckets = rmsBuckets.length;
      const durationSec = totalBuckets * (bucketDurationMs / 1000);
      const envelope = new Float32Array(rmsBuckets);

      // Generate a simplified 1000-point overview for UI waveform rendering
      const overviewPoints = Math.min(1200, totalBuckets);
      const waveformOverview = [];
      if (totalBuckets > 0) {
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
      }

      resolve({
        envelope,
        bucketDurationMs,
        bucketsPerSec: 1000 / bucketDurationMs, // 10
        duration: durationSec,
        waveformOverview
      });
    });
  });
}

/**
 * Perform Voice Activity Detection (VAD) on RMS envelope
 * Returns binary array (1 for speech, 0 for silence)
 * @param {Float32Array} envelope
 * @returns {Uint8Array} vadSignal
 */
function computeVAD(envelope) {
  const len = envelope.length;
  if (len === 0) return new Uint8Array(0);

  // Compute stats: sorted percentiles for adaptive threshold
  const sampleCount = Math.min(len, 20000);
  const sampleStep = Math.max(1, Math.floor(len / sampleCount));
  const samples = [];
  for (let i = 0; i < len; i += sampleStep) {
    samples.push(envelope[i]);
  }
  samples.sort((a, b) => a - b);

  const p25 = samples[Math.floor(samples.length * 0.25)] || 0;
  const p75 = samples[Math.floor(samples.length * 0.75)] || 0.05;
  const p95 = samples[Math.floor(samples.length * 0.95)] || 0.2;

  // Adaptive voice threshold
  const threshold = Math.max(0.015, p25 + (p75 - p25) * 0.7);

  const vad = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    vad[i] = envelope[i] >= threshold ? 1 : 0;
  }

  // Smooth VAD: bridge short gaps (< 300ms = 3 buckets)
  for (let i = 1; i < len - 2; i++) {
    if (vad[i] === 0 && vad[i - 1] === 1 && (vad[i + 1] === 1 || vad[i + 2] === 1)) {
      vad[i] = 1;
    }
  }

  return vad;
}

/**
 * Precompute prefix sum of VAD array for O(1) interval queries
 * @param {Uint8Array} vad
 * @returns {Int32Array}
 */
function computePrefixSum(vad) {
  const prefix = new Int32Array(vad.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < vad.length; i++) {
    prefix[i + 1] = prefix[i] + vad[i];
  }
  return prefix;
}

/**
 * Automatically find optimal scale factor and offset using normalized cross-correlation
 * @param {Float32Array} envelope
 * @param {Array<{ start: number, end: number }>} subtitles
 * @param {object} options
 * @returns {{ scale: number, offset: number, confidence: number, pattern: string }}
 */
function findOptimalSync(envelope, subtitles, options = {}) {
  if (!subtitles || subtitles.length === 0 || envelope.length === 0) {
    return { scale: 1.0, offset: 0.0, confidence: 0, pattern: '자막 또는 오디오 데이터 없음' };
  }

  const bucketsPerSec = 10; // 100ms buckets
  const vad = computeVAD(envelope);
  const prefix = computePrefixSum(vad);
  const totalBuckets = vad.length;
  const videoDuration = totalBuckets / bucketsPerSec;

  // Select reliable subtitle cues (filter very short cues or cues beyond reasonable video length)
  const validSubs = subtitles
    .filter(s => s.end > s.start && s.end - s.start <= 10 && s.start < videoDuration * 1.5)
    .map(s => ({
      start: s.start,
      end: s.end,
      dur: s.end - s.start
    }));

  if (validSubs.length === 0) {
    return { scale: 1.0, offset: 0.0, confidence: 0, pattern: '유효한 자막 대사 없음' };
  }

  // Candidate scale factors to test:
  // Standard framerate conversion ratios + small sweep
  const scaleCandidates = new Set([
    1.0,
    25 / 23.976,       // ~1.042709 (PAL -> NTSC)
    23.976 / 25,       // ~0.959040 (NTSC -> PAL)
    25 / 24,          // ~1.041667 (PAL -> 24p)
    24 / 25,          // 0.960000 (24p -> PAL)
    24 / 23.976,       // ~1.001001 (Film -> NTSC)
    23.976 / 24,       // ~0.999000 (NTSC -> Film)
    29.97 / 23.976,
    23.976 / 29.97
  ]);

  // Fine-grain exploration around 1.0 (between 0.950 and 1.050 with 0.005 step)
  for (let s = 0.955; s <= 1.045; s += 0.005) {
    scaleCandidates.add(Number(s.toFixed(6)));
  }

  // Offset search range (default: -45s to +45s in 0.2s steps)
  const minOffset = options.minOffset !== undefined ? options.minOffset : -45.0;
  const maxOffset = options.maxOffset !== undefined ? options.maxOffset : 45.0;
  const offsetStep = options.offsetStep !== undefined ? options.offsetStep : 0.2;

  let bestScore = -1;
  let bestScale = 1.0;
  let bestOffset = 0.0;

  for (const scale of scaleCandidates) {
    for (let offset = minOffset; offset <= maxOffset; offset += offsetStep) {
      let overlapBuckets = 0;
      let totalSubBuckets = 0;

      for (let i = 0; i < validSubs.length; i++) {
        const sub = validSubs[i];
        const vStart = scale * sub.start + offset;
        const vEnd = scale * sub.end + offset;

        if (vEnd < 0 || vStart >= videoDuration) continue;

        const k1 = Math.max(0, Math.floor(vStart * bucketsPerSec));
        const k2 = Math.min(totalBuckets - 1, Math.floor(vEnd * bucketsPerSec));

        if (k2 >= k1) {
          const speechCount = prefix[k2 + 1] - prefix[k1];
          overlapBuckets += speechCount;
          totalSubBuckets += (k2 - k1 + 1);
        }
      }

      if (totalSubBuckets > 50) {
        const score = overlapBuckets / totalSubBuckets;
        if (score > bestScore) {
          bestScore = score;
          bestScale = scale;
          bestOffset = offset;
        }
      }
    }
  }

  // Refine best offset around bestScale with higher resolution (0.05s steps)
  if (bestScore > 0) {
    const fineStart = bestOffset - 1.0;
    const fineEnd = bestOffset + 1.0;
    for (let offset = fineStart; offset <= fineEnd; offset += 0.05) {
      let overlapBuckets = 0;
      let totalSubBuckets = 0;

      for (let i = 0; i < validSubs.length; i++) {
        const sub = validSubs[i];
        const vStart = bestScale * sub.start + offset;
        const vEnd = bestScale * sub.end + offset;

        if (vEnd < 0 || vStart >= videoDuration) continue;

        const k1 = Math.max(0, Math.floor(vStart * bucketsPerSec));
        const k2 = Math.min(totalBuckets - 1, Math.floor(vEnd * bucketsPerSec));

        if (k2 >= k1) {
          overlapBuckets += (prefix[k2 + 1] - prefix[k1]);
          totalSubBuckets += (k2 - k1 + 1);
        }
      }

      if (totalSubBuckets > 50) {
        const score = overlapBuckets / totalSubBuckets;
        if (score > bestScore) {
          bestScore = score;
          bestOffset = offset;
        }
      }
    }
  }

  // Calculate confidence percentage (0 to 100)
  const confidence = Math.min(100, Math.max(0, Math.round(bestScore * 140)));

  return {
    scale: Number(bestScale.toFixed(6)),
    offset: Number(bestOffset.toFixed(3)),
    confidence,
    pattern: identifyFpsPattern(bestScale)
  };
}

module.exports = {
  extractAudioEnvelope,
  computeVAD,
  findOptimalSync
};

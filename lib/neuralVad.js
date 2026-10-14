const fs = require('fs');
const path = require('path');

/**
 * Silero VAD (ONNX) speech probability estimator.
 * Audio is consumed as a stream; to keep inference fast, each block of audio is split into
 * many independent rows that run as one batch (the model is stateful per row). Every row is
 * preceded by a short warm-up taken from the preceding audio so its recurrent state settles
 * before its own frames are scored.
 */

const MODEL_PATH = path.join(__dirname, '..', 'models', 'silero_vad.onnx');
const SAMPLE_RATE = 16000;
const FRAME = 512;          // 32ms per frame at 16kHz
const CONTEXT = 64;         // samples of the previous frame prepended to each input (Silero v5)
const ROW_FRAMES = 78;      // ~2.5s of audio per batch row
const WARMUP_FRAMES = 16;   // ~0.5s warm-up per row
const BATCH_ROWS = 256;     // rows per block (~640s of audio per block, ~40MB buffer)

let sessionPromise = null;

/**
 * Lazily load onnxruntime and the Silero model. Resolves to null when unavailable
 * so callers can fall back to energy-based VAD.
 * @returns {Promise<{ ort: object, session: object }|null>}
 */
function loadSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      try {
        if (!fs.existsSync(MODEL_PATH)) return null;
        const ort = require('onnxruntime-node');
        const session = await ort.InferenceSession.create(MODEL_PATH);
        return { ort, session };
      } catch (err) {
        console.warn(`[neuralVad] Silero VAD 사용 불가, 에너지 기반 VAD로 대체: ${err.message}`);
        return null;
      }
    })();
  }
  return sessionPromise;
}

/**
 * Streaming speech probability estimator for 16kHz mono float samples.
 * Usage: await push(samples) repeatedly, then await finish() → per-frame probabilities.
 */
class SileroStream {
  constructor(runtime) {
    this.ort = runtime.ort;
    this.session = runtime.session;
    this.blockFrames = ROW_FRAMES * BATCH_ROWS;
    this.lookbehind = WARMUP_FRAMES * FRAME + CONTEXT;
    this.buf = new Float32Array(this.lookbehind + this.blockFrames * FRAME);
    this.bufLen = this.lookbehind; // leading zeros act as warm-up for the very first rows
    this.probs = [];
    this.sr = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
  }

  /**
   * @param {Float32Array} samples
   */
  async push(samples) {
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(samples.length - offset, this.buf.length - this.bufLen);
      this.buf.set(samples.subarray(offset, offset + take), this.bufLen);
      this.bufLen += take;
      offset += take;
      if (this.bufLen === this.buf.length) {
        await this.runBlock(this.blockFrames);
        // Keep the tail as look-behind for the next block
        this.buf.copyWithin(0, this.buf.length - this.lookbehind);
        this.bufLen = this.lookbehind;
      }
    }
  }

  /**
   * @returns {Promise<Float32Array>} speech probability per 32ms frame
   */
  async finish() {
    const remaining = this.bufLen - this.lookbehind;
    if (remaining > 0) {
      const frames = Math.ceil(remaining / FRAME);
      this.buf.fill(0, this.bufLen);
      await this.runBlock(frames);
    }
    return Float32Array.from(this.probs);
  }

  /**
   * Score `frames` frames that start right after the look-behind region of the buffer.
   * @param {number} frames
   */
  async runBlock(frames) {
    const rows = Math.ceil(frames / ROW_FRAMES);
    const width = CONTEXT + FRAME;
    const steps = WARMUP_FRAMES + ROW_FRAMES;
    const input = new Float32Array(rows * width);
    let state = new this.ort.Tensor('float32', new Float32Array(2 * rows * 128), [2, rows, 128]);
    const rowProbs = new Float32Array(rows * ROW_FRAMES);

    for (let step = 0; step < steps; step++) {
      for (let r = 0; r < rows; r++) {
        // Sample index in buf where this row's frame (incl. warm-up) begins; context precedes it
        const frameStart = this.lookbehind + (r * ROW_FRAMES + step - WARMUP_FRAMES) * FRAME;
        input.set(this.buf.subarray(frameStart - CONTEXT, frameStart + FRAME), r * width);
      }
      const out = await this.session.run({
        input: new this.ort.Tensor('float32', input, [rows, width]),
        state,
        sr: this.sr
      });
      state = out.stateN;
      if (step >= WARMUP_FRAMES) {
        const data = out.output.data;
        for (let r = 0; r < rows; r++) rowProbs[r * ROW_FRAMES + step - WARMUP_FRAMES] = data[r];
      }
    }

    for (let i = 0; i < frames; i++) this.probs.push(rowProbs[i]);
  }
}

/**
 * Create a streaming estimator, or null when Silero VAD is unavailable
 * @returns {Promise<SileroStream|null>}
 */
async function createSileroStream() {
  const runtime = await loadSession();
  return runtime ? new SileroStream(runtime) : null;
}

/**
 * Average per-frame probabilities into fixed-duration buckets
 * @param {Float32Array} frameProbs
 * @param {number} bucketDurationMs
 * @param {number} bucketCount
 * @returns {Float32Array}
 */
function framesToBuckets(frameProbs, bucketDurationMs, bucketCount) {
  const sums = new Float32Array(bucketCount);
  const counts = new Uint16Array(bucketCount);
  const frameSec = FRAME / SAMPLE_RATE;
  for (let i = 0; i < frameProbs.length; i++) {
    const center = (i + 0.5) * frameSec;
    const b = Math.floor(center * 1000 / bucketDurationMs);
    if (b >= bucketCount) break;
    sums[b] += frameProbs[i];
    counts[b]++;
  }
  for (let b = 0; b < bucketCount; b++) {
    sums[b] = counts[b] > 0 ? sums[b] / counts[b] : (b > 0 ? sums[b - 1] : 0);
  }
  return sums;
}

module.exports = {
  SAMPLE_RATE,
  createSileroStream,
  framesToBuckets
};

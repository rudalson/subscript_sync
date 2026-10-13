/**
 * Mathematical synchronization engine for subtitle timing adjustment
 */

const FPS_PRESETS = [
  { name: 'PAL (25fps) → NTSC/Film (23.976fps)', ratio: 25 / 23.976, tolerance: 0.004 },
  { name: 'NTSC/Film (23.976fps) → PAL (25fps)', ratio: 23.976 / 25, tolerance: 0.004 },
  { name: 'PAL (25fps) → Film (24fps)', ratio: 25 / 24, tolerance: 0.003 },
  { name: 'Film (24fps) → PAL (25fps)', ratio: 24 / 25, tolerance: 0.003 },
  { name: 'Film (24fps) → NTSC (23.976fps)', ratio: 24 / 23.976, tolerance: 0.0015 },
  { name: 'NTSC (23.976fps) → Film (24fps)', ratio: 23.976 / 24, tolerance: 0.0015 },
  { name: '동일 프레임레이트 (1:1 동일 속도)', ratio: 1.0, tolerance: 0.0005 }
];

/**
 * Identify likely framerate conversion pattern based on scale factor
 * @param {number} scale
 * @returns {string} Human-readable description
 */
function identifyFpsPattern(scale) {
  for (const preset of FPS_PRESETS) {
    if (Math.abs(scale - preset.ratio) <= preset.tolerance) {
      return preset.name;
    }
  }
  const pct = ((scale - 1.0) * 100).toFixed(3);
  return `사용자 정의 배율 (${pct > 0 ? '+' : ''}${pct}%)`;
}

/**
 * Calculate scale (alpha) and offset (beta) from two sync points
 * @param {{ subTime: number, videoTime: number }} p1
 * @param {{ subTime: number, videoTime: number }} p2
 * @returns {{ scale: number, offset: number, pattern: string, driftPer10Min: number }}
 */
function calculateTwoPointParameters(p1, p2) {
  if (!p1 || !p2) {
    throw new Error('두 개의 기준점이 모두 필요합니다.');
  }

  const s1 = Number(p1.subTime);
  const v1 = Number(p1.videoTime);
  const s2 = Number(p2.subTime);
  const v2 = Number(p2.videoTime);

  if (isNaN(s1) || isNaN(v1) || isNaN(s2) || isNaN(v2)) {
    throw new Error('기준점의 시간 값이 유효하지 않습니다.');
  }

  const subDiff = s2 - s1;
  if (Math.abs(subDiff) < 0.1) {
    throw new Error('두 자막 기준점의 시간 차이가 너무 가깝습니다. 최소 10초 이상 떨어진 지점을 지정하세요.');
  }

  const videoDiff = v2 - v1;
  const scale = videoDiff / subDiff;
  const offset = v1 - (scale * s1);

  // Time drift per 10 minutes (600 seconds)
  const driftPer10Min = (scale - 1.0) * 600;

  return {
    scale: Number(scale.toFixed(6)),
    offset: Number(offset.toFixed(3)),
    pattern: identifyFpsPattern(scale),
    driftPer10Min: Number(driftPer10Min.toFixed(2))
  };
}

/**
 * Apply linear transformation (t' = scale * t + offset) to subtitle items
 * @param {Array<{ id: number, start: number, end: number, text: string }>} items
 * @param {number} scale
 * @param {number} offset
 * @param {{ startIndex?: number, endIndex?: number, startTime?: number, endTime?: number }|null} range
 * @returns {Array<{ id: number, start: number, end: number, text: string }>}
 */
function applyLinearSync(items, scale, offset, range = null) {
  return items.map((item, idx) => {
    let shouldApply = true;

    if (range) {
      if (range.startIndex !== undefined && idx < range.startIndex) shouldApply = false;
      if (range.endIndex !== undefined && idx > range.endIndex) shouldApply = false;
      if (range.startTime !== undefined && item.start < range.startTime) shouldApply = false;
      if (range.endTime !== undefined && item.start > range.endTime) shouldApply = false;
    }

    if (!shouldApply) {
      return { ...item };
    }

    const newStart = Math.max(0, scale * item.start + offset);
    const newEnd = Math.max(newStart + 0.1, scale * item.end + offset);

    return {
      ...item,
      start: Number(newStart.toFixed(3)),
      end: Number(newEnd.toFixed(3))
    };
  });
}

/**
 * Shift subtitle times by delta seconds
 * @param {Array<{ id: number, start: number, end: number, text: string }>} items
 * @param {number} deltaSeconds
 * @param {object|null} range
 * @returns {Array<{ id: number, start: number, end: number, text: string }>}
 */
function applyShiftOffset(items, deltaSeconds, range = null) {
  return applyLinearSync(items, 1.0, deltaSeconds, range);
}

/**
 * Apply multiple segment transformations
 * @param {Array<{ id: number, start: number, end: number, text: string }>} items
 * @param {Array<{ startIndex: number, endIndex: number, scale: number, offset: number }>} segments
 * @returns {Array<{ id: number, start: number, end: number, text: string }>}
 */
function applySegmentedSync(items, segments) {
  let result = items.map(item => ({ ...item }));

  for (const seg of segments) {
    const scale = seg.scale !== undefined ? seg.scale : 1.0;
    const offset = seg.offset !== undefined ? seg.offset : 0.0;
    result = applyLinearSync(result, scale, offset, {
      startIndex: seg.startIndex,
      endIndex: seg.endIndex
    });
  }

  return result;
}

module.exports = {
  FPS_PRESETS,
  identifyFpsPattern,
  calculateTwoPointParameters,
  applyLinearSync,
  applyShiftOffset,
  applySegmentedSync
};

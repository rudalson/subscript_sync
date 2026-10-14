/**
 * Mathematical synchronization engine for subtitle timing adjustment.
 * Shared by the server (CommonJS) and the browser (window.SyncEngine), so both sides
 * use the same framerate presets, pattern names and timing math.
 */
(function (factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    window.SyncEngine = factory();
  }
})(function () {
  const FPS_PRESETS = [
    { id: 'pal-to-ntsc', name: 'PAL (25fps) → NTSC/Film (23.976fps)', ratio: 25 / 23.976, tolerance: 0.004 },
    { id: 'ntsc-to-pal', name: 'NTSC/Film (23.976fps) → PAL (25fps)', ratio: 23.976 / 25, tolerance: 0.004 },
    { id: 'pal-to-film', name: 'PAL (25fps) → Film (24fps)', ratio: 25 / 24, tolerance: 0.003 },
    { id: 'film-to-pal', name: 'Film (24fps) → PAL (25fps)', ratio: 24 / 25, tolerance: 0.003 },
    { id: 'film-to-ntsc', name: 'Film (24fps) → NTSC (23.976fps)', ratio: 24 / 23.976, tolerance: 0.0015 },
    { id: 'ntsc-to-film', name: 'NTSC (23.976fps) → Film (24fps)', ratio: 23.976 / 24, tolerance: 0.0015 },
    { id: 'same', name: '동일 프레임레이트 (1:1 동일 속도)', ratio: 1.0, tolerance: 0.0005 }
  ];

  /**
   * Identify likely framerate conversion pattern based on scale factor
   * @param {number} scale
   * @returns {string} Human-readable description
   */
  function identifyFpsPattern(scale) {
    // Tolerances overlap near 1.0 (e.g. 24/23.976), so pick the closest matching preset
    let match = null;
    for (const preset of FPS_PRESETS) {
      const diff = Math.abs(scale - preset.ratio);
      if (diff <= preset.tolerance && (!match || diff < Math.abs(scale - match.ratio))) {
        match = preset;
      }
    }
    if (match) return match.name;
    const pct = ((scale - 1.0) * 100).toFixed(3);
    return `사용자 정의 배율 (${pct > 0 ? '+' : ''}${pct}%)`;
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

  return {
    FPS_PRESETS,
    identifyFpsPattern,
    applyLinearSync,
    applyShiftOffset
  };
});

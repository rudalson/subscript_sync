/**
 * SubSync Studio - Frontend Application Logic
 */

// Application State
const state = {
  subtitles: [],
  filteredSubtitles: [],
  videoMeta: null,
  subMeta: null,
  undoStack: [],
  redoStack: [],
  selectedIndex: -1,
  p1: { videoTime: null, subTime: null },
  p2: { videoTime: null, subTime: null },
  totalOffset: 0,
  waveformOverview: [],
  autoSyncResult: null,
  activeCueIndex: -1,
  isPlaying: false
};

// DOM Elements
const video = document.getElementById('videoPlayer');
const videoBox = document.getElementById('videoBox');
const videoPlaceholder = document.getElementById('videoPlaceholder');
const subOverlay = document.getElementById('subOverlay');
const subTextDisplay = document.getElementById('subTextDisplay');

const seekBar = document.getElementById('seekBar');
const timecodeDisplay = document.getElementById('timecodeDisplay');
const btnPlayPause = document.getElementById('btnPlayPause');
const btnStepBack = document.getElementById('btnStepBack');
const btnStepForward = document.getElementById('btnStepForward');
const btnBack5s = document.getElementById('btnBack5s');
const btnFwd5s = document.getElementById('btnFwd5s');
const playbackRateSelect = document.getElementById('playbackRateSelect');
const btnVolume = document.getElementById('btnVolume');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');

const paneResizer = document.getElementById('paneResizer');
const leftPane = document.querySelector('.left-pane');
const appContainer = document.querySelector('.app-container');

const waveformCanvas = document.getElementById('waveformCanvas');
const timelineContainer = document.getElementById('timelineContainer');
const timelinePlayhead = document.getElementById('timelinePlayhead');

const totalOffsetBadge = document.getElementById('totalOffsetBadge');
const btnResetOffset = document.getElementById('btnResetOffset');

// Status Chips & Meta
const videoStatusChip = document.getElementById('videoStatusChip');
const subStatusChip = document.getElementById('subStatusChip');
const videoFilename = document.getElementById('videoFilename');
const subFilename = document.getElementById('subFilename');
const subMetaInfo = document.getElementById('subMetaInfo');
const subCountBadge = document.getElementById('subCountBadge');
const subFontSizeSelect = document.getElementById('subFontSizeSelect');

// Header Buttons
const btnUndo = document.getElementById('btnUndo');
const btnRedo = document.getElementById('btnRedo');
const btnLoadFiles = document.getElementById('btnLoadFiles');
const btnSaveSubtitle = document.getElementById('btnSaveSubtitle');
const btnDownloadSubtitle = document.getElementById('btnDownloadSubtitle');

// Subtitle Table
const subTable = document.getElementById('subTable');
const subTableBody = document.getElementById('subTableBody');
const subSearchInput = document.getElementById('subSearchInput');

// 2-Point Calibration Tab
const p1VideoInput = document.getElementById('p1VideoTime');
const p1SubInput = document.getElementById('p1SubTime');
const p2VideoInput = document.getElementById('p2VideoTime');
const p2SubInput = document.getElementById('p2SubTime');
const p1Status = document.getElementById('p1Status');
const p2Status = document.getElementById('p2Status');
const twoPointScale = document.getElementById('twoPointScale');
const twoPointOffset = document.getElementById('twoPointOffset');
const twoPointPattern = document.getElementById('twoPointPattern');
const twoPointDrift = document.getElementById('twoPointDrift');
const btnApplyTwoPoint = document.getElementById('btnApplyTwoPoint');
const btnSetP1Video = document.getElementById('btnSetP1Video');
const btnSetP1Sub = document.getElementById('btnSetP1Sub');
const btnSetP2Video = document.getElementById('btnSetP2Video');
const btnSetP2Sub = document.getElementById('btnSetP2Sub');

// Auto-Sync Tab
const btnRunAutoSync = document.getElementById('btnRunAutoSync');
const autoSyncProgressText = document.getElementById('autoSyncProgressText');
const autoSyncResultBox = document.getElementById('autoSyncResultBox');
const autoConfidence = document.getElementById('autoConfidence');
const autoScale = document.getElementById('autoScale');
const autoOffset = document.getElementById('autoOffset');
const autoPattern = document.getElementById('autoPattern');
const btnApplyAutoSync = document.getElementById('btnApplyAutoSync');

// Segment Sync Tab
const segSelectedId = document.getElementById('segSelectedId');
const segCustomShiftInput = document.getElementById('segCustomShiftInput');
const btnApplySegCustom = document.getElementById('btnApplySegCustom');

// Modals
const fileModal = document.getElementById('fileModal');
const saveModal = document.getElementById('saveModal');
const subFileInput = document.getElementById('subFileInput');
const videoFileInput = document.getElementById('videoFileInput');
const toastContainer = document.getElementById('toastContainer');

/* =========================================================
   Toast Notifications
   ========================================================= */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'error' ? '❌' : (type === 'success' ? '✅' : 'ℹ️')}</span> <span>${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/* =========================================================
   History Management (Undo / Redo)
   ========================================================= */
function pushHistory() {
  state.undoStack.push(JSON.parse(JSON.stringify(state.subtitles)));
  state.redoStack = [];
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  btnUndo.disabled = state.undoStack.length === 0;
  btnRedo.disabled = state.redoStack.length === 0;
}

btnUndo.addEventListener('click', () => {
  if (state.undoStack.length === 0) return;
  state.redoStack.push(JSON.parse(JSON.stringify(state.subtitles)));
  state.subtitles = state.undoStack.pop();
  renderSubtitleTable();
  drawWaveform();
  updateUndoRedoButtons();
  showToast('이전 상태로 되돌렸습니다 (Undo)', 'info');
});

btnRedo.addEventListener('click', () => {
  if (state.redoStack.length === 0) return;
  state.undoStack.push(JSON.parse(JSON.stringify(state.subtitles)));
  state.subtitles = state.redoStack.pop();
  renderSubtitleTable();
  drawWaveform();
  updateUndoRedoButtons();
  showToast('다시 실행했습니다 (Redo)', 'info');
});

/* =========================================================
   Tab Navigation
   ========================================================= */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    document.getElementById(tabId).classList.add('active');
  });
});

/* =========================================================
   Video Player Events & Controls
   ========================================================= */
function initPlayer() {
  video.addEventListener('timeupdate', () => {
    const cur = video.currentTime;
    const dur = video.duration || 0;

    // Update timecode
    timecodeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;

    // Update seek bar
    if (dur > 0 && !seekBar.matches(':active')) {
      seekBar.value = (cur / dur) * 100;
    }

    // Update playhead on waveform
    updatePlayhead(cur, dur);

    // Update Subtitle Overlay & Table Active Row
    updateSubtitleOverlay(cur);
  });

  video.addEventListener('loadedmetadata', () => {
    videoPlaceholder.style.display = 'none';
    seekBar.value = 0;
    timecodeDisplay.textContent = `00:00:00.000 / ${formatTime(video.duration)}`;
    drawWaveform();
  });

  video.addEventListener('play', () => {
    state.isPlaying = true;
    btnPlayPause.textContent = '⏸ 일시정지';
  });

  video.addEventListener('pause', () => {
    state.isPlaying = false;
    btnPlayPause.textContent = '▶ 재생';
  });

  btnPlayPause.addEventListener('click', togglePlay);

  seekBar.addEventListener('input', () => {
    if (video.duration) {
      video.currentTime = (seekBar.value / 100) * video.duration;
    }
  });

  btnStepBack.addEventListener('click', () => {
    video.currentTime = Math.max(0, video.currentTime - 0.04);
  });

  btnStepForward.addEventListener('click', () => {
    video.currentTime = Math.min(video.duration || 0, video.currentTime + 0.04);
  });

  btnBack5s.addEventListener('click', () => {
    video.currentTime = Math.max(0, video.currentTime - 5.0);
  });

  btnFwd5s.addEventListener('click', () => {
    video.currentTime = Math.min(video.duration || 0, video.currentTime + 5.0);
  });

  playbackRateSelect.addEventListener('change', () => {
    video.playbackRate = parseFloat(playbackRateSelect.value);
  });

  // Volume Controls
  initVolumeControls();
}

let savedVolume = 1.0;

function initVolumeControls() {
  setVolume(1.0);

  volumeSlider.addEventListener('input', () => {
    setVolume(parseFloat(volumeSlider.value));
  });

  btnVolume.addEventListener('click', toggleMute);

  // Wheel to adjust volume on volume box
  const volBox = document.querySelector('.volume-box');
  if (volBox) {
    volBox.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.deltaY < 0 ? 0.05 : -0.05;
      setVolume(video.volume + step);
    }, { passive: false });
  }
}

function setVolume(val) {
  val = Math.max(0, Math.min(1, val));
  video.volume = val;
  volumeSlider.value = val;
  volumeValue.textContent = `${Math.round(val * 100)}%`;

  if (val === 0) {
    btnVolume.textContent = '🔇';
    btnVolume.title = '음소거 해제 (M)';
  } else if (val < 0.5) {
    btnVolume.textContent = '🔉';
    btnVolume.title = '음소거 토글 (M)';
  } else {
    btnVolume.textContent = '🔊';
    btnVolume.title = '음소거 토글 (M)';
  }
}

function toggleMute() {
  if (video.volume > 0) {
    savedVolume = video.volume;
    setVolume(0);
  } else {
    setVolume(savedVolume > 0 ? savedVolume : 1.0);
  }
}

function togglePlay() {
  if (video.paused) {
    video.play();
  } else {
    video.pause();
  }
}

/* =========================================================
   Subtitle Overlay & Active Row Highlighting
   ========================================================= */
function updateSubtitleOverlay(currentTime) {
  if (!state.subtitles || state.subtitles.length === 0) {
    subTextDisplay.style.display = 'none';
    return;
  }

  let activeCue = null;
  let activeIndex = -1;

  for (let i = 0; i < state.subtitles.length; i++) {
    const cue = state.subtitles[i];
    if (currentTime >= cue.start && currentTime <= cue.end) {
      activeCue = cue;
      activeIndex = i;
      break;
    }
  }

  if (activeCue) {
    const cleanText = activeCue.text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
    subTextDisplay.textContent = cleanText;
    subTextDisplay.style.display = 'inline-block';
  } else {
    subTextDisplay.style.display = 'none';
  }

  // Highlight row in table if changed
  if (activeIndex !== state.activeCueIndex) {
    if (state.activeCueIndex >= 0) {
      const prevRow = document.getElementById(`sub-row-${state.activeCueIndex}`);
      if (prevRow) prevRow.classList.remove('active-cue');
    }

    state.activeCueIndex = activeIndex;

    if (activeIndex >= 0) {
      const newRow = document.getElementById(`sub-row-${activeIndex}`);
      if (newRow) {
        newRow.classList.add('active-cue');
        // Smooth scroll row into view if not user interacting
        newRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }
}

/* =========================================================
   Subtitle Table Rendering
   ========================================================= */
function renderSubtitleTable() {
  const query = (subSearchInput.value || '').toLowerCase().trim();
  subTableBody.innerHTML = '';

  state.filteredSubtitles = state.subtitles.filter(item => {
    if (!query) return true;
    return item.text.toLowerCase().includes(query) || String(item.id).includes(query);
  });

  subCountBadge.textContent = `(${state.subtitles.length}개)`;
  subMetaInfo.textContent = `${state.subtitles.length}개 항목 | ${state.subMeta ? state.subMeta.format : 'SRT'}`;

  const fragment = document.createDocumentFragment();

  for (let i = 0; i < state.filteredSubtitles.length; i++) {
    const item = state.filteredSubtitles[i];
    const duration = (item.end - item.start).toFixed(2);

    const tr = document.createElement('tr');
    tr.id = `sub-row-${item.id - 1}`;
    if (state.selectedIndex === item.id - 1) tr.classList.add('selected');
    if (state.activeCueIndex === item.id - 1) tr.classList.add('active-cue');

    const cleanCueText = item.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n\s*\n+/g, '\n').trim();
    tr.innerHTML = `
      <td class="col-id">${item.id}</td>
      <td class="col-time">${formatTime(item.start)}</td>
      <td class="col-time">${formatTime(item.end)}</td>
      <td class="col-dur">${duration}s</td>
      <td class="col-text">${escapeHtml(cleanCueText).replace(/\n/g, '<br>')}</td>
      <td class="col-action">
        <button class="btn btn-sm btn-p1" title="기준점 1로 지정" data-id="${item.id}">P1</button>
        <button class="btn btn-sm btn-p2" title="기준점 2로 지정" data-id="${item.id}">P2</button>
      </td>
    `;

    // Row click: seek to subtitle start time & select
    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      selectSubtitle(item.id - 1);
      video.currentTime = item.start;
    });

    // P1 / P2 button clicks
    const btnP1 = tr.querySelector('.btn-p1');
    const btnP2 = tr.querySelector('.btn-p2');

    btnP1.addEventListener('click', (e) => {
      e.stopPropagation();
      setCalibrationPoint(1, video.currentTime, item.start, item.text);
    });

    btnP2.addEventListener('click', (e) => {
      e.stopPropagation();
      setCalibrationPoint(2, video.currentTime, item.start, item.text);
    });

    fragment.appendChild(tr);
  }

  subTableBody.appendChild(fragment);
  btnSaveSubtitle.disabled = state.subtitles.length === 0;
  btnDownloadSubtitle.disabled = state.subtitles.length === 0;
}

function selectSubtitle(index) {
  state.selectedIndex = index;
  segSelectedId.textContent = index >= 0 ? (index + 1) : '-';

  document.querySelectorAll('#subTableBody tr').forEach(row => row.classList.remove('selected'));
  const row = document.getElementById(`sub-row-${index}`);
  if (row) row.classList.add('selected');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

/* =========================================================
   Waveform & Timeline Canvas Rendering
   ========================================================= */
function drawWaveform() {
  const canvas = waveformCanvas;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio || 800;
  canvas.height = rect.height * window.devicePixelRatio || 96;

  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  const width = rect.width;
  const height = rect.height;

  ctx.clearRect(0, 0, width, height);

  // Background grid
  ctx.fillStyle = '#0b111e';
  ctx.fillRect(0, 0, width, height);

  const duration = video.duration || (state.subtitles.length > 0 ? state.subtitles[state.subtitles.length - 1].end : 0);
  if (!duration) return;

  // Draw Audio Waveform if available
  if (state.waveformOverview && state.waveformOverview.length > 0) {
    ctx.fillStyle = '#1e3a8a';
    const numPoints = state.waveformOverview.length;
    const barWidth = width / numPoints;
    const centerY = height / 2;

    for (let i = 0; i < numPoints; i++) {
      const val = state.waveformOverview[i];
      const barHeight = Math.max(1, val * height * 0.85);
      const x = i * barWidth;
      ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 0.5), barHeight);
    }
  }

  // Draw Subtitle dialogue blocks on bottom half
  if (state.subtitles && state.subtitles.length > 0) {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;

    for (const sub of state.subtitles) {
      const x1 = (sub.start / duration) * width;
      const x2 = (sub.end / duration) * width;
      const blockWidth = Math.max(2, x2 - x1);

      ctx.fillRect(x1, height - 20, blockWidth, 14);
      ctx.strokeRect(x1, height - 20, blockWidth, 14);
    }
  }
}

function updatePlayhead(currentTime, duration) {
  if (!duration || duration <= 0) return;
  const rect = timelineContainer.getBoundingClientRect();
  const leftPx = (currentTime / duration) * rect.width;
  timelinePlayhead.style.left = `${leftPx}px`;
}

timelineContainer.addEventListener('click', (e) => {
  const rect = timelineContainer.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  const duration = video.duration || 0;
  if (duration > 0) {
    video.currentTime = pct * duration;
  }
});

/* =========================================================
   2-Point Calibration Logic
   ========================================================= */
function setCalibrationPoint(pointNum, videoTime, subTime, text = '') {
  const vTime = Number(videoTime.toFixed(3));
  const sTime = Number(subTime.toFixed(3));

  if (pointNum === 1) {
    state.p1 = { videoTime: vTime, subTime: sTime };
    p1VideoInput.value = formatTime(vTime);
    p1SubInput.value = formatTime(sTime);
    p1Status.textContent = '설정됨';
    p1Status.style.color = '#10b981';
    showToast(`기준점 1 지정 완료 (영상: ${formatTime(vTime)}, 자막: ${formatTime(sTime)})`, 'success');
  } else {
    state.p2 = { videoTime: vTime, subTime: sTime };
    p2VideoInput.value = formatTime(vTime);
    p2SubInput.value = formatTime(sTime);
    p2Status.textContent = '설정됨';
    p2Status.style.color = '#10b981';
    showToast(`기준점 2 지정 완료 (영상: ${formatTime(vTime)}, 자막: ${formatTime(sTime)})`, 'success');
  }

  calculateTwoPoint();
}

function calculateTwoPoint() {
  if (state.p1.videoTime === null || state.p2.videoTime === null) return;

  const s1 = state.p1.subTime;
  const v1 = state.p1.videoTime;
  const s2 = state.p2.subTime;
  const v2 = state.p2.videoTime;

  const subDiff = s2 - s1;
  if (Math.abs(subDiff) < 0.1) {
    twoPointPattern.textContent = '두 기준점의 자막 시간 차이가 너무 작습니다';
    twoPointPattern.style.color = '#ef4444';
    btnApplyTwoPoint.disabled = true;
    return;
  }

  const scale = (v2 - v1) / subDiff;
  const offset = v1 - (scale * s1);
  const drift10Min = (scale - 1.0) * 600;

  twoPointScale.textContent = scale.toFixed(6);
  twoPointOffset.textContent = `${offset >= 0 ? '+' : ''}${offset.toFixed(3)}s`;
  twoPointDrift.textContent = `${drift10Min >= 0 ? '+' : ''}${drift10Min.toFixed(2)}s`;

  // Pattern detection
  let patternText = '사용자 정의 배율';
  if (Math.abs(scale - (25 / 23.976)) < 0.005) {
    patternText = 'PAL (25fps) → NTSC (23.976fps) [약 +4.27%]';
  } else if (Math.abs(scale - (23.976 / 25)) < 0.005) {
    patternText = 'NTSC (23.976fps) → PAL (25fps) [약 -4.10%]';
  } else if (Math.abs(scale - (24 / 23.976)) < 0.002) {
    patternText = 'Film (24fps) → NTSC (23.976fps) [약 +0.1%]';
  } else if (Math.abs(scale - 1.0) < 0.0005) {
    patternText = '동일 프레임레이트 (순수 지연 오프셋)';
  }
  twoPointPattern.textContent = patternText;
  btnApplyTwoPoint.disabled = false;
}

// 2-Point Input buttons
btnSetP1Video.addEventListener('click', () => {
  p1VideoInput.value = formatTime(video.currentTime);
  state.p1.videoTime = Number(video.currentTime.toFixed(3));
  calculateTwoPoint();
});

btnSetP1Sub.addEventListener('click', () => {
  if (state.selectedIndex >= 0 && state.subtitles[state.selectedIndex]) {
    const sub = state.subtitles[state.selectedIndex];
    p1SubInput.value = formatTime(sub.start);
    state.p1.subTime = Number(sub.start.toFixed(3));
    calculateTwoPoint();
  } else {
    showToast('자막 목록에서 기준점이 될 자막을 먼저 클릭하세요.', 'error');
  }
});

btnSetP2Video.addEventListener('click', () => {
  p2VideoInput.value = formatTime(video.currentTime);
  state.p2.videoTime = Number(video.currentTime.toFixed(3));
  calculateTwoPoint();
});

btnSetP2Sub.addEventListener('click', () => {
  if (state.selectedIndex >= 0 && state.subtitles[state.selectedIndex]) {
    const sub = state.subtitles[state.selectedIndex];
    p2SubInput.value = formatTime(sub.start);
    state.p2.subTime = Number(sub.start.toFixed(3));
    calculateTwoPoint();
  } else {
    showToast('자막 목록에서 기준점이 될 자막을 먼저 클릭하세요.', 'error');
  }
});

// Apply 2-Point Sync
btnApplyTwoPoint.addEventListener('click', async () => {
  try {
    const scale = parseFloat(twoPointScale.textContent);
    const offset = parseFloat(twoPointOffset.textContent);

    pushHistory();

    state.subtitles = state.subtitles.map(item => ({
      ...item,
      start: Number(Math.max(0, scale * item.start + offset).toFixed(3)),
      end: Number(Math.max(0.1, scale * item.end + offset).toFixed(3))
    }));

    renderSubtitleTable();
    drawWaveform();
    showToast(`2포인트 비례 싱크가 성공적으로 적용되었습니다! (배율: ${scale}, 오프셋: ${offset}s)`, 'success');
  } catch (err) {
    showToast(`2포인트 싱크 적용 실패: ${err.message}`, 'error');
  }
});

/* =========================================================
   Quick Offset Adjustments (Buttons + Hotkeys)
   ========================================================= */
function applyQuickShift(deltaSec) {
  if (!state.subtitles || state.subtitles.length === 0) return;

  pushHistory();
  state.totalOffset += deltaSec;
  totalOffsetBadge.textContent = `${state.totalOffset >= 0 ? '+' : ''}${state.totalOffset.toFixed(3)}s`;

  state.subtitles = state.subtitles.map(item => ({
    ...item,
    start: Number(Math.max(0, item.start + deltaSec).toFixed(3)),
    end: Number(Math.max(0.1, item.end + deltaSec).toFixed(3))
  }));

  renderSubtitleTable();
  drawWaveform();
  showToast(`자막 싱크 ${deltaSec >= 0 ? '+' : ''}${deltaSec.toFixed(1)}s 조정되었습니다.`, 'info');
}

document.querySelectorAll('[data-shift]').forEach(btn => {
  btn.addEventListener('click', () => {
    const delta = parseFloat(btn.getAttribute('data-shift'));
    applyQuickShift(delta);
  });
});

btnResetOffset.addEventListener('click', () => {
  if (state.totalOffset !== 0) {
    applyQuickShift(-state.totalOffset);
    state.totalOffset = 0;
    totalOffsetBadge.textContent = '0.000s';
  }
});

/* =========================================================
   Auto-Sync via Audio VAD
   ========================================================= */
btnRunAutoSync.addEventListener('click', async () => {
  if (!state.videoMeta || !state.videoMeta.path) {
    return showToast('비디오 파일이 먼저 로드되어 있어야 합니다.', 'error');
  }
  if (!state.subtitles || state.subtitles.length === 0) {
    return showToast('자막 파일이 먼저 로드되어 있어야 합니다.', 'error');
  }

  btnRunAutoSync.disabled = true;
  autoSyncProgressText.textContent = '⏳ 오디오 분석 및 싱크 정렬 계산 중... (수 초 소요)';

  try {
    const res = await fetch('/api/sync/auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoPath: state.videoMeta.path,
        subtitles: state.subtitles
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    state.autoSyncResult = data;
    autoConfidence.textContent = `${data.confidence}%`;
    autoScale.textContent = data.scale.toFixed(6);
    autoOffset.textContent = `${data.offset >= 0 ? '+' : ''}${data.offset.toFixed(3)}s`;
    autoPattern.textContent = data.pattern;

    autoSyncResultBox.style.display = 'flex';
    autoSyncProgressText.textContent = '✅ 자동 분석 완료!';
    showToast(`자동 싱크 분석 완료 (신뢰도: ${data.confidence}%, 배율: ${data.scale})`, 'success');
  } catch (err) {
    autoSyncProgressText.textContent = '❌ 분석 실패';
    showToast(`자동 싱크 분석 실패: ${err.message}`, 'error');
  } finally {
    btnRunAutoSync.disabled = false;
  }
});

btnApplyAutoSync.addEventListener('click', () => {
  if (!state.autoSyncResult || !state.autoSyncResult.syncedItems) return;

  pushHistory();
  state.subtitles = state.autoSyncResult.syncedItems;
  renderSubtitleTable();
  drawWaveform();
  showToast('자동 음성 싱크 결과가 성공적으로 적용되었습니다!', 'success');
});

/* =========================================================
   Segment Sync Logic
   ========================================================= */
function applySegmentShift(delta) {
  if (!state.subtitles || state.subtitles.length === 0) return;

  const mode = document.querySelector('input[name="segRange"]:checked').value;
  let startIdx = 0;
  if (mode === 'selectedToEnd') {
    if (state.selectedIndex < 0) {
      return showToast('적용을 시작할 자막을 목록에서 먼저 선택하세요.', 'error');
    }
    startIdx = state.selectedIndex;
  }

  pushHistory();
  for (let i = startIdx; i < state.subtitles.length; i++) {
    const item = state.subtitles[i];
    item.start = Number(Math.max(0, item.start + delta).toFixed(3));
    item.end = Number(Math.max(0.1, item.end + delta).toFixed(3));
  }

  renderSubtitleTable();
  drawWaveform();
  showToast(`#${startIdx + 1}부터 끝까지 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}s 조정 완료!`, 'success');
}

document.getElementById('btnSegShiftMinus1').addEventListener('click', () => applySegmentShift(-1.0));
document.getElementById('btnSegShiftMinus05').addEventListener('click', () => applySegmentShift(-0.5));
document.getElementById('btnSegShiftMinus01').addEventListener('click', () => applySegmentShift(-0.1));
document.getElementById('btnSegShiftPlus01').addEventListener('click', () => applySegmentShift(0.1));
document.getElementById('btnSegShiftPlus05').addEventListener('click', () => applySegmentShift(0.5));
document.getElementById('btnSegShiftPlus1').addEventListener('click', () => applySegmentShift(1.0));

btnApplySegCustom.addEventListener('click', () => {
  const delta = parseFloat(segCustomShiftInput.value || '0');
  if (delta !== 0) applySegmentShift(delta);
});

/* =========================================================
   Manual FPS Conversion Preset Buttons
   ========================================================= */
document.querySelectorAll('[data-fps]').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.getAttribute('data-fps');
    let scale = 1.0;
    if (type === 'pal-to-ntsc') scale = 25 / 23.976;
    else if (type === 'ntsc-to-pal') scale = 23.976 / 25;
    else if (type === 'film-to-ntsc') scale = 24 / 23.976;
    else if (type === 'ntsc-to-film') scale = 23.976 / 24;

    pushHistory();
    state.subtitles = state.subtitles.map(item => ({
      ...item,
      start: Number((item.start * scale).toFixed(3)),
      end: Number((item.end * scale).toFixed(3))
    }));

    renderSubtitleTable();
    drawWaveform();
    showToast(`프레임레이트 변환 비율(×${scale.toFixed(4)})이 적용되었습니다.`, 'success');
  });
});

/* =========================================================
   File Loading & Modals
   ========================================================= */
btnLoadFiles.addEventListener('click', () => {
  fileModal.style.display = 'flex';
});

document.getElementById('btnCloseFileModal').addEventListener('click', () => {
  fileModal.style.display = 'none';
});

document.getElementById('btnCancelLoad').addEventListener('click', () => {
  fileModal.style.display = 'none';
});

document.getElementById('btnBrowseVideo').addEventListener('click', () => {
  videoFileInput.click();
});

document.getElementById('btnBrowseSubtitle').addEventListener('click', () => {
  subFileInput.click();
});

videoFileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    const file = e.target.files[0];
    document.getElementById('videoPathInput').value = file.name;
    loadVideoFileDirectly(file);
  }
});

subFileInput.addEventListener('change', async (e) => {
  if (e.target.files.length > 0) {
    const file = e.target.files[0];
    document.getElementById('subPathInput').value = file.name;
    loadSubtitleFileDirectly(file);
  }
});

document.getElementById('btnConfirmLoad').addEventListener('click', async () => {
  const vPath = document.getElementById('videoPathInput').value.trim();
  const sPath = document.getElementById('subPathInput').value.trim();

  if (vPath || sPath) {
    try {
      const res = await fetch('/api/load/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath: vPath, subtitlePath: sPath })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      if (data.subtitle) {
        state.subMeta = data.subtitle;
        state.subtitles = data.subtitle.items;
        subFilename.textContent = data.subtitle.filename;
        renderSubtitleTable();
        showToast(`자막 로드 완료 (${data.subtitle.format}, ${data.subtitle.count}개 대사)`, 'success');
      }

      if (data.video) {
        state.videoMeta = data.video;
        videoFilename.textContent = data.video.filename;
        video.src = `/api/stream/video?path=${encodeURIComponent(data.video.path)}`;
        loadAudioWaveform(data.video.path);
        showToast(`동영상 로드 완료 (${data.video.vCodec} / ${data.video.aCodec})`, 'success');
      }

      fileModal.style.display = 'none';
    } catch (err) {
      showToast(`파일 로드 오류: ${err.message}`, 'error');
    }
  }
});

function loadVideoFileDirectly(file) {
  state.videoMeta = {
    filename: file.name,
    isDirectPlayable: true
  };
  videoFilename.textContent = file.name;
  video.src = URL.createObjectURL(file);
  showToast(`동영상 파일 선택: ${file.name}`, 'info');
}

async function loadSubtitleFileDirectly(file) {
  const formData = new FormData();
  formData.append('subtitle', file);

  try {
    const res = await fetch('/api/upload/subtitle', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    state.subMeta = {
      filename: data.filename,
      format: data.format,
      encoding: data.encoding
    };
    state.subtitles = data.items;
    subFilename.textContent = data.filename;
    renderSubtitleTable();
    drawWaveform();
    showToast(`자막 로드 완료 (${data.format}, ${data.encoding}, ${data.count}개 대사)`, 'success');
  } catch (err) {
    showToast(`자막 업로드 오류: ${err.message}`, 'error');
  }
}

async function loadAudioWaveform(videoPath) {
  try {
    const res = await fetch('/api/audio/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath })
    });
    const data = await res.json();
    if (data.success && data.waveformOverview) {
      state.waveformOverview = data.waveformOverview;
      drawWaveform();
    }
  } catch (err) {
    console.warn('Waveform analysis failed', err);
  }
}

/* Drag and Drop files onto window */
window.addEventListener('dragover', (e) => {
  e.preventDefault();
});

window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = e.dataTransfer.files;
  if (!files || files.length === 0) return;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
    if (['.srt', '.smi', '.sami', '.vtt'].includes(ext)) {
      loadSubtitleFileDirectly(f);
    } else if (['.mp4', '.mkv', '.avi', '.webm', '.mov'].includes(ext)) {
      loadVideoFileDirectly(f);
    }
  }
});

/* Search Filter */
subSearchInput.addEventListener('input', () => {
  renderSubtitleTable();
});

/* =========================================================
   Saving & Exporting
   ========================================================= */
btnSaveSubtitle.addEventListener('click', () => {
  saveModal.style.display = 'flex';
});

document.getElementById('btnCloseSaveModal').addEventListener('click', () => {
  saveModal.style.display = 'none';
});

document.getElementById('btnCancelSave').addEventListener('click', () => {
  saveModal.style.display = 'none';
});

document.getElementById('btnConfirmSave').addEventListener('click', async () => {
  try {
    const format = document.getElementById('saveFormatSelect').value;
    const overwrite = document.getElementById('overwriteCheckbox').checked;

    const res = await fetch('/api/save/subtitle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: state.subtitles,
        format,
        originalPath: state.subMeta ? state.subMeta.path : null,
        overwrite
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    saveModal.style.display = 'none';
    showToast(`자막 저장 완료: ${data.savedPath}`, 'success');
  } catch (err) {
    showToast(`저장 실패: ${err.message}`, 'error');
  }
});

btnDownloadSubtitle.addEventListener('click', async () => {
  try {
    const format = state.subMeta ? state.subMeta.format : 'SRT';
    const filename = state.subMeta ? state.subMeta.filename : 'subtitle.srt';

    const res = await fetch('/api/export/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: state.subtitles,
        format,
        filename
      })
    });

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `[synced] ${filename}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('보정된 자막 파일 다운로드가 시작되었습니다.', 'success');
  } catch (err) {
    showToast(`다운로드 실패: ${err.message}`, 'error');
  }
});

/* =========================================================
   Draggable Pane Resizer Splitter
   ========================================================= */
function initPaneResizer() {
  const savedWidth = localStorage.getItem('subsync_left_pane_width');
  if (savedWidth) {
    leftPane.style.flex = `0 0 ${savedWidth}px`;
  }

  let isDragging = false;

  paneResizer.addEventListener('mousedown', (e) => {
    isDragging = true;
    paneResizer.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const containerRect = appContainer.getBoundingClientRect();
    let newWidth = e.clientX - containerRect.left;

    // Minimum width for left pane: 380px, minimum width for right pane: 320px
    const minLeft = 380;
    const maxLeft = containerRect.width - 320;
    newWidth = Math.max(minLeft, Math.min(maxLeft, newWidth));

    leftPane.style.flex = `0 0 ${newWidth}px`;
    drawWaveform();
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      paneResizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const currentWidth = leftPane.getBoundingClientRect().width;
      localStorage.setItem('subsync_left_pane_width', Math.round(currentWidth));
      drawWaveform();
    }
  });
}

/* =========================================================
   Keyboard Shortcuts
   ========================================================= */
window.addEventListener('keydown', (e) => {
  // Ignore shortcuts if focusing an input field
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    return;
  }

  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.code === 'KeyM') {
    e.preventDefault();
    toggleMute();
  } else if (e.code === 'KeyZ' && !e.ctrlKey) {
    e.preventDefault();
    applyQuickShift(-0.1);
  } else if (e.code === 'KeyX' && !e.ctrlKey) {
    e.preventDefault();
    applyQuickShift(0.1);
  } else if (e.code === 'KeyZ' && e.ctrlKey) {
    e.preventDefault();
    btnUndo.click();
  } else if (e.code === 'KeyY' && e.ctrlKey) {
    e.preventDefault();
    btnRedo.click();
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    video.currentTime = Math.max(0, video.currentTime - 1.0);
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    video.currentTime = Math.min(video.duration || 0, video.currentTime + 1.0);
  }
});

window.addEventListener('resize', () => {
  drawWaveform();
});

/* =========================================================
   Subtitle Font Size Control
   ========================================================= */
function setSubtitleFontSize(scale) {
  const s = parseFloat(scale) || 1.0;
  const remVal = (1.25 * s).toFixed(3);
  document.documentElement.style.setProperty('--sub-font-size', `${remVal}rem`);
  if (subFontSizeSelect) subFontSizeSelect.value = String(s);
  localStorage.setItem('subsync_sub_font_scale', String(s));
}

function initSubtitleFontSize() {
  const savedScale = localStorage.getItem('subsync_sub_font_scale') || '1.0';
  setSubtitleFontSize(savedScale);

  if (subFontSizeSelect) {
    subFontSizeSelect.addEventListener('change', () => {
      setSubtitleFontSize(subFontSizeSelect.value);
      showToast(`자막 크기: ${Math.round(parseFloat(subFontSizeSelect.value) * 100)}%`, 'info');
    });
  }
}

/* =========================================================
   Header Status Chips Click Handlers (Direct File Open)
   ========================================================= */
function initFileChipClickHandlers() {
  if (videoStatusChip) {
    videoStatusChip.addEventListener('click', () => {
      videoFileInput.click();
    });
  }

  if (subStatusChip) {
    subStatusChip.addEventListener('click', () => {
      subFileInput.click();
    });
  }

  if (videoPlaceholder) {
    videoPlaceholder.addEventListener('click', () => {
      videoFileInput.click();
    });
  }
}

// App Initialization
initPlayer();
initPaneResizer();
initSubtitleFontSize();
initFileChipClickHandlers();

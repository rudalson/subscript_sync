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
const timecodeCurrent = document.getElementById('timecodeCurrent');
const timecodeDuration = document.getElementById('timecodeDuration');
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
const subListEmpty = document.getElementById('subListEmpty');

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
   Icons (inline SVG)
   ========================================================= */
const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z"/></svg>',
  volHigh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h3.5L12 5v14l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  volLow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h3.5L12 5v14l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6"/></svg>',
  volMute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h3.5L12 5v14l-4.5-4H4z" fill="currentColor"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>'
};

/* =========================================================
   Toast Notifications
   ========================================================= */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
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
  showToast('실행 취소', 'info');
});

btnRedo.addEventListener('click', () => {
  if (state.redoStack.length === 0) return;
  state.undoStack.push(JSON.parse(JSON.stringify(state.subtitles)));
  state.subtitles = state.redoStack.pop();
  renderSubtitleTable();
  drawWaveform();
  updateUndoRedoButtons();
  showToast('다시 실행', 'info');
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
    timecodeCurrent.textContent = formatTime(cur);
    timecodeDuration.textContent = formatTime(dur);

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
    timecodeCurrent.textContent = formatTime(0);
    timecodeDuration.textContent = formatTime(video.duration);
    drawWaveform();
  });

  video.addEventListener('play', () => {
    state.isPlaying = true;
    btnPlayPause.innerHTML = ICONS.pause;
    btnPlayPause.setAttribute('aria-label', '일시정지');
  });

  video.addEventListener('pause', () => {
    state.isPlaying = false;
    btnPlayPause.innerHTML = ICONS.play;
    btnPlayPause.setAttribute('aria-label', '재생');
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
  volumeValue.textContent = String(Math.round(val * 100));

  if (val === 0) {
    btnVolume.innerHTML = ICONS.volMute;
    btnVolume.title = '음소거 해제 (M)';
  } else {
    btnVolume.innerHTML = val < 0.5 ? ICONS.volLow : ICONS.volHigh;
    btnVolume.title = '음소거 (M)';
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

  subCountBadge.textContent = query
    ? `${state.filteredSubtitles.length} / ${state.subtitles.length}`
    : String(state.subtitles.length);
  if (subMetaInfo) {
    subMetaInfo.textContent = state.subtitles.length > 0
      ? `${state.subMeta ? state.subMeta.format : 'SRT'} · ${state.subtitles.length}`
      : '';
  }
  if (subStatusChip && state.subMeta) {
    subStatusChip.title = `${state.subMeta.filename} (${state.subMeta.format || 'SRT'}, ${state.subtitles.length}개 대사)`;
  }
  subListEmpty.style.display = state.filteredSubtitles.length === 0 ? 'block' : 'none';
  subListEmpty.textContent = state.subtitles.length === 0
    ? '자막 파일을 불러오면 여기에 대사가 표시됩니다.'
    : '검색 결과가 없습니다.';

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
        <button class="btn btn-p1" title="이 자막과 현재 재생 시점을 기준점 1로" data-id="${item.id}">P1</button>
        <button class="btn btn-p2" title="이 자막과 현재 재생 시점을 기준점 2로" data-id="${item.id}">P2</button>
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
  drawWaveform();
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

  const css = getComputedStyle(document.documentElement);
  const color = name => css.getPropertyValue(name).trim();

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color('--tl-bg');
  ctx.fillRect(0, 0, width, height);

  const duration = video.duration || (state.subtitles.length > 0 ? state.subtitles[state.subtitles.length - 1].end : 0);
  if (!duration) return;

  // Layout: ruler on top, waveform in the middle, cue lane at the bottom
  const rulerH = 18;
  const laneH = 14;
  const laneY = height - laneH - 6;
  const waveTop = rulerH + 4;
  const waveBottom = laneY - 6;

  // Time ruler: pick the smallest tick step that keeps labels >= 72px apart
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const pxPerSec = width / duration;
  const step = steps.find(s => s * pxPerSec >= 72) || steps[steps.length - 1];

  ctx.font = `10px ${color('--font-mono')}`;
  ctx.textBaseline = 'middle';
  for (let t = 0; t <= duration; t += step) {
    const x = Math.round(t * pxPerSec) + 0.5;
    ctx.fillStyle = color('--tl-grid');
    ctx.fillRect(x, rulerH, 1, height - rulerH);
    ctx.fillStyle = color('--tl-ruler');
    ctx.fillRect(x, rulerH - 5, 1, 5);
    ctx.fillText(formatRulerTime(t), x + 4, rulerH / 2);
  }
  ctx.fillStyle = color('--tl-grid');
  ctx.fillRect(0, rulerH - 0.5, width, 1);

  // Audio waveform
  if (state.waveformOverview && state.waveformOverview.length > 0) {
    ctx.fillStyle = color('--tl-wave');
    const numPoints = state.waveformOverview.length;
    const barWidth = width / numPoints;
    const centerY = (waveTop + waveBottom) / 2;
    const maxH = waveBottom - waveTop;

    for (let i = 0; i < numPoints; i++) {
      const barHeight = Math.max(1, state.waveformOverview[i] * maxH);
      ctx.fillRect(i * barWidth, centerY - barHeight / 2, Math.max(1, barWidth - 0.5), barHeight);
    }
  }

  // Subtitle cue lane
  if (state.subtitles && state.subtitles.length > 0) {
    ctx.fillStyle = color('--tl-cue');
    for (const sub of state.subtitles) {
      const x1 = (sub.start / duration) * width;
      const w = Math.max(1, ((sub.end - sub.start) / duration) * width);
      ctx.fillRect(x1, laneY, w, laneH);
    }

    // Leading edges make adjacent cues readable at overview zoom
    ctx.fillStyle = color('--tl-cue-edge');
    for (const sub of state.subtitles) {
      ctx.fillRect(Math.round((sub.start / duration) * width), laneY, 1, laneH);
    }

    const sel = state.subtitles[state.selectedIndex];
    if (sel) {
      const x1 = (sel.start / duration) * width;
      const w = Math.max(2, ((sel.end - sel.start) / duration) * width);
      ctx.fillStyle = color('--tl-cue-selected');
      ctx.fillRect(x1, laneY - 2, w, laneH + 4);
    }
  }
}

function formatRulerTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
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
    p1Status.classList.add('is-set');
    showToast(`P1 — 영상 ${formatTime(vTime)} · 자막 ${formatTime(sTime)}`, 'success');
  } else {
    state.p2 = { videoTime: vTime, subTime: sTime };
    p2VideoInput.value = formatTime(vTime);
    p2SubInput.value = formatTime(sTime);
    p2Status.textContent = '설정됨';
    p2Status.classList.add('is-set');
    showToast(`P2 — 영상 ${formatTime(vTime)} · 자막 ${formatTime(sTime)}`, 'success');
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
    twoPointPattern.textContent = '두 기준점의 자막 시점이 너무 가깝습니다';
    twoPointPattern.classList.add('is-error');
    btnApplyTwoPoint.disabled = true;
    return;
  }
  twoPointPattern.classList.remove('is-error');

  const scale = (v2 - v1) / subDiff;
  const offset = v1 - (scale * s1);
  const drift10Min = (scale - 1.0) * 600;

  twoPointScale.textContent = scale.toFixed(6);
  twoPointOffset.textContent = `${offset >= 0 ? '+' : ''}${offset.toFixed(3)}s`;
  twoPointDrift.textContent = `${drift10Min >= 0 ? '+' : ''}${drift10Min.toFixed(2)}s`;

  // Pattern detection
  let patternText = '알려진 프레임레이트 패턴 아님';
  if (Math.abs(scale - (25 / 23.976)) < 0.005) {
    patternText = 'PAL 25 → NTSC 23.976 (+4.27%)';
  } else if (Math.abs(scale - (23.976 / 25)) < 0.005) {
    patternText = 'NTSC 23.976 → PAL 25 (−4.10%)';
  } else if (Math.abs(scale - (24 / 23.976)) < 0.002) {
    patternText = 'Film 24 → NTSC 23.976 (+0.1%)';
  } else if (Math.abs(scale - 1.0) < 0.0005) {
    patternText = '속도 동일 — 지연만 있음';
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
    showToast('목록에서 기준이 될 자막을 먼저 선택하세요.', 'error');
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
    showToast('목록에서 기준이 될 자막을 먼저 선택하세요.', 'error');
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
    showToast(`2점 보정 적용 — 배율 ${scale}, 오프셋 ${offset}s`, 'success');
  } catch (err) {
    showToast(`2점 보정 실패: ${err.message}`, 'error');
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
  showToast(`전체 ${deltaSec >= 0 ? '+' : ''}${deltaSec.toFixed(1)}s`, 'info');
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
    return showToast('동영상을 먼저 경로로 불러오세요.', 'error');
  }
  if (!state.subtitles || state.subtitles.length === 0) {
    return showToast('자막을 먼저 불러오세요.', 'error');
  }

  btnRunAutoSync.disabled = true;
  autoSyncProgressText.classList.remove('is-error');
  autoSyncProgressText.textContent = '오디오 분석 중… 몇 초 걸립니다';

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
    autoSyncProgressText.textContent = '분석 완료';
    showToast(`자동 정렬 분석 완료 — 신뢰도 ${data.confidence}%`, 'success');
  } catch (err) {
    autoSyncProgressText.classList.add('is-error');
    autoSyncProgressText.textContent = '분석 실패';
    showToast(`자동 정렬 분석 실패: ${err.message}`, 'error');
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
  showToast('자동 정렬 결과 적용', 'success');
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
      return showToast('시작할 자막을 목록에서 먼저 선택하세요.', 'error');
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
  showToast(`#${startIdx + 1}부터 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}s`, 'success');
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
    showToast(`FPS 변환 ×${scale.toFixed(4)} 적용`, 'success');
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
        subStatusChip.title = `${data.subtitle.filename} (${data.subtitle.format}, ${data.subtitle.count}개 대사)`;
        subStatusChip.classList.add('is-loaded');
        renderSubtitleTable();
        showToast(`자막 ${data.subtitle.count}개 불러옴 · ${data.subtitle.format}`, 'success');
      }

      if (data.video) {
        state.videoMeta = data.video;
        videoFilename.textContent = data.video.filename;
        videoStatusChip.title = data.video.path || data.video.filename;
        videoStatusChip.classList.add('is-loaded');
        video.src = `/api/stream/video?path=${encodeURIComponent(data.video.path)}`;
        loadAudioWaveform(data.video.path);
        showToast(`동영상 불러옴 · ${data.video.vCodec} / ${data.video.aCodec}`, 'success');
      }

      fileModal.style.display = 'none';
    } catch (err) {
      showToast(`불러오기 실패: ${err.message}`, 'error');
    }
  }
});

function loadVideoFileDirectly(file) {
  state.videoMeta = {
    filename: file.name,
    isDirectPlayable: true
  };
  videoFilename.textContent = file.name;
  videoStatusChip.title = file.name;
  videoStatusChip.classList.add('is-loaded');
  video.src = URL.createObjectURL(file);
  showToast(`동영상 · ${file.name}`, 'info');
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

    const safeFilename = file.name || data.filename;
    state.subMeta = {
      filename: safeFilename,
      format: data.format,
      encoding: data.encoding
    };
    state.subtitles = data.items;
    subFilename.textContent = safeFilename;
    subStatusChip.title = `${safeFilename} (${data.format}, ${data.count}개 대사)`;
    subStatusChip.classList.add('is-loaded');
    renderSubtitleTable();
    drawWaveform();
    showToast(`자막 ${data.count}개 불러옴 · ${data.format} · ${data.encoding}`, 'success');
  } catch (err) {
    showToast(`자막 불러오기 실패: ${err.message}`, 'error');
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
    showToast(`저장됨 · ${data.savedPath}`, 'success');
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
    showToast('다운로드 시작', 'success');
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
      showToast(`자막 글자 ${Math.round(parseFloat(subFontSizeSelect.value) * 100)}%`, 'info');
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

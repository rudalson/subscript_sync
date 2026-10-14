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

// Auto-Sync Tab
const btnRunAutoSync = document.getElementById('btnRunAutoSync');
const autoSyncProgressText = document.getElementById('autoSyncProgressText');
const autoSyncResultBox = document.getElementById('autoSyncResultBox');
const autoConfidence = document.getElementById('autoConfidence');
const autoScale = document.getElementById('autoScale');
const autoOffset = document.getElementById('autoOffset');
const autoPattern = document.getElementById('autoPattern');
const autoRefineInfo = document.getElementById('autoRefineInfo');
const refineCuesCheckbox = document.getElementById('refineCuesCheckbox');
const segmentAlignCheckbox = document.getElementById('segmentAlignCheckbox');
const btnApplyAutoSync = document.getElementById('btnApplyAutoSync');

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
    `;

    // Row click: seek to subtitle start time & select
    tr.addEventListener('click', () => {
      selectSubtitle(item.id - 1);
      video.currentTime = item.start;
    });

    fragment.appendChild(tr);
  }

  subTableBody.appendChild(fragment);
  btnSaveSubtitle.disabled = state.subtitles.length === 0;
  btnDownloadSubtitle.disabled = state.subtitles.length === 0;
}

function selectSubtitle(index) {
  state.selectedIndex = index;

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
   Quick Offset Adjustments (Buttons + Hotkeys)
   ========================================================= */
function applyQuickShift(deltaSec) {
  if (!state.subtitles || state.subtitles.length === 0) return;

  pushHistory();
  state.totalOffset += deltaSec;
  totalOffsetBadge.textContent = `${state.totalOffset >= 0 ? '+' : ''}${state.totalOffset.toFixed(3)}s`;

  state.subtitles = SyncEngine.applyShiftOffset(state.subtitles, deltaSec);

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
  if (!state.videoMeta) {
    return showToast('동영상을 먼저 불러오세요.', 'error');
  }

  // If disk path is missing, try auto-resolving by filename or ask native file picker
  if (!state.videoMeta.path && state.videoMeta.filename) {
    try {
      const r = await fetch('/api/resolve/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: state.videoMeta.filename })
      });
      const d = await r.json();
      if (d.success && d.path) {
        state.videoMeta.path = d.path;
        videoStatusChip.title = d.path;
        loadAudioWaveform(d.path);
      }
    } catch (e) {}
  }

  if (!state.videoMeta.path) {
    showToast('FFmpeg 오디오 분석을 위해 파일 위치를 선택해주세요.', 'info');
    try {
      const bRes = await fetch('/api/browse/native', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'video' })
      });
      const bData = await bRes.json();
      if (bData.success && bData.path) {
        state.videoMeta.path = bData.path;
        videoStatusChip.title = bData.path;
        loadAudioWaveform(bData.path);
        showToast(`동영상 경로 연결 완료: ${bData.path}`, 'success');
      } else {
        return showToast('동영상 경로가 필요합니다.', 'error');
      }
    } catch (e) {
      return showToast('동영상 경로를 찾을 수 없습니다.', 'error');
    }
  }

  if (!state.subtitles || state.subtitles.length === 0) {
    return showToast('자막을 먼저 불러오세요.', 'error');
  }

  btnRunAutoSync.disabled = true;
  autoSyncProgressText.classList.remove('is-error');
  autoSyncProgressText.textContent = '오디오 분석 중… 신경망 음성 감지로 영화 1편 기준 30초가량 걸립니다';

  try {
    const res = await fetch('/api/sync/auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoPath: state.videoMeta.path,
        subtitles: state.subtitles,
        segmentAlign: segmentAlignCheckbox.checked,
        refineCues: refineCuesCheckbox.checked
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    state.autoSyncResult = data;
    autoConfidence.textContent = `${data.confidence}%`;
    autoScale.textContent = data.scale.toFixed(6);
    autoOffset.textContent = `${data.offset >= 0 ? '+' : ''}${data.offset.toFixed(3)}s`;
    autoPattern.textContent = data.pattern;
    const infoLines = [];
    if (data.segments) {
      const splits = data.segments.slice(1).map(seg => {
        const t = Math.max(0, seg.startTime);
        const mm = String(Math.floor(t / 60)).padStart(2, '0');
        const ss = String(Math.floor(t % 60)).padStart(2, '0');
        return `${mm}:${ss}(#${seg.fromIndex + 1})`;
      });
      const offsets = data.segments.map(seg => `${seg.offset >= 0 ? '+' : ''}${seg.offset.toFixed(1)}s`);
      infoLines.push(splits.length > 0
        ? `구간별 정렬: 분할 지점 ${splits.length}개 · ${splits.join(', ')} · 구간 보정 ${offsets.join(' → ')}`
        : `구간별 정렬: 분할 지점 없음 · 구간 보정 ${offsets[0]}`);
    }
    if (data.refineStats) {
      const { snapped, followed, medianShift } = data.refineStats;
      infoLines.push(`미세 조정: ${snapped}줄 발화 시작에 맞춤 · ${followed}줄 주변 흐름 따름 · 이동량 중앙값 ${medianShift.toFixed(2)}s`);
    }
    autoRefineInfo.innerHTML = infoLines.map(escapeHtml).join('<br>');
    autoRefineInfo.style.display = infoLines.length > 0 ? '' : 'none';

    autoSyncResultBox.style.display = 'flex';
    autoSyncProgressText.textContent = '분석 완료';
    const vadLabel = data.vadSource === 'silero' ? '신경망 음성 감지' : '에너지 기반 음성 감지';
    showToast(`자막 정렬 분석 완료 — 신뢰도 ${data.confidence}% · ${vadLabel}`, 'success');
  } catch (err) {
    autoSyncProgressText.classList.add('is-error');
    autoSyncProgressText.textContent = '분석 실패';
    showToast(`자막 정렬 분석 실패: ${err.message}`, 'error');
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
  showToast('자막 정렬 결과 적용', 'success');
});

/* =========================================================
   Manual FPS Conversion Preset Buttons
   ========================================================= */
document.querySelectorAll('[data-fps]').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = SyncEngine.FPS_PRESETS.find(p => p.id === btn.getAttribute('data-fps'));
    if (!preset) return;
    const scale = preset.ratio;

    pushHistory();
    state.subtitles = SyncEngine.applyLinearSync(state.subtitles, scale, 0);

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

document.getElementById('btnBrowseVideo').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/browse/native', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'video' })
    });
    const data = await res.json();
    if (data.success && data.path) {
      document.getElementById('videoPathInput').value = data.path;
      return;
    }
  } catch (e) {}
  videoFileInput.click();
});

document.getElementById('btnBrowseSubtitle').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/browse/native', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'subtitle' })
    });
    const data = await res.json();
    if (data.success && data.path) {
      document.getElementById('subPathInput').value = data.path;
      return;
    }
  } catch (e) {}
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

async function loadVideoFileDirectly(file) {
  state.videoMeta = {
    filename: file.name,
    isDirectPlayable: true
  };
  videoFilename.textContent = file.name;
  videoStatusChip.title = file.name;
  videoStatusChip.classList.add('is-loaded');
  video.src = URL.createObjectURL(file);
  showToast(`동영상 · ${file.name}`, 'info');

  // Automatically resolve disk path via backend to enable FFmpeg features (waveform & auto-sync)
  try {
    const res = await fetch('/api/resolve/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name })
    });
    const data = await res.json();
    if (data.success && data.path) {
      state.videoMeta.path = data.path;
      state.videoMeta.vCodec = data.vCodec;
      state.videoMeta.aCodec = data.aCodec;
      videoStatusChip.title = data.path;
      loadAudioWaveform(data.path);
    }
  } catch (e) {
    console.warn('Auto-resolve video path failed', e);
  }
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

    // Automatically resolve disk path
    try {
      const resResolve = await fetch('/api/resolve/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: safeFilename })
      });
      const dataResolve = await resResolve.json();
      if (dataResolve.success && dataResolve.path) {
        state.subMeta.path = dataResolve.path;
      }
    } catch (e) {}
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

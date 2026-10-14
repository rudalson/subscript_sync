const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { decodeSubtitleBuffer, parseSubtitle } = require('./lib/subtitleParser');
const { serializeSubtitle } = require('./lib/subtitleSerializer');
const { calculateTwoPointParameters, applyLinearSync, applyShiftOffset, identifyFpsPattern } = require('./lib/syncEngine');
const { ANALYSIS_VERSION, extractAudioEnvelope, findOptimalSync } = require('./lib/audioAnalyzer');
const { probeVideo, streamDirectVideo, streamTranscodedVideo } = require('./lib/videoStreamer');
const { resolveLocalFile, openNativeFileDialog } = require('./lib/fileLocator');

const app = express();
const PORT = process.env.PORT || 4200;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for in-memory or temp storage
const upload = multer({ storage: multer.memoryStorage() });

// In-memory cache for audio analysis of currently opened video
// Keyed by analysis version so pipeline changes never reuse stale envelopes
const audioCache = new Map();
const audioCacheKey = videoPath => `v${ANALYSIS_VERSION}:${videoPath}`;

/**
 * Endpoint: Parse uploaded subtitle file buffer
 */
app.post('/api/upload/subtitle', upload.single('subtitle'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '자막 파일이 업로드되지 않았습니다.' });
    }

    const { text, encoding } = decodeSubtitleBuffer(req.file.buffer);
    const parsed = parseSubtitle(text);

    let originalname = req.file.originalname;
    try {
      const decoded = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      if (decoded && !decoded.includes('\ufffd')) {
        originalname = decoded;
      }
    } catch (_) {
      originalname = req.file.originalname;
    }

    return res.json({
      success: true,
      filename: originalname,
      format: parsed.format,
      encoding,
      count: parsed.items.length,
      items: parsed.items
    });
  } catch (err) {
    return res.status(500).json({ error: `자막 파싱 실패: ${err.message}` });
  }
});

/**
 * Endpoint: Load local file path (Video or Subtitle)
 */
app.post('/api/load/local', async (req, res) => {
  try {
    const { videoPath, subtitlePath } = req.body;
    const response = {};

    const resolvedSub = resolveLocalFile(subtitlePath);
    if (resolvedSub && fs.existsSync(resolvedSub)) {
      const buffer = fs.readFileSync(resolvedSub);
      const { text, encoding } = decodeSubtitleBuffer(buffer);
      const parsed = parseSubtitle(text);
      response.subtitle = {
        path: resolvedSub,
        filename: path.basename(resolvedSub),
        format: parsed.format,
        encoding,
        count: parsed.items.length,
        items: parsed.items
      };
    }

    const resolvedVideo = resolveLocalFile(videoPath);
    if (resolvedVideo && fs.existsSync(resolvedVideo)) {
      const videoInfo = await probeVideo(resolvedVideo);
      response.video = {
        path: resolvedVideo,
        ...videoInfo
      };
    }

    return res.json({ success: true, ...response });
  } catch (err) {
    return res.status(500).json({ error: `파일 로드 실패: ${err.message}` });
  }
});

/**
 * Endpoint: Stream video (supports range requests and transcoding)
 */
app.get('/api/stream/video', async (req, res) => {
  try {
    let videoPath = req.query.path;
    const seekTime = parseFloat(req.query.t || '0');

    videoPath = resolveLocalFile(videoPath);
    if (!videoPath || !fs.existsSync(videoPath)) {
      return res.status(404).send('비디오 파일을 찾을 수 없습니다.');
    }

    const videoInfo = await probeVideo(videoPath);

    if (videoInfo.isDirectPlayable && seekTime === 0) {
      return streamDirectVideo(videoPath, req, res);
    } else {
      return streamTranscodedVideo(videoPath, seekTime, res, videoInfo.vCodec);
    }
  } catch (err) {
    return res.status(500).send(`스트리밍 오류: ${err.message}`);
  }
});

/**
 * Endpoint: Analyze audio and extract envelope + waveform
 */
app.post('/api/audio/analyze', async (req, res) => {
  try {
    let { videoPath } = req.body;
    videoPath = resolveLocalFile(videoPath);
    if (!videoPath || !fs.existsSync(videoPath)) {
      return res.status(400).json({ error: '비디오 파일 경로가 유효하지 않습니다.' });
    }

    if (audioCache.has(audioCacheKey(videoPath))) {
      const cached = audioCache.get(audioCacheKey(videoPath));
      return res.json({
        success: true,
        duration: cached.duration,
        waveformOverview: cached.waveformOverview,
        cached: true
      });
    }

    const analysis = await extractAudioEnvelope(videoPath);
    audioCache.set(audioCacheKey(videoPath), analysis);

    return res.json({
      success: true,
      duration: analysis.duration,
      waveformOverview: analysis.waveformOverview,
      cached: false
    });
  } catch (err) {
    return res.status(500).json({ error: `오디오 분석 실패: ${err.message}` });
  }
});

/**
 * Endpoint: Auto sync calculation using Voice Activity Detection & correlation
 */
app.post('/api/sync/auto', async (req, res) => {
  try {
    let { videoPath, subtitles } = req.body;
    videoPath = resolveLocalFile(videoPath);
    if (!videoPath || !fs.existsSync(videoPath)) {
      return res.status(400).json({ error: '비디오 파일 경로가 필요합니다.' });
    }
    if (!subtitles || !Array.isArray(subtitles)) {
      return res.status(400).json({ error: '자막 목록이 필요합니다.' });
    }

    let audioData = audioCache.get(audioCacheKey(videoPath));
    if (!audioData) {
      audioData = await extractAudioEnvelope(videoPath);
      audioCache.set(audioCacheKey(videoPath), audioData);
    }

    const match = findOptimalSync(audioData.envelope, subtitles);

    // Apply match to items
    const syncedItems = applyLinearSync(subtitles, match.scale, match.offset);

    return res.json({
      success: true,
      scale: match.scale,
      offset: match.offset,
      confidence: match.confidence,
      pattern: match.pattern,
      correlation: match.correlation,
      audioSource: audioData.audioSource,
      driftPer10Min: Number(((match.scale - 1.0) * 600).toFixed(2)),
      syncedItems
    });
  } catch (err) {
    return res.status(500).json({ error: `자동 싱크 계산 실패: ${err.message}` });
  }
});

/**
 * Endpoint: Automatically locate a file on disk by filename
 */
app.post('/api/resolve/file', async (req, res) => {
  try {
    const { filename } = req.body;
    const resolved = resolveLocalFile(filename);
    if (!resolved) {
      return res.json({ success: false, error: '로컬 디스크에서 파일을 찾지 못했습니다.' });
    }

    let info = {};
    try {
      info = await probeVideo(resolved);
    } catch (e) {}

    return res.json({
      success: true,
      path: resolved,
      filename: path.basename(resolved),
      ...info
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint: Open native Windows file picker dialog
 */
app.post('/api/browse/native', async (req, res) => {
  try {
    const { type } = req.body;
    const selectedPath = await openNativeFileDialog(type || 'video');
    if (!selectedPath) {
      return res.json({ success: false, cancelled: true });
    }

    let info = {};
    if (type !== 'subtitle') {
      try {
        info = await probeVideo(selectedPath);
      } catch (e) {}
    }

    return res.json({
      success: true,
      path: selectedPath,
      filename: path.basename(selectedPath),
      ...info
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint: Calculate 2-point linear parameters and preview
 */
app.post('/api/sync/twopoint', (req, res) => {
  try {
    const { p1, p2, items, range } = req.body;
    if (!p1 || !p2) {
      return res.status(400).json({ error: '기준점 1과 기준점 2가 필요합니다.' });
    }

    const params = calculateTwoPointParameters(p1, p2);
    let syncedItems = null;

    if (items && Array.isArray(items)) {
      syncedItems = applyLinearSync(items, params.scale, params.offset, range);
    }

    return res.json({
      success: true,
      ...params,
      syncedItems
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * Endpoint: Apply custom scale and offset
 */
app.post('/api/sync/apply', (req, res) => {
  try {
    const { items, scale, offset, range } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: '자막 목록이 필요합니다.' });
    }

    const s = scale !== undefined ? Number(scale) : 1.0;
    const o = offset !== undefined ? Number(offset) : 0.0;
    const syncedItems = applyLinearSync(items, s, o, range);

    return res.json({
      success: true,
      syncedItems
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint: Save synced subtitle to file on disk
 */
app.post('/api/save/subtitle', (req, res) => {
  try {
    const { items, format, originalPath, targetPath, overwrite } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: '저장할 자막 내용이 없습니다.' });
    }

    const targetFormat = (format || 'SRT').toUpperCase();
    const serialized = serializeSubtitle(items, targetFormat);

    let finalPath = targetPath;
    if (!finalPath) {
      if (originalPath) {
        const dir = path.dirname(originalPath);
        const ext = `.${targetFormat.toLowerCase()}`;
        const baseName = path.basename(originalPath, path.extname(originalPath));

        if (overwrite) {
          // Backup original first
          const backupPath = path.join(dir, `${baseName}.original.bak`);
          if (!fs.existsSync(backupPath) && fs.existsSync(originalPath)) {
            fs.copyFileSync(originalPath, backupPath);
          }
          finalPath = path.join(dir, `${baseName}${ext}`);
        } else {
          finalPath = path.join(dir, `[synced] ${baseName}${ext}`);
        }
      } else {
        finalPath = path.join(process.cwd(), `[synced] subtitle.${targetFormat.toLowerCase()}`);
      }
    }

    // Always save in UTF-8
    fs.writeFileSync(finalPath, serialized, 'utf8');

    return res.json({
      success: true,
      savedPath: finalPath,
      size: serialized.length
    });
  } catch (err) {
    return res.status(500).json({ error: `자막 저장 실패: ${err.message}` });
  }
});

/**
 * Endpoint: Direct download of serialized subtitle
 */
app.post('/api/export/download', (req, res) => {
  try {
    const { items, format, filename } = req.body;
    const targetFormat = (format || 'SRT').toUpperCase();
    const content = serializeSubtitle(items, targetFormat);
    const baseName = filename ? path.basename(filename, path.extname(filename)) : 'subtitle';
    const downloadName = `[synced] ${baseName}.${targetFormat.toLowerCase()}`;

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(content);
  } catch (err) {
    return res.status(500).json({ error: `내보내기 실패: ${err.message}` });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🎬 SubSync Studio 서버가 시작되었습니다!`);
  console.log(`🌐 접속 주소: http://localhost:${PORT}`);
  console.log(`====================================================`);
});

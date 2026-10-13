const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Get video metadata using ffprobe
 * @param {string} filePath
 * @returns {Promise<{ duration: number, width: number, height: number, vCodec: string, aCodec: string, isDirectPlayable: boolean, filename: string }>}
 */
function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ];

    const proc = spawn('ffprobe', args, { windowsHide: true });
    let stdoutData = '';
    let stderrData = '';

    proc.stdout.on('data', data => {
      stdoutData += data.toString();
    });
    proc.stderr.on('data', data => {
      stderrData += data.toString();
    });

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`ffprobe failed: ${stderrData}`));
      }

      try {
        const info = JSON.parse(stdoutData);
        const videoStream = info.streams.find(s => s.codec_type === 'video');
        const audioStream = info.streams.find(s => s.codec_type === 'audio');

        const duration = parseFloat(info.format.duration || (videoStream && videoStream.duration) || 0);
        const vCodec = videoStream ? videoStream.codec_name : 'unknown';
        const aCodec = audioStream ? audioStream.codec_name : 'unknown';
        const ext = path.extname(filePath).toLowerCase();

        // Browser natively supports MP4/WebM with h264/av1/vp8/vp9 video and aac/opus/mp3 audio
        const directVideoCodecs = ['h264', 'avc1', 'vp8', 'vp9', 'av1'];
        const directAudioCodecs = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];
        const directContainers = ['.mp4', '.m4v', '.webm', '.ogg'];

        const isDirectPlayable = directContainers.includes(ext) &&
          directVideoCodecs.includes(vCodec.toLowerCase()) &&
          (!audioStream || directAudioCodecs.includes(aCodec.toLowerCase()));

        resolve({
          duration,
          width: videoStream ? videoStream.width : 0,
          height: videoStream ? videoStream.height : 0,
          vCodec,
          aCodec,
          ext,
          isDirectPlayable,
          filename: path.basename(filePath)
        });
      } catch (err) {
        reject(new Error(`Failed to parse ffprobe output: ${err.message}`));
      }
    });
  });
}

/**
 * Handle direct Range-request streaming for natively playable files
 * @param {string} filePath
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function streamDirectVideo(filePath, req, res) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4'
    };

    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes'
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
}

/**
 * Transcode/Remux video on-the-fly using FFmpeg for non-native files (MKV, AVI, AC3 audio, etc.)
 * @param {string} filePath
 * @param {number} startTime
 * @param {import('express').Response} res
 * @param {string} vCodec
 */
function streamTranscodedVideo(filePath, startTime, res, vCodec = '') {
  const isH264 = ['h264', 'avc1'].includes(vCodec.toLowerCase());

  // If video is already H264, copy video stream and only re-encode audio to AAC (very fast!)
  const vCopy = isH264;

  const args = [
    '-ss', String(startTime || 0),
    '-i', filePath,
    '-c:v', vCopy ? 'copy' : 'libx264',
    ...(vCopy ? [] : ['-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '26']),
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1'
  ];

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Transfer-Encoding': 'chunked'
  });

  const proc = spawn('ffmpeg', args, { windowsHide: true });
  proc.stdout.pipe(res);

  reqCloseHandler = () => {
    try { proc.kill('SIGKILL'); } catch (e) {}
  };
  res.on('close', reqCloseHandler);
}

module.exports = {
  probeVideo,
  streamDirectVideo,
  streamTranscodedVideo
};

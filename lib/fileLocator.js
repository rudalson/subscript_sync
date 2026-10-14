const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const userHome = os.homedir();

// Standard locations where users store videos and subtitles
const searchRoots = [
  process.cwd(),
  path.join(userHome, 'Videos'),
  path.join(userHome, 'Downloads'),
  path.join(userHome, 'Desktop'),
  path.join(userHome, 'Documents'),
  path.join(userHome, 'Videos', 'Captures'),
  path.join(userHome, 'Movies')
];

// Add common drive roots if they exist on Windows
['D:', 'E:', 'F:'].forEach(drive => {
  if (fs.existsSync(drive)) {
    const v = path.join(drive, 'Videos');
    const m = path.join(drive, 'Movies');
    const d = path.join(drive, 'Downloads');
    if (fs.existsSync(v)) searchRoots.push(v);
    if (fs.existsSync(m)) searchRoots.push(m);
    if (fs.existsSync(d)) searchRoots.push(d);
  }
});

// Cache of recently resolved paths for instant lookup
const resolvedPathCache = new Map();

/**
 * Automatically locate an existing file on disk given a path or filename
 * @param {string} inputPath
 * @returns {string|null} Full absolute path, or null if not found
 */
function resolveLocalFile(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return null;

  const trimmed = inputPath.trim();
  if (!trimmed) return null;

  // 1. Direct check if path exists
  try {
    if (fs.existsSync(trimmed)) {
      const stat = fs.statSync(trimmed);
      if (stat.isFile()) return path.resolve(trimmed);
    }
  } catch (e) {}

  const baseName = path.basename(trimmed);

  // 2. Check cache
  if (resolvedPathCache.has(baseName)) {
    const cached = resolvedPathCache.get(baseName);
    if (fs.existsSync(cached)) return cached;
  }

  // 3. Search in standard user media directories
  for (const dir of searchRoots) {
    if (!fs.existsSync(dir)) continue;

    const directCandidate = path.join(dir, baseName);
    try {
      if (fs.existsSync(directCandidate) && fs.statSync(directCandidate).isFile()) {
        resolvedPathCache.set(baseName, directCandidate);
        return directCandidate;
      }
    } catch (e) {}

    // Check 1-level subdirectories (e.g. Downloads\Spider-Man.2026\file.mkv)
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subCandidate = path.join(dir, entry.name, baseName);
          if (fs.existsSync(subCandidate) && fs.statSync(subCandidate).isFile()) {
            resolvedPathCache.set(baseName, subCandidate);
            return subCandidate;
          }
        }
      }
    } catch (e) {}
  }

  return null;
}

/**
 * Open native Windows Explorer File Dialog to let user pick a file
 * Returns absolute path of selected file or null
 * @param {'video'|'subtitle'|'all'} type
 * @returns {Promise<string|null>}
 */
function openNativeFileDialog(type = 'video') {
  return new Promise((resolve) => {
    let filter = '모든 파일 (*.*)|*.*';
    let title = '파일 선택';

    if (type === 'video') {
      filter = '비디오 파일 (*.mp4;*.mkv;*.avi;*.webm;*.mov;*.ts)|*.mp4;*.mkv;*.avi;*.webm;*.mov;*.ts|모든 파일 (*.*)|*.*';
      title = '동영상 파일 선택';
    } else if (type === 'subtitle') {
      filter = '자막 파일 (*.srt;*.smi;*.sami;*.vtt)|*.srt;*.smi;*.sami;*.vtt|모든 파일 (*.*)|*.*';
      title = '자막 파일 선택';
    }

    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = '${filter.replace(/'/g, "''")}'
$f.Title = '${title.replace(/'/g, "''")}'
$f.InitialDirectory = [Environment]::GetFolderPath('MyVideos')
$res = $f.ShowDialog()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::WriteLine($f.FileName)
}
`;

    const proc = spawn('powershell', ['-NoProfile', '-Command', psScript], {
      windowsHide: false // Must allow dialog window to show
    });

    let stdout = '';
    proc.stdout.on('data', data => {
      stdout += data.toString('utf8');
    });

    proc.on('close', () => {
      const filePath = stdout.trim();
      if (filePath && fs.existsSync(filePath)) {
        resolvedPathCache.set(path.basename(filePath), filePath);
        resolve(filePath);
      } else {
        resolve(null);
      }
    });

    proc.on('error', () => {
      resolve(null);
    });
  });
}

module.exports = {
  resolveLocalFile,
  openNativeFileDialog
};

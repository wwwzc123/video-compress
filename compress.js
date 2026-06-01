// 视频压缩工具 — 用 FFmpeg 把大视频压成小视频
// 用法: node compress.js <输入> [输出] [选项]
// 需要安装 FFmpeg: https://ffmpeg.org/download.html

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

// ===== 预设 =====
const PRESETS = {
  high:   { crf: 23, preset: 'slow',   desc: '高质量（文件较大）' },
  medium: { crf: 28, preset: 'medium', desc: '中等（推荐）' },
  low:    { crf: 35, preset: 'fast',   desc: '低质量（文件最小）' },
};

const SIZES = {
  '1080p': { w: 1920, h: 1080 },
  '720p':  { w: 1280, h: 720 },
  '480p':  { w: 854,  h: 480 },
  '360p':  { w: 640,  h: 360 },
};

// ===== 工具函数 =====
function fmtBytes(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + ' KB';
  return bytes + ' B';
}

function pct(part, total) {
  return total > 0 ? ((1 - part / total) * 100).toFixed(1) + '%' : '—';
}

function parseDuration(raw) {
  // ffprobe 输出的 Duration: 00:01:23.45
  const m = (raw || '').match(/(\d+):(\d+):(\d+\.?\d*)/);
  if (!m) return null;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
}

// ===== 检查 ffmpeg =====
function findFFmpeg() {
  // 搜索路径
  const candidates = [
    'ffmpeg',
    path.join(__dirname, 'ffmpeg.exe'),
  ];

  // winget 安装路径
  const wingetBase = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(wingetBase)) {
    const dirs = fs.readdirSync(wingetBase);
    for (const d of dirs) {
      if (d.startsWith('Gyan.FFmpeg')) {
        const bin = path.join(wingetBase, d, 'ffmpeg-8.1.1-full_build', 'bin', 'ffmpeg.exe');
        if (fs.existsSync(bin)) candidates.push(bin);
      }
    }
  }

  // 检查 PATH
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
  } catch {}

  for (const c of candidates) {
    if (c !== 'ffmpeg' && fs.existsSync(c)) {
      const probe = c.replace(/ffmpeg\.exe$/, 'ffprobe.exe');
      return { ffmpeg: c, ffprobe: fs.existsSync(probe) ? probe : c };
    }
  }

  console.error('\n  ✖ 未找到 FFmpeg');
  console.error('  安装: winget install ffmpeg   或   https://ffmpeg.org/download.html\n');
  process.exit(1);
}

const { ffmpeg: ffmpegPath, ffprobe: ffprobePath } = findFFmpeg();

// ===== 获取视频信息 =====
function probe(file) {
  try {
    const out = execSync(`"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${file}"`, {
      encoding: 'utf-8', maxBuffer: 1024 * 1024,
    });
    const data = JSON.parse(out);
    const v = data.streams.find(s => s.codec_type === 'video');
    return {
      width: v ? v.width : null,
      height: v ? v.height : null,
      codec: v ? v.codec_name : '?',
      duration: parseFloat(data.format?.duration) || 0,
      bitrate: parseInt(data.format?.bit_rate) || 0,
      size: parseInt(data.format?.size) || fs.statSync(file).size,
    };
  } catch {
    return { size: fs.statSync(file).size };
  }
}

// ===== 压缩 =====
function compress(input, output, { crf, preset, size, bitrate }) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', input, '-c:v', 'libx264', '-preset', preset, '-crf', String(crf)];

    // 分辨率
    if (size && SIZES[size]) {
      const { w, h } = SIZES[size];
      args.push('-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`);
    }

    // 码率上限
    if (bitrate) {
      args.push('-maxrate', bitrate, '-bufsize', bitrate);
    }

    // 音频: AAC 128k
    args.push('-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output);

    const info = probe(input);
    const totalSec = info.duration || 0;
    const startTime = Date.now();

    console.log(`\n  输入: ${path.basename(input)}  (${fmtBytes(info.size)})`);
    console.log(`  预设: ${preset} / CRF ${crf}${size ? ' / ' + size : ''}`);
    console.log(`  输出: ${path.basename(output)}`);
    console.log(`  ${''.padEnd(40, '─')}`);

    const child = spawn(ffmpegPath, args);

    let lastLine = '';
    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      lastLine = lines[lines.length - 1] || lastLine;

      // 从 ffmpeg stderr 解析进度: time=00:00:05.12
      const m = lastLine.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
      if (m && totalSec > 0) {
        const elapsed = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
        const pctDone = Math.min(100, ((elapsed / totalSec) * 100));
        const barLen = 30;
        const done = Math.round((pctDone / 100) * barLen);
        const bar = '█'.repeat(done) + '░'.repeat(barLen - done);

        const elapsedReal = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? (elapsedReal / elapsed).toFixed(1) : '?';

        process.stdout.write(`\r  [${bar}] ${pctDone.toFixed(0)}%  ${speed}x  `);
      }
    });

    child.on('close', (code) => {
      process.stdout.write('\n');
      if (code === 0) {
        const outInfo = probe(output);
        const saved = info.size - outInfo.size;
        console.log(`  ${''.padEnd(40, '─')}`);
        console.log(`  ✅ 完成`);
        console.log(`  压缩前: ${fmtBytes(info.size)}`);
        console.log(`  压缩后: ${fmtBytes(outInfo.size)}`);
        console.log(`  节省了: ${fmtBytes(saved)}  (${pct(outInfo.size, info.size)})\n`);
        resolve(output);
      } else {
        reject(new Error(`ffmpeg 退出码: ${code}`));
      }
    });

    child.on('error', reject);
  });
}

// ===== CLI =====
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: null, output: null, quality: 'medium', size: null, bitrate: null };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--quality' || a === '-q') {
      const q = args[++i];
      if (q && PRESETS[q]) opts.quality = q;
    } else if (a === '--size' || a === '-s') {
      const s = args[++i];
      if (s && SIZES[s]) opts.size = s;
    } else if (a === '--bitrate' || a === '-b') {
      opts.bitrate = args[++i];
    } else if (a === '--help' || a === '-h') {
      showHelp();
      process.exit(0);
    } else if (!opts.input) {
      opts.input = a;
    } else if (!opts.output) {
      opts.output = a;
    }
  }

  return opts;
}

function showHelp() {
  console.log(`
  视频压缩工具 — 基于 FFmpeg

  用法: node compress.js <输入> [输出] [选项]

  选项:
    --quality, -q   质量预设: high / medium / low
    --size, -s      目标分辨率: 1080p / 720p / 480p / 360p
    --bitrate, -b   最大码率, 如 2M / 500k

  预设说明:
    high      CRF 23, 高质量，文件较大
    medium    CRF 28, 中等（默认），平衡
    low       CRF 35, 低质量，文件最小

  示例:
    node compress.js 大视频.mp4
    node compress.js input.mp4 output.mp4 -q low -s 720p
    node compress.js input.mp4 -s 480p -b 500k

  需要 FFmpeg: https://ffmpeg.org/download.html
`);
}

async function main() {
  const opts = parseArgs();

  if (!opts.input) {
    console.error('\n  ✖ 请提供输入文件');
    console.error('  用法: node compress.js <输入> [输出] [选项]\n');
    process.exit(1);
  }

  if (!fs.existsSync(opts.input)) {
    console.error(`\n  ✖ 文件不存在: ${opts.input}\n`);
    process.exit(1);
  }

  // 自动生成输出文件名
  if (!opts.output) {
    const dir = path.dirname(opts.input);
    const ext = path.extname(opts.input);
    const name = path.basename(opts.input, ext);
    opts.output = path.join(dir, `${name}_compressed${ext}`);
  }

  const { crf, preset } = PRESETS[opts.quality];

  try {
    await compress(opts.input, opts.output, { crf, preset, size: opts.size, bitrate: opts.bitrate });
  } catch (e) {
    console.error(`\n  ✖ 压缩失败: ${e.message}`);
    console.error('  请确认已安装 FFmpeg: https://ffmpeg.org/download.html\n');
    process.exit(1);
  }
}

main();

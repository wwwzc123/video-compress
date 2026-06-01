# video-compress

把大视频压成小视频，基于 FFmpeg。

## 安装

```bash
npm install -g github:wwwzc123/video-compress
```

装完后 `vpress` 就是全局命令。

**依赖 FFmpeg**：没装的话 `winget install ffmpeg`（Mac: `brew install ffmpeg`）。

## 使用

```bash
# 默认压缩
vpress 大视频.mp4

# 高压缩
vpress 大视频.mp4 -q low -s 480p

# 指定输出
vpress input.mp4 output.mp4 -s 720p

# 限制码率
vpress input.mp4 -b 500k
```

## 参数

| 参数 | 可选值 | 默认 |
|------|--------|------|
| `-q` 质量 | high / medium / low | medium |
| `-s` 分辨率 | 1080p / 720p / 480p / 360p | 原尺寸 |
| `-b` 码率 | 1M / 500k | 不限制 |

## 示例

压缩前 607 KB → 压缩后 187 KB，节省 **69%**：
```
vpress test.mp4 -q low -s 480p
```

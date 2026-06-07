# QweenFFmpeg

Server-side video render and processing pipeline for [QweenApp](https://github.com/your-org/qween-app).  
Stitch frames into video, or process existing videos — crop, trim, scale, segment — with output format choice.

```
qween-ffmpeg/
├── apps/
│   ├── api/               ← Python FastAPI  (port 8000)
│   └── web/               ← Next.js 14 UI   (port 3000)
│       └── src/
│           ├── app/       ← Shell + routing
│           ├── components/ui/  ← Shared UI primitives
│           ├── tools/     ← One file per tool
│           └── lib/api.ts ← API client
├── .codesandbox/
│   └── tasks.json         ← Setup + manual run tasks
├── .github/
│   └── workflows/ci.yml
└── README.md
```

---

## Tools

| Tool | Input | What it does |
|------|-------|-------------|
| **Stitch** | ZIP of image frames | Assembles frames → video at chosen FPS, quality, and format |
| **Crop** | Video file | Crops a region from the video |
| **Trim** | Video file | Cuts start/end by time |
| **Scale** | Video file | Resizes to preset or custom dimensions |
| **Segment** | Video file | Splits into equal-length chunks |

**Output formats:** MP4, MOV, WebM, GIF *(GIF on Stitch only)*

---

## Setup — CodeSandbox

Dependencies are installed automatically on sandbox boot via `setupTasks` in `.codesandbox/tasks.json`.  
Servers are **not** auto-started — run them manually from the Tasks panel:

1. Click **▶ Run API (FastAPI :8000)** — starts the Python API
2. Click **▶ Run Web (Next.js :3000)** — starts the Next.js UI
3. Open port **3000** for the UI · port **8000/docs** for the Swagger explorer
4. Optionally run **✓ Health check** to verify ffmpeg is available

---

## Setup — Local

### 1. Install system dependencies

**ffmpeg** (required — system binary, not a pip package):

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt update && sudo apt install -y ffmpeg

# Windows
winget install ffmpeg
```

Verify:
```bash
ffmpeg -version
ffprobe -version
```

**pnpm** (required for Next.js):
```bash
npm install -g pnpm@9.1.0
```

### 2. Install project dependencies

```bash
# Next.js
cd apps/web && pnpm install

# Python API
cd apps/api
pip install -r requirements.txt
python -m playwright install chromium --with-deps
```

### 3. Run servers

Run each in a separate terminal:

```bash
# Terminal 1 — API
cd apps/api && uvicorn main:app --reload --port 8000 --host 0.0.0.0

# Terminal 2 — Web
cd apps/web && pnpm dev
```

- UI → http://localhost:3000
- API docs → http://localhost:8000/docs

Or run both at once from the project root:
```bash
pnpm dev
```

---

## Connecting QweenApp

In QweenApp v183+, open the menu → **Render to Server…**  
Paste your API server URL (e.g. `https://xxxx-8000.csb.app`) into the **Render Server URL** field.

Two render modes:

| Button | Mode | Best for |
|--------|------|----------|
| **▶ SVG Render** | Captures frames in-browser via GSAP seek → sends ZIP → server stitches | SVG / animation-only compositions |
| **◈ Video Render** | Sends full stage HTML + video blobs + fonts → Playwright renders frame-by-frame | Mixed video + SVG compositions |

---

## Render pipeline (Video Render)

```
QweenApp browser
  └─ collects: stage HTML, video blobs (IndexedDB), fonts, node metadata
       └─ POST /jobs/playwright-render
            └─ FastAPI spawns a thread
                 └─ Playwright (headless Chromium)
                      ├─ loads self-contained stage HTML
                      ├─ injects video base64 src + @font-face
                      ├─ waits for all <video> canplay events
                      └─ per frame:
                           ├─ window.__qween_seek(t)
                           ├─ waits for seeked + rAF flush
                           └─ page.screenshot() → frame_NNNNNN.png
                 └─ ffmpeg stitches → output file
            └─ GET /jobs/{id}/status  ← poll until done
       └─ GET /jobs/{id}/download     ← download result
```

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/health`                      | ffmpeg version check |
| `POST`   | `/jobs/upload`                 | Upload ZIP of frames → extract |
| `GET`    | `/jobs/{id}/frame/{n}`         | Serve preview frame |
| `POST`   | `/jobs/{id}/stitch`            | Stitch frames → video (format param) |
| `POST`   | `/jobs/{id}/process`           | Process video file (crop/trim/scale/format) |
| `GET`    | `/jobs/{id}/download`          | Download output file |
| `POST`   | `/jobs/{id}/segment`           | Split video into chunks |
| `GET`    | `/jobs/{id}/segment/{n}`       | Download a segment |
| `DELETE` | `/jobs/{id}`                   | Clean up job files |
| `GET`    | `/jobs`                        | List active jobs |
| `POST`   | `/jobs/playwright-render`      | Full Playwright render (JSON payload) |
| `GET`    | `/jobs/{id}/status`            | Poll render job progress |

Full interactive docs at `/docs`.

---

## Stitch parameters

| Param | Default | Description |
|-------|---------|-------------|
| `fps` | `30` | Frames per second |
| `crf` | `18` | Quality — 0 (lossless) to 51 (worst) |
| `preset` | `medium` | Encode speed (`ultrafast` → `veryslow`) |
| `format` | `mp4` | Output format: `mp4`, `mov`, `webm`, `gif` |
| `width` / `height` | source | Scale output (`-2` = auto-fit) |
| `trim_start` / `trim_end` | — | Trim in seconds |
| `crop_x/y/w/h` | — | Crop region |

## Process parameters (Crop / Trim / Scale)

| Param | Default | Description |
|-------|---------|-------------|
| `format` | `mp4` | Output format: `mp4`, `mov`, `webm` |
| `width` / `height` | source | Scale output |
| `trim_start` / `trim_end` | — | Trim in seconds |
| `crop_x/y/w/h` | — | Crop region |

## Segment parameters

| Param | Default | Description |
|-------|---------|-------------|
| `segment_duration` | `5` | Seconds per segment |

---

## Output quality guide

| CRF | Quality |
|-----|---------|
| 0–17 | Lossless / near-lossless |
| 18 *(default)* | Visually lossless |
| 19–28 | Good — smaller file |
| 29+ | Lossy — drafts only |

---

## Output format notes

| Format | Codec | Notes |
|--------|-------|-------|
| MP4 | H.264 (libx264) | Best compatibility |
| MOV | H.264 (libx264) | Apple ecosystem |
| WebM | VP9 (libvpx-vp9) | Web / open format — slower encode |
| GIF | palette-based | Stitch only · large files, 256 colours |

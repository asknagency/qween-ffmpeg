# QweenFFmpeg

Server-side video render pipeline for [QweenApp](https://github.com/your-org/qween-app).  
Upload a ZIP of frames **or** send a full stage composition — server renders via Playwright + ffmpeg.

```
qween-ffmpeg/
├── apps/
│   ├── api/          ← Python FastAPI  (port 8000)
│   └── web/          ← Next.js 14 UI  (port 3000)
├── .codesandbox/
│   └── tasks.json    ← auto-start config
├── .github/
│   └── workflows/ci.yml
└── README.md
```

---

## Quick start — CodeSandbox

1. Upload this repo (or connect GitHub)
2. CodeSandbox reads `.codesandbox/tasks.json` and auto-installs + starts both servers
3. Open port **3000** for the UI · port **8000/docs** for the Swagger API explorer

---

## Quick start — Local

**Requirements:** Node 20+, Python 3.11+, pnpm 9+, ffmpeg (see below)

### 1. Install ffmpeg (system binary — required)

**macOS**
```bash
brew install ffmpeg
```

**Ubuntu / Debian**
```bash
sudo apt update && sudo apt install -y ffmpeg
```

**Windows**
```bash
winget install ffmpeg
```

Verify:
```bash
ffmpeg -version
ffprobe -version
```

### 2. Install pnpm (if not already)
```bash
npm install -g pnpm@9.1.0
```

### 3. Install project dependencies
```bash
# Web (Next.js)
cd apps/web && pnpm install

# API (Python)
cd ../api && pip install -r requirements.txt
python -m playwright install chromium --with-deps
```

### 4. Run both servers
```bash
# From repo root — starts both concurrently
pnpm dev
```

- UI → http://localhost:3000  
- API docs → http://localhost:8000/docs

---

## Connecting QweenApp

In QweenApp v183+, open the menu → **Render to Server…**  
Paste your server URL (e.g. `https://xxxx-8000.csb.app`) into the **Render Server URL** field.  
It is saved to `localStorage` — set it once and forget it.

Two render modes are available from within QweenApp:

| Button | Mode | Best for |
|--------|------|----------|
| **▶ SVG Render** | Captures frames in-browser via GSAP seek → sends ZIP → server stitches | SVG/animation-only compositions |
| **◈ Video Render** | Sends full stage HTML + video blobs + fonts → Playwright renders frame-by-frame | Mixed video + SVG compositions |

---

## Render pipeline (Video Render)

```
QweenApp browser
  └─ collects: stage HTML, video blobs (from IndexedDB), fonts, node metadata
       └─ POST /jobs/playwright-render
            └─ FastAPI spins up a thread
                 └─ Playwright (headless Chromium)
                      ├─ loads self-contained stage HTML
                      ├─ injects video base64 src + font @font-face
                      ├─ waits for all <video> canplay events
                      └─ per frame:
                           ├─ window.__qween_seek(t)   ← seeks GSAP + all videos
                           ├─ waits for seeked + rAF flush
                           └─ page.screenshot() → frame_NNNNNN.png
                 └─ ffmpeg stitches frames → output.mp4
            └─ GET /jobs/{id}/status  ← QweenApp polls until done
       └─ GET /jobs/{id}/download     ← download MP4
```

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | ffmpeg version check |
| `POST` | `/jobs/upload` | Upload ZIP of frames → extract |
| `GET` | `/jobs/{id}/frame/{n}` | Serve preview frame |
| `POST` | `/jobs/{id}/stitch` | Stitch frames → MP4 |
| `GET` | `/jobs/{id}/download` | Download output MP4 |
| `POST` | `/jobs/{id}/segment` | Split MP4 into chunks |
| `GET` | `/jobs/{id}/segment/{n}` | Download segment |
| `DELETE` | `/jobs/{id}` | Clean up job files |
| `GET` | `/jobs` | List active jobs |
| `POST` | `/jobs/playwright-render` | Full Playwright render (JSON payload) |
| `GET` | `/jobs/{id}/status` | Poll render job progress |

Full interactive docs at `/docs` (Swagger UI).

---

## Stitch parameters

| Param | Default | Description |
|-------|---------|-------------|
| `fps` | `30` | Frames per second |
| `crf` | `18` | Quality — 0 (lossless) to 51 (worst) |
| `preset` | `medium` | Encode speed (`ultrafast` → `veryslow`) |
| `width` / `height` | source | Scale output (use `-2` for auto-fit) |
| `trim_start` / `trim_end` | — | Trim in seconds |
| `crop_x/y/w/h` | — | Crop region |
| `segment_duration` | `5` | Seconds per segment when splitting |

---

## Output quality guide

| CRF | Quality |
|-----|---------|
| 0–17 | Lossless / near-lossless |
| 18 *(default)* | Visually lossless |
| 19–28 | Good — smaller file |
| 29+ | Lossy — use only for drafts |

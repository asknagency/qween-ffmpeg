# Qween

A 3-in-1 monorepo for creating, rendering, and processing GSAP animations into video.

```
apps/
├── api/   FastAPI  · port 8000  — ffmpeg jobs, asset store, render orchestration
├── app/   Node.js  · port 3000  — serves QweenRender.html + project ZIPs to Playwright
└── web/   Next.js  · port 5000  — QweenFFmpeg tools UI
```

## How it works

```
User exports project.zip from QweenApp
  → POST /jobs/render-project  (FastAPI, port 8000)
      saves ZIP to apps/app/public/projects/{job_id}.zip
  → Playwright opens http://localhost:3000/QweenRender.html?src=.../projects/{job_id}.zip
      real GSAP, real AnimationEngine, real DOM
      window.__qween_ready     — signals timeline is built
      window.__qween_seek(t)   — seeks every frame
      window.__qween_frame_ready — signals frame is painted
  → screenshots → ffmpeg → output video
  → GET /jobs/{job_id}/download
```

## Quick start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Python 3.11+
- ffmpeg (in PATH)

### Install

```bash
# Clone and install everything
git clone https://github.com/your-org/qween.git
cd qween

# Install Node deps (web + app)
pnpm install

# Install Python deps + Playwright browser
cd apps/api
pip install -r requirements.txt
python -m playwright install chromium --with-deps
cd ../..
```

### Run all three apps

```bash
pnpm dev
```

| App | URL | What it does |
|-----|-----|--------------|
| `apps/app` | http://localhost:3000 | Serves QweenRender.html for Playwright |
| `apps/api` | http://localhost:8000 | FastAPI render & ffmpeg API |
| `apps/web` | http://localhost:5000 | QweenFFmpeg tools UI |

## Render a project via curl

```bash
# Submit project ZIP
curl -X POST http://localhost:8000/jobs/render-project \
  -F "file=@my-project.zip" \
  -F "fps=30" \
  -F "format=mp4"
# → {"job_id": "abc123", "poll_url": "/jobs/abc123/status", ...}

# Poll until done
curl http://localhost:8000/jobs/abc123/status

# Download output
curl -O -J http://localhost:8000/jobs/abc123/download
```

Or use the included test script:

```bash
chmod +x test_render.sh
./test_render.sh                                    # localhost
./test_render.sh http://localhost:8000 project.zip  # with real project
```

## Architecture

### `apps/api` — FastAPI

- `POST /jobs/render-project` — accepts project ZIP, saves it for Playwright, queues render
- `POST /jobs/playwright-render` — accepts raw JSON payload (from QweenApp browser)
- `GET  /jobs/{id}/status` — poll render progress
- `GET  /jobs/{id}/download` — download rendered video
- `POST /assets/upload` — upload video/font asset, returns `asset_id`
- `GET  /assets/{id}` — serve asset file
- `GET  /health` — server status

### `apps/app` — Node.js renderer

- Serves `QweenRender.html` at `GET /`
- Serves project ZIPs at `GET /projects/{job_id}.zip`
- `GET /health` — renderer status
- `GET /projects` — list stored projects
- `DELETE /projects/{id}` — clean up a project ZIP

### `apps/web` — Next.js

QweenFFmpeg tools: Stitch, Crop, Trim, Scale, Segment, Merge, Recent jobs.

## QweenRender.html

The renderer page that Playwright drives. Accepts a project ZIP via `?src=` URL:

```
http://localhost:3000/QweenRender.html?src=http://localhost:3000/projects/abc123.zip
```

Exposes three hooks for Playwright:

| Hook | Type | Description |
|------|------|-------------|
| `window.__qween_ready` | `boolean` | `true` after timeline is built and playing |
| `window.__qween_seek(t)` | `async function` | Pause + seek timeline and all videos to time `t` |
| `window.__qween_frame_ready` | `boolean` | `true` after seek is complete and frame is painted |

## Updating QweenRender.html

QweenRender.html lives in `apps/app/public/`. It contains the full `AnimationEngine`
copied from QweenApp. When QweenApp's animation engine changes:

1. Copy the updated `AnimationEngine` class from `QweenApp.html`
2. Paste it into `QweenRender.html` (replace the existing class)
3. The three Playwright hooks (`__qween_seek` etc.) at the bottom of `run()` stay unchanged

> **Future:** Extract `AnimationEngine` to a shared module and auto-generate
> `QweenRender.html` at build time — eliminating the manual copy step entirely.

## Environment variables

### Configure env files (required before first run)

Copy each `.env.example` to `.env` and fill in values for your environment:

```bash
# Root
cp .env.example .env

# Per-app
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

| File | Key variables |
|------|---------------|
| `.env` / `apps/api/.env` | `PORT=8000`, `RENDERER_PORT=3000`, `CORS_ORIGINS`, `WORK_DIR`, `ASSETS_DIR` |
| `apps/web/.env` | `NEXT_PUBLIC_API_URL=http://localhost:8000` |

Update these values whenever you change ports, deploy to a new host, or reconfigure storage paths.

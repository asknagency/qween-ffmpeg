import asyncio
import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiofiles
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ── App setup ────────────────────────────────────────────────────────────────
app = FastAPI(title="QweenFFmpeg API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WORK_DIR = Path(tempfile.gettempdir()) / "qween_ffmpeg"
WORK_DIR.mkdir(exist_ok=True)

# ── Helpers ───────────────────────────────────────────────────────────────────

def new_job() -> tuple[str, Path]:
    job_id = str(uuid.uuid4())
    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True)
    return job_id, job_dir


def run_ffmpeg(args: list[str], cwd: Path | None = None) -> tuple[int, str, str]:
    result = subprocess.run(
        ["ffmpeg", "-y", *args],
        capture_output=True,
        text=True,
        cwd=str(cwd) if cwd else None,
    )
    return result.returncode, result.stdout, result.stderr


def cleanup_job(job_dir: Path):
    shutil.rmtree(job_dir, ignore_errors=True)


def natural_sort_key(s: str):
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r"(\d+)", s)]


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
    version_line = result.stdout.splitlines()[0] if result.stdout else "unknown"
    return {"status": "ok", "ffmpeg": version_line}


# ── 1. Upload ZIP → extract frames → return preview info ─────────────────────

@app.post("/jobs/upload")
async def upload_frames(file: UploadFile = File(...)):
    if not file.filename.endswith(".zip"):
        raise HTTPException(400, "Please upload a ZIP file containing image frames.")

    job_id, job_dir = new_job()
    frames_dir = job_dir / "frames"
    frames_dir.mkdir()

    zip_path = job_dir / "upload.zip"
    async with aiofiles.open(zip_path, "wb") as f:
        content = await file.read()
        await f.write(content)

    # Extract
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(frames_dir)

    # Flatten nested folders (common when exporting from apps)
    all_images: list[Path] = []
    for ext in ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp", "*.tiff"):
        all_images.extend(frames_dir.rglob(ext))

    if not all_images:
        shutil.rmtree(job_dir)
        raise HTTPException(400, "No image files found inside the ZIP.")

    # Move all to flat frames dir and rename sequentially (natural sort)
    flat_dir = job_dir / "flat"
    flat_dir.mkdir()
    all_images.sort(key=lambda p: natural_sort_key(p.name))

    ext = all_images[0].suffix.lower()
    for i, img in enumerate(all_images):
        shutil.copy(img, flat_dir / f"frame_{i:06d}{ext}")

    # Probe first frame for dimensions
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0",
            str(flat_dir / f"frame_000000{ext}"),
        ],
        capture_output=True, text=True,
    )
    dims = probe.stdout.strip().split(",") if probe.stdout.strip() else ["?", "?"]
    width = dims[0] if len(dims) > 0 else "?"
    height = dims[1] if len(dims) > 1 else "?"

    return {
        "job_id": job_id,
        "frame_count": len(all_images),
        "extension": ext,
        "width": width,
        "height": height,
        "first_frame": f"/jobs/{job_id}/frame/0",
    }


# ── 2. Serve a preview frame ──────────────────────────────────────────────────

@app.get("/jobs/{job_id}/frame/{index}")
def get_frame(job_id: str, index: int):
    job_dir = WORK_DIR / job_id
    flat_dir = job_dir / "flat"
    if not flat_dir.exists():
        raise HTTPException(404, "Job not found.")

    frames = sorted(flat_dir.iterdir(), key=lambda p: natural_sort_key(p.name))
    if index >= len(frames) or index < 0:
        raise HTTPException(404, "Frame index out of range.")

    return FileResponse(frames[index])


# ── 3. Stitch frames → video ──────────────────────────────────────────────────

@app.post("/jobs/{job_id}/stitch")
async def stitch(
    job_id: str,
    fps: float = Form(30),
    crf: int = Form(18),          # quality: 0 (lossless) – 51 (worst); 18 = visually lossless
    width: Optional[int] = Form(None),
    height: Optional[int] = Form(None),
    preset: str = Form("medium"),  # ultrafast … veryslow
    trim_start: Optional[float] = Form(None),  # seconds
    trim_end: Optional[float] = Form(None),
    crop_x: Optional[int] = Form(None),
    crop_y: Optional[int] = Form(None),
    crop_w: Optional[int] = Form(None),
    crop_h: Optional[int] = Form(None),
):
    job_dir = WORK_DIR / job_id
    flat_dir = job_dir / "flat"
    if not flat_dir.exists():
        raise HTTPException(404, "Job not found.")

    frames = sorted(flat_dir.iterdir(), key=lambda p: natural_sort_key(p.name))
    if not frames:
        raise HTTPException(400, "No frames found for this job.")

    ext = frames[0].suffix.lower()
    input_pattern = str(flat_dir / f"frame_%06d{ext}")
    output_path = job_dir / "output.mp4"

    # Build filter chain
    filters = []

    if crop_x is not None and crop_y is not None and crop_w and crop_h:
        filters.append(f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}")

    if width or height:
        w = width or -2
        h = height or -2
        filters.append(f"scale={w}:{h}")

    vf_arg = ",".join(filters) if filters else None

    args = [
        "-framerate", str(fps),
        "-i", input_pattern,
    ]

    if trim_start is not None:
        args += ["-ss", str(trim_start)]
    if trim_end is not None:
        args += ["-to", str(trim_end)]

    args += ["-c:v", "libx264", "-crf", str(crf), "-preset", preset]

    if vf_arg:
        args += ["-vf", vf_arg]

    args += ["-pix_fmt", "yuv420p", str(output_path)]

    code, stdout, stderr = run_ffmpeg(args)

    if code != 0:
        raise HTTPException(500, f"ffmpeg error:\n{stderr}")

    size = output_path.stat().st_size
    return {
        "job_id": job_id,
        "download_url": f"/jobs/{job_id}/download",
        "size_bytes": size,
        "size_mb": round(size / 1_048_576, 2),
    }


# ── 4. Download output ────────────────────────────────────────────────────────

@app.get("/jobs/{job_id}/download")
def download(job_id: str):
    output_path = WORK_DIR / job_id / "output.mp4"
    if not output_path.exists():
        raise HTTPException(404, "Output not found. Run /stitch first.")
    return FileResponse(
        output_path,
        media_type="video/mp4",
        filename=f"qween_{job_id[:8]}.mp4",
    )


# ── 5. Segment video ──────────────────────────────────────────────────────────

@app.post("/jobs/{job_id}/segment")
async def segment(
    job_id: str,
    segment_duration: float = Form(5.0),  # seconds per segment
):
    job_dir = WORK_DIR / job_id
    output_path = job_dir / "output.mp4"
    if not output_path.exists():
        raise HTTPException(404, "No output video found. Run /stitch first.")

    seg_dir = job_dir / "segments"
    seg_dir.mkdir(exist_ok=True)

    args = [
        "-i", str(output_path),
        "-c", "copy",
        "-map", "0",
        "-segment_time", str(segment_duration),
        "-f", "segment",
        "-reset_timestamps", "1",
        str(seg_dir / "seg_%03d.mp4"),
    ]

    code, _, stderr = run_ffmpeg(args)
    if code != 0:
        raise HTTPException(500, f"ffmpeg error:\n{stderr}")

    segments = sorted(seg_dir.glob("seg_*.mp4"))
    return {
        "job_id": job_id,
        "segment_count": len(segments),
        "segments": [
            {
                "index": i,
                "filename": s.name,
                "size_mb": round(s.stat().st_size / 1_048_576, 2),
                "download_url": f"/jobs/{job_id}/segment/{i}",
            }
            for i, s in enumerate(segments)
        ],
    }


@app.get("/jobs/{job_id}/segment/{index}")
def download_segment(job_id: str, index: int):
    seg_dir = WORK_DIR / job_id / "segments"
    segs = sorted(seg_dir.glob("seg_*.mp4")) if seg_dir.exists() else []
    if index >= len(segs) or index < 0:
        raise HTTPException(404, "Segment not found.")
    return FileResponse(segs[index], media_type="video/mp4", filename=segs[index].name)


# ── 6. Cleanup ────────────────────────────────────────────────────────────────

@app.delete("/jobs/{job_id}")
def delete_job(job_id: str, background_tasks: BackgroundTasks):
    job_dir = WORK_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(404, "Job not found.")
    background_tasks.add_task(cleanup_job, job_dir)
    return {"deleted": job_id}


# ── 7. List active jobs ───────────────────────────────────────────────────────

@app.get("/jobs")
def list_jobs():
    jobs = []
    for d in WORK_DIR.iterdir():
        if d.is_dir():
            flat = d / "flat"
            frame_count = len(list(flat.iterdir())) if flat.exists() else 0
            has_output = (d / "output.mp4").exists()
            jobs.append({
                "job_id": d.name,
                "frame_count": frame_count,
                "has_output": has_output,
            })
    return {"jobs": jobs}


# ── 8. Playwright render ──────────────────────────────────────────────────────

# In-memory job status store (survives the request, reset on server restart)
_render_jobs: Dict[str, Dict[str, Any]] = {}

class VideoAsset(BaseModel):
    nodeId: str
    slotId: str
    dbId: str
    mimeType: str
    label: str
    b64: str

class FontAsset(BaseModel):
    family: str
    weight: int = 400
    style: str = "normal"
    format: str = "woff2"
    b64: str

class NodeMeta(BaseModel):
    id: str
    type: str = "svg"
    width: float = 1080
    height: float = 1080
    zIndex: int = 0
    visible: bool = True
    svgContent: str = ""
    videoSlots: List[Dict[str, Any]] = []

class PlaywrightRenderRequest(BaseModel):
    fps: float = 30
    crf: int = 18
    startTime: float = 0
    endTime: float = 5
    stageWidth: float = 1080
    stageHeight: float = 1080
    nodes: List[NodeMeta] = []
    videoAssets: List[VideoAsset] = []
    fontAssets: List[FontAsset] = []
    gsapCdn: str = "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/gsap.min.js"


def _build_stage_html(req: PlaywrightRenderRequest, job_dir: Path) -> str:
    """Build a self-contained HTML page the headless browser will load."""

    # Inline font @font-face declarations
    font_css = ""
    for f in req.fontAssets:
        font_css += (
            f"@font-face {{font-family:'{f.family}';font-weight:{f.weight};"
            f"font-style:{f.style};"
            f"src:url('data:font/{f.format};base64,{f.b64}') format('{f.format}');}}\n"
        )

    # Build node layers HTML
    nodes_html = ""
    for node in sorted(req.nodes, key=lambda n: n.zIndex):
        if not node.visible:
            continue
        style = (
            f"position:absolute;top:0;left:0;"
            f"width:{node.width}px;height:{node.height}px;"
            f"z-index:{node.zIndex};"
        )
        if node.type == "svg":
            nodes_html += f'<div id="{node.id}" style="{style}">{node.svgContent}</div>\n'
        elif node.type == "video":
            for slot in node.videoSlots:
                slot_id = slot.get("treeId", node.id + "_video")
                db_id = slot.get("dbId", "")
                # video src will be injected by JS from the asset map
                nodes_html += (
                    f'<video id="{slot_id}" data-dbid="{db_id}" '
                    f'style="{style}object-fit:contain;" '
                    f'muted playsinline preload="auto"></video>\n'
                )

    # Build video asset injection script
    video_js = "const _videoAssets = {};\n"
    for va in req.videoAssets:
        video_js += (
            f"_videoAssets['{va.dbId}'] = 'data:{va.mimeType};base64,{va.b64}';\n"
        )

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ background:#000; overflow:hidden; }}
#stage {{ position:relative; width:{req.stageWidth}px; height:{req.stageHeight}px; overflow:hidden; }}
{font_css}
</style>
</head>
<body>
<div id="stage">
{nodes_html}
</div>
<script src="{req.gsapCdn}"></script>
<script>
{video_js}

// Inject video sources from base64 asset map
document.querySelectorAll('video[data-dbid]').forEach(v => {{
  const dbId = v.getAttribute('data-dbid');
  if (_videoAssets[dbId]) v.src = _videoAssets[dbId];
}});

// Signal ready state to Playwright
window.__qween_ready = false;
window.__qween_frame_done = false;

// Wait for all videos to be loadable then signal ready
Promise.all(
  Array.from(document.querySelectorAll('video')).map(v =>
    new Promise(res => {{
      if (v.readyState >= 2) {{ res(); return; }}
      v.addEventListener('canplay', res, {{ once: true }});
      v.addEventListener('error', res, {{ once: true }});
    }})
  )
).then(() => {{ window.__qween_ready = true; }});

// Frame seek function called by Playwright per frame
window.__qween_seek = async function(t) {{
  window.__qween_frame_done = false;
  // Seek GSAP timeline if present
  if (window.__masterTl) {{
    window.__masterTl.pause();
    window.__masterTl.time(t);
  }}
  // Seek all video elements — wait for seeked event
  const videos = Array.from(document.querySelectorAll('video'));
  await Promise.all(videos.map(v => new Promise(res => {{
    if (!v.src) {{ res(); return; }}
    v.pause();
    v.currentTime = t;
    const onSeeked = () => {{ v.removeEventListener('seeked', onSeeked); res(); }};
    v.addEventListener('seeked', onSeeked);
    // Fallback: resolve after 200ms if seeked never fires
    setTimeout(res, 200);
  }})));
  // Allow compositor to flush
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__qween_frame_done = true;
}};
</script>
</body>
</html>"""
    return html


def _run_playwright_render(job_id: str, req: PlaywrightRenderRequest, job_dir: Path):
    """Blocking function run in a thread — drives Playwright and ffmpeg."""
    status = _render_jobs[job_id]

    try:
        from playwright.sync_api import sync_playwright

        frames_dir = job_dir / "pw_frames"
        frames_dir.mkdir()

        # Write stage HTML to disk
        html_path = job_dir / "stage.html"
        html_path.write_text(_build_stage_html(req, job_dir), encoding="utf-8")

        fps = req.fps
        start_t = req.startTime
        end_t = req.endTime
        total_frames = max(1, round((end_t - start_t) * fps))
        w = int(req.stageWidth)
        h = int(req.stageHeight)

        status["message"] = "Launching headless browser…"
        status["progress"] = "0%"

        with sync_playwright() as p:
            browser = p.chromium.launch(
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--autoplay-policy=no-user-gesture-required",
                    "--disable-web-security",
                    "--allow-file-access-from-files",
                    "--disable-features=IsolateOrigins,site-per-process",
                ]
            )
            page = browser.new_page(viewport={"width": w, "height": h})

            # Load stage HTML
            page.goto(f"file://{html_path.resolve()}")

            # Wait up to 10s for assets to be ready
            page.wait_for_function("window.__qween_ready === true", timeout=10_000)
            status["message"] = "Browser ready — capturing frames…"

            for i in range(total_frames):
                t = start_t + (i / fps)
                # Seek to this time
                page.evaluate(f"window.__qween_seek({t})")
                page.wait_for_function("window.__qween_frame_done === true", timeout=5_000)

                # Screenshot this frame
                frame_path = frames_dir / f"frame_{i:06d}.png"
                page.screenshot(path=str(frame_path), clip={"x": 0, "y": 0, "width": w, "height": h})

                pct = round((i + 1) / total_frames * 100)
                status["message"] = f"Capturing frame {i + 1}/{total_frames}…"
                status["progress"] = f"{pct}%"

            browser.close()

        # ffmpeg stitch
        status["message"] = "Stitching frames with ffmpeg…"
        output_path = job_dir / "output.mp4"
        input_pattern = str(frames_dir / "frame_%06d.png")
        code, _, stderr = run_ffmpeg([
            "-framerate", str(fps),
            "-i", input_pattern,
            "-c:v", "libx264",
            "-crf", str(req.crf),
            "-preset", "medium",
            "-pix_fmt", "yuv420p",
            str(output_path),
        ])
        if code != 0:
            raise RuntimeError(f"ffmpeg error: {stderr}")

        size_mb = round(output_path.stat().st_size / 1_048_576, 2)
        status["status"] = "done"
        status["message"] = f"Done — {size_mb} MB"
        status["size_mb"] = size_mb
        status["progress"] = "100%"

    except Exception as e:
        status["status"] = "error"
        status["message"] = str(e)


@app.post("/jobs/playwright-render")
async def playwright_render(req: PlaywrightRenderRequest, background_tasks: BackgroundTasks):
    """Accept full composition payload, render via Playwright in background."""
    job_id, job_dir = new_job()
    _render_jobs[job_id] = {
        "status": "running",
        "message": "Queued…",
        "progress": "0%",
        "size_mb": None,
    }
    # Run in thread so the event loop isn't blocked
    thread = threading.Thread(
        target=_run_playwright_render,
        args=(job_id, req, job_dir),
        daemon=True,
    )
    thread.start()
    return {"job_id": job_id, "status": "running"}


@app.get("/jobs/{job_id}/status")
def job_status(job_id: str):
    """Poll render job status."""
    if job_id in _render_jobs:
        return _render_jobs[job_id]
    # Fall back to checking disk (for zip-upload jobs)
    job_dir = WORK_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(404, "Job not found.")
    has_output = (job_dir / "output.mp4").exists()
    return {
        "status": "done" if has_output else "running",
        "message": "Output ready." if has_output else "Processing…",
        "progress": "100%" if has_output else "?",
    }


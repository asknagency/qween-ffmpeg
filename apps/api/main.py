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
from fastapi.responses import FileResponse
from pydantic import BaseModel

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="QweenFFmpeg API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WORK_DIR = Path(tempfile.gettempdir()) / "qween_ffmpeg"
WORK_DIR.mkdir(exist_ok=True)

# ── Format config ─────────────────────────────────────────────────────────────
FORMAT_CONFIG = {
    "mp4":  {"ext": ".mp4",  "mime": "video/mp4",       "codec_args": ["-c:v", "libx264", "-pix_fmt", "yuv420p"]},
    "mov":  {"ext": ".mov",  "mime": "video/quicktime",  "codec_args": ["-c:v", "libx264", "-pix_fmt", "yuv420p"]},
    "webm": {"ext": ".webm", "mime": "video/webm",       "codec_args": ["-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p"]},
    "gif":  {"ext": ".gif",  "mime": "image/gif",        "codec_args": []},  # handled separately
}

VALID_FORMATS       = set(FORMAT_CONFIG.keys())
VALID_VIDEO_FORMATS = {"mp4", "mov", "webm"}  # for process endpoint (no GIF)

# ── Helpers ───────────────────────────────────────────────────────────────────

def new_job() -> tuple[str, Path]:
    job_id = str(uuid.uuid4())
    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True)
    return job_id, job_dir


def run_ffmpeg(args: list[str], cwd: Path | None = None) -> tuple[int, str, str]:
    result = subprocess.run(
        ["ffmpeg", "-y", *args],
        capture_output=True, text=True,
        cwd=str(cwd) if cwd else None,
    )
    return result.returncode, result.stdout, result.stderr


def cleanup_job(job_dir: Path):
    shutil.rmtree(job_dir, ignore_errors=True)


def natural_sort_key(s: str):
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r"(\d+)", s)]


def probe_video(path: Path) -> dict:
    """Return width, height, duration of a video file."""
    r = subprocess.run(
        ["ffprobe", "-v", "error",
         "-select_streams", "v:0",
         "-show_entries", "stream=width,height,duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    raw   = r.stdout.strip().splitlines()[0] if r.stdout.strip() else ""
    parts = [p.strip() for p in raw.split(",")] if raw else []
    return {
        "width":    parts[0] if len(parts) > 0 else "?",
        "height":   parts[1] if len(parts) > 1 else "?",
        "duration": parts[2] if len(parts) > 2 else "0",
    }


def output_path_for(job_dir: Path, fmt: str) -> Path:
    return job_dir / f"output{FORMAT_CONFIG[fmt]['ext']}"


def build_result(job_dir: Path, job_id: str, fmt: str) -> dict:
    p = output_path_for(job_dir, fmt)
    size = p.stat().st_size
    return {
        "job_id":       job_id,
        "format":       fmt,
        "download_url": f"/jobs/{job_id}/download",
        "size_bytes":   size,
        "size_mb":      round(size / 1_048_576, 2),
    }


def build_vf(crop_x, crop_y, crop_w, crop_h, width, height) -> str | None:
    filters = []
    if crop_w and crop_h:
        filters.append(f"crop={crop_w}:{crop_h}:{crop_x or 0}:{crop_y or 0}")
    if width or height:
        filters.append(f"scale={width or -2}:{height or -2}")
    return ",".join(filters) if filters else None


def stitch_to_gif(input_pattern: str, fps: float, job_dir: Path, output: Path,
                  vf_extra: str | None = None) -> tuple[int, str]:
    """Two-pass palette GIF encode."""
    palette = job_dir / "palette.png"
    vf_base = f"fps={fps},scale=320:-1:flags=lanczos"
    if vf_extra:
        vf_base = f"{vf_extra},{vf_base}"

    # Pass 1 — build palette
    c1, _, e1 = run_ffmpeg([
        "-framerate", str(fps), "-i", input_pattern,
        "-vf", f"{vf_base},palettegen", str(palette),
    ])
    if c1 != 0:
        return c1, e1

    # Pass 2 — encode
    c2, _, e2 = run_ffmpeg([
        "-framerate", str(fps), "-i", input_pattern,
        "-i", str(palette),
        "-lavfi", f"{vf_base} [x]; [x][1:v] paletteuse",
        str(output),
    ])
    return c2, e2


def process_video_to_format(
    input_path: Path,
    output_path: Path,
    fmt: str,
    crf: int = 18,
    preset: str = "medium",
    trim_start: float | None = None,
    trim_end: float | None = None,
    vf: str | None = None,
) -> tuple[int, str]:
    """Run ffmpeg on an existing video file with format-aware codec args."""
    cfg = FORMAT_CONFIG[fmt]
    args = []

    if trim_start is not None:
        args += ["-ss", str(trim_start)]

    args += ["-i", str(input_path)]

    if trim_end is not None:
        args += ["-to", str(trim_end)]

    args += cfg["codec_args"]

    if fmt in ("mp4", "mov"):
        args += ["-crf", str(crf), "-preset", preset]
    elif fmt == "webm":
        args += ["-crf", str(crf), "-b:v", "0"]

    if vf:
        args += ["-vf", vf]

    args += [str(output_path)]
    code, _, err = run_ffmpeg(args)
    return code, err


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    r = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
    line = r.stdout.splitlines()[0] if r.stdout else "unknown"
    return {"status": "ok", "ffmpeg": line}


# ── 1. Upload ZIP of frames ───────────────────────────────────────────────────

@app.post("/jobs/upload")
async def upload_frames(file: UploadFile = File(...)):
    if not file.filename.endswith(".zip"):
        raise HTTPException(400, "Please upload a ZIP file containing image frames.")

    job_id, job_dir = new_job()
    frames_dir = job_dir / "frames"
    frames_dir.mkdir()
    zip_path = job_dir / "upload.zip"

    async with aiofiles.open(zip_path, "wb") as f:
        f.write(await file.read())

    with zipfile.ZipFile(zip_path) as z:
        z.extractall(frames_dir)

    all_images: list[Path] = []
    for ext in ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp", "*.tiff"):
        all_images.extend(frames_dir.rglob(ext))

    if not all_images:
        shutil.rmtree(job_dir)
        raise HTTPException(400, "No image files found inside the ZIP.")

    flat_dir = job_dir / "flat"
    flat_dir.mkdir()
    all_images.sort(key=lambda p: natural_sort_key(p.name))
    img_ext = all_images[0].suffix.lower()
    for i, img in enumerate(all_images):
        shutil.copy(img, flat_dir / f"frame_{i:06d}{img_ext}")

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0",
         str(flat_dir / f"frame_000000{img_ext}")],
        capture_output=True, text=True,
    )
    raw  = probe.stdout.strip().splitlines()[0] if probe.stdout.strip() else ""
    dims = raw.split(",") if raw else []

    return {
        "job_id":      job_id,
        "frame_count": len(all_images),
        "extension":   img_ext,
        "width":       dims[0].strip() if len(dims) > 0 else "?",
        "height":      dims[1].strip() if len(dims) > 1 else "?",
        "first_frame": f"/jobs/{job_id}/frame/0",
    }


# ── 2. Upload video file (MP4/MOV/WebM) ──────────────────────────────────────

@app.post("/jobs/upload-video")
async def upload_video(file: UploadFile = File(...)):
    allowed = {".mp4", ".mov", ".webm", ".avi", ".mkv"}
    suffix = Path(file.filename).suffix.lower()
    if suffix not in allowed:
        raise HTTPException(400, f"Unsupported file type. Allowed: {', '.join(allowed)}")

    job_id, job_dir = new_job()
    raw_path   = job_dir / f"raw{suffix}"
    video_path = job_dir / f"input{suffix}"

    async with aiofiles.open(raw_path, "wb") as f:
        f.write(await file.read())

    # Remux to fix moov atom position, incomplete files, or codec issues
    # -movflags faststart moves moov atom to front (fixes "moov atom not found")
    code, _, err = run_ffmpeg([
        "-i", str(raw_path),
        "-c", "copy",
        "-movflags", "faststart",
        str(video_path),
    ])

    if code != 0:
        # Fallback — try re-encoding if copy remux fails
        code, _, err = run_ffmpeg([
            "-i", str(raw_path),
            "-c:v", "libx264", "-crf", "18", "-preset", "fast",
            "-movflags", "faststart",
            str(video_path),
        ])

    if code != 0:
        shutil.rmtree(job_dir)
        raise HTTPException(400, f"Could not process video file. Make sure it is a valid video.\nDetails: {err.splitlines()[-1] if err else 'unknown error'}")

    # Clean up raw upload
    raw_path.unlink(missing_ok=True)

    info = probe_video(video_path)
    return {
        "job_id":    job_id,
        "width":     info["width"],
        "height":    info["height"],
        "duration":  info["duration"],
        "input_path": str(video_path),
    }


# ── 3. Frame preview ──────────────────────────────────────────────────────────

@app.get("/jobs/{job_id}/frame/{index}")
def get_frame(job_id: str, index: int):
    flat_dir = WORK_DIR / job_id / "flat"
    if not flat_dir.exists():
        raise HTTPException(404, "Job not found.")
    frames = sorted(flat_dir.iterdir(), key=lambda p: natural_sort_key(p.name))
    if index < 0 or index >= len(frames):
        raise HTTPException(404, "Frame index out of range.")
    return FileResponse(frames[index])


# ── 4. Stitch frames → video (ZIP upload jobs) ────────────────────────────────

@app.post("/jobs/{job_id}/stitch")
async def stitch(
    job_id: str,
    fps:         float         = Form(30),
    crf:         int           = Form(18),
    preset:      str           = Form("medium"),
    format:      str           = Form("mp4"),
    width:       Optional[str] = Form(None),
    height:      Optional[str] = Form(None),
    trim_start:  Optional[str] = Form(None),
    trim_end:    Optional[str] = Form(None),
    crop_x:      Optional[str] = Form(None),
    crop_y:      Optional[str] = Form(None),
    crop_w:      Optional[str] = Form(None),
    crop_h:      Optional[str] = Form(None),
):
    if format not in VALID_FORMATS:
        raise HTTPException(400, f"Invalid format. Choose from: {', '.join(VALID_FORMATS)}")

    def to_int(v):
        try: return int(v) if v and str(v).strip() else None
        except: return None

    def to_float(v):
        try: return float(v) if v and str(v).strip() else None
        except: return None

    _width      = to_int(width)
    _height     = to_int(height)
    _trim_start = to_float(trim_start)
    _trim_end   = to_float(trim_end)
    _crop_x     = to_int(crop_x)
    _crop_y     = to_int(crop_y)
    _crop_w     = to_int(crop_w)
    _crop_h     = to_int(crop_h)

    job_dir  = WORK_DIR / job_id
    flat_dir = job_dir / "flat"
    if not flat_dir.exists():
        raise HTTPException(404, "Job not found.")

    frames = sorted(flat_dir.iterdir(), key=lambda p: natural_sort_key(p.name))
    if not frames:
        raise HTTPException(400, "No frames found.")

    img_ext       = frames[0].suffix.lower()
    input_pattern = str(flat_dir / f"frame_%06d{img_ext}")
    output        = output_path_for(job_dir, format)
    vf            = build_vf(_crop_x, _crop_y, _crop_w, _crop_h, _width, _height)

    if format == "gif":
        code, err = stitch_to_gif(input_pattern, fps, job_dir, output, vf)
    else:
        cfg  = FORMAT_CONFIG[format]
        args = ["-framerate", str(fps), "-i", input_pattern]
        if trim_start is not None:
            args += ["-ss", str(trim_start)]
        if trim_end is not None:
            args += ["-to", str(trim_end)]
        args += cfg["codec_args"]
        if format in ("mp4", "mov"):
            args += ["-crf", str(crf), "-preset", preset]
        elif format == "webm":
            args += ["-crf", str(crf), "-b:v", "0"]
        if vf:
            args += ["-vf", vf]
        args += [str(output)]
        code, _, err = run_ffmpeg(args)

    if code != 0:
        raise HTTPException(500, f"ffmpeg error:\n{err}")

    return build_result(job_dir, job_id, format)


# ── 5. Process existing video (Crop / Trim / Scale) ───────────────────────────

@app.post("/jobs/{job_id}/process")
async def process_video(
    job_id: str,
    format:      str           = Form("mp4"),
    crf:         int           = Form(18),
    preset:      str           = Form("medium"),
    width:       Optional[str] = Form(None),
    height:      Optional[str] = Form(None),
    trim_start:  Optional[str] = Form(None),
    trim_end:    Optional[str] = Form(None),
    crop_x:      Optional[str] = Form(None),
    crop_y:      Optional[str] = Form(None),
    crop_w:      Optional[str] = Form(None),
    crop_h:      Optional[str] = Form(None),
):
    if format not in VALID_VIDEO_FORMATS:
        raise HTTPException(400, f"Invalid format for video processing. Choose from: {', '.join(VALID_VIDEO_FORMATS)}")

    job_dir = WORK_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(404, "Job not found.")

    # Coerce crop fields — empty string or None → None
    def to_int(v):
        try: return int(v) if v and str(v).strip() else None
        except: return None

    def to_float(v):
        try: return float(v) if v and str(v).strip() else None
        except: return None

    _crop_x     = to_int(crop_x)
    _crop_y     = to_int(crop_y)
    _crop_w     = to_int(crop_w)
    _crop_h     = to_int(crop_h)
    _width      = to_int(width)
    _height     = to_int(height)
    _trim_start = to_float(trim_start)
    _trim_end   = to_float(trim_end)

    # Find uploaded input video
    input_video = next(
        (f for f in job_dir.iterdir() if f.stem == "input" and f.suffix in {".mp4", ".mov", ".webm", ".avi", ".mkv"}),
        None,
    )
    if not input_video:
        raise HTTPException(404, "No input video found for this job. Use /jobs/upload-video first.")

    output = output_path_for(job_dir, format)
    vf     = build_vf(_crop_x, _crop_y, _crop_w, _crop_h, _width, _height)
    code, err = process_video_to_format(
        input_video, output, format, crf, preset, _trim_start, _trim_end, vf
    )

    if code != 0:
        raise HTTPException(500, f"ffmpeg error:\n{err}")

    return build_result(job_dir, job_id, format)


# ── 6. Download output ────────────────────────────────────────────────────────

@app.get("/jobs/{job_id}/download")
def download(job_id: str):
    job_dir = WORK_DIR / job_id
    # Find whichever output file exists
    for fmt, cfg in FORMAT_CONFIG.items():
        p = job_dir / f"output{cfg['ext']}"
        if p.exists():
            return FileResponse(p, media_type=cfg["mime"],
                                filename=f"qween_{job_id[:8]}{cfg['ext']}")
    raise HTTPException(404, "No output found. Run /stitch or /process first.")


# ── 7. Segment video ──────────────────────────────────────────────────────────

@app.post("/jobs/{job_id}/segment")
async def segment(job_id: str, segment_duration: float = Form(5.0)):
    job_dir = WORK_DIR / job_id

    # Accept any output video (prefer mp4)
    output_video = None
    for fmt in ("mp4", "mov", "webm"):
        p = output_path_for(job_dir, fmt)
        if p.exists():
            output_video = p
            break
    # Also check for a raw uploaded video
    if not output_video:
        output_video = next(
            (f for f in job_dir.iterdir() if f.stem == "input" and f.suffix in {".mp4", ".mov", ".webm", ".avi", ".mkv"}),
            None,
        )
    if not output_video:
        raise HTTPException(404, "No video found. Run /stitch or /process first, or upload a video.")

    seg_dir = job_dir / "segments"
    seg_dir.mkdir(exist_ok=True)

    code, _, err = run_ffmpeg([
        "-i", str(output_video),
        "-c", "copy", "-map", "0",
        "-segment_time", str(segment_duration),
        "-f", "segment", "-reset_timestamps", "1",
        str(seg_dir / "seg_%03d.mp4"),
    ])
    if code != 0:
        raise HTTPException(500, f"ffmpeg error:\n{err}")

    segs = sorted(seg_dir.glob("seg_*.mp4"))
    return {
        "job_id":        job_id,
        "segment_count": len(segs),
        "segments": [
            {
                "index":        i,
                "filename":     s.name,
                "size_mb":      round(s.stat().st_size / 1_048_576, 2),
                "download_url": f"/jobs/{job_id}/segment/{i}",
            }
            for i, s in enumerate(segs)
        ],
    }


@app.get("/jobs/{job_id}/segment/{index}")
def download_segment(job_id: str, index: int):
    seg_dir = WORK_DIR / job_id / "segments"
    segs = sorted(seg_dir.glob("seg_*.mp4")) if seg_dir.exists() else []
    if index < 0 or index >= len(segs):
        raise HTTPException(404, "Segment not found.")
    return FileResponse(segs[index], media_type="video/mp4", filename=segs[index].name)


# ── 8. Cleanup ────────────────────────────────────────────────────────────────

@app.delete("/jobs/{job_id}")
def delete_job(job_id: str, background_tasks: BackgroundTasks):
    job_dir = WORK_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(404, "Job not found.")
    background_tasks.add_task(cleanup_job, job_dir)
    return {"deleted": job_id}


# ── 9. List jobs ──────────────────────────────────────────────────────────────

@app.get("/jobs")
def list_jobs():
    jobs = []
    for d in WORK_DIR.iterdir():
        if not d.is_dir():
            continue
        flat        = d / "flat"
        frame_count = len(list(flat.iterdir())) if flat.exists() else 0
        has_output  = any((d / f"output{cfg['ext']}").exists() for cfg in FORMAT_CONFIG.values())
        jobs.append({"job_id": d.name, "frame_count": frame_count, "has_output": has_output})
    return {"jobs": jobs}


# ── 10. Playwright render ─────────────────────────────────────────────────────

_render_jobs: Dict[str, Dict[str, Any]] = {}


class VideoAsset(BaseModel):
    nodeId: str; slotId: str; dbId: str; mimeType: str; label: str; b64: str

class FontAsset(BaseModel):
    family: str; weight: int = 400; style: str = "normal"; format: str = "woff2"; b64: str

class NodeMeta(BaseModel):
    id: str; type: str = "svg"; width: float = 1080; height: float = 1080
    zIndex: int = 0; visible: bool = True; svgContent: str = ""
    videoSlots: List[Dict[str, Any]] = []

class PlaywrightRenderRequest(BaseModel):
    fps: float = 30; crf: int = 18; format: str = "mp4"
    startTime: float = 0; endTime: float = 5
    stageWidth: float = 1080; stageHeight: float = 1080
    nodes: List[NodeMeta] = []; videoAssets: List[VideoAsset] = []
    fontAssets: List[FontAsset] = []
    gsapCdn: str = "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/gsap.min.js"


def _build_stage_html(req: PlaywrightRenderRequest, job_dir: Path) -> str:
    font_css = ""
    for f in req.fontAssets:
        font_css += (f"@font-face {{font-family:'{f.family}';font-weight:{f.weight};"
                     f"font-style:{f.style};src:url('data:font/{f.format};base64,{f.b64}') format('{f.format}');}}\n")
    nodes_html = ""
    for node in sorted(req.nodes, key=lambda n: n.zIndex):
        if not node.visible:
            continue
        style = (f"position:absolute;top:0;left:0;width:{node.width}px;height:{node.height}px;z-index:{node.zIndex};")
        if node.type == "svg":
            nodes_html += f'<div id="{node.id}" style="{style}">{node.svgContent}</div>\n'
        elif node.type == "video":
            for slot in node.videoSlots:
                slot_id = slot.get("treeId", node.id + "_video")
                db_id   = slot.get("dbId", "")
                nodes_html += (f'<video id="{slot_id}" data-dbid="{db_id}" '
                               f'style="{style}object-fit:contain;" muted playsinline preload="auto"></video>\n')
    video_js = "const _videoAssets = {};\n"
    for va in req.videoAssets:
        video_js += f"_videoAssets['{va.dbId}'] = 'data:{va.mimeType};base64,{va.b64}';\n"
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{{margin:0;padding:0;box-sizing:border-box;}}body{{background:#000;overflow:hidden;}}
#stage{{position:relative;width:{req.stageWidth}px;height:{req.stageHeight}px;overflow:hidden;}}
{font_css}</style></head><body><div id="stage">{nodes_html}</div>
<script src="{req.gsapCdn}"></script><script>
{video_js}
document.querySelectorAll('video[data-dbid]').forEach(v=>{{const d=v.getAttribute('data-dbid');if(_videoAssets[d])v.src=_videoAssets[d];}});
window.__qween_ready=false;window.__qween_frame_done=false;
Promise.all(Array.from(document.querySelectorAll('video')).map(v=>new Promise(res=>{{
  if(v.readyState>=2){{res();return;}}v.addEventListener('canplay',res,{{once:true}});v.addEventListener('error',res,{{once:true}});
}}))).then(()=>{{window.__qween_ready=true;}});
window.__qween_seek=async function(t){{
  window.__qween_frame_done=false;
  if(window.__masterTl){{window.__masterTl.pause();window.__masterTl.time(t);}}
  const videos=Array.from(document.querySelectorAll('video'));
  await Promise.all(videos.map(v=>new Promise(res=>{{
    if(!v.src){{res();return;}}v.pause();v.currentTime=t;
    const s=()=>{{v.removeEventListener('seeked',s);res();}};v.addEventListener('seeked',s);setTimeout(res,200);
  }})));
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  window.__qween_frame_done=true;
}};
</script></body></html>"""


def _run_playwright_render(job_id: str, req: PlaywrightRenderRequest, job_dir: Path):
    status = _render_jobs[job_id]
    try:
        from playwright.sync_api import sync_playwright
        frames_dir = job_dir / "pw_frames"
        frames_dir.mkdir()
        html_path = job_dir / "stage.html"
        html_path.write_text(_build_stage_html(req, job_dir), encoding="utf-8")
        fps = req.fps
        total_frames = max(1, round((req.endTime - req.startTime) * fps))
        w, h = int(req.stageWidth), int(req.stageHeight)
        status["message"] = "Launching headless browser…"; status["progress"] = "0%"
        with sync_playwright() as p:
            browser = p.chromium.launch(args=[
                "--no-sandbox","--disable-setuid-sandbox",
                "--autoplay-policy=no-user-gesture-required",
                "--disable-web-security","--allow-file-access-from-files",
                "--disable-features=IsolateOrigins,site-per-process",
            ])
            page = browser.new_page(viewport={"width": w, "height": h})
            page.goto(f"file://{html_path.resolve()}")
            page.wait_for_function("window.__qween_ready === true", timeout=10_000)
            status["message"] = "Capturing frames…"
            for i in range(total_frames):
                t = req.startTime + (i / fps)
                page.evaluate(f"window.__qween_seek({t})")
                page.wait_for_function("window.__qween_frame_done === true", timeout=5_000)
                page.screenshot(path=str(frames_dir / f"frame_{i:06d}.png"),
                                clip={"x": 0, "y": 0, "width": w, "height": h})
                pct = round((i + 1) / total_frames * 100)
                status["message"] = f"Frame {i+1}/{total_frames}…"; status["progress"] = f"{pct}%"
            browser.close()

        fmt    = req.format if req.format in VALID_FORMATS else "mp4"
        output = output_path_for(job_dir, fmt)
        status["message"] = f"Stitching to {fmt.upper()}…"
        input_pattern = str(frames_dir / "frame_%06d.png")

        if fmt == "gif":
            code, err = stitch_to_gif(input_pattern, fps, job_dir, output)
        else:
            cfg  = FORMAT_CONFIG[fmt]
            args = ["-framerate", str(fps), "-i", input_pattern] + cfg["codec_args"]
            if fmt in ("mp4", "mov"):
                args += ["-crf", str(req.crf), "-preset", "medium"]
            elif fmt == "webm":
                args += ["-crf", str(req.crf), "-b:v", "0"]
            args += [str(output)]
            code, _, err = run_ffmpeg(args)

        if code != 0:
            raise RuntimeError(f"ffmpeg error: {err}")

        size_mb = round(output.stat().st_size / 1_048_576, 2)
        status.update({"status": "done", "message": f"Done — {size_mb} MB",
                       "size_mb": size_mb, "progress": "100%", "format": fmt})
    except Exception as e:
        status.update({"status": "error", "message": str(e)})


@app.post("/jobs/playwright-render")
async def playwright_render(req: PlaywrightRenderRequest, background_tasks: BackgroundTasks):
    job_id, job_dir = new_job()
    _render_jobs[job_id] = {"status": "running", "message": "Queued…", "progress": "0%", "size_mb": None}
    t = threading.Thread(target=_run_playwright_render, args=(job_id, req, job_dir), daemon=True)
    t.start()
    return {"job_id": job_id, "status": "running"}


@app.get("/jobs/{job_id}/status")
def job_status(job_id: str):
    if job_id in _render_jobs:
        return _render_jobs[job_id]
    job_dir = WORK_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(404, "Job not found.")
    has_output = any((job_dir / f"output{cfg['ext']}").exists() for cfg in FORMAT_CONFIG.values())
    return {
        "status":   "done" if has_output else "running",
        "message":  "Output ready." if has_output else "Processing…",
        "progress": "100%" if has_output else "?",
    }

import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiofiles
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="QweenFFmpeg API", version="4.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

WORK_DIR         = Path(tempfile.gettempdir()) / "qween_ffmpeg"
WORK_DIR.mkdir(exist_ok=True)
MAX_ZIP_MB       = 500
MAX_VIDEO_MB     = 2048
AUTO_CLEAN_HOURS = 6

# ── Format config ─────────────────────────────────────────────────────────────
FORMAT_CONFIG = {
    "mp4":  {"ext": ".mp4",  "mime": "video/mp4",      "codec_args": ["-c:v", "libx264", "-pix_fmt", "yuv420p"]},
    "mov":  {"ext": ".mov",  "mime": "video/quicktime", "codec_args": ["-c:v", "libx264", "-pix_fmt", "yuv420p"]},
    "webm": {"ext": ".webm", "mime": "video/webm",      "codec_args": ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0"]},
    "gif":  {"ext": ".gif",  "mime": "image/gif",       "codec_args": []},
}
VALID_FORMATS       = set(FORMAT_CONFIG.keys())
VALID_VIDEO_FORMATS = {"mp4", "mov", "webm"}

# ── Asset store config ────────────────────────────────────────────────────────
ASSETS_DIR = WORK_DIR / "assets"
ASSETS_DIR.mkdir(exist_ok=True)
ASSET_VIDEO_EXTS = {".mp4", ".mov", ".webm", ".avi", ".mkv"}
ASSET_FONT_EXTS  = {".woff2", ".woff", ".ttf", ".otf"}
ASSET_ALLOWED_EXTS = ASSET_VIDEO_EXTS | ASSET_FONT_EXTS
ASSET_MIME = {
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".avi": "video/x-msvideo", ".mkv": "video/x-matroska",
    ".woff2": "font/woff2", ".woff": "font/woff",
    ".ttf": "font/ttf", ".otf": "font/otf",
}
_asset_hash_index: Dict[str, str] = {}  # content_hash -> asset_id
_asset_lock = threading.Lock()

# ── Playwright render ────────────────────────────────────────────────────────
from render_stage.build import build_stage_html  # noqa: E402

_render_payloads: Dict[str, dict] = {}
_render_lock = threading.Lock()

# ── Job metadata ──────────────────────────────────────────────────────────────
_job_meta: Dict[str, Dict[str, Any]] = {}
_meta_lock = threading.Lock()

def _register_job(job_id: str, label: str = "", input_file: str = ""):
    with _meta_lock:
        _job_meta[job_id] = {
            "job_id": job_id, "label": label, "input_file": input_file,
            "created_at": time.time(), "has_output": False, "format": None, "size_mb": None,
        }

def _mark_output(job_id: str, fmt: str, size_mb: float):
    with _meta_lock:
        if job_id in _job_meta:
            _job_meta[job_id].update({"has_output": True, "format": fmt, "size_mb": size_mb})

# ── #7 — CPU Queue (semaphore, max 1 concurrent ffmpeg job) ───────────────────
_ffmpeg_sem = threading.Semaphore(1)

# ── #8 — Async job status store ───────────────────────────────────────────────
_async_jobs: Dict[str, Dict[str, Any]] = {}
_async_lock = threading.Lock()

def _job_update(job_id: str, **kw):
    with _async_lock:
        if job_id in _async_jobs:
            _async_jobs[job_id].update(kw)

def _job_init(job_id: str, label: str):
    with _async_lock:
        _async_jobs[job_id] = {
            "status": "queued", "message": "Waiting in queue…",
            "progress": 0, "label": label,
            "started_at": time.time(), "size_mb": None, "format": None,
        }

# ── Auto-cleanup ──────────────────────────────────────────────────────────────
def _sweep_old_jobs(max_age_hours: float = AUTO_CLEAN_HOURS):
    cutoff = time.time() - max_age_hours * 3600
    removed = 0
    for d in WORK_DIR.iterdir():
        if not d.is_dir() or d == ASSETS_DIR:
            continue
        if d.stat().st_mtime < cutoff:
            shutil.rmtree(d, ignore_errors=True)
            with _meta_lock: _job_meta.pop(d.name, None)
            with _async_lock: _async_jobs.pop(d.name, None)
            removed += 1
    # Sweep individual assets on the same schedule
    for d in ASSETS_DIR.iterdir():
        if d.is_dir() and d.stat().st_mtime < cutoff:
            content_hash = None
            meta_path = d / "meta.json"
            if meta_path.exists():
                try:
                    content_hash = json.loads(meta_path.read_text()).get("content_hash")
                except Exception:
                    pass
            shutil.rmtree(d, ignore_errors=True)
            if content_hash:
                with _asset_lock: _asset_hash_index.pop(content_hash, None)
            removed += 1
    return removed

def _cleanup_thread():
    while True:
        time.sleep(30 * 60)
        try: _sweep_old_jobs()
        except: pass

_sweep_old_jobs()
threading.Thread(target=_cleanup_thread, daemon=True).start()

# ── Helpers ───────────────────────────────────────────────────────────────────
def new_job(label: str = "", input_file: str = "") -> tuple[str, Path]:
    job_id  = str(uuid.uuid4())
    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True)
    _register_job(job_id, label, input_file)
    return job_id, job_dir

def run_ffmpeg(args: list[str], cwd: Path | None = None) -> tuple[int, str, str]:
    result = subprocess.run(["ffmpeg", "-y", *args], capture_output=True, text=True,
                            cwd=str(cwd) if cwd else None)
    return result.returncode, result.stdout, result.stderr

def run_ffmpeg_queued(args: list[str], cwd: Path | None = None) -> tuple[int, str, str]:
    """Same as run_ffmpeg but acquires the CPU semaphore first."""
    with _ffmpeg_sem:
        return run_ffmpeg(args, cwd)

def cleanup_job(job_dir: Path):
    shutil.rmtree(job_dir, ignore_errors=True)
    with _meta_lock: _job_meta.pop(job_dir.name, None)
    with _async_lock: _async_jobs.pop(job_dir.name, None)

def natural_sort_key(s: str):
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r"(\d+)", s)]

def probe_video(path: Path) -> dict:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,duration", "-of", "csv=p=0", str(path)],
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
    mb = round(p.stat().st_size / 1_048_576, 2)
    _mark_output(job_id, fmt, mb)
    return {"job_id": job_id, "format": fmt,
            "download_url": f"/jobs/{job_id}/download",
            "size_bytes": p.stat().st_size, "size_mb": mb}

def build_vf(crop_x, crop_y, crop_w, crop_h, width, height) -> str | None:
    filters = []
    if crop_w and crop_h:
        filters.append(f"crop={crop_w}:{crop_h}:{crop_x or 0}:{crop_y or 0}")
    if width or height:
        filters.append(f"scale={width or -2}:{height or -2}")
    return ",".join(filters) if filters else None

def friendly_ffmpeg_error(err: str) -> str:
    if not err: return "Unknown ffmpeg error."
    lines = [l.strip() for l in err.splitlines() if l.strip()]
    for line in lines:
        ll = line.lower()
        if "no such file" in ll:       return "Input file not found."
        if "invalid data" in ll or "moov atom" in ll: return "Invalid or corrupted video file."
        if "codec not currently" in ll: return "Unsupported codec in input file."
        if "out of memory" in ll:       return "Server ran out of memory — try a smaller file."
        if "encoder" in ll and "not found" in ll: return "Required encoder not installed."
    for line in reversed(lines):
        if line and not line.startswith("ffmpeg version"):
            return line
    return "ffmpeg processing failed."

def stitch_to_gif(input_pattern: str, fps: float, job_dir: Path, output: Path,
                  vf_extra: str | None = None) -> tuple[int, str]:
    palette = job_dir / "palette.png"
    vf_base = f"fps={fps},scale=320:-1:flags=lanczos"
    if vf_extra: vf_base = f"{vf_extra},{vf_base}"
    c1, _, e1 = run_ffmpeg_queued(["-framerate", str(fps), "-i", input_pattern,
                                   "-vf", f"{vf_base},palettegen", str(palette)])
    if c1 != 0: return c1, e1
    c2, _, e2 = run_ffmpeg_queued(["-framerate", str(fps), "-i", input_pattern,
                                   "-i", str(palette),
                                   "-lavfi", f"{vf_base} [x]; [x][1:v] paletteuse", str(output)])
    return c2, e2

def process_video_to_format(input_path, output_path, fmt, crf=18, preset="medium",
                             trim_start=None, trim_end=None, vf=None):
    cfg  = FORMAT_CONFIG[fmt]
    args = []
    if trim_start is not None: args += ["-ss", str(trim_start)]
    args += ["-i", str(input_path)] + cfg["codec_args"]
    if trim_end is not None: args += ["-to", str(trim_end)]
    if fmt in ("mp4", "mov"): args += ["-crf", str(crf), "-preset", preset]
    elif fmt == "webm":       args += ["-crf", str(crf), "-b:v", "0"]
    if vf: args += ["-vf", vf]
    args += [str(output_path)]
    code, _, err = run_ffmpeg_queued(args)
    return code, err

def to_int(v):
    try: return int(v) if v and str(v).strip() else None
    except: return None

def to_float(v):
    try: return float(v) if v and str(v).strip() else None
    except: return None

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    r    = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
    line = r.stdout.splitlines()[0] if r.stdout else "unknown"
    total_mb = sum(f.stat().st_size for f in WORK_DIR.rglob("*") if f.is_file()) / 1_048_576
    queue_busy = not _ffmpeg_sem._value  # 0 = busy, 1 = free
    return {"status": "ok", "ffmpeg": line, "version": "4.0.0",
            "active_jobs": len(list(WORK_DIR.iterdir())),
            "storage_used_mb": round(total_mb, 1),
            "queue_busy": queue_busy,
            "auto_clean_hours": AUTO_CLEAN_HOURS}

# ── Storage ───────────────────────────────────────────────────────────────────
@app.get("/storage")
def storage_info():
    total_mb = sum(f.stat().st_size for f in WORK_DIR.rglob("*") if f.is_file()) / 1_048_576
    return {"storage_used_mb": round(total_mb, 1),
            "job_count": len(list(WORK_DIR.iterdir())),
            "auto_clean_hours": AUTO_CLEAN_HOURS}

@app.delete("/storage/clean")
def clean_all_jobs():
    removed = _sweep_old_jobs(max_age_hours=0)
    return {"deleted_jobs": removed}

# ── Upload ZIP ────────────────────────────────────────────────────────────────
@app.post("/jobs/upload")
async def upload_frames(file: UploadFile = File(...)):
    if not file.filename.endswith(".zip"):
        raise HTTPException(400, "Please upload a ZIP file.")
    data = await file.read()
    if len(data) / 1_048_576 > MAX_ZIP_MB:
        raise HTTPException(413, f"ZIP too large. Maximum is {MAX_ZIP_MB} MB.")
    job_id, job_dir = new_job(label=file.filename, input_file=file.filename)
    frames_dir = job_dir / "frames"; frames_dir.mkdir()
    zip_path   = job_dir / "upload.zip"
    async with aiofiles.open(zip_path, "wb") as f: await f.write(data)
    with zipfile.ZipFile(zip_path) as z: z.extractall(frames_dir)
    all_images: list[Path] = []
    for ext in ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp", "*.tiff"):
        all_images.extend(frames_dir.rglob(ext))
    if not all_images:
        shutil.rmtree(job_dir)
        raise HTTPException(400, "No image files found in ZIP.")
    flat_dir = job_dir / "flat"; flat_dir.mkdir()
    all_images.sort(key=lambda p: natural_sort_key(p.name))
    img_ext = all_images[0].suffix.lower()
    for i, img in enumerate(all_images):
        shutil.copy(img, flat_dir / f"frame_{i:06d}{img_ext}")
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0",
         str(flat_dir / f"frame_000000{img_ext}")],
        capture_output=True, text=True)
    raw  = probe.stdout.strip().splitlines()[0] if probe.stdout.strip() else ""
    dims = raw.split(",") if raw else []
    return {"job_id": job_id, "frame_count": len(all_images), "extension": img_ext,
            "width": dims[0].strip() if dims else "?",
            "height": dims[1].strip() if len(dims) > 1 else "?",
            "first_frame": f"/jobs/{job_id}/frame/0"}

# ── Upload video ──────────────────────────────────────────────────────────────
@app.post("/jobs/upload-video")
async def upload_video(file: UploadFile = File(...)):
    allowed = {".mp4", ".mov", ".webm", ".avi", ".mkv"}
    suffix  = Path(file.filename).suffix.lower()
    if suffix not in allowed:
        raise HTTPException(400, f"Unsupported type '{suffix}'. Allowed: {', '.join(sorted(allowed))}")
    data = await file.read()
    size_mb = len(data) / 1_048_576
    if size_mb > MAX_VIDEO_MB:
        raise HTTPException(413, f"Video too large ({size_mb:.0f} MB). Max is {MAX_VIDEO_MB} MB.")
    job_id, job_dir = new_job(label=file.filename, input_file=file.filename)
    raw_path   = job_dir / f"raw{suffix}"
    video_path = job_dir / f"input{suffix}"
    async with aiofiles.open(raw_path, "wb") as f: await f.write(data)
    code, _, err = run_ffmpeg(["-i", str(raw_path), "-c", "copy",
                               "-movflags", "faststart", str(video_path)])
    if code != 0:
        code, _, err = run_ffmpeg(["-i", str(raw_path), "-c:v", "libx264",
                                   "-crf", "18", "-preset", "fast",
                                   "-movflags", "faststart", str(video_path)])
    if code != 0:
        shutil.rmtree(job_dir)
        raise HTTPException(400, f"Could not process video: {friendly_ffmpeg_error(err)}")
    raw_path.unlink(missing_ok=True)
    info = probe_video(video_path)
    return {"job_id": job_id, "width": info["width"], "height": info["height"],
            "duration": info["duration"], "size_mb": round(size_mb, 1)}

# ── Frame preview ─────────────────────────────────────────────────────────────
@app.get("/jobs/{job_id}/frame/{index}")
def get_frame(job_id: str, index: int):
    flat_dir = WORK_DIR / job_id / "flat"
    if not flat_dir.exists(): raise HTTPException(404, "Job not found.")
    frames = sorted(flat_dir.iterdir(), key=lambda p: natural_sort_key(p.name))
    if index < 0 or index >= len(frames): raise HTTPException(404, "Frame index out of range.")
    return FileResponse(frames[index])

# ── #8 — Async stitch ─────────────────────────────────────────────────────────
def _run_stitch(job_id: str, job_dir: Path, input_pattern: str, img_ext: str,
                fps: float, crf: int, preset: str, fmt: str, vf: str | None,
                trim_start: float | None, trim_end: float | None):
    _job_update(job_id, status="queued", message="Waiting in queue…", progress=5)
    output = output_path_for(job_dir, fmt)
    try:
        _job_update(job_id, status="processing", message="Stitching frames…", progress=10)
        if fmt == "gif":
            code, err = stitch_to_gif(input_pattern, fps, job_dir, output, vf)
        else:
            cfg  = FORMAT_CONFIG[fmt]
            args = ["-framerate", str(fps), "-i", input_pattern]
            if trim_start is not None: args += ["-ss", str(trim_start)]
            if trim_end   is not None: args += ["-to", str(trim_end)]
            args += cfg["codec_args"]
            if fmt in ("mp4", "mov"): args += ["-crf", str(crf), "-preset", preset]
            elif fmt == "webm":       args += ["-crf", str(crf), "-b:v", "0"]
            if vf: args += ["-vf", vf]
            args += [str(output)]
            _job_update(job_id, progress=20)
            code, _, err = run_ffmpeg_queued(args)
        if code != 0:
            raise RuntimeError(friendly_ffmpeg_error(err))
        mb = round(output.stat().st_size / 1_048_576, 2)
        _mark_output(job_id, fmt, mb)
        _job_update(job_id, status="done", message=f"Done — {mb} MB",
                    progress=100, size_mb=mb, format=fmt)
    except Exception as e:
        _job_update(job_id, status="error", message=str(e), progress=0)

@app.post("/jobs/{job_id}/stitch")
async def stitch(
    job_id: str,
    fps: float = Form(30), crf: int = Form(18), preset: str = Form("medium"),
    format: str = Form("mp4"),
    width: Optional[str] = Form(None), height: Optional[str] = Form(None),
    trim_start: Optional[str] = Form(None), trim_end: Optional[str] = Form(None),
    crop_x: Optional[str] = Form(None), crop_y: Optional[str] = Form(None),
    crop_w: Optional[str] = Form(None), crop_h: Optional[str] = Form(None),
    async_mode: bool = Form(False),
):
    if format not in VALID_FORMATS:
        raise HTTPException(400, f"Invalid format. Choose from: {', '.join(sorted(VALID_FORMATS))}")
    job_dir  = WORK_DIR / job_id
    flat_dir = job_dir / "flat"
    if not flat_dir.exists(): raise HTTPException(404, "Job not found.")
    frames = sorted(flat_dir.iterdir(), key=lambda p: natural_sort_key(p.name))
    if not frames: raise HTTPException(400, "No frames found.")
    img_ext       = frames[0].suffix.lower()
    input_pattern = str(flat_dir / f"frame_%06d{img_ext}")
    vf = build_vf(to_int(crop_x), to_int(crop_y), to_int(crop_w), to_int(crop_h),
                  to_int(width), to_int(height))

    if async_mode:
        _job_init(job_id, label=f"Stitch → {format.upper()}")
        t = threading.Thread(
            target=_run_stitch,
            args=(job_id, job_dir, input_pattern, img_ext, fps, crf, preset, format,
                  vf, to_float(trim_start), to_float(trim_end)),
            daemon=True)
        t.start()
        return {"job_id": job_id, "status": "queued",
                "poll_url": f"/jobs/{job_id}/status"}

    # Synchronous (legacy)
    output = output_path_for(job_dir, format)
    if format == "gif":
        code, err = stitch_to_gif(input_pattern, fps, job_dir, output, vf)
    else:
        cfg  = FORMAT_CONFIG[format]
        args = ["-framerate", str(fps), "-i", input_pattern]
        ts   = to_float(trim_start); te = to_float(trim_end)
        if ts is not None: args += ["-ss", str(ts)]
        if te is not None: args += ["-to", str(te)]
        args += cfg["codec_args"]
        if format in ("mp4", "mov"): args += ["-crf", str(crf), "-preset", preset]
        elif format == "webm":       args += ["-crf", str(crf), "-b:v", "0"]
        if vf: args += ["-vf", vf]
        args += [str(output)]
        code, _, err = run_ffmpeg_queued(args)
    if code != 0: raise HTTPException(500, friendly_ffmpeg_error(err))
    return build_result(job_dir, job_id, format)

# ── #8 — Async process ────────────────────────────────────────────────────────
def _run_process(job_id: str, job_dir: Path, input_video: Path,
                 fmt: str, crf: int, preset: str, vf: str | None,
                 trim_start: float | None, trim_end: float | None):
    _job_update(job_id, status="queued", message="Waiting in queue…", progress=5)
    output = output_path_for(job_dir, fmt)
    try:
        _job_update(job_id, status="processing", message="Processing video…", progress=15)
        code, err = process_video_to_format(input_video, output, fmt, crf, preset,
                                             trim_start, trim_end, vf)
        if code != 0: raise RuntimeError(friendly_ffmpeg_error(err))
        mb = round(output.stat().st_size / 1_048_576, 2)
        _mark_output(job_id, fmt, mb)
        _job_update(job_id, status="done", message=f"Done — {mb} MB",
                    progress=100, size_mb=mb, format=fmt)
    except Exception as e:
        _job_update(job_id, status="error", message=str(e), progress=0)

@app.post("/jobs/{job_id}/process")
async def process_video(
    job_id: str,
    format: str = Form("mp4"), crf: int = Form(18), preset: str = Form("medium"),
    width: Optional[str] = Form(None), height: Optional[str] = Form(None),
    trim_start: Optional[str] = Form(None), trim_end: Optional[str] = Form(None),
    crop_x: Optional[str] = Form(None), crop_y: Optional[str] = Form(None),
    crop_w: Optional[str] = Form(None), crop_h: Optional[str] = Form(None),
    async_mode: bool = Form(False),
):
    if format not in VALID_VIDEO_FORMATS:
        raise HTTPException(400, f"Invalid format. Choose from: {', '.join(sorted(VALID_VIDEO_FORMATS))}")
    job_dir = WORK_DIR / job_id
    if not job_dir.exists(): raise HTTPException(404, "Job not found.")
    input_video = next(
        (f for f in job_dir.iterdir()
         if f.stem == "input" and f.suffix in {".mp4", ".mov", ".webm", ".avi", ".mkv"}), None)
    if not input_video:
        raise HTTPException(404, "No input video found. Use /jobs/upload-video first.")
    vf = build_vf(to_int(crop_x), to_int(crop_y), to_int(crop_w), to_int(crop_h),
                  to_int(width), to_int(height))

    if async_mode:
        _job_init(job_id, label=f"Process → {format.upper()}")
        t = threading.Thread(
            target=_run_process,
            args=(job_id, job_dir, input_video, format, crf, preset, vf,
                  to_float(trim_start), to_float(trim_end)),
            daemon=True)
        t.start()
        return {"job_id": job_id, "status": "queued",
                "poll_url": f"/jobs/{job_id}/status"}

    code, err = process_video_to_format(input_video, output_path_for(job_dir, format),
                                         format, crf, preset,
                                         to_float(trim_start), to_float(trim_end), vf)
    if code != 0: raise HTTPException(500, friendly_ffmpeg_error(err))
    return build_result(job_dir, job_id, format)

# ── #6 — Merge multiple videos ────────────────────────────────────────────────
@app.post("/jobs/merge")
async def merge_videos(
    files: List[UploadFile] = File(...),
    format: str = Form("mp4"),
):
    if format not in VALID_VIDEO_FORMATS:
        raise HTTPException(400, f"Invalid format. Choose from: {', '.join(sorted(VALID_VIDEO_FORMATS))}")
    if len(files) < 2:
        raise HTTPException(400, "Please provide at least 2 video files to merge.")

    job_id, job_dir = new_job(label=f"Merge {len(files)} files → {format.upper()}")
    _job_init(job_id, label=f"Merge {len(files)} files → {format.upper()}")
    inputs_dir = job_dir / "inputs"; inputs_dir.mkdir()

    def _do_merge():
        try:
            _job_update(job_id, status="processing", message="Uploading & remuxing inputs…", progress=10)
            concat_list = job_dir / "concat.txt"
            remuxed = []

            for i, f in enumerate(files):  # files already read — use stored bytes
                suffix = Path(f.filename).suffix.lower()
                raw    = inputs_dir / f"raw_{i:03d}{suffix}"
                fixed  = inputs_dir / f"clip_{i:03d}.mp4"
                # Already read above; write synchronously inside thread
                raw.write_bytes(f._body)  # stashed below
                code, _, err = run_ffmpeg(["-i", str(raw), "-c", "copy",
                                           "-movflags", "faststart", str(fixed)])
                if code != 0:
                    code, _, err = run_ffmpeg(["-i", str(raw), "-c:v", "libx264",
                                               "-crf", "18", "-preset", "fast",
                                               "-movflags", "faststart", str(fixed)])
                if code != 0:
                    raise RuntimeError(f"Could not process clip {i+1}: {friendly_ffmpeg_error(err)}")
                remuxed.append(fixed)
                pct = 10 + int((i + 1) / len(files) * 40)
                _job_update(job_id, message=f"Prepared clip {i+1}/{len(files)}…", progress=pct)

            concat_list.write_text("\n".join(f"file '{p}'" for p in remuxed))
            _job_update(job_id, status="processing", message="Merging clips…", progress=55)

            output = output_path_for(job_dir, format)
            cfg    = FORMAT_CONFIG[format]
            code, _, err = run_ffmpeg_queued([
                "-f", "concat", "-safe", "0", "-i", str(concat_list),
                *cfg["codec_args"],
                *((["-crf", "18", "-preset", "medium"]) if format in ("mp4", "mov") else ["-crf", "18", "-b:v", "0"]),
                str(output),
            ])
            if code != 0: raise RuntimeError(friendly_ffmpeg_error(err))

            mb = round(output.stat().st_size / 1_048_576, 2)
            _mark_output(job_id, format, mb)
            _job_update(job_id, status="done", message=f"Done — {mb} MB",
                        progress=100, size_mb=mb, format=format)
        except Exception as e:
            _job_update(job_id, status="error", message=str(e), progress=0)

    # Read all file bytes before handing off to thread
    for f in files:
        f._body = await f.read()

    threading.Thread(target=_do_merge, daemon=True).start()
    return {"job_id": job_id, "status": "queued", "poll_url": f"/jobs/{job_id}/status"}

# ── Download ──────────────────────────────────────────────────────────────────
@app.get("/jobs/{job_id}/download")
def download(job_id: str):
    job_dir = WORK_DIR / job_id
    for fmt, cfg in FORMAT_CONFIG.items():
        p = job_dir / f"output{cfg['ext']}"
        if p.exists():
            return FileResponse(p, media_type=cfg["mime"],
                                filename=f"qween_{job_id[:8]}{cfg['ext']}")
    raise HTTPException(404, "No output yet. Run /stitch or /process first.")

# ── Segment ───────────────────────────────────────────────────────────────────
@app.post("/jobs/{job_id}/segment")
async def segment(job_id: str, segment_duration: float = Form(5.0)):
    job_dir = WORK_DIR / job_id
    output_video = None
    for fmt in ("mp4", "mov", "webm"):
        p = output_path_for(job_dir, fmt)
        if p.exists(): output_video = p; break
    if not output_video:
        output_video = next(
            (f for f in job_dir.iterdir()
             if f.stem == "input" and f.suffix in {".mp4", ".mov", ".webm", ".avi", ".mkv"}), None)
    if not output_video:
        raise HTTPException(404, "No video found. Run /stitch, /process, or upload a video first.")
    seg_dir = job_dir / "segments"; seg_dir.mkdir(exist_ok=True)
    code, _, err = run_ffmpeg_queued([
        "-i", str(output_video), "-c", "copy", "-map", "0",
        "-segment_time", str(segment_duration),
        "-f", "segment", "-reset_timestamps", "1",
        str(seg_dir / "seg_%03d.mp4"),
    ])
    if code != 0: raise HTTPException(500, friendly_ffmpeg_error(err))
    segs = sorted(seg_dir.glob("seg_*.mp4"))
    return {"job_id": job_id, "segment_count": len(segs),
            "segments": [{"index": i, "filename": s.name,
                          "size_mb": round(s.stat().st_size / 1_048_576, 2),
                          "download_url": f"/jobs/{job_id}/segment/{i}"}
                         for i, s in enumerate(segs)]}

@app.get("/jobs/{job_id}/segment/{index}")
def download_segment(job_id: str, index: int):
    seg_dir = WORK_DIR / job_id / "segments"
    segs    = sorted(seg_dir.glob("seg_*.mp4")) if seg_dir.exists() else []
    if index < 0 or index >= len(segs): raise HTTPException(404, "Segment not found.")
    return FileResponse(segs[index], media_type="video/mp4", filename=segs[index].name)

# ── List / Delete jobs ────────────────────────────────────────────────────────
@app.get("/jobs")
def list_jobs():
    jobs = []
    for d in sorted(WORK_DIR.iterdir(), key=lambda x: -x.stat().st_mtime):
        if not d.is_dir(): continue
        meta       = _job_meta.get(d.name, {})
        async_meta = _async_jobs.get(d.name, {})
        flat       = d / "flat"
        fc         = len(list(flat.iterdir())) if flat.exists() else 0
        out_fmt    = next((fmt for fmt, cfg in FORMAT_CONFIG.items()
                           if (d / f"output{cfg['ext']}").exists()), None)
        out_size   = None
        if out_fmt:
            p = d / f"output{FORMAT_CONFIG[out_fmt]['ext']}"
            out_size = round(p.stat().st_size / 1_048_576, 2)
        jobs.append({
            "job_id":     d.name,
            "label":      meta.get("label") or async_meta.get("label", ""),
            "input_file": meta.get("input_file", ""),
            "created_at": meta.get("created_at", d.stat().st_mtime),
            "frame_count": fc,
            "has_output": out_fmt is not None,
            "format":     out_fmt,
            "size_mb":    out_size,
            "async_status": async_meta.get("status"),
        })
    return {"jobs": jobs}

@app.delete("/jobs/{job_id}")
def delete_job(job_id: str, background_tasks: BackgroundTasks):
    job_dir = WORK_DIR / job_id
    if not job_dir.exists(): raise HTTPException(404, "Job not found.")
    background_tasks.add_task(cleanup_job, job_dir)
    return {"deleted": job_id}

# ── #8 — Unified status endpoint ─────────────────────────────────────────────
@app.get("/jobs/{job_id}/status")
def job_status(job_id: str):
    # Check async job store first
    with _async_lock:
        if job_id in _async_jobs:
            return dict(_async_jobs[job_id])
    # Fall back to disk check
    job_dir = WORK_DIR / job_id
    if not job_dir.exists(): raise HTTPException(404, "Job not found.")
    has_output = any((job_dir / f"output{cfg['ext']}").exists() for cfg in FORMAT_CONFIG.values())
    return {"status": "done" if has_output else "running",
            "message": "Output ready." if has_output else "Processing…",
            "progress": 100 if has_output else 0}


# ── Alpha WebM (dual-stream alphamerge) ───────────────────────────────────────
# Client encodes two opaque streams via WebCodecs: RGB color, and alpha
# repacked into the Y plane of a second I420 stream (U/V neutral, 128).
# ffmpeg combines them into a single yuva420p WebM via the alphamerge filter.
@app.post("/jobs/alphamerge")
async def alphamerge(
    color: UploadFile = File(...),
    alpha: UploadFile = File(...),
    fps: float = Form(30),
    crf: int = Form(18),
):
    job_id, job_dir = new_job(label="alphamerge → webm")
    color_path = job_dir / f"color{Path(color.filename).suffix or '.mp4'}"
    alpha_path = job_dir / f"alpha{Path(alpha.filename).suffix or '.mp4'}"
    async with aiofiles.open(color_path, "wb") as f: await f.write(await color.read())
    async with aiofiles.open(alpha_path, "wb") as f: await f.write(await alpha.read())

    output = output_path_for(job_dir, "webm")
    code, _, err = run_ffmpeg_queued([
        "-i", str(color_path), "-i", str(alpha_path),
        "-filter_complex", "[0:v][1:v]alphamerge=shortest=1",
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
        "-auto-alt-ref", "0", "-crf", str(crf), "-b:v", "0",
        "-r", str(fps),
        str(output)
    ])
    if code != 0:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(400, f"alphamerge failed: {friendly_ffmpeg_error(err)}")
    return build_result(job_dir, job_id, "webm")


# ── GIF from already-encoded opaque video ─────────────────────────────────────
# Reuses the client's WebCodecs-encoded opaque MP4 as ffmpeg's sole input for
# palettegen/paletteuse — one small upload, one ffmpeg invocation.
@app.post("/jobs/gif-from-video")
async def gif_from_video(
    file: UploadFile = File(...),
    fps: float = Form(15),
    width: Optional[int] = Form(None),
):
    job_id, job_dir = new_job(label="gif-from-video")
    suffix = Path(file.filename).suffix or ".mp4"
    input_path = job_dir / f"input{suffix}"
    async with aiofiles.open(input_path, "wb") as f: await f.write(await file.read())

    output = output_path_for(job_dir, "gif")
    palette = job_dir / "palette.png"
    vf_base = f"fps={fps},scale={width}:-1:flags=lanczos" if width else f"fps={fps},scale=320:-1:flags=lanczos"
    c1, _, e1 = run_ffmpeg_queued(["-i", str(input_path), "-vf", f"{vf_base},palettegen", str(palette)])
    if c1 != 0:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(400, f"GIF encode failed: {friendly_ffmpeg_error(e1)}")
    c2, _, e2 = run_ffmpeg_queued(["-i", str(input_path), "-i", str(palette),
                                    "-lavfi", f"{vf_base} [x]; [x][1:v] paletteuse",
                                    str(output)])
    if c2 != 0:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(400, f"GIF encode failed: {friendly_ffmpeg_error(e2)}")
    return build_result(job_dir, job_id, "gif")


# ── Audio mux / mix ────────────────────────────────────────────────────────────
# Combine a silent WebCodecs-encoded video with one or more audio sources.
# Video stream is copied (no re-encode); trim/loop/fade/mix handled via
# ffmpeg's filter graph (atrim, aloop, afade, amix, adelay).
class AudioTrack(BaseModel):
    delay_ms:    float = 0      # adelay
    trim_start:  Optional[float] = None  # atrim start (seconds)
    trim_end:    Optional[float] = None  # atrim end (seconds)
    loop:        bool  = False  # aloop to match video duration
    fade_in:     float = 0      # afade in duration (seconds)
    fade_out:    float = 0      # afade out duration (seconds)
    volume:      float = 1.0

@app.post("/jobs/mux-audio/{video_job_id}")
async def mux_audio(
    video_job_id: str,
    output_format: str = Form("mp4"),
    audio_files: List[UploadFile] = File(...),
    delay_ms:    str = Form(""),    # comma-separated, parallel to audio_files
    trim_start:  str = Form(""),
    trim_end:    str = Form(""),
    loop:        str = Form(""),
    fade_in:     str = Form(""),
    fade_out:    str = Form(""),
    volume:      str = Form(""),
):
    if output_format not in VALID_VIDEO_FORMATS:
        raise HTTPException(400, f"Invalid format. Choose from: {', '.join(sorted(VALID_VIDEO_FORMATS))}")

    src_job_dir = WORK_DIR / video_job_id
    src_video = None
    for cfg in FORMAT_CONFIG.values():
        p = src_job_dir / f"output{cfg['ext']}"
        if p.exists():
            src_video = p
            break
    if src_video is None:
        raise HTTPException(404, "Source video job not found or has no output.")

    job_id, job_dir = new_job(label=f"mux-audio → {output_format.upper()}")

    def _split(csv: str, n: int, default, caster):
        parts = [p.strip() for p in csv.split(",")] if csv else []
        out = []
        for i in range(n):
            out.append(caster(parts[i]) if i < len(parts) and parts[i] != "" else default)
        return out

    n = len(audio_files)
    delays  = _split(delay_ms,   n, 0,    float)
    starts  = _split(trim_start, n, None, to_float)
    ends    = _split(trim_end,   n, None, to_float)
    loops   = _split(loop,       n, False, lambda v: v.lower() in ("1","true","yes"))
    fadeins = _split(fade_in,    n, 0,    float)
    fadeouts= _split(fade_out,   n, 0,    float)
    vols    = _split(volume,     n, 1.0,  float)

    audio_paths = []
    for i, af in enumerate(audio_files):
        suffix = Path(af.filename).suffix or ".m4a"
        p = job_dir / f"audio_{i}{suffix}"
        async with aiofiles.open(p, "wb") as f: await f.write(await af.read())
        audio_paths.append(p)

    vinfo = probe_video(src_video)
    video_duration = to_float(vinfo.get("duration")) or 0

    args = ["-i", str(src_video)]
    for p in audio_paths:
        args += ["-i", str(p)]

    filter_parts = []
    mixed_labels = []
    for i in range(n):
        label_in = f"{i+1}:a"
        chain = []
        if starts[i] is not None or ends[i] is not None:
            trim_args = []
            if starts[i] is not None: trim_args.append(f"start={starts[i]}")
            if ends[i] is not None:   trim_args.append(f"end={ends[i]}")
            chain.append(f"atrim={':'.join(trim_args)}")
            chain.append("asetpts=PTS-STARTPTS")
        if loops[i] and video_duration:
            chain.append(f"aloop=loop=-1:size=2e9")
            chain.append(f"atrim=0:{video_duration}")
            chain.append("asetpts=PTS-STARTPTS")
        if fadeins[i] > 0:
            chain.append(f"afade=t=in:st=0:d={fadeins[i]}")
        if fadeouts[i] > 0 and video_duration:
            chain.append(f"afade=t=out:st={max(0, video_duration - fadeouts[i])}:d={fadeouts[i]}")
        if vols[i] != 1.0:
            chain.append(f"volume={vols[i]}")
        if delays[i] > 0:
            chain.append(f"adelay={int(delays[i])}:all=1")
        out_label = f"a{i}"
        if chain:
            filter_parts.append(f"[{label_in}]{','.join(chain)}[{out_label}]")
        else:
            filter_parts.append(f"[{label_in}]anull[{out_label}]")
        mixed_labels.append(f"[{out_label}]")

    if n == 1:
        final_label = mixed_labels[0]
        filter_complex = ";".join(filter_parts)
    else:
        filter_parts.append(f"{''.join(mixed_labels)}amix=inputs={n}:duration=longest:dropout_transition=0[aout]")
        final_label = "[aout]"
        filter_complex = ";".join(filter_parts)

    audio_codec = "libopus" if output_format == "webm" else "aac"
    output = output_path_for(job_dir, output_format)
    args += [
        "-filter_complex", filter_complex,
        "-map", "0:v", "-map", final_label,
        "-c:v", "copy", "-c:a", audio_codec, "-shortest",
        str(output)
    ]
    code, _, err = run_ffmpeg_queued(args)
    if code != 0:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(400, f"Audio mux failed: {friendly_ffmpeg_error(err)}")
    return build_result(job_dir, job_id, output_format)


# ── Asset store ────────────────────────────────────────────────────────────────
# Lightweight content-addressed store for video/font assets referenced by
# /jobs/playwright-render. Avoids round-tripping base64-encoded blobs through
# the job JSON payload.
@app.post("/assets/upload")
async def upload_asset(file: UploadFile = File(...), content_hash: Optional[str] = Form(None)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ASSET_ALLOWED_EXTS:
        raise HTTPException(
            400,
            f"Unsupported asset type '{suffix}'. Allowed: {', '.join(sorted(ASSET_ALLOWED_EXTS))}",
        )

    data = await file.read()
    size_mb = len(data) / 1_048_576
    if suffix in ASSET_VIDEO_EXTS and size_mb > MAX_VIDEO_MB:
        raise HTTPException(413, f"Asset too large ({size_mb:.0f} MB). Max is {MAX_VIDEO_MB} MB.")

    computed_hash = hashlib.sha256(data).hexdigest()
    dedupe_key = content_hash or computed_hash

    # Deduplication: same content hash → return existing asset_id if still on disk
    with _asset_lock:
        existing_id = _asset_hash_index.get(dedupe_key)
    if existing_id:
        existing_dir = ASSETS_DIR / existing_id
        existing_files = list(existing_dir.glob("file.*")) if existing_dir.exists() else []
        if existing_files:
            existing_dir.touch()  # bump mtime so it survives the next sweep
            return {
                "asset_id": existing_id,
                "size_mb": round(existing_files[0].stat().st_size / 1_048_576, 2),
                "content_hash": dedupe_key,
                "expires_in": f"{AUTO_CLEAN_HOURS}h",
            }

    asset_id  = str(uuid.uuid4())
    asset_dir = ASSETS_DIR / asset_id
    asset_dir.mkdir(parents=True)
    asset_path = asset_dir / f"file{suffix}"
    async with aiofiles.open(asset_path, "wb") as f:
        await f.write(data)
    (asset_dir / "meta.json").write_text(json.dumps({
        "filename": file.filename, "content_hash": dedupe_key,
        "mime": ASSET_MIME.get(suffix, "application/octet-stream"),
        "uploaded_at": time.time(),
    }))

    with _asset_lock:
        _asset_hash_index[dedupe_key] = asset_id

    return {
        "asset_id": asset_id,
        "size_mb": round(size_mb, 2),
        "content_hash": dedupe_key,
        "expires_in": f"{AUTO_CLEAN_HOURS}h",
    }


@app.get("/assets/{asset_id}")
def get_asset(asset_id: str):
    asset_dir = ASSETS_DIR / asset_id
    if not asset_dir.exists():
        raise HTTPException(404, "Asset not found or expired.")
    files = list(asset_dir.glob("file.*"))
    if not files:
        raise HTTPException(404, "Asset not found or expired.")
    p = files[0]
    mime = ASSET_MIME.get(p.suffix.lower(), "application/octet-stream")
    return FileResponse(p, media_type=mime)


@app.delete("/assets/{asset_id}")
def delete_asset(asset_id: str):
    asset_dir = ASSETS_DIR / asset_id
    if not asset_dir.exists():
        raise HTTPException(404, "Asset not found.")
    content_hash = None
    meta_path = asset_dir / "meta.json"
    if meta_path.exists():
        try: content_hash = json.loads(meta_path.read_text()).get("content_hash")
        except Exception: pass
    shutil.rmtree(asset_dir, ignore_errors=True)
    if content_hash:
        with _asset_lock: _asset_hash_index.pop(content_hash, None)
    return {"deleted": asset_id}


# ── Playwright frame-by-frame render ──────────────────────────────────────────
class PlaywrightRenderRequest(BaseModel):
    fps: float = 30
    crf: int = 18
    format: str = "mp4"
    startTime: float = 0
    endTime: float = 0
    stageWidth: int = 1920
    stageHeight: int = 1080
    nodes: List[Dict[str, Any]] = []
    videoAssets: List[Dict[str, Any]] = []
    fontAssets: List[Dict[str, Any]] = []
    tweens: List[Dict[str, Any]] = []
    timelineLoop: bool = False
    timelineYoyo: bool = False
    timelineReverse: bool = False
    timelineSpeed: float = 1
    rootSvgId: str = "main-svg-root"
    originalViewBox: Optional[Dict[str, Any]] = None
    globalDataSources: List[Dict[str, Any]] = []
    swapTemplates: List[Dict[str, Any]] = []
    storedInitialStates: List[Dict[str, Any]] = []
    gsapCdn: Optional[str] = None


@app.get("/render-stage/{job_id}")
def render_stage(job_id: str):
    with _render_lock:
        payload = _render_payloads.get(job_id)
    if payload is None:
        raise HTTPException(404, "Render job not found or already completed.")
    html = build_stage_html(payload, asset_base="/assets")
    return HTMLResponse(html)


def _run_playwright_render(job_id: str, job_dir: Path, payload: dict, fmt: str,
                            fps: float, crf: int):
    import asyncio
    from playwright.async_api import async_playwright

    _job_update(job_id, status="processing", message="Launching renderer…", progress=2)

    frames_dir = job_dir / "frames"
    frames_dir.mkdir(exist_ok=True)

    start_time = payload.get("startTime", 0) or 0
    end_time   = payload.get("endTime", 0) or 0
    stage_w    = payload.get("stageWidth", 1920)
    stage_h    = payload.get("stageHeight", 1080)
    total_frames = max(1, math.ceil((end_time - start_time) * fps))

    async def _render():
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
            page = await browser.new_page(viewport={"width": stage_w, "height": stage_h})
            try:
                await page.goto(f"http://localhost:8000/render-stage/{job_id}", wait_until="load")
                await page.wait_for_function("window.__qween_ready === true", timeout=120_000)

                for i in range(total_frames):
                    t = start_time + (i / fps)
                    await page.evaluate("(t) => window.__qween_seek(t)", t)
                    await page.wait_for_function("window.__qween_frame_ready === true", timeout=30_000)
                    await page.screenshot(
                        path=str(frames_dir / f"frame_{i:06d}.png"),
                        clip={"x": 0, "y": 0, "width": stage_w, "height": stage_h},
                    )
                    _job_update(job_id, progress=int((i + 1) / total_frames * 72),
                                 message=f"Frame {i+1}/{total_frames}")
            finally:
                await browser.close()

    asyncio.run(_render())

    _job_update(job_id, status="processing", message="Stitching frames…", progress=74)

    output = output_path_for(job_dir, fmt)
    cfg = FORMAT_CONFIG[fmt]
    input_pattern = str(frames_dir / "frame_%06d.png")
    if fmt == "gif":
        code, err = stitch_to_gif(input_pattern, fps, job_dir, output)
    else:
        args = ["-framerate", str(fps), "-i", input_pattern, *cfg["codec_args"]]
        if fmt in ("mp4", "mov"): args += ["-crf", str(crf), "-preset", "medium"]
        elif fmt == "webm":       args += ["-crf", str(crf), "-b:v", "0"]
        args += [str(output)]
        code, _, err = run_ffmpeg_queued(args)

    if code != 0:
        raise RuntimeError(friendly_ffmpeg_error(err))

    mb = round(output.stat().st_size / 1_048_576, 2)
    _mark_output(job_id, fmt, mb)
    _job_update(job_id, status="done", message=f"Done — {mb} MB", progress=100, size_mb=mb, format=fmt)


def _run_playwright_render_safe(job_id: str, job_dir: Path, payload: dict, fmt: str,
                                 fps: float, crf: int):
    try:
        _run_playwright_render(job_id, job_dir, payload, fmt, fps, crf)
    except Exception as e:
        _job_update(job_id, status="error", message=str(e), progress=0)
    finally:
        with _render_lock:
            _render_payloads.pop(job_id, None)


@app.post("/jobs/playwright-render")
async def playwright_render(req: PlaywrightRenderRequest, background_tasks: BackgroundTasks):
    fmt = req.format
    if fmt not in VALID_FORMATS:
        raise HTTPException(400, f"Invalid format. Choose from: {', '.join(sorted(VALID_FORMATS))}")
    if fmt == "gif":
        raise HTTPException(400, "GIF is not supported for Video Render.")
    if req.endTime <= req.startTime:
        raise HTTPException(400, "endTime must be greater than startTime.")

    job_id, job_dir = new_job(label=f"playwright-render → {fmt.upper()}")
    _job_init(job_id, label=f"playwright-render → {fmt.upper()}")

    payload = req.model_dump()
    with _render_lock:
        _render_payloads[job_id] = payload

    t = threading.Thread(
        target=_run_playwright_render_safe,
        args=(job_id, job_dir, payload, fmt, req.fps, req.crf),
        daemon=True,
    )
    t.start()

    return {"job_id": job_id, "status": "queued", "poll_url": f"/jobs/{job_id}/status"}

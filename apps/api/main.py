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
from fastapi.responses import FileResponse
from pydantic import BaseModel

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="QweenFFmpeg API", version="3.0.0")
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
        if d.is_dir() and d.stat().st_mtime < cutoff:
            shutil.rmtree(d, ignore_errors=True)
            with _meta_lock: _job_meta.pop(d.name, None)
            with _async_lock: _async_jobs.pop(d.name, None)
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
    return {"status": "ok", "ffmpeg": line, "version": "2.2.0",
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


# ── Playwright Frame-by-Frame Render ──────────────────────────────────────────
# Headless render mode: ships QweenApp_v223.html to Playwright, injects
# projectJson so the real GSAP timeline is built — no second implementation.

QWEEN_APP_PATH = Path(__file__).parent.parent / "QweenApp_v223.html"

class PlaywrightRenderRequest(BaseModel):
    projectJson:      dict                 # full project.json object
    fps:              float       = 30
    crf:              int         = 18
    format:           str         = "mp4"
    startTime:        float       = 0
    endTime:          float       = 5.0
    stageWidth:       float       = 1080
    stageHeight:      float       = 1080
    scaleMultiplier:  float       = 1.0


def _extract_fonts(project: dict, job_dir: Path) -> dict:
    """
    Extract base64 fonts from project.json, write to disk, return
    a mapping of { blob_url_placeholder → file:// URL } for rewriting.
    Fonts are always mandatory — runs unconditionally before page load.
    """
    fonts_dir = job_dir / "fonts"
    fonts_dir.mkdir(exist_ok=True)
    font_css_lines = []

    for font in project.get("fonts", []):
        try:
            b64   = font.get("base64", "")
            if not b64:
                continue
            fname = f"{font.get('id', 'font')}.{font.get('format', 'ttf')}"
            fpath = fonts_dir / fname
            fpath.write_bytes(__import__("base64").b64decode(b64))
            family    = font.get("family", "UnknownFont")
            weight    = font.get("weight", "normal")
            style     = font.get("style", "normal")
            fmt_name  = font.get("format", "truetype")
            file_url  = fpath.resolve().as_uri()
            font_css_lines.append(
                f"@font-face {{ font-family: '{family}'; font-weight: {weight}; "
                f"font-style: {style}; src: url('{file_url}') format('{fmt_name}'); }}"
            )
        except Exception as e:
            print(f"[QweenRender] Font extraction failed for {font.get('family')}: {e}")

    return "\n".join(font_css_lines)


def _build_seek_js() -> str:
    """
    Simplified __qween_seek — now backed by the real GSAP timeline
    exposed by QweenApp's headless render mode as window.__masterTl.
    """
    return """
window.__qween_frame_done = false;

window.__qween_seek = async function(t) {
  window.__qween_frame_done = false;

  // 1. Seek the real GSAP timeline exposed by QweenApp headless boot
  if (window.__masterTl) {
    window.__masterTl.pause();
    window.__masterTl.time(t);
  }

  // 2. Seek any video elements present in the canvas
  const videos = Array.from(document.querySelectorAll('video'));
  const seekPromises = videos.map(v => new Promise(res => {
    if (!v.src) { res(); return; }
    v.pause();
    if (Math.abs(v.currentTime - t) < 0.001) { res(); return; }
    const onSeeked = () => { v.removeEventListener('seeked', onSeeked); res(); };
    v.addEventListener('seeked', onSeeked);
    v.currentTime = t;
    setTimeout(res, 300);
  }));
  await Promise.all(seekPromises);

  // 3. Two rAF cycles for paint to settle
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__qween_frame_done = true;
};
"""


def _run_playwright_render(job_id: str, req: PlaywrightRenderRequest, job_dir: Path):
    try:
        from playwright.sync_api import sync_playwright
        import json as _json

        fmt          = req.format if req.format in VALID_FORMATS else "mp4"
        scale        = max(0.5, min(req.scaleMultiplier, 4.0))
        w            = int(req.stageWidth  * scale)
        h            = int(req.stageHeight * scale)
        fps          = req.fps
        total_frames = max(1, round((req.endTime - req.startTime) * fps))
        frames_dir   = job_dir / "frames"
        frames_dir.mkdir()

        # ── 1. Read QweenApp_v223.html from repo ─────────────────────────────
        if not QWEEN_APP_PATH.exists():
            raise FileNotFoundError(
                f"QweenApp_v223.html not found at {QWEEN_APP_PATH}. "
                "Ensure it is committed to apps/QweenApp_v223.html in the repo."
            )
        app_html = QWEEN_APP_PATH.read_text(encoding="utf-8")

        # ── 2. Font pipeline (mandatory — always runs before page load) ───────
        font_css = _extract_fonts(req.projectJson, job_dir)

        # ── 3. Build render-mode HTML ─────────────────────────────────────────
        # Inject: font CSS overrides + projectJson + seek JS + scale
        project_json_str = _json.dumps(req.projectJson)
        seek_js          = _build_seek_js()

        inject_head = f"""
<style id="__qween_font_overrides">
{font_css}
</style>
<script id="__qween_project_inject">
  window.__qween_project = {project_json_str};
</script>"""

        inject_body = f"""
<script id="__qween_seek_inject">
{seek_js}
</script>"""

        # Scale the canvas if needed
        if scale != 1.0:
            inject_head += (
                f'\n<style id="__qween_scale">'
                f'.frame{{transform:scale({scale});transform-origin:top left;}}'
                f'body{{width:{w}px;height:{h}px;overflow:hidden;}}'
                f'</style>'
            )

        # Inject into the real app HTML
        if '</head>' in app_html:
            app_html = app_html.replace('</head>', f'{inject_head}\n</head>', 1)
        else:
            app_html = inject_head + app_html

        if '</body>' in app_html:
            app_html = app_html.replace('</body>', f'{inject_body}\n</body>', 1)
        else:
            app_html += inject_body

        html_path = job_dir / "stage.html"
        html_path.write_text(app_html, encoding="utf-8")
        _job_update(job_id, status="processing", message="Launching browser…", progress=2)

        # ── 3b. Copy vendored assets (Vue, GSAP, Element Plus, fonts, etc.) ────
        # stage.html references ./vendor/... relative to itself; since stage.html
        # is served from job_dir, the vendor/ directory must exist alongside it.
        vendor_src = QWEEN_APP_PATH.parent / "vendor"
        if vendor_src.exists():
            shutil.copytree(vendor_src, job_dir / "vendor", dirs_exist_ok=True)

        # ── 4. Spin up a local HTTP server so CDN scripts load correctly ──────
        # file:// URLs block external CDN requests in Chromium; http:// does not.
        import http.server, socketserver, random
        http_port = random.randint(19000, 29000)
        html_dir  = str(job_dir)

        class _SilentHandler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **kw):
                super().__init__(*a, directory=html_dir, **kw)
            def log_message(self, *a): pass

        httpd = socketserver.TCPServer(("127.0.0.1", http_port), _SilentHandler)
        srv_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        srv_thread.start()

        # ── 5. Launch Playwright ──────────────────────────────────────────────
        with sync_playwright() as p:
            browser = p.chromium.launch(args=[
                "--no-sandbox", "--disable-setuid-sandbox",
                "--autoplay-policy=no-user-gesture-required",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
            ])
            page = browser.new_page(viewport={"width": w, "height": h})

            # WebM: transparent background
            if fmt == "webm":
                page.add_init_script(
                    "document.documentElement.style.background='transparent';"
                    "document.body && (document.body.style.background='transparent');"
                )

            # Capture all browser console output and page errors for debugging
            browser_logs = []
            page.on("console", lambda msg: browser_logs.append(f"[{msg.type}] {msg.text}"))
            page.on("pageerror", lambda err: browser_logs.append(f"[pageerror] {err}"))

            # Load over HTTP so CDN scripts (GSAP, Vue, ElementPlus) load correctly
            page.goto(f"http://127.0.0.1:{http_port}/stage.html?mode=render")

            # Wait for QweenApp to finish building the timeline
            try:
                page.wait_for_function("window.__qween_ready === true", timeout=45_000)
            except Exception as wait_err:
                log_dump = "\n".join(browser_logs[-40:]) if browser_logs else "(no browser logs)"
                raise RuntimeError(
                    f"__qween_ready timeout.\n--- Browser logs ---\n{log_dump}"
                ) from wait_err
            _job_update(job_id, message=f"Capturing {total_frames} frames…", progress=5)

            # Resolve the canvas bounding box for screenshot clip
            clip = page.evaluate("""() => {
                const el = window.__qween_container
                         || document.querySelector('.frame')
                         || document.body;
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.x), y: Math.round(r.y),
                         width: Math.round(r.width), height: Math.round(r.height) };
            }""")
            if not clip or clip["width"] == 0:
                clip = {"x": 0, "y": 0, "width": w, "height": h}

            # ── 5. Frame-by-frame capture ─────────────────────────────────────
            for i in range(total_frames):
                t = req.startTime + (i / fps)
                page.evaluate(f"window.__qween_seek({t})")
                page.wait_for_function(
                    "window.__qween_frame_done === true",
                    timeout=8_000
                )
                page.screenshot(
                    path=str(frames_dir / f"frame_{i:06d}.png"),
                    clip=clip,
                    omit_background=(fmt == "webm"),
                )
                pct = 5 + round((i + 1) / total_frames * 73)
                _job_update(job_id,
                    message=f"Frame {i+1}/{total_frames} · t={t:.3f}s",
                    progress=pct)

            browser.close()

        httpd.shutdown()

        # ── 4. Stitch with ffmpeg ────────────────────────────────────────────
        output        = output_path_for(job_dir, fmt)
        input_pattern = str(frames_dir / "frame_%06d.png")
        _job_update(job_id, message=f"Stitching {total_frames} frames → {fmt.upper()}…", progress=80)

        if fmt == "gif":
            code, err = stitch_to_gif(input_pattern, fps, job_dir, output)
        else:
            cfg  = FORMAT_CONFIG[fmt]
            args = ["-framerate", str(fps), "-i", input_pattern] + cfg["codec_args"]
            if fmt in ("mp4", "mov"): args += ["-crf", str(req.crf), "-preset", "medium"]
            elif fmt == "webm":       args += ["-crf", str(req.crf), "-b:v", "0"]
            args += [str(output)]
            code, _, err = run_ffmpeg_queued(args)

        if code != 0:
            raise RuntimeError(friendly_ffmpeg_error(err))

        mb = round(output.stat().st_size / 1_048_576, 2)
        _mark_output(job_id, fmt, mb)
        _job_update(job_id, status="done",
                    message=f"Done — {mb} MB · {fmt.upper()}",
                    progress=100, size_mb=mb, format=fmt)

    except Exception as e:
        _job_update(job_id, status="error", message=str(e), progress=0)


@app.post("/jobs/playwright-render")
async def playwright_render(req: PlaywrightRenderRequest):
    if req.format not in VALID_FORMATS:
        raise HTTPException(400, f"Invalid format. Choose from: {', '.join(sorted(VALID_FORMATS))}")
    job_id, job_dir = new_job(label=f"render → {req.format.upper()}")
    _job_init(job_id, label=f"Render → {req.format.upper()}")
    threading.Thread(
        target=_run_playwright_render,
        args=(job_id, req, job_dir),
        daemon=True
    ).start()
    return {"job_id": job_id, "status": "queued", "poll_url": f"/jobs/{job_id}/status"}

# Refactor Later: Strategy 3 — In-Browser Batch Capture

**Target:** `apps/api/main.py` → `_run_playwright_render` + `apps/app/public/QweenRender.html`

---

## Problem

The current Playwright render loop is O(frames × bands) in Chromium IPC round-trips:

```
for each frame:
  Python → page.evaluate(__qween_seek)   # IPC
  Python → wait_for_function             # IPC poll
  for each band:
    Python → page.evaluate (set_layer_mode)  # IPC
    Python → page.screenshot()               # IPC + PNG encode + file write
```

For a 10s / 30fps / 2 video-node project: 300 frames × 2 bands = **600 screenshots + 900 IPC calls**, all sequential.

---

## Proposed Solution: JS-Driven Batch Capture

Move the entire render loop into `QweenRender.html`. Python initiates once, the browser runs the loop internally, then posts all frames back as a ZIP.

### Flow

```
Python                          QweenRender.html (browser)
  │                                      │
  ├─ page.goto(url)                       │
  ├─ wait __qween_ready                  │
  ├─ page.evaluate(__qween_batch_render, │
  │   { fps, startTime, endTime,         │
  │     bands: [{zMin,zMax},...] })      │
  │                               ┌──────┤
  │                               │ for each frame:
  │                               │   seek(t)
  │                               │   await frameReady()
  │                               │   for each band:
  │                               │     setLayerMode(band)
  │                               │     canvas = document.querySelector(...)
  │                               │     blob = await canvas.toBlob('image/png')
  │                               │     zip.add(`band{b}/frame_{i}.png`, blob)
  │                               │ window.__qween_batch_done = zipBlob
  │                               └──────┤
  ├─ wait __qween_batch_done             │
  ├─ page.evaluate() → get zip bytes     │
  ├─ unzip → band dirs                   │
  └─ continue to _composite_video_layers │
```

### Key Details

**JS side (`QweenRender.html`)**

Add a `window.__qween_batch_render(config)` function:

```javascript
window.__qween_batch_render = async ({ fps, startTime, endTime, bands }) => {
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip/dist/jszip.min.js');
  const zip = new JSZip();
  const totalFrames = Math.round((endTime - startTime) * fps);
  const canvas = document.querySelector('canvas') || document.body; // adjust selector

  for (let i = 0; i < totalFrames; i++) {
    const t = startTime + i / fps;
    await window.__qween_seek(t);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    for (let b = 0; b < bands.length; b++) {
      const { zMin, zMax } = bands[b];
      window.__qween_set_layer_mode('band', zMin, zMax);
      await new Promise(r => requestAnimationFrame(r));

      const blob = await new Promise(res =>
        canvas.toBlob(res, 'image/png')
      );
      zip.file(`band${b}/frame_${String(i).padStart(6,'0')}.png`, blob);
    }

    window.__qween_batch_progress = (i + 1) / totalFrames;
  }

  window.__qween_batch_done = await zip.generateAsync({ type: 'base64' });
};
```

**Python side (`main.py`)**

Replace the Playwright seek loop with:

```python
bands_config = [
    {"zMin": (video_zs[b-1] if b > 0 else None),
     "zMax": (video_zs[b]   if b < len(video_zs) else None)}
    for b in range(len(active_bands))
]
await page.evaluate("(cfg) => window.__qween_batch_render(cfg)", {
    "fps": fps,
    "startTime": start_time,
    "endTime":   start_time + (total_frames / fps),
    "bands":     bands_config,
})

# Poll progress from Python (optional — for job updates)
while True:
    progress = await page.evaluate("() => window.__qween_batch_progress || 0")
    _job_update(job_id, progress=int(progress * 72), message=f"Rendering {int(progress*100)}%")
    done = await page.evaluate("() => !!window.__qween_batch_done")
    if done:
        break
    await asyncio.sleep(0.5)

zip_b64 = await page.evaluate("() => window.__qween_batch_done")
import base64, io, zipfile as _zfmod
zip_bytes = base64.b64decode(zip_b64)
with _zfmod.ZipFile(io.BytesIO(zip_bytes)) as zf:
    for b, (_, band_dir) in enumerate(active_bands):
        for name in zf.namelist():
            if name.startswith(f"band{b}/"):
                band_dir.joinpath(Path(name).name).write_bytes(zf.read(name))
```

---

## Expected Gains

| Metric | Current | After Strategy 3 |
|---|---|---|
| IPC round-trips (300 frames, 2 bands) | ~900 | ~3 (goto + evaluate + poll×N) |
| Screenshot overhead | Per-frame Python→Chromium | In-browser `canvas.toBlob` |
| Seek redundancy | `frames × bands` seeks | `frames` seeks |
| Progress granularity | Per-band per-frame | Single poll interval (0.5s) |

Estimated wall-clock improvement: **60–80%** for video-heavy projects.

---

## Pre-conditions Before Starting

- [ ] Confirm `QweenRender.html` exposes a single `<canvas>` element (or a stable DOM selector) that captures the full composite stage
- [ ] Confirm `window.__qween_set_layer_mode` is synchronous (no async settle needed after call)
- [ ] Test JSZip CDN availability in Playwright's network environment (or bundle it)
- [ ] Decide on ZIP transfer method: `base64` string (simple) vs. `page.evaluate` returning `Uint8Array` (avoids 33% base64 overhead for large renders)
- [ ] Add `__qween_batch_render` behind a feature flag or version check so old `QweenRender.html` deployments still work

---

## Files to Change

- `apps/app/public/QweenRender.html` — add `__qween_batch_render` JS function
- `apps/api/main.py` → `_run_playwright_render` — replace seek loop with batch evaluate + ZIP unpack
- `apps/api/main.py` → `_run_playwright_render` — remove `frames_band_dirs` mkdir (bands come from ZIP)

---

*Written: 2026-06-18*

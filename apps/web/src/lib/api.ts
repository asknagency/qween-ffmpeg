const DEFAULT_BASE = 'http://localhost:8000'

export type OutputFormat = 'mp4' | 'mov' | 'webm' | 'gif'
export type VideoFormat  = 'mp4' | 'mov' | 'webm'

export interface UploadResult {
  job_id: string; frame_count: number; extension: string
  width: string; height: string; first_frame: string
}

export interface VideoUploadResult {
  job_id: string; width: string; height: string; duration: string
}

export interface ProcessResult {
  job_id: string; format: string
  download_url: string; size_bytes: number; size_mb: number
}

export interface SegmentInfo {
  index: number; filename: string; size_mb: number; download_url: string
}

export interface SegmentResult {
  job_id: string; segment_count: number; segments: SegmentInfo[]
}

export interface StitchParams {
  fps: number; crf: number; preset: string; format: OutputFormat
  width?: number; height?: number
  trim_start?: number; trim_end?: number
  crop_x?: number; crop_y?: number; crop_w?: number; crop_h?: number
}

export interface ProcessParams {
  format: VideoFormat; crf?: number; preset?: string
  width?: number; height?: number
  trim_start?: number; trim_end?: number
  crop_x?: number; crop_y?: number; crop_w?: number; crop_h?: number
}

// ── Error helper ─────────────────────────────────────────────────────────────
async function extractError(r: Response, fallback: string): Promise<string> {
  try {
    const body = await r.json()
    if (typeof body.detail === 'string') return body.detail
    if (Array.isArray(body.detail)) {
      // FastAPI 422 validation errors — each item has loc + msg
      return body.detail.map((e: any) => `${e.loc?.slice(-1)[0] ?? 'field'}: ${e.msg}`).join(' · ')
    }
    if (body.message) return body.message
    return fallback
  } catch {
    return fallback
  }
}

// ── Upload ZIP of frames (Stitch only) ───────────────────────────────────────
export async function uploadZip(file: File, base = DEFAULT_BASE): Promise<UploadResult> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(`${base}/jobs/upload`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(await extractError(r, 'Upload failed'))
  return r.json()
}

// ── Upload video file (Crop / Trim / Scale / Segment) ────────────────────────
export async function uploadVideo(file: File, base = DEFAULT_BASE): Promise<VideoUploadResult> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(`${base}/jobs/upload-video`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(await extractError(r, 'Upload failed'))
  return r.json()
}

// ── Stitch frames → video ────────────────────────────────────────────────────
export async function stitch(jobId: string, params: StitchParams, base = DEFAULT_BASE): Promise<ProcessResult> {
  const fd = new FormData()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') fd.append(k, String(v))
  })
  const r = await fetch(`${base}/jobs/${jobId}/stitch`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(await extractError(r, 'Stitch failed'))
  return r.json()
}

// ── Process existing video (Crop / Trim / Scale) ─────────────────────────────
export async function processVideo(jobId: string, params: ProcessParams, base = DEFAULT_BASE): Promise<ProcessResult> {
  const fd = new FormData()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') fd.append(k, String(v))
  })
  const r = await fetch(`${base}/jobs/${jobId}/process`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(await extractError(r, 'Process failed'))
  return r.json()
}

// ── Segment ──────────────────────────────────────────────────────────────────
export async function segment(jobId: string, duration: number, base = DEFAULT_BASE): Promise<SegmentResult> {
  const fd = new FormData()
  fd.append('segment_duration', String(duration))
  const r = await fetch(`${base}/jobs/${jobId}/segment`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(await extractError(r, 'Segment failed'))
  return r.json()
}

// ── Misc ─────────────────────────────────────────────────────────────────────
export async function deleteJob(jobId: string, base = DEFAULT_BASE) {
  await fetch(`${base}/jobs/${jobId}`, { method: 'DELETE' })
}

export const downloadUrl          = (jobId: string, base = DEFAULT_BASE) => `${base}/jobs/${jobId}/download`
export const segmentDownloadUrl   = (jobId: string, idx: number, base = DEFAULT_BASE) => `${base}/jobs/${jobId}/segment/${idx}`
export const frameUrl             = (jobId: string, idx: number, base = DEFAULT_BASE) => `${base}/jobs/${jobId}/frame/${idx}`

// ── Format helpers ───────────────────────────────────────────────────────────
export const FORMAT_LABELS: Record<string, string> = {
  mp4: 'MP4', mov: 'MOV', webm: 'WebM', gif: 'GIF'
}
export const VIDEO_FORMATS: VideoFormat[]   = ['mp4', 'mov', 'webm']
export const ALL_FORMATS:   OutputFormat[]  = ['mp4', 'mov', 'webm', 'gif']

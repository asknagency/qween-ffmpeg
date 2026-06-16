const DEFAULT_BASE = 'http://localhost:8000'

export type OutputFormat = 'mp4' | 'mov' | 'webm' | 'gif'
export type VideoFormat  = 'mp4' | 'mov' | 'webm'

export interface UploadResult {
  job_id: string; frame_count: number; extension: string
  width: string; height: string; first_frame: string
}
export interface VideoUploadResult {
  job_id: string; width: string; height: string; duration: string; size_mb: number
}
export interface ProcessResult {
  job_id: string; format: string; download_url: string; size_bytes: number; size_mb: number
}
export interface SegmentInfo  { index: number; filename: string; size_mb: number; download_url: string }
export interface SegmentResult { job_id: string; segment_count: number; segments: SegmentInfo[] }
export interface StitchParams {
  fps: number; crf: number; preset: string; format: OutputFormat
  width?: number; height?: number; trim_start?: number; trim_end?: number
  crop_x?: number; crop_y?: number; crop_w?: number; crop_h?: number
}
export interface ProcessParams {
  format: VideoFormat; crf?: number; preset?: string
  width?: number; height?: number; trim_start?: number; trim_end?: number
  crop_x?: number; crop_y?: number; crop_w?: number; crop_h?: number
}
export interface StorageInfo {
  storage_used_mb: number; job_count: number; auto_clean_hours: number
}

// ── File size limits (mirror server limits) ───────────────────────────────────
export const MAX_ZIP_MB   = 500
export const MAX_VIDEO_MB = 2048

// ── Client-side file validation ───────────────────────────────────────────────
export function validateFile(file: File, type: 'zip' | 'video'): string | null {
  const mb = file.size / 1_048_576
  if (type === 'zip') {
    if (!file.name.toLowerCase().endsWith('.zip'))
      return 'Please select a .zip file.'
    if (mb > MAX_ZIP_MB)
      return `File too large (${mb.toFixed(0)} MB). Maximum is ${MAX_ZIP_MB} MB.`
  } else {
    const allowed = ['.mp4', '.mov', '.webm', '.avi', '.mkv']
    if (!allowed.some(ext => file.name.toLowerCase().endsWith(ext)))
      return `Unsupported file type. Allowed: ${allowed.join(', ')}`
    if (mb > MAX_VIDEO_MB)
      return `File too large (${mb.toFixed(0)} MB). Maximum is ${MAX_VIDEO_MB} MB.`
  }
  return null
}

// ── XHR-based upload with progress callback ───────────────────────────────────
export function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress: (pct: number) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    })
    xhr.addEventListener('load', async () => {
      let body: any
      try { body = JSON.parse(xhr.responseText) } catch { body = { detail: xhr.responseText } }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body)
      } else {
        reject(new Error(friendlyApiError(body, `Upload failed (${xhr.status})`)))
      }
    })
    xhr.addEventListener('error', () => {
      reject(new Error('Network error — is the API server running?'))
    })
    xhr.addEventListener('timeout', () => {
      reject(new Error('Upload timed out — file may be too large or connection too slow.'))
    })
    xhr.timeout = 5 * 60 * 1000 // 5 min
    xhr.send(formData)
  })
}

// ── Error normaliser ──────────────────────────────────────────────────────────
function friendlyApiError(body: any, fallback: string): string {
  if (!body) return fallback
  // FastAPI detail string
  if (typeof body.detail === 'string') return body.detail
  // FastAPI 422 validation array
  if (Array.isArray(body.detail))
    return body.detail.map((e: any) => `${e.loc?.slice(-1)[0] ?? 'field'}: ${e.msg}`).join(' · ')
  if (body.message) return body.message
  return fallback
}

async function extractError(r: Response, fallback: string): Promise<string> {
  try { return friendlyApiError(await r.json(), fallback) } catch { return fallback }
}

// ── Network-aware fetch wrapper ───────────────────────────────────────────────
async function apiFetch(url: string, opts: RequestInit, fallback: string): Promise<any> {
  let r: Response
  try {
    r = await fetch(url, opts)
  } catch {
    throw new Error('Cannot reach API — check the server is running and CORS is enabled.')
  }
  if (!r.ok) throw new Error(await extractError(r, fallback))
  return r.json()
}

// ── Upload ZIP (with progress) ────────────────────────────────────────────────
export async function uploadZip(
  file: File, base = DEFAULT_BASE,
  onProgress?: (pct: number) => void,
): Promise<UploadResult> {
  const err = validateFile(file, 'zip')
  if (err) throw new Error(err)
  const fd = new FormData(); fd.append('file', file)
  if (onProgress) return uploadWithProgress(`${base}/jobs/upload`, fd, onProgress)
  return apiFetch(`${base}/jobs/upload`, { method: 'POST', body: fd }, 'Upload failed')
}

// ── Upload video (with progress) ──────────────────────────────────────────────
export async function uploadVideo(
  file: File, base = DEFAULT_BASE,
  onProgress?: (pct: number) => void,
): Promise<VideoUploadResult> {
  const err = validateFile(file, 'video')
  if (err) throw new Error(err)
  const fd = new FormData(); fd.append('file', file)
  if (onProgress) return uploadWithProgress(`${base}/jobs/upload-video`, fd, onProgress)
  return apiFetch(`${base}/jobs/upload-video`, { method: 'POST', body: fd }, 'Upload failed')
}

// ── Stitch ────────────────────────────────────────────────────────────────────
export async function stitch(jobId: string, params: StitchParams, base = DEFAULT_BASE): Promise<ProcessResult> {
  const fd = new FormData()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') fd.append(k, String(v)) })
  return apiFetch(`${base}/jobs/${jobId}/stitch`, { method: 'POST', body: fd }, 'Stitch failed')
}

// ── Process ───────────────────────────────────────────────────────────────────
export async function processVideo(jobId: string, params: ProcessParams, base = DEFAULT_BASE): Promise<ProcessResult> {
  const fd = new FormData()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') fd.append(k, String(v)) })
  return apiFetch(`${base}/jobs/${jobId}/process`, { method: 'POST', body: fd }, 'Process failed')
}

// ── Segment ───────────────────────────────────────────────────────────────────
export async function segment(jobId: string, duration: number, base = DEFAULT_BASE): Promise<SegmentResult> {
  const fd = new FormData(); fd.append('segment_duration', String(duration))
  return apiFetch(`${base}/jobs/${jobId}/segment`, { method: 'POST', body: fd }, 'Segment failed')
}

// ── Storage ───────────────────────────────────────────────────────────────────
export async function getStorage(base = DEFAULT_BASE): Promise<StorageInfo> {
  return apiFetch(`${base}/storage`, { method: 'GET' }, 'Could not fetch storage info')
}

export async function cleanAllJobs(base = DEFAULT_BASE): Promise<{ deleted_jobs: number }> {
  return apiFetch(`${base}/storage/clean`, { method: 'DELETE' }, 'Clean failed')
}

export async function deleteJob(jobId: string, base = DEFAULT_BASE) {
  await fetch(`${base}/jobs/${jobId}`, { method: 'DELETE' })
}

// ── URLs ──────────────────────────────────────────────────────────────────────
export const downloadUrl        = (jobId: string, base = DEFAULT_BASE) => `${base}/jobs/${jobId}/download`
export const segmentDownloadUrl = (jobId: string, idx: number, base = DEFAULT_BASE) => `${base}/jobs/${jobId}/segment/${idx}`
export const frameUrl           = (jobId: string, idx: number, base = DEFAULT_BASE) => `${base}/jobs/${jobId}/frame/${idx}`

// ── Format helpers ────────────────────────────────────────────────────────────
export const FORMAT_LABELS: Record<string, string> = { mp4: 'MP4', mov: 'MOV', webm: 'WebM', gif: 'GIF' }
export const VIDEO_FORMATS: VideoFormat[]  = ['mp4', 'mov', 'webm']
export const ALL_FORMATS:   OutputFormat[] = ['mp4', 'mov', 'webm', 'gif']

// ── Jobs list (for Recent tab) ────────────────────────────────────────────────
export interface JobRecord {
  job_id: string; label: string; input_file: string
  created_at: number; frame_count: number
  has_output: boolean; format: string | null; size_mb: number | null
}
export async function listJobs(base = DEFAULT_BASE): Promise<{ jobs: JobRecord[] }> {
  return apiFetch(`${base}/jobs`, { method: 'GET' }, 'Could not fetch jobs')
}

// ── Job status (for log viewer) ───────────────────────────────────────────────
export interface JobStatus {
  status: string; message: string; progress: number
  label?: string; size_mb?: number | null; format?: string | null
}
export async function getJobStatus(jobId: string, base = DEFAULT_BASE): Promise<JobStatus> {
  return apiFetch(`${base}/jobs/${jobId}/status`, { method: 'GET' }, 'Could not fetch status')
}

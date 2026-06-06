const BASE = '/api/ffmpeg'

export interface UploadResult {
  job_id: string
  frame_count: number
  extension: string
  width: string
  height: string
  first_frame: string
}

export interface StitchResult {
  job_id: string
  download_url: string
  size_bytes: number
  size_mb: number
}

export interface SegmentInfo {
  index: number
  filename: string
  size_mb: number
  download_url: string
}

export interface SegmentResult {
  job_id: string
  segment_count: number
  segments: SegmentInfo[]
}

export interface StitchParams {
  fps: number
  crf: number
  width?: number
  height?: number
  preset: string
  trim_start?: number
  trim_end?: number
  crop_x?: number
  crop_y?: number
  crop_w?: number
  crop_h?: number
}

export async function uploadZip(file: File): Promise<UploadResult> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(`${BASE}/jobs/upload`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error((await r.json()).detail ?? 'Upload failed')
  return r.json()
}

export async function stitch(jobId: string, params: StitchParams): Promise<StitchResult> {
  const fd = new FormData()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') fd.append(k, String(v))
  })
  const r = await fetch(`${BASE}/jobs/${jobId}/stitch`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error((await r.json()).detail ?? 'Stitch failed')
  return r.json()
}

export async function segment(jobId: string, duration: number): Promise<SegmentResult> {
  const fd = new FormData()
  fd.append('segment_duration', String(duration))
  const r = await fetch(`${BASE}/jobs/${jobId}/segment`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error((await r.json()).detail ?? 'Segment failed')
  return r.json()
}

export async function deleteJob(jobId: string) {
  await fetch(`${BASE}/jobs/${jobId}`, { method: 'DELETE' })
}

export function frameUrl(jobId: string, index: number) {
  return `${BASE}/jobs/${jobId}/frame/${index}`
}

export function downloadUrl(jobId: string) {
  return `${BASE}/jobs/${jobId}/download`
}

export function segmentDownloadUrl(jobId: string, index: number) {
  return `${BASE}/jobs/${jobId}/segment/${index}`
}

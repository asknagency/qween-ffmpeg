'use client'
import { useState } from 'react'
import { DropZone, Btn, Card, Field, NumInput, SectionTitle, LogBox, ErrorBox, DownloadBtn, PillGroup } from '@/components/ui'
import { uploadVideo, processVideo, downloadUrl, VIDEO_FORMATS, FORMAT_LABELS } from '@/lib/api'
import type { VideoFormat } from '@/lib/api'

type Stage = 'idle' | 'uploading' | 'ready' | 'processing' | 'done'

export default function CropTool({ apiBase }: { apiBase: string }) {
  const [file, setFile]     = useState<File | null>(null)
  const [stage, setStage]   = useState<Stage>('idle')
  const [upload, setUpload] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const [log, setLog]       = useState<string[]>([])
  const [error, setError]   = useState('')
  const [format, setFormat] = useState<VideoFormat>('mp4')
  const [cropX, setCropX]   = useState('')
  const [cropY, setCropY]   = useState('')
  const [cropW, setCropW]   = useState('')
  const [cropH, setCropH]   = useState('')

  const addLog = (m: string) => setLog(p => [...p, m])

  const handleFile = async (f: File) => {
    setFile(f); setError(''); setLog([]); setResult(null); setStage('uploading')
    addLog(`Uploading ${f.name}…`)
    try {
      const r = await uploadVideo(f, apiBase)
      setUpload(r)
      setCropW(r.width); setCropH(r.height)
      addLog(`✓ ${r.width}×${r.height} · ${Number(r.duration).toFixed(1)}s`)
      setStage('ready')
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const handleRun = async () => {
    if (!upload) return
    if (!cropW || !cropH) return setError('Crop width and height are required')
    setStage('processing'); setError('')
    addLog(`Cropping: x=${cropX||0} y=${cropY||0} w=${cropW} h=${cropH} → ${format.toUpperCase()}…`)
    try {
      const r = await processVideo(upload.job_id, {
        format,
        crop_x: cropX ? Number(cropX) : 0,
        crop_y: cropY ? Number(cropY) : 0,
        crop_w: Number(cropW),
        crop_h: Number(cropH),
      }, apiBase)
      setResult(r)
      addLog(`✓ Done — ${r.size_mb} MB · ${format.toUpperCase()}`)
      setStage('done')
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => {
    setFile(null); setUpload(null); setResult(null)
    setLog([]); setError(''); setStage('idle')
    setCropX(''); setCropY(''); setCropW(''); setCropH('')
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <DropZone onFile={handleFile} loading={stage === 'uploading'} file={file}
        accept=".mp4,.mov,.webm,.avi,.mkv"
        label="Drop a video file to crop"
        sub="MP4 · MOV · WebM · AVI · MKV" />

      {stage === 'uploading' && (
        <Card className="p-6 flex items-center justify-center gap-3">
          <svg className="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c6dfa" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <span className="text-sub text-sm font-mono">Uploading video…</span>
        </Card>
      )}

      {upload && stage !== 'uploading' && (
        <Card className="px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#7c6dfa" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
          </div>
          <div className="text-xs font-mono">
            <span className="text-text">{upload.width}×{upload.height}</span>
            <span className="text-muted ml-2">{Number(upload.duration).toFixed(1)}s</span>
          </div>
        </Card>
      )}

      {(stage === 'ready' || stage === 'processing' || stage === 'done') && (
        <Card className="p-4 flex flex-col gap-5">

          <div>
            <SectionTitle>Output Format</SectionTitle>
            <PillGroup options={VIDEO_FORMATS} value={format} onChange={v => setFormat(v as VideoFormat)} />
          </div>

          <div>
            <SectionTitle>Crop Region</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="X Offset (px)">
                <NumInput value={cropX} onChange={setCropX} placeholder="0" min={0} />
              </Field>
              <Field label="Y Offset (px)">
                <NumInput value={cropY} onChange={setCropY} placeholder="0" min={0} />
              </Field>
              <Field label="Width (px)">
                <NumInput value={cropW} onChange={setCropW} placeholder={upload?.width} min={1} />
              </Field>
              <Field label="Height (px)">
                <NumInput value={cropH} onChange={setCropH} placeholder={upload?.height} min={1} />
              </Field>
            </div>
            {upload && (
              <p className="text-[11px] text-muted font-mono mt-3">
                Source: {upload.width}×{upload.height} · Crop: {cropW||upload.width}×{cropH||upload.height} @ ({cropX||0},{cropY||0})
              </p>
            )}
          </div>
        </Card>
      )}

      <LogBox lines={log} />
      <ErrorBox message={error} />

      {result && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
            <span className="text-sm font-semibold text-text">
              Cropped · {result.size_mb} MB · {FORMAT_LABELS[result.format]}
            </span>
          </div>
          <DownloadBtn href={downloadUrl(upload.job_id, apiBase)}
            label={`Download ${FORMAT_LABELS[result.format]}`} />
          <Btn onClick={reset} variant="ghost" fullWidth>Start Over</Btn>
        </Card>
      )}

      {(stage === 'ready' || stage === 'processing') && !result && (
        <Btn onClick={handleRun} loading={stage === 'processing'} fullWidth>
          {stage === 'processing' ? `Cropping to ${format.toUpperCase()}…` : `✂ Crop to ${format.toUpperCase()}`}
        </Btn>
      )}
    </div>
  )
}

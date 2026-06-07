'use client'
import { useState } from 'react'
import { DropZone, Btn, Card, Field, NumInput, SectionTitle, LogBox, ErrorBox, DownloadBtn, FramePreview, PillGroup } from '@/components/ui'
import { uploadZip, stitch, downloadUrl } from '@/lib/api'

const FPS_OPTIONS = [12, 24, 25, 30, 48, 60]
type Stage = 'idle' | 'uploading' | 'ready' | 'processing' | 'done'

export default function CropTool({ apiBase }: { apiBase: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [upload, setUpload] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [fps, setFps] = useState(30)
  const [cropX, setCropX] = useState('')
  const [cropY, setCropY] = useState('')
  const [cropW, setCropW] = useState('')
  const [cropH, setCropH] = useState('')

  const addLog = (m: string) => setLog(p => [...p, m])

  const handleFile = async (f: File) => {
    setFile(f); setError(''); setLog([]); setResult(null)
    setStage('uploading')
    addLog(`Uploading ${f.name}…`)
    try {
      const r = await uploadZip(f, apiBase)
      setUpload(r)
      // Pre-fill crop with full frame size
      setCropW(r.width); setCropH(r.height)
      addLog(`✓ ${r.frame_count} frames · ${r.width}×${r.height}`)
      setStage('ready')
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const handleRun = async () => {
    if (!upload) return
    if (!cropW || !cropH) return setError('Crop width and height are required')
    setStage('processing'); setError('')
    addLog(`Cropping: x=${cropX||0} y=${cropY||0} w=${cropW} h=${cropH} @ ${fps}fps…`)
    try {
      const r = await stitch(upload.job_id, {
        fps,
        crf: 18,
        preset: 'medium',
        crop_x: cropX ? Number(cropX) : 0,
        crop_y: cropY ? Number(cropY) : 0,
        crop_w: Number(cropW),
        crop_h: Number(cropH),
      }, apiBase)
      setResult(r)
      addLog(`✓ Done — ${r.size_mb} MB`)
      setStage('done')
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => { setFile(null); setUpload(null); setResult(null); setLog([]); setError(''); setStage('idle'); setCropX(''); setCropY(''); setCropW(''); setCropH('') }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <DropZone onFile={handleFile} loading={stage === 'uploading'} file={file} />

      {stage === 'uploading' && (
        <Card className="p-6 flex items-center justify-center gap-3">
          <svg className="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c6dfa" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <span className="text-sub text-sm font-mono">Extracting frames…</span>
        </Card>
      )}

      {upload && stage !== 'uploading' && (
        <FramePreview jobId={upload.job_id} frameCount={upload.frame_count}
          width={upload.width} height={upload.height} apiBase={apiBase} />
      )}

      {(stage === 'ready' || stage === 'processing' || stage === 'done') && (
        <Card className="p-4 flex flex-col gap-5">
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

          <div>
            <SectionTitle>Frame Rate</SectionTitle>
            <PillGroup options={FPS_OPTIONS} value={fps} onChange={v => setFps(Number(v))} />
          </div>
        </Card>
      )}

      <LogBox lines={log} />
      <ErrorBox message={error} />

      {result && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
            <span className="text-sm font-semibold text-text">Cropped output · {result.size_mb} MB</span>
          </div>
          <DownloadBtn href={downloadUrl(upload.job_id, apiBase)} label="Download Cropped MP4" />
          <Btn onClick={reset} variant="ghost" fullWidth>Start Over</Btn>
        </Card>
      )}

      {(stage === 'ready' || stage === 'processing') && !result && (
        <Btn onClick={handleRun} loading={stage === 'processing'} fullWidth>
          {stage === 'processing' ? 'Cropping…' : '✂ Crop to MP4'}
        </Btn>
      )}
    </div>
  )
}

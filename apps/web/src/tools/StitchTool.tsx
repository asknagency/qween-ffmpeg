'use client'
import { useState, useRef } from 'react'
import { DropZone, Btn, Card, Field, NumInput, PillGroup, Select, SectionTitle,
         LogBox, ErrorBox, DownloadBtn, FramePreview, UploadProgress } from '@/components/ui'
import { uploadZip, downloadUrl, ALL_FORMATS, FORMAT_LABELS } from '@/lib/api'
import type { OutputFormat } from '@/lib/api'

const PRESETS = ['ultrafast','superfast','veryfast','faster','fast','medium','slow','veryslow'].map(v=>({value:v,label:v}))
const FPS_OPTIONS = [12, 24, 25, 30, 48, 60]
type Stage = 'idle' | 'uploading' | 'ready' | 'queued' | 'processing' | 'done' | 'error'

export default function StitchTool({ apiBase }: { apiBase: string }) {
  const [file, setFile]       = useState<File | null>(null)
  const [stage, setStage]     = useState<Stage>('idle')
  const [upload, setUpload]   = useState<any>(null)
  const [jobId, setJobId]     = useState<string | null>(null)
  const [log, setLog]         = useState<string[]>([])
  const [error, setError]     = useState('')
  const [uploadPct, setUploadPct] = useState(0)
  const [progress, setProgress]   = useState(0)
  const [message, setMessage]     = useState('')
  const [resultMb, setResultMb]   = useState<number | null>(null)
  const [resultFmt, setResultFmt] = useState<string>('')
  const [fps, setFps]     = useState(30)
  const [crf, setCrf]     = useState(18)
  const [preset, setPreset] = useState('medium')
  const [format, setFormat] = useState<OutputFormat>('mp4')
  const [width, setWidth]   = useState('')
  const [height, setHeight] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addLog = (m: string) => setLog(p => [...p, m])
  const isGif  = format === 'gif'

  const startPoll = (jid: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${apiBase}/jobs/${jid}/status`)
        const d = await r.json()
        setProgress(d.progress ?? 0)
        setMessage(d.message ?? '')
        if (d.status === 'done') {
          clearInterval(pollRef.current!)
          setResultMb(d.size_mb); setResultFmt(d.format ?? format)
          setStage('done')
          addLog(`✓ Done — ${d.size_mb} MB · ${(d.format ?? format).toUpperCase()}`)
        } else if (d.status === 'error') {
          clearInterval(pollRef.current!)
          setError(d.message); setStage('error')
        } else if (d.status === 'processing') {
          setStage('processing')
        }
      } catch {}
    }, 1200)
  }

  const handleFile = async (f: File) => {
    setFile(f); setError(''); setLog([]); setUploadPct(0); setStage('uploading')
    addLog(`Uploading ${f.name}…`)
    try {
      const r = await uploadZip(f, apiBase, setUploadPct)
      setUpload(r)
      addLog(`✓ ${r.frame_count} frames · ${r.width}×${r.height}`)
      setStage('ready')
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const handleRun = async () => {
    if (!upload) return
    setStage('queued'); setError(''); setProgress(0); setMessage('Queuing…')
    addLog(`Stitching ${upload.frame_count} frames @ ${fps}fps → ${format.toUpperCase()}…`)
    try {
      const fd = new FormData()
      const params: Record<string, string> = {
        fps: String(fps), crf: String(crf), preset, format, async_mode: 'true'
      }
      if (width)  params.width  = width
      if (height) params.height = height
      Object.entries(params).forEach(([k,v]) => fd.append(k, v))
      const r = await fetch(`${apiBase}/jobs/${upload.job_id}/stitch`, { method: 'POST', body: fd })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail ?? 'Stitch failed')
      setJobId(upload.job_id)
      addLog(`Job queued — polling for progress…`)
      startPoll(upload.job_id)
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    setFile(null); setUpload(null); setJobId(null); setLog([]); setError('')
    setStage('idle'); setProgress(0); setMessage(''); setResultMb(null)
  }

  const totalSec  = fps > 0 && upload ? (upload.frame_count / fps).toFixed(1) : '—'
  const isWorking = stage === 'queued' || stage === 'processing'

  return (
    <div className="flex flex-col gap-4 pb-6">
      <DropZone onFile={handleFile} loading={stage==='uploading'} file={file}
        label="Drop ZIP of image frames" sub=".zip of PNG / JPG frames" />

      {stage === 'uploading' && (
        <Card className="p-4 flex flex-col gap-3">
          <UploadProgress pct={uploadPct} label="Uploading ZIP…" />
          <span className="text-sub text-xs font-mono text-center">
            {uploadPct >= 100 ? 'Extracting frames…' : 'Uploading…'}
          </span>
        </Card>
      )}

      {upload && !isWorking && stage !== 'uploading' && (
        <FramePreview jobId={upload.job_id} frameCount={upload.frame_count}
          width={upload.width} height={upload.height} apiBase={apiBase} />
      )}

      {(stage === 'ready' || isWorking || stage === 'done' || stage === 'error') && (
        <Card className="p-4 flex flex-col gap-5">
          <div>
            <SectionTitle>Output Format</SectionTitle>
            <PillGroup options={ALL_FORMATS} value={format} onChange={v => setFormat(v as OutputFormat)} />
            {isGif && <p className="text-[11px] text-amber-400/80 font-mono mt-2">⚠ GIF: 320px wide · large files · 256 colours</p>}
          </div>
          <div>
            <SectionTitle>Frame Rate</SectionTitle>
            <PillGroup options={FPS_OPTIONS} value={fps} onChange={v => setFps(Number(v))} />
            <p className="text-[11px] text-muted font-mono mt-2">{upload?.frame_count} frames → {totalSec}s @ {fps}fps</p>
          </div>
          {!isGif && (
            <Field label={`Quality — CRF ${crf}`} hint={crf<=18?'✦ visually lossless':crf<=28?'✦ good':'⚠ lossy'}>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-green">best</span>
                <input type="range" min={0} max={51} value={crf} onChange={e=>setCrf(Number(e.target.value))} />
                <span className="text-xs font-mono text-red">worst</span>
              </div>
            </Field>
          )}
          {!isGif && format !== 'webm' && (
            <Field label="Encode Preset"><Select value={preset} onChange={setPreset} options={PRESETS} /></Field>
          )}
          {!isGif && (
            <Field label="Scale (optional)" hint="Leave blank to keep source size">
              <div className="flex gap-2 items-center">
                <NumInput value={width}  onChange={setWidth}  placeholder={upload?.width  ?? 'W'} />
                <span className="text-muted font-mono text-sm">×</span>
                <NumInput value={height} onChange={setHeight} placeholder={upload?.height ?? 'H'} />
              </div>
            </Field>
          )}
        </Card>
      )}

      {/* Progress */}
      {isWorking && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-sub">{message || (stage==='queued' ? 'Waiting in queue…' : 'Processing…')}</span>
            <span className="text-accent">{progress}%</span>
          </div>
          <div className="h-1.5 bg-bg border border-border rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-300 shimmer"
              style={{ width: `${Math.max(progress, 8)}%` }} />
          </div>
          {stage === 'queued' && (
            <p className="text-[10px] text-muted font-mono">⏳ Another job is running — yours is queued</p>
          )}
        </Card>
      )}

      <LogBox lines={log} />
      <ErrorBox message={error} />

      {stage === 'done' && jobId && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
            <span className="text-sm font-semibold text-text">
              Output ready · {resultMb} MB · {FORMAT_LABELS[resultFmt] ?? resultFmt.toUpperCase()}
            </span>
          </div>
          <DownloadBtn href={downloadUrl(jobId, apiBase)}
            label={`Download ${FORMAT_LABELS[resultFmt] ?? resultFmt.toUpperCase()}`} />
          <Btn onClick={reset} variant="ghost" fullWidth>Start Over</Btn>
        </Card>
      )}

      {(stage === 'ready' || stage === 'error') && (
        <Btn onClick={handleRun} fullWidth>
          ▶ Stitch to {format.toUpperCase()}
        </Btn>
      )}
    </div>
  )
}

'use client'
import { useState, useRef } from 'react'
import { DropZone, Btn, Card, Field, NumInput, SectionTitle,
         LogBox, ErrorBox, DownloadBtn, PillGroup, UploadProgress } from '@/components/ui'
import { uploadVideo, downloadUrl, VIDEO_FORMATS, FORMAT_LABELS } from '@/lib/api'
import type { VideoFormat } from '@/lib/api'

type Stage = 'idle' | 'uploading' | 'ready' | 'queued' | 'processing' | 'done' | 'error'

export default function ScaleTool({ apiBase }: { apiBase: string }) {
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
  const [resultFmt, setResultFmt] = useState('')
  const [format, setFormat]   = useState<VideoFormat>('mp4')
    const [scaleW, setScaleW] = useState("")
  const [scaleH, setScaleH] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addLog = (m: string) => setLog(p => [...p, m])

  const startPoll = (jid: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${apiBase}/jobs/${jid}/status`)
        const d = await r.json()
        setProgress(d.progress ?? 0); setMessage(d.message ?? '')
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
      const r = await uploadVideo(f, apiBase, setUploadPct)
      setUpload(r)
      
      addLog(`✓ ${r.width}×${r.height} · ${Number(r.duration).toFixed(1)}s`)
      setStage('ready')
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const handleRun = async () => {
    if (!upload) return
    setStage('queued'); setError(''); setProgress(0); setMessage('Queuing…')
    addLog(`Processing → ${format.toUpperCase()}…`)
    try {
      const fd = new FormData()
              const params: Record<string, string> = { format, async_mode: "true" }
        if (scaleW) params.width  = scaleW
        if (scaleH) params.height = scaleH
      Object.entries(params).forEach(([k,v]) => fd.append(k, v))
      const r = await fetch(`${apiBase}/jobs/${upload.job_id}/process`, { method: 'POST', body: fd })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail ?? 'Process failed')
      setJobId(upload.job_id)
      addLog('Job queued — polling for progress…')
      startPoll(upload.job_id)
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    setFile(null); setUpload(null); setJobId(null); setLog([]); setError('')
    setStage('idle'); setProgress(0); setMessage(''); setResultMb(null)
    setScaleW(""); setScaleH("")
  }

  const isWorking = stage === 'queued' || stage === 'processing'

  return (
    <div className="flex flex-col gap-4 pb-6">
      <DropZone onFile={handleFile} loading={stage==='uploading'} file={file}
        accept=".mp4,.mov,.webm,.avi,.mkv"
        label="Drop a video file to scale"
        sub="MP4 · MOV · WebM · AVI · MKV" />

      {stage === 'uploading' && (
        <Card className="p-4 flex flex-col gap-3">
          <UploadProgress pct={uploadPct} label="Uploading video…" />
          <span className="text-sub text-xs font-mono text-center">{uploadPct >= 100 ? 'Processing…' : 'Uploading…'}</span>
        </Card>
      )}

      {upload && stage !== 'uploading' && (
        <Card className="px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#7c6dfa" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
          </div>
          <div className="text-xs font-mono">
            <span className="text-text">{upload.width}×{upload.height}</span>
            <span className="text-muted ml-2">{Number(upload.duration).toFixed(1)}s</span>
            <span className="text-muted ml-2">{upload.size_mb} MB</span>
          </div>
        </Card>
      )}

      {(stage === 'ready' || isWorking || stage === 'done' || stage === 'error') && (
        <Card className="p-4 flex flex-col gap-5">
          <div>
            <SectionTitle>Output Format</SectionTitle>
            <PillGroup options={VIDEO_FORMATS} value={format} onChange={v => setFormat(v as VideoFormat)} />
          </div>
                    <div>
            <SectionTitle>Quick Presets</SectionTitle>
            <div className="flex gap-2 flex-wrap">
              {[{l:"4K",w:"3840",h:"2160"},{l:"1080p",w:"1920",h:"1080"},{l:"720p",w:"1280",h:"720"},{l:"480p",w:"854",h:"480"},{l:"Sq 1080",w:"1080",h:"1080"},{l:"Sq 720",w:"720",h:"720"}].map(p=>(
                <button key={p.l} onClick={()=>{setScaleW(p.w);setScaleH(p.h)}}
                  className={`px-3 py-2 rounded-lg text-xs font-mono border transition-colors select-none ${scaleW===p.w&&scaleH===p.h?"bg-accent border-accent text-white":"bg-bg border-border text-sub hover:border-accent/50"}`}>
                  {p.l}
                </button>
              ))}
            </div>
          </div>
          <Field label="Custom Size" hint="-2 = auto-fit">
            <div className="flex gap-2 items-center">
              <NumInput value={scaleW} onChange={setScaleW} placeholder={upload?.width ?? "W"} />
              <span className="text-muted font-mono text-sm">×</span>
              <NumInput value={scaleH} onChange={setScaleH} placeholder={upload?.height ?? "H"} />
            </div>
          </Field>
          {upload && <p className="text-[11px] text-muted font-mono">{upload.width}×{upload.height} → {scaleW||upload.width}×{scaleH||upload.height}</p>}
        </Card>
      )}

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
          {stage === 'queued' && <p className="text-[10px] text-muted font-mono">⏳ Another job is running — yours is queued</p>}
        </Card>
      )}

      <LogBox lines={log} />
      <ErrorBox message={error} />

      {stage === 'done' && jobId && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
            <span className="text-sm font-semibold text-text">
              Scaled · {resultMb} MB · {FORMAT_LABELS[resultFmt] ?? resultFmt.toUpperCase()}
            </span>
          </div>
          <DownloadBtn href={downloadUrl(jobId, apiBase)}
            label={`Download ${FORMAT_LABELS[resultFmt] ?? resultFmt.toUpperCase()}`} />
          <Btn onClick={reset} variant="ghost" fullWidth>Start Over</Btn>
        </Card>
      )}

      {(stage === 'ready' || stage === 'error') && (
        <Btn onClick={handleRun} fullWidth>
          ⤢ Scale to {format.toUpperCase()}
        </Btn>
      )}
    </div>
  )
}

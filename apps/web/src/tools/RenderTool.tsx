'use client'
import { useState, useRef } from 'react'
import { DropZone, Btn, Card, Field, NumInput, PillGroup, SectionTitle,
         LogBox, ErrorBox, DownloadBtn, UploadProgress } from '@/components/ui'
import { renderProject, downloadUrl, VIDEO_FORMATS, FORMAT_LABELS } from '@/lib/api'
import type { VideoFormat } from '@/lib/api'

const FPS_OPTIONS = [12, 24, 25, 30, 48, 60]
type Stage = 'idle' | 'ready' | 'uploading' | 'queued' | 'processing' | 'done' | 'error'

export default function RenderTool({ apiBase }: { apiBase: string }) {
  const [file, setFile]       = useState<File | null>(null)
  const [stage, setStage]     = useState<Stage>('idle')
  const [jobId, setJobId]     = useState<string | null>(null)
  const [log, setLog]         = useState<string[]>([])
  const [error, setError]     = useState('')
  const [uploadPct, setUploadPct] = useState(0)
  const [progress, setProgress]   = useState(0)
  const [message, setMessage]     = useState('')
  const [resultMb, setResultMb]   = useState<number | null>(null)
  const [resultFmt, setResultFmt] = useState<string>('')

  const [fps, setFps]       = useState(30)
  const [crf, setCrf]       = useState(18)
  const [format, setFormat] = useState<VideoFormat>('mp4')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime]     = useState('')
  const [stageW, setStageW] = useState('')
  const [stageH, setStageH] = useState('')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const addLog = (m: string) => setLog(p => [...p, m])

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

  const handleFile = (f: File) => {
    setFile(f); setError(''); setLog([]); setUploadPct(0)
    setJobId(null); setResultMb(null); setStage('ready')
  }

  const handleRun = async () => {
    if (!file) return
    setStage('uploading'); setError(''); setLog([]); setUploadPct(0); setProgress(0); setMessage('')
    addLog(`Uploading ${file.name}…`)
    try {
      const params: any = { fps, crf, format }
      if (startTime) params.start_time   = Number(startTime)
      if (endTime)   params.end_time     = Number(endTime)
      if (stageW)    params.stage_width  = Number(stageW)
      if (stageH)    params.stage_height = Number(stageH)

      const r = await renderProject(file, params, apiBase, setUploadPct)
      setJobId(r.job_id)
      addLog(`Queued · ${r.stage} @ ${r.fps}fps · ${r.end_time}s → ${r.format.toUpperCase()}`)
      setStage('queued')
      startPoll(r.job_id)
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    setFile(null); setJobId(null); setLog([]); setError('')
    setStage('idle'); setProgress(0); setMessage(''); setResultMb(null); setUploadPct(0)
  }

  const isWorking = stage === 'queued' || stage === 'processing'
  const canEdit   = stage === 'ready' || stage === 'error'

  return (
    <div className="flex flex-col gap-4 pb-6">
      <DropZone onFile={handleFile} loading={stage === 'uploading'} file={file}
        label="Drop QweenApp project ZIP" sub=".zip with project.json + assets/" />

      {stage === 'uploading' && (
        <Card className="p-4 flex flex-col gap-3">
          <UploadProgress pct={uploadPct} label="Uploading project…" />
          <span className="text-sub text-xs font-mono text-center">
            {uploadPct >= 100 ? 'Parsing project…' : 'Uploading…'}
          </span>
        </Card>
      )}

      {file && (canEdit || isWorking || stage === 'done') && (
        <Card className="p-4 flex flex-col gap-5">
          <div>
            <SectionTitle>Output Format</SectionTitle>
            <PillGroup options={VIDEO_FORMATS} value={format} onChange={v => setFormat(v as VideoFormat)} />
          </div>
          <div>
            <SectionTitle>Frame Rate</SectionTitle>
            <PillGroup options={FPS_OPTIONS} value={fps} onChange={v => setFps(Number(v))} />
          </div>
          <Field label={`Quality — CRF ${crf}`} hint={crf <= 18 ? '✦ visually lossless' : crf <= 28 ? '✦ good' : '⚠ lossy'}>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-green">best</span>
              <input type="range" min={0} max={51} value={crf} disabled={!canEdit}
                onChange={e => setCrf(Number(e.target.value))} />
              <span className="text-xs font-mono text-red">worst</span>
            </div>
          </Field>
          <div>
            <SectionTitle>Trim (optional)</SectionTitle>
            <div className="flex gap-2 items-center">
              <NumInput value={startTime} onChange={setStartTime} placeholder="start s" min={0} step={0.1} />
              <span className="text-muted font-mono text-sm">→</span>
              <NumInput value={endTime} onChange={setEndTime} placeholder="end s" min={0} step={0.1} />
            </div>
            <p className="text-[11px] text-muted font-mono mt-2">Leave end blank to auto-detect from the timeline</p>
          </div>
          <div>
            <SectionTitle>Stage Override (optional)</SectionTitle>
            <div className="flex gap-2 items-center">
              <NumInput value={stageW} onChange={setStageW} placeholder="W" min={1} />
              <span className="text-muted font-mono text-sm">×</span>
              <NumInput value={stageH} onChange={setStageH} placeholder="H" min={1} />
            </div>
            <p className="text-[11px] text-muted font-mono mt-2">Leave blank to use the project's native size</p>
          </div>
        </Card>
      )}

      {/* Progress */}
      {isWorking && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-sub">{message || (stage === 'queued' ? 'Waiting in queue…' : 'Rendering…')}</span>
            <span className="text-accent">{progress}%</span>
          </div>
          <div className="h-1.5 bg-bg border border-border rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-300 shimmer"
              style={{ width: `${Math.max(progress, 8)}%` }} />
          </div>
          {stage === 'queued' && (
            <p className="text-[10px] text-muted font-mono">⏳ Launching headless browser…</p>
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
          ▶ Render to {format.toUpperCase()}
        </Btn>
      )}
    </div>
  )
}

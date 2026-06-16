'use client'
import { useState, useRef } from 'react'
import { Btn, Card, SectionTitle, LogBox, ErrorBox, DownloadBtn, PillGroup } from '@/components/ui'
import { downloadUrl, VIDEO_FORMATS, FORMAT_LABELS } from '@/lib/api'
import type { VideoFormat } from '@/lib/api'

const MAX_FILES = 10
type Stage = 'idle' | 'uploading' | 'queued' | 'processing' | 'done' | 'error'

export default function MergeTool({ apiBase }: { apiBase: string }) {
  const [files, setFiles]     = useState<File[]>([])
  const [stage, setStage]     = useState<Stage>('idle')
  const [format, setFormat]   = useState<VideoFormat>('mp4')
  const [jobId, setJobId]     = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [log, setLog]         = useState<string[]>([])
  const [error, setError]     = useState('')
  const [resultMb, setResultMb] = useState<number | null>(null)
  const inputRef              = useRef<HTMLInputElement>(null)
  const pollRef               = useRef<ReturnType<typeof setInterval> | null>(null)

  const addLog = (m: string) => setLog(p => [...p, m])

  const handleFiles = (incoming: FileList | null) => {
    if (!incoming) return
    const valid = Array.from(incoming).filter(f => {
      const ext = f.name.toLowerCase()
      return ['.mp4','.mov','.webm','.avi','.mkv'].some(e => ext.endsWith(e))
    })
    if (!valid.length) return setError('No valid video files selected.')
    setFiles(p => [...p, ...valid].slice(0, MAX_FILES))
    setError('')
  }

  const removeFile = (i: number) => setFiles(p => p.filter((_, idx) => idx !== i))

  const moveUp   = (i: number) => {
    if (i === 0) return
    setFiles(p => { const a = [...p]; [a[i-1], a[i]] = [a[i], a[i-1]]; return a })
  }
  const moveDown = (i: number) => {
    setFiles(p => { if (i >= p.length - 1) return p; const a = [...p]; [a[i], a[i+1]] = [a[i+1], a[i]]; return a })
  }

  const startPoll = (jid: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${apiBase}/jobs/${jid}/status`)
        const d = await r.json()
        setProgress(d.progress ?? 0)
        setMessage(d.message ?? '')
        if (d.status === 'done') {
          clearInterval(pollRef.current!)
          setResultMb(d.size_mb)
          setStage('done')
          addLog(`✓ Done — ${d.size_mb} MB · ${format.toUpperCase()}`)
        } else if (d.status === 'error') {
          clearInterval(pollRef.current!)
          setError(d.message)
          setStage('error')
        }
      } catch {}
    }, 1000)
  }

  const handleRun = async () => {
    if (files.length < 2) return setError('Add at least 2 video files.')
    setStage('uploading'); setError(''); setLog([]); setProgress(0)
    addLog(`Uploading ${files.length} files for merge…`)

    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    fd.append('format', format)

    try {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${apiBase}/jobs/merge`)
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 30))
      })
      await new Promise<void>((resolve, reject) => {
        xhr.addEventListener('load', () => {
          const body = JSON.parse(xhr.responseText)
          if (xhr.status >= 200 && xhr.status < 300) {
            setJobId(body.job_id)
            setStage('queued')
            addLog(`Job queued: ${body.job_id.slice(0,8)}`)
            startPoll(body.job_id)
            resolve()
          } else {
            reject(new Error(body.detail ?? `HTTP ${xhr.status}`))
          }
        })
        xhr.addEventListener('error', () => reject(new Error('Network error — is the API running?')))
        xhr.send(fd)
      })
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    setFiles([]); setStage('idle'); setJobId(null)
    setProgress(0); setMessage(''); setLog([]); setError(''); setResultMb(null)
  }

  const isWorking = stage === 'uploading' || stage === 'queued' || stage === 'processing'

  return (
    <div className="flex flex-col gap-4 pb-6">

      {/* File list */}
      <Card className="p-4 flex flex-col gap-3">
        <SectionTitle>Video Files ({files.length}/{MAX_FILES})</SectionTitle>

        {files.length === 0 ? (
          <div onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-2xl py-10 flex flex-col items-center
              gap-3 cursor-pointer hover:border-accent/40 transition-colors active:scale-98">
            <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#7c6dfa" strokeWidth="1.6">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            <p className="text-sm text-sub">Tap to add video files</p>
            <p className="text-xs text-muted">MP4 · MOV · WebM · AVI · MKV</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 bg-bg border border-border rounded-xl px-3 py-2.5">
                <span className="text-[10px] font-mono text-muted w-4 shrink-0">{i+1}</span>
                <span className="text-xs font-mono text-text flex-1 truncate">{f.name}</span>
                <span className="text-[10px] font-mono text-muted shrink-0">
                  {(f.size/1e6).toFixed(1)}MB
                </span>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => moveUp(i)} disabled={i===0}
                    className="w-6 h-6 rounded-md bg-panel border border-border text-muted
                      disabled:opacity-20 flex items-center justify-center active:scale-90">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                  </button>
                  <button onClick={() => moveDown(i)} disabled={i===files.length-1}
                    className="w-6 h-6 rounded-md bg-panel border border-border text-muted
                      disabled:opacity-20 flex items-center justify-center active:scale-90">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                  <button onClick={() => removeFile(i)}
                    className="w-6 h-6 rounded-md bg-panel border border-red/20 text-red/60
                      flex items-center justify-center active:scale-90">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {files.length > 0 && files.length < MAX_FILES && (
          <button onClick={() => inputRef.current?.click()}
            className="flex items-center justify-center gap-2 py-2.5 border border-dashed
              border-border rounded-xl text-xs text-sub hover:border-accent/40 transition-colors active:scale-95">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add more files
          </button>
        )}

        <input ref={inputRef} type="file" accept=".mp4,.mov,.webm,.avi,.mkv"
          multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
      </Card>

      {/* Format */}
      <Card className="p-4">
        <SectionTitle>Output Format</SectionTitle>
        <PillGroup options={VIDEO_FORMATS} value={format} onChange={v => setFormat(v as VideoFormat)} />
      </Card>

      {/* Progress */}
      {isWorking && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-sub">{message || (stage === 'uploading' ? 'Uploading…' : 'In queue…')}</span>
            <span className="text-accent">{progress}%</span>
          </div>
          <div className="h-1.5 bg-bg border border-border rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }} />
          </div>
          {stage === 'queued' && (
            <p className="text-[10px] text-muted font-mono">
              ⏳ Waiting for previous job to finish…
            </p>
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
              Merged · {resultMb} MB · {FORMAT_LABELS[format]}
            </span>
          </div>
          <DownloadBtn href={downloadUrl(jobId, apiBase)} label={`Download ${FORMAT_LABELS[format]}`} />
          <Btn onClick={reset} variant="ghost" fullWidth>Start Over</Btn>
        </Card>
      )}

      {(stage === 'idle' || stage === 'error') && (
        <Btn onClick={handleRun} disabled={files.length < 2} fullWidth>
          ⊕ Merge {files.length > 0 ? `${files.length} Files` : '(add files above)'}
        </Btn>
      )}
    </div>
  )
}

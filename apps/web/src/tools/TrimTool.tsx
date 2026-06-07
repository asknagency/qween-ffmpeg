'use client'
import { useState } from 'react'
import { DropZone, Btn, Card, Field, NumInput, SectionTitle, LogBox, ErrorBox, DownloadBtn, FramePreview, PillGroup } from '@/components/ui'
import { uploadZip, stitch, downloadUrl } from '@/lib/api'

const FPS_OPTIONS = [12, 24, 25, 30, 48, 60]
type Stage = 'idle' | 'uploading' | 'ready' | 'processing' | 'done'

export default function TrimTool({ apiBase }: { apiBase: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [upload, setUpload] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [fps, setFps] = useState(30)
  const [trimStart, setTrimStart] = useState('')
  const [trimEnd, setTrimEnd] = useState('')

  const addLog = (m: string) => setLog(p => [...p, m])
  const totalSec = fps > 0 && upload ? (upload.frame_count / fps).toFixed(1) : '—'

  const handleFile = async (f: File) => {
    setFile(f); setError(''); setLog([]); setResult(null)
    setStage('uploading')
    addLog(`Uploading ${f.name}…`)
    try {
      const r = await uploadZip(f, apiBase)
      setUpload(r)
      addLog(`✓ ${r.frame_count} frames · ${r.width}×${r.height}`)
      setStage('ready')
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const handleRun = async () => {
    if (!upload) return
    setStage('processing'); setError('')
    addLog(`Trimming: ${trimStart||0}s → ${trimEnd||totalSec}s @ ${fps}fps…`)
    try {
      const r = await stitch(upload.job_id, {
        fps, crf: 18, preset: 'medium',
        trim_start: trimStart ? Number(trimStart) : undefined,
        trim_end: trimEnd ? Number(trimEnd) : undefined,
      }, apiBase)
      setResult(r)
      addLog(`✓ Done — ${r.size_mb} MB`)
      setStage('done')
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => { setFile(null); setUpload(null); setResult(null); setLog([]); setError(''); setStage('idle'); setTrimStart(''); setTrimEnd('') }

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
            <SectionTitle>Trim Range (seconds)</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start" hint="Default: 0s">
                <NumInput value={trimStart} onChange={setTrimStart} placeholder="0" min={0} step={0.1} />
              </Field>
              <Field label="End" hint={`Default: ${totalSec}s`}>
                <NumInput value={trimEnd} onChange={setTrimEnd} placeholder={totalSec} min={0} step={0.1} />
              </Field>
            </div>
            {upload && (
              <p className="text-[11px] text-muted font-mono mt-3">
                Full duration: {totalSec}s · Trimmed: {trimStart||0}s → {trimEnd||totalSec}s
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
            <span className="text-sm font-semibold text-text">Trimmed output · {result.size_mb} MB</span>
          </div>
          <DownloadBtn href={downloadUrl(upload.job_id, apiBase)} label="Download Trimmed MP4" />
          <Btn onClick={reset} variant="ghost" fullWidth>Start Over</Btn>
        </Card>
      )}

      {(stage === 'ready' || stage === 'processing') && !result && (
        <Btn onClick={handleRun} loading={stage === 'processing'} fullWidth>
          {stage === 'processing' ? 'Trimming…' : '✂ Trim to MP4'}
        </Btn>
      )}
    </div>
  )
}

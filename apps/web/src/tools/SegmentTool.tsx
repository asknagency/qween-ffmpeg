'use client'
import { useState } from 'react'
import { DropZone, Btn, Card, Field, NumInput, SectionTitle, LogBox, ErrorBox, PillGroup } from '@/components/ui'
import { uploadVideo, segment, segmentDownloadUrl } from '@/lib/api'

const DURATION_OPTIONS = [2, 5, 10, 15, 30, 60]
type Stage = 'idle' | 'uploading' | 'ready' | 'segmenting' | 'done'

export default function SegmentTool({ apiBase }: { apiBase: string }) {
  const [file, setFile]       = useState<File | null>(null)
  const [stage, setStage]     = useState<Stage>('idle')
  const [upload, setUpload]   = useState<any>(null)
  const [segResult, setSegResult] = useState<any>(null)
  const [log, setLog]         = useState<string[]>([])
  const [error, setError]     = useState('')
  const [duration, setDuration] = useState(5)
  const [customDur, setCustomDur] = useState('')

  const addLog    = (m: string) => setLog(p => [...p, m])
  const activeDur = customDur ? Number(customDur) : duration
  const totalSec  = upload ? Number(upload.duration).toFixed(1) : '—'

  const handleFile = async (f: File) => {
    setFile(f); setError(''); setLog([]); setSegResult(null); setStage('uploading')
    addLog(`Uploading ${f.name}…`)
    try {
      const r = await uploadVideo(f, apiBase)
      setUpload(r)
      addLog(`✓ ${r.width}×${r.height} · ${Number(r.duration).toFixed(1)}s`)
      setStage('ready')
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const handleSegment = async () => {
    if (!upload) return
    setStage('segmenting'); setError('')
    addLog(`Splitting into ${activeDur}s chunks…`)
    try {
      const r = await segment(upload.job_id, activeDur, apiBase)
      setSegResult(r)
      addLog(`✓ ${r.segment_count} segments created`)
      setStage('done')
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => {
    setFile(null); setUpload(null); setSegResult(null)
    setLog([]); setError(''); setStage('idle'); setCustomDur('')
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <DropZone onFile={handleFile} loading={stage === 'uploading'} file={file}
        accept=".mp4,.mov,.webm,.avi,.mkv"
        label="Drop a video file to segment"
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
            <span className="text-muted ml-2">{totalSec}s</span>
            {upload && activeDur > 0 && (
              <span className="text-muted ml-2">
                → ~{Math.ceil(Number(upload.duration) / activeDur)} segments
              </span>
            )}
          </div>
        </Card>
      )}

      {(stage === 'ready' || stage === 'segmenting' || stage === 'done') && !segResult && (
        <Card className="p-4 flex flex-col gap-5">
          <div>
            <SectionTitle>Segment Duration</SectionTitle>
            <PillGroup options={DURATION_OPTIONS} value={activeDur}
              onChange={v => { setDuration(Number(v)); setCustomDur('') }} />
            <div className="mt-3">
              <Field label="Custom (seconds)">
                <NumInput value={customDur} onChange={setCustomDur}
                  placeholder="e.g. 7.5" min={0.5} step={0.5} />
              </Field>
            </div>
            {upload && (
              <p className="text-[11px] text-muted font-mono mt-3">
                {totalSec}s video → ~{Math.ceil(Number(upload.duration) / activeDur)} × {activeDur}s chunks
              </p>
            )}
          </div>
        </Card>
      )}

      <LogBox lines={log} />
      <ErrorBox message={error} />

      {segResult && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
            <span className="text-sm font-semibold text-text">
              {segResult.segment_count} segments ready
            </span>
          </div>
          <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
            {segResult.segments.map((seg: any) => (
              <a key={seg.index}
                href={segmentDownloadUrl(upload.job_id, seg.index, apiBase)}
                download
                className="flex items-center justify-between px-3 py-3 rounded-xl bg-bg border border-border
                  hover:border-accent/40 transition-colors active:scale-95">
                <span className="text-xs font-mono text-sub">{seg.filename}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted">{seg.size_mb} MB</span>
                  <span className="text-accent text-sm">↓</span>
                </div>
              </a>
            ))}
          </div>
          <Btn onClick={reset} variant="ghost" fullWidth>Start Over</Btn>
        </Card>
      )}

      {(stage === 'ready' || stage === 'segmenting') && !segResult && (
        <Btn onClick={handleSegment} loading={stage === 'segmenting'} fullWidth>
          {stage === 'segmenting' ? 'Segmenting…' : `Split into ${activeDur}s Chunks`}
        </Btn>
      )}
    </div>
  )
}

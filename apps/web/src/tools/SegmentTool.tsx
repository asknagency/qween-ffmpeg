'use client'
import { useState } from 'react'
import { DropZone, Btn, Card, Field, NumInput, SectionTitle, LogBox, ErrorBox, PillGroup } from '@/components/ui'
import { uploadZip, stitch, segment, segmentDownloadUrl, downloadUrl } from '@/lib/api'

const FPS_OPTIONS = [12, 24, 25, 30, 48, 60]
const DURATION_OPTIONS = [2, 5, 10, 15, 30, 60]
type Stage = 'idle' | 'uploading' | 'stitching' | 'segmenting' | 'done'

export default function SegmentTool({ apiBase }: { apiBase: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [upload, setUpload] = useState<any>(null)
  const [segResult, setSegResult] = useState<any>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [fps, setFps] = useState(30)
  const [duration, setDuration] = useState(5)
  const [customDur, setCustomDur] = useState('')

  const addLog = (m: string) => setLog(p => [...p, m])

  const handleFile = async (f: File) => {
    setFile(f); setError(''); setLog([]); setSegResult(null)
    setStage('uploading')
    addLog(`Uploading ${f.name}…`)
    try {
      const r = await uploadZip(f, apiBase)
      setUpload(r)
      addLog(`✓ ${r.frame_count} frames · ${r.width}×${r.height}`)
      setStage('stitching')
      addLog(`Stitching @ ${fps}fps…`)
      await stitch(r.job_id, { fps, crf: 18, preset: 'medium' }, apiBase)
      addLog('✓ Stitched — ready to segment')
      setStage('done') // re-using done to mean "ready for segment"
    } catch (e: any) { setError(e.message); setStage('idle') }
  }

  const handleSegment = async () => {
    if (!upload) return
    const dur = customDur ? Number(customDur) : duration
    setStage('segmenting'); setError('')
    addLog(`Segmenting into ${dur}s chunks…`)
    try {
      const r = await segment(upload.job_id, dur, apiBase)
      setSegResult(r)
      addLog(`✓ ${r.segment_count} segments created`)
    } catch (e: any) { setError(e.message) }
    finally { setStage('done') }
  }

  const reset = () => { setFile(null); setUpload(null); setSegResult(null); setLog([]); setError(''); setStage('idle'); setCustomDur('') }
  const activeDur = customDur ? Number(customDur) : duration

  return (
    <div className="flex flex-col gap-4 pb-6">
      <DropZone onFile={handleFile} loading={stage === 'uploading' || stage === 'stitching'} file={file}
        label="Drop ZIP of frames to segment" />

      {(stage === 'uploading' || stage === 'stitching') && (
        <Card className="p-6 flex items-center justify-center gap-3">
          <svg className="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c6dfa" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <span className="text-sub text-sm font-mono">
            {stage === 'uploading' ? 'Extracting frames…' : 'Stitching video…'}
          </span>
        </Card>
      )}

      {upload && (stage === 'done' || stage === 'segmenting') && (
        <Card className="p-4 flex flex-col gap-5">
          <div>
            <SectionTitle>Segment Duration</SectionTitle>
            <PillGroup options={DURATION_OPTIONS} value={activeDur}
              onChange={v => { setDuration(Number(v)); setCustomDur('') }} />
            <div className="mt-3">
              <Field label="Custom (seconds)">
                <NumInput value={customDur} onChange={setCustomDur} placeholder="e.g. 7.5" min={0.5} step={0.5} />
              </Field>
            </div>
            {upload && (
              <p className="text-[11px] text-muted font-mono mt-3">
                ~{Math.ceil((upload.frame_count / fps) / activeDur)} segments from {(upload.frame_count / fps).toFixed(1)}s video
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

      {segResult && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
              <span className="text-sm font-semibold text-text">{segResult.segment_count} segments ready</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
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

      {(stage === 'done' || stage === 'segmenting') && !segResult && (
        <Btn onClick={handleSegment} loading={stage === 'segmenting'} fullWidth>
          {stage === 'segmenting' ? 'Segmenting…' : `Split into ${activeDur}s Chunks`}
        </Btn>
      )}
    </div>
  )
}

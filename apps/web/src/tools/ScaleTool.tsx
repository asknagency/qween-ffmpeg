'use client'
import { useState } from 'react'
import { DropZone, Btn, Card, Field, NumInput, SectionTitle, LogBox, ErrorBox, DownloadBtn, FramePreview, PillGroup } from '@/components/ui'
import { uploadZip, stitch, downloadUrl } from '@/lib/api'

const FPS_OPTIONS = [12, 24, 25, 30, 48, 60]
const PRESETS_SCALE = [
  { label: '4K', w: '3840', h: '2160' },
  { label: '1080p', w: '1920', h: '1080' },
  { label: '720p', w: '1280', h: '720' },
  { label: '480p', w: '854', h: '480' },
  { label: 'Square 1080', w: '1080', h: '1080' },
  { label: 'Square 720', w: '720', h: '720' },
]
type Stage = 'idle' | 'uploading' | 'ready' | 'processing' | 'done'

export default function ScaleTool({ apiBase }: { apiBase: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [upload, setUpload] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [fps, setFps] = useState(30)
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')

  const addLog = (m: string) => setLog(p => [...p, m])

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
    addLog(`Scaling to ${width||'-2'}×${height||'-2'} @ ${fps}fps…`)
    try {
      const r = await stitch(upload.job_id, {
        fps, crf: 18, preset: 'medium',
        width: width ? Number(width) : undefined,
        height: height ? Number(height) : undefined,
      }, apiBase)
      setResult(r)
      addLog(`✓ Done — ${r.size_mb} MB`)
      setStage('done')
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => { setFile(null); setUpload(null); setResult(null); setLog([]); setError(''); setStage('idle'); setWidth(''); setHeight('') }
  const applyPreset = (p: typeof PRESETS_SCALE[0]) => { setWidth(p.w); setHeight(p.h) }

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
            <SectionTitle>Quick Presets</SectionTitle>
            <div className="flex gap-2 flex-wrap">
              {PRESETS_SCALE.map(p => (
                <button key={p.label} onClick={() => applyPreset(p)}
                  className={`px-3 py-2 rounded-lg text-xs font-mono border transition-colors select-none
                    ${width === p.w && height === p.h
                      ? 'bg-accent border-accent text-white'
                      : 'bg-bg border-border text-sub hover:border-accent/50'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle>Custom Size</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Width (px)" hint="Use -2 for auto">
                <NumInput value={width} onChange={setWidth} placeholder={upload?.width} />
              </Field>
              <Field label="Height (px)" hint="Use -2 for auto">
                <NumInput value={height} onChange={setHeight} placeholder={upload?.height} />
              </Field>
            </div>
            {upload && (
              <p className="text-[11px] text-muted font-mono mt-3">
                Source: {upload.width}×{upload.height} → Output: {width||upload.width}×{height||upload.height}
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
            <span className="text-sm font-semibold text-text">Scaled output · {result.size_mb} MB</span>
          </div>
          <DownloadBtn href={downloadUrl(upload.job_id, apiBase)} label="Download Scaled MP4" />
          <Btn onClick={reset} variant="ghost" fullWidth>Start Over</Btn>
        </Card>
      )}

      {(stage === 'ready' || stage === 'processing') && !result && (
        <Btn onClick={handleRun} loading={stage === 'processing'} fullWidth>
          {stage === 'processing' ? 'Scaling…' : '⤢ Scale to MP4'}
        </Btn>
      )}
    </div>
  )
}

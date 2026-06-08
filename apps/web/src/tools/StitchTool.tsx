'use client'
import { useState } from 'react'
import { DropZone, Btn, Card, Field, NumInput, PillGroup, Select, SectionTitle, LogBox, ErrorBox, DownloadBtn, FramePreview, UploadProgress } from '@/components/ui'
import { uploadZip, stitch, downloadUrl, ALL_FORMATS, FORMAT_LABELS } from '@/lib/api'
import type { OutputFormat } from '@/lib/api'

const PRESETS = ['ultrafast','superfast','veryfast','faster','fast','medium','slow','veryslow'].map(v => ({ value: v, label: v }))
const FPS_OPTIONS = [12, 24, 25, 30, 48, 60]
type Stage = 'idle' | 'uploading' | 'ready' | 'processing' | 'done'

export default function StitchTool({ apiBase }: { apiBase: string }) {
  const [file, setFile]     = useState<File | null>(null)
  const [stage, setStage]   = useState<Stage>('idle')
  const [upload, setUpload] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const [log, setLog]       = useState<string[]>([])
  const [error, setError]   = useState('')
  const [uploadPct, setUploadPct] = useState(0)
  const [fps, setFps]       = useState(30)
  const [crf, setCrf]       = useState(18)
  const [preset, setPreset] = useState('medium')
  const [format, setFormat] = useState<OutputFormat>('mp4')
  const [width, setWidth]   = useState('')
  const [height, setHeight] = useState('')

  const addLog = (m: string) => setLog(p => [...p, m])
  const isGif  = format === 'gif'

  const handleFile = async (f: File) => {
    setFile(f); setError(''); setLog([]); setResult(null); setStage('uploading')
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
    setStage('processing'); setError('')
    addLog(`Stitching ${upload.frame_count} frames @ ${fps}fps → ${format.toUpperCase()}…`)
    try {
      const r = await stitch(upload.job_id, {
        fps, crf, preset, format,
        width:  width  ? Number(width)  : undefined,
        height: height ? Number(height) : undefined,
      }, apiBase)
      setResult(r)
      addLog(`✓ Done — ${r.size_mb} MB · ${format.toUpperCase()}`)
      setStage('done')
    } catch (e: any) { setError(e.message); setStage('ready') }
  }

  const reset = () => {
    setFile(null); setUpload(null); setResult(null)
    setLog([]); setError(''); setStage('idle')
  }

  const totalSec = fps > 0 && upload ? (upload.frame_count / fps).toFixed(1) : '—'

  return (
    <div className="flex flex-col gap-4 pb-6">
      <DropZone onFile={handleFile} loading={stage === 'uploading'} file={file}
        label="Drop ZIP of image frames" sub=".zip of PNG / JPG frames" />

      {stage === 'uploading' && (
        <Card className="p-6 flex items-center justify-center gap-3">
          <svg className="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c6dfa" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <UploadProgress pct={uploadPct} label="Uploading ZIP…" />
          <span className="text-sub text-sm font-mono mt-2">{uploadPct >= 100 ? "Extracting frames…" : "Uploading…"}</span>
        </Card>
      )}

      {upload && stage !== 'uploading' && (
        <FramePreview jobId={upload.job_id} frameCount={upload.frame_count}
          width={upload.width} height={upload.height} apiBase={apiBase} />
      )}

      {(stage === 'ready' || stage === 'processing' || stage === 'done') && (
        <Card className="p-4 flex flex-col gap-5">

          {/* Output Format */}
          <div>
            <SectionTitle>Output Format</SectionTitle>
            <PillGroup
              options={ALL_FORMATS}
              value={format}
              onChange={v => setFormat(v as OutputFormat)}
            />
            {isGif && (
              <p className="text-[11px] text-amber-400/80 font-mono mt-2">
                ⚠ GIF: auto-scaled to 320px wide · large file size · 256 colours
              </p>
            )}
          </div>

          {/* FPS */}
          <div>
            <SectionTitle>Frame Rate</SectionTitle>
            <PillGroup options={FPS_OPTIONS} value={fps} onChange={v => setFps(Number(v))} />
            <p className="text-[11px] text-muted font-mono mt-2">
              {upload?.frame_count} frames → {totalSec}s at {fps}fps
            </p>
          </div>

          {/* Quality — hidden for GIF */}
          {!isGif && (
            <Field label={`Quality — CRF ${crf}`}
              hint={crf <= 18 ? '✦ visually lossless' : crf <= 28 ? '✦ good' : '⚠ lossy'}>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-green">best</span>
                <input type="range" min={0} max={51} value={crf}
                  onChange={e => setCrf(Number(e.target.value))} />
                <span className="text-xs font-mono text-red">worst</span>
              </div>
            </Field>
          )}

          {/* Preset — hidden for GIF / WebM */}
          {!isGif && format !== 'webm' && (
            <Field label="Encode Preset">
              <Select value={preset} onChange={setPreset} options={PRESETS} />
            </Field>
          )}

          {/* Scale — hidden for GIF (auto-scaled) */}
          {!isGif && (
            <Field label="Scale Output (optional)" hint="Leave blank to keep source size">
              <div className="flex gap-2 items-center">
                <NumInput value={width}  onChange={setWidth}  placeholder={upload?.width  ?? 'W'} />
                <span className="text-muted font-mono text-sm">×</span>
                <NumInput value={height} onChange={setHeight} placeholder={upload?.height ?? 'H'} />
              </div>
            </Field>
          )}
        </Card>
      )}

      <LogBox lines={log} />
      <ErrorBox message={error} />

      {result && (
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
            <span className="text-sm font-semibold text-text">
              Output ready · {result.size_mb} MB · {FORMAT_LABELS[result.format]}
            </span>
          </div>
          <DownloadBtn href={downloadUrl(upload.job_id, apiBase)}
            label={`Download ${FORMAT_LABELS[result.format]}`} />
          <Btn onClick={reset} variant="ghost" fullWidth>Start Over</Btn>
        </Card>
      )}

      {(stage === 'ready' || stage === 'processing') && !result && (
        <Btn onClick={handleRun} loading={stage === 'processing'} fullWidth>
          {stage === 'processing' ? `Stitching to ${format.toUpperCase()}…` : `▶ Stitch to ${format.toUpperCase()}`}
        </Btn>
      )}
    </div>
  )
}

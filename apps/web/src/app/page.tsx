'use client'
import { useState } from 'react'
import DropZone from '@/components/DropZone'
import FramePreview from '@/components/FramePreview'
import SettingsPanel, { Settings } from '@/components/SettingsPanel'
import { uploadZip, stitch, segment, deleteJob, downloadUrl, segmentDownloadUrl, UploadResult, StitchResult, SegmentResult } from '@/lib/api'

type Stage = 'idle' | 'uploading' | 'ready' | 'stitching' | 'done' | 'segmenting'

const DEFAULT_SETTINGS: Settings = {
  fps: 30, crf: 18, width: '', height: '', preset: 'medium',
  trim_start: '', trim_end: '',
  crop_x: '', crop_y: '', crop_w: '', crop_h: '',
  segment_duration: '5',
}

function Badge({ children, color = 'accent' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    accent: 'bg-accent/10 text-accent border-accent/20',
    green: 'bg-green/10 text-green border-green/20',
    red: 'bg-red/10 text-red border-red/20',
  }
  return (
    <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${colors[color]}`}>
      {children}
    </span>
  )
}

function Btn({ onClick, disabled, loading, children, variant = 'primary' }: {
  onClick: () => void; disabled?: boolean; loading?: boolean
  children: React.ReactNode; variant?: 'primary' | 'ghost' | 'danger'
}) {
  const base = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-accent hover:bg-accent/80 text-white',
    ghost: 'bg-transparent border border-border hover:border-accent/50 text-sub hover:text-text',
    danger: 'bg-transparent border border-red/40 hover:border-red text-red/70 hover:text-red',
  }
  return (
    <button onClick={onClick} disabled={disabled || loading} className={`${base} ${variants[variant]}`}>
      {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
      {children}
    </button>
  )
}

function LogBox({ lines }: { lines: string[] }) {
  if (!lines.length) return null
  return (
    <div className="bg-bg border border-border rounded-xl p-3 font-mono text-xs text-sub max-h-40 overflow-y-auto">
      {lines.map((l, i) => (
        <div key={i} className="leading-5">
          <span className="text-muted mr-2">›</span>{l}
        </div>
      ))}
    </div>
  )
}

export default function Home() {
  const [stage, setStage] = useState<Stage>('idle')
  const [upload, setUpload] = useState<UploadResult | null>(null)
  const [stitchResult, setStitchResult] = useState<StitchResult | null>(null)
  const [segResult, setSegResult] = useState<SegmentResult | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')

  const addLog = (msg: string) => setLog(prev => [...prev, msg])
  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    setError(msg); addLog('✗ ' + msg)
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    setStage('uploading'); setError(''); setLog([])
    setStitchResult(null); setSegResult(null)
    addLog(`Uploading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`)
    try {
      const result = await uploadZip(file)
      setUpload(result)
      addLog(`✓ ${result.frame_count} frames extracted · ${result.width}×${result.height}`)
      setStage('ready')
    } catch (e) { fail(e); setStage('idle') }
  }

  // ── Stitch ────────────────────────────────────────────────────────────────
  const handleStitch = async () => {
    if (!upload) return
    setStage('stitching'); setError('')
    addLog(`Stitching ${upload.frame_count} frames @ ${settings.fps} fps, CRF ${settings.crf}…`)
    try {
      const result = await stitch(upload.job_id, {
        fps: settings.fps,
        crf: settings.crf,
        preset: settings.preset,
        width: settings.width ? Number(settings.width) : undefined,
        height: settings.height ? Number(settings.height) : undefined,
        trim_start: settings.trim_start ? Number(settings.trim_start) : undefined,
        trim_end: settings.trim_end ? Number(settings.trim_end) : undefined,
        crop_x: settings.crop_x ? Number(settings.crop_x) : undefined,
        crop_y: settings.crop_y ? Number(settings.crop_y) : undefined,
        crop_w: settings.crop_w ? Number(settings.crop_w) : undefined,
        crop_h: settings.crop_h ? Number(settings.crop_h) : undefined,
      })
      setStitchResult(result)
      addLog(`✓ Done — ${result.size_mb} MB`)
      setStage('done')
    } catch (e) { fail(e); setStage('ready') }
  }

  // ── Segment ───────────────────────────────────────────────────────────────
  const handleSegment = async () => {
    if (!upload) return
    setStage('segmenting'); setError('')
    const dur = Number(settings.segment_duration) || 5
    addLog(`Segmenting into ${dur}s chunks…`)
    try {
      const result = await segment(upload.job_id, dur)
      setSegResult(result)
      addLog(`✓ ${result.segment_count} segments created`)
      setStage('done')
    } catch (e) { fail(e); setStage('done') }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleReset = async () => {
    if (upload) await deleteJob(upload.job_id).catch(() => {})
    setStage('idle'); setUpload(null); setStitchResult(null)
    setSegResult(null); setLog([]); setError(''); setSettings(DEFAULT_SETTINGS)
  }

  const busy = stage === 'uploading' || stage === 'stitching' || stage === 'segmenting'

  return (
    <div className="min-h-screen bg-bg">
      {/* ── Top bar ── */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M15 10L19.553 7.724A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" stroke="#7c6dfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="font-mono font-semibold text-text text-sm tracking-tight">QweenFFmpeg</span>
          <Badge>v1.0</Badge>
        </div>
        {upload && (
          <button onClick={handleReset} className="text-xs font-mono text-muted hover:text-red transition-colors">
            ✕ reset
          </button>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">

        {/* ── Left col ── */}
        <div className="flex flex-col gap-5">

          {/* Upload */}
          {stage === 'idle' && (
            <DropZone onFile={handleFile} loading={busy} />
          )}

          {/* Uploading spinner */}
          {stage === 'uploading' && (
            <div className="border border-border rounded-xl p-10 flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              <p className="text-sub text-sm font-mono">Extracting frames…</p>
            </div>
          )}

          {/* Frame preview */}
          {upload && stage !== 'idle' && (
            <FramePreview
              jobId={upload.job_id}
              frameCount={upload.frame_count}
              width={upload.width}
              height={upload.height}
            />
          )}

          {/* Log */}
          <LogBox lines={log} />

          {/* Error */}
          {error && (
            <div className="bg-red/5 border border-red/20 rounded-xl px-4 py-3 text-xs font-mono text-red">
              {error}
            </div>
          )}

          {/* Output card */}
          {stitchResult && (
            <div className="bg-panel border border-green/20 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
                  <span className="text-sm font-medium text-text">Output ready</span>
                </div>
                <Badge color="green">{stitchResult.size_mb} MB</Badge>
              </div>
              <div className="p-4 flex flex-wrap gap-3">
                <a
                  href={downloadUrl(upload!.job_id)}
                  download
                  className="inline-flex items-center gap-2 px-4 py-2 bg-green/10 border border-green/30 text-green rounded-lg text-sm font-medium hover:bg-green/20 transition-colors"
                >
                  ↓ Download MP4
                </a>
                <Btn onClick={handleSegment} loading={stage === 'segmenting'} variant="ghost">
                  ✂ Segment video
                </Btn>
              </div>
            </div>
          )}

          {/* Segments */}
          {segResult && (
            <div className="bg-panel border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <span className="text-sm font-medium text-text">Segments</span>
                <Badge>{segResult.segment_count} parts</Badge>
              </div>
              <div className="p-3 flex flex-col gap-1.5 max-h-60 overflow-y-auto">
                {segResult.segments.map(seg => (
                  <a
                    key={seg.index}
                    href={segmentDownloadUrl(upload!.job_id, seg.index)}
                    download
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg border border-border hover:border-accent/40 transition-colors group"
                  >
                    <span className="text-xs font-mono text-sub group-hover:text-text">{seg.filename}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted">{seg.size_mb} MB</span>
                      <span className="text-accent text-xs">↓</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right col: settings ── */}
        <div className="flex flex-col gap-4">
          <div className="bg-panel border border-border rounded-xl p-5 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-mono font-semibold uppercase tracking-widest text-muted">Settings</p>
              {upload && <Badge color="green">{upload.frame_count} frames</Badge>}
            </div>

            <SettingsPanel
              settings={settings}
              onChange={setSettings}
              frameCount={upload?.frame_count ?? 0}
              srcWidth={upload?.width ?? '?'}
              srcHeight={upload?.height ?? '?'}
            />

            {upload && (
              <div className="flex flex-col gap-2 pt-2 border-t border-border">
                <Btn
                  onClick={handleStitch}
                  loading={stage === 'stitching'}
                  disabled={busy || stage === 'uploading'}
                >
                  {stage === 'stitching' ? 'Stitching…' : '▶ Stitch to MP4'}
                </Btn>
                {stitchResult && (
                  <Btn onClick={handleReset} variant="ghost">
                    ↺ Start over
                  </Btn>
                )}
              </div>
            )}
          </div>

          {/* Help card */}
          {!upload && (
            <div className="bg-panel border border-border rounded-xl p-5">
              <p className="text-xs font-mono font-semibold uppercase tracking-widest text-muted mb-3">How it works</p>
              <ol className="flex flex-col gap-2.5">
                {[
                  'Export frames from QweenApp as a ZIP',
                  'Drop the ZIP here — any size',
                  'Scrub the preview to verify order',
                  'Set FPS, quality, crop & trim',
                  'Stitch → download MP4',
                  'Optionally segment into chunks',
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-xs text-sub">
                    <span className="font-mono text-accent/60 mt-0.5 shrink-0">{i + 1}.</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

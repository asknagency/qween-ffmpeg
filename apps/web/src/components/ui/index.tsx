'use client'
import { useRef, useState } from 'react'

// ── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  )
}

// ── Button ───────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'ghost' | 'danger' | 'success'
export function Btn({
  onClick, disabled, loading, children, variant = 'primary', fullWidth,
}: {
  onClick?: () => void; disabled?: boolean; loading?: boolean
  children: React.ReactNode; variant?: BtnVariant; fullWidth?: boolean
}) {
  const base = `inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold
    transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed
    disabled:active:scale-100 px-4 py-3 select-none`
  const vars: Record<BtnVariant, string> = {
    primary: 'bg-accent hover:bg-accent/85 text-white',
    ghost:   'bg-transparent border border-border hover:border-accent/60 text-sub hover:text-text',
    danger:  'bg-transparent border border-red/40 hover:border-red text-red/80 hover:text-red',
    success: 'bg-green/15 border border-green/30 hover:bg-green/25 text-green',
  }
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`${base} ${vars[variant]} ${fullWidth ? 'w-full' : ''}`}>
      {loading && <Spinner size={14} />}
      {children}
    </button>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-panel border border-border rounded-2xl ${className}`}>{children}</div>
  )
}

// ── Field ─────────────────────────────────────────────────────────────────────
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-mono text-sub font-medium">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted font-mono">{hint}</p>}
    </div>
  )
}

// ── NumInput ─────────────────────────────────────────────────────────────────
export function NumInput({ value, onChange, placeholder, min, max, step }: {
  value: string; onChange: (v: string) => void
  placeholder?: string; min?: number; max?: number; step?: number
}) {
  return (
    <input type="number" value={value} placeholder={placeholder}
      min={min} max={max} step={step}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-bg border border-border rounded-xl px-3 py-3 text-sm font-mono text-text
        focus:outline-none focus:border-accent transition-colors"
      inputMode="decimal"
    />
  )
}

// ── Select ───────────────────────────────────────────────────────────────────
export function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-bg border border-border rounded-xl px-3 py-3 text-sm font-mono text-text
        focus:outline-none focus:border-accent transition-colors appearance-none">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ── PillGroup ─────────────────────────────────────────────────────────────────
export function PillGroup({ options, value, onChange }: {
  options: (string | number)[]; value: string | number; onChange: (v: string | number) => void
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)}
          className={`px-3 py-2 rounded-lg text-xs font-mono border transition-colors select-none
            ${value === o
              ? 'bg-accent border-accent text-white'
              : 'bg-bg border-border text-sub hover:border-accent/50 hover:text-text'}`}>
          {o}
        </button>
      ))}
    </div>
  )
}

// ── DropZone ─────────────────────────────────────────────────────────────────
export function DropZone({
  onFile, loading, accept = '.zip', label = 'Drop ZIP of frames', sub = '.zip of PNG / JPG frames', file
}: {
  onFile: (f: File) => void; loading?: boolean
  accept?: string; label?: string; sub?: string; file?: File | null
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)

  const handle = (f: File) => {
    const ok = accept.split(',').some(ext => f.name.toLowerCase().endsWith(ext.trim()))
    if (!ok) return alert(`Please upload a ${accept} file.`)
    onFile(f)
  }

  return (
    <div
      onClick={() => !loading && ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handle(f) }}
      className={`relative border-2 border-dashed rounded-2xl transition-all duration-200 cursor-pointer select-none
        ${drag ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/40'}
        ${loading ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = '' }} />

      <div className="flex flex-col items-center justify-center gap-3 py-10 px-6 text-center">
        {file ? (
          <>
            <div className="w-12 h-12 rounded-2xl bg-green/10 border border-green/30 flex items-center justify-center">
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
                <path d="M9 12l2 2 4-4" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#4ade80" strokeWidth="1.8"/>
              </svg>
            </div>
            <div>
              <p className="text-green font-medium text-sm truncate max-w-[200px]">{file.name}</p>
              <p className="text-muted text-xs mt-0.5">{(file.size / 1e6).toFixed(1)} MB · tap to change</p>
            </div>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-2xl bg-panel border border-border flex items-center justify-center">
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
                <path d="M12 16V8M12 8L9 11M12 8L15 11" stroke="#7c6dfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3 16.5C3 18.43 4.57 20 6.5 20h11c1.93 0 3.5-1.57 3.5-3.5" stroke="#555566" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <p className="text-text font-medium text-sm">{label}</p>
              <p className="text-sub text-xs mt-0.5">tap to browse</p>
            </div>
            <span className="text-xs font-mono text-muted bg-bg border border-border px-3 py-1 rounded-full">{sub}</span>
          </>
        )}
      </div>
    </div>
  )
}

// ── LogBox ───────────────────────────────────────────────────────────────────
export function LogBox({ lines }: { lines: string[] }) {
  if (!lines.length) return null
  return (
    <div className="bg-bg border border-border rounded-xl p-3 font-mono text-xs text-sub max-h-36 overflow-y-auto">
      {lines.map((l, i) => (
        <div key={i} className="leading-5">
          <span className="text-muted mr-2">›</span>{l}
        </div>
      ))}
    </div>
  )
}

// ── ErrorBox ─────────────────────────────────────────────────────────────────
export function ErrorBox({ message }: { message: string }) {
  if (!message) return null
  return (
    <div className="bg-red/5 border border-red/20 rounded-xl px-4 py-3 text-xs font-mono text-red">
      ✗ {message}
    </div>
  )
}

// ── DownloadBtn ───────────────────────────────────────────────────────────────
export function DownloadBtn({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} download
      className="flex items-center justify-center gap-2 w-full py-3 bg-green/10 border border-green/30
        text-green rounded-xl text-sm font-semibold hover:bg-green/20 transition-colors active:scale-95">
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      {label}
    </a>
  )
}

// ── SectionTitle ──────────────────────────────────────────────────────────────
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted mb-3">{children}</p>
  )
}

// ── FramePreview ──────────────────────────────────────────────────────────────
export function FramePreview({ jobId, frameCount, width, height, apiBase }: {
  jobId: string; frameCount: number; width: string; height: string; apiBase: string
}) {
  const [idx, setIdx] = useState(0)
  return (
    <Card>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <span className="text-xs font-mono text-sub">preview</span>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="text-accent">{idx + 1}/{frameCount}</span>
          <span className="text-muted">{width}×{height}</span>
        </div>
      </div>
      <div className="relative bg-[#0a0a0c] flex items-center justify-center" style={{ minHeight: 180 }}>
        <div className="absolute inset-0 opacity-20"
          style={{ backgroundImage: 'repeating-conic-gradient(#1a1a1e 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${apiBase}/jobs/${jobId}/frame/${idx}`} alt={`frame ${idx}`}
          className="relative max-h-52 max-w-full object-contain" />
      </div>
      <div className="px-4 pb-4 pt-3">
        <input type="range" min={0} max={frameCount - 1} value={idx}
          onChange={e => setIdx(Number(e.target.value))} />
        <div className="flex justify-between text-xs font-mono text-muted mt-1">
          <span>0</span><span>{frameCount - 1}</span>
        </div>
      </div>
    </Card>
  )
}

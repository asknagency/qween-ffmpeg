'use client'

export interface Settings {
  fps: number
  crf: number
  width: string
  height: string
  preset: string
  trim_start: string
  trim_end: string
  crop_x: string
  crop_y: string
  crop_w: string
  crop_h: string
  segment_duration: string
}

interface Props {
  settings: Settings
  onChange: (s: Settings) => void
  frameCount: number
  srcWidth: string
  srcHeight: string
}

const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'veryslow']
const COMMON_FPS = [12, 24, 25, 30, 48, 60]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-sub font-mono w-28 shrink-0">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function NumInput({ value, onChange, placeholder, min, max }: {
  value: string; onChange: (v: string) => void
  placeholder?: string; min?: number; max?: number
}) {
  return (
    <input
      type="number" value={value} placeholder={placeholder}
      min={min} max={max}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-bg border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-text
        focus:outline-none focus:border-accent transition-colors"
    />
  )
}

export default function SettingsPanel({ settings: s, onChange, frameCount, srcWidth, srcHeight }: Props) {
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch })

  const totalSec = s.fps > 0 ? (frameCount / s.fps).toFixed(2) : '—'

  return (
    <div className="flex flex-col gap-5">

      {/* ── Video ── */}
      <section>
        <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-muted mb-3">Video</p>
        <div className="flex flex-col gap-3">

          {/* FPS */}
          <Row label="fps">
            <div className="flex gap-2 flex-wrap">
              {COMMON_FPS.map(f => (
                <button key={f}
                  onClick={() => set({ fps: f })}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono border transition-colors
                    ${s.fps === f
                      ? 'bg-accent border-accent text-white'
                      : 'bg-bg border-border text-sub hover:border-accent/50 hover:text-text'}`}
                >{f}</button>
              ))}
              <input
                type="number" min={1} max={240} value={s.fps}
                onChange={e => set({ fps: Number(e.target.value) })}
                className="w-16 bg-bg border border-border rounded-md px-2 py-1 text-xs font-mono text-text
                  focus:outline-none focus:border-accent"
                placeholder="custom"
              />
            </div>
            <p className="text-[11px] text-muted mt-1.5 font-mono">
              {frameCount} frames → {totalSec}s at {s.fps} fps
            </p>
          </Row>

          {/* Quality */}
          <Row label={`quality (crf ${s.crf})`}>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-green">best</span>
              <input type="range" min={0} max={51} value={s.crf}
                onChange={e => set({ crf: Number(e.target.value) })} />
              <span className="text-xs font-mono text-red">worst</span>
            </div>
            <p className="text-[11px] text-muted mt-1 font-mono">
              {s.crf <= 18 ? '✦ visually lossless' : s.crf <= 28 ? '✦ good quality' : '⚠ lossy'}
            </p>
          </Row>

          {/* Preset */}
          <Row label="encode speed">
            <select value={s.preset} onChange={e => set({ preset: e.target.value })}
              className="bg-bg border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-text
                focus:outline-none focus:border-accent w-full">
              {PRESETS.map(p => <option key={p}>{p}</option>)}
            </select>
          </Row>

          {/* Scale */}
          <Row label="scale (px)">
            <div className="flex gap-2 items-center">
              <NumInput value={s.width} onChange={v => set({ width: v })} placeholder={srcWidth} />
              <span className="text-muted text-xs font-mono">×</span>
              <NumInput value={s.height} onChange={v => set({ height: v })} placeholder={srcHeight} />
            </div>
            <p className="text-[11px] text-muted mt-1 font-mono">leave blank to keep source size · -2 = auto-fit</p>
          </Row>
        </div>
      </section>

      {/* ── Trim ── */}
      <section>
        <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-muted mb-3">Trim (seconds)</p>
        <div className="flex flex-col gap-3">
          <Row label="start">
            <NumInput value={s.trim_start} onChange={v => set({ trim_start: v })} placeholder="0" min={0} />
          </Row>
          <Row label="end">
            <NumInput value={s.trim_end} onChange={v => set({ trim_end: v })} placeholder={totalSec} min={0} />
          </Row>
        </div>
      </section>

      {/* ── Crop ── */}
      <section>
        <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-muted mb-3">Crop</p>
        <div className="flex flex-col gap-3">
          <Row label="x / y offset">
            <div className="flex gap-2">
              <NumInput value={s.crop_x} onChange={v => set({ crop_x: v })} placeholder="0" min={0} />
              <NumInput value={s.crop_y} onChange={v => set({ crop_y: v })} placeholder="0" min={0} />
            </div>
          </Row>
          <Row label="width / height">
            <div className="flex gap-2">
              <NumInput value={s.crop_w} onChange={v => set({ crop_w: v })} placeholder={srcWidth} min={1} />
              <NumInput value={s.crop_h} onChange={v => set({ crop_h: v })} placeholder={srcHeight} min={1} />
            </div>
          </Row>
        </div>
      </section>

      {/* ── Segment ── */}
      <section>
        <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-muted mb-3">Segment</p>
        <Row label="duration (s)">
          <NumInput value={s.segment_duration} onChange={v => set({ segment_duration: v })} placeholder="5" min={0.5} />
        </Row>
        <p className="text-[11px] text-muted mt-2 font-mono">splits the output video into equal-length chunks</p>
      </section>

    </div>
  )
}

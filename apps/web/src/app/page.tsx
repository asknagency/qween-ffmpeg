'use client'
import { useState } from 'react'
import StitchTool  from '@/tools/StitchTool'
import CropTool    from '@/tools/CropTool'
import TrimTool    from '@/tools/TrimTool'
import ScaleTool   from '@/tools/ScaleTool'
import SegmentTool from '@/tools/SegmentTool'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Tab definitions ───────────────────────────────────────────────────────────
const TABS = [
  {
    id: 'stitch',
    label: 'Stitch',
    emoji: '▶',
    desc: 'Frames → MP4',
    icon: (
      <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
    ),
  },
  {
    id: 'crop',
    label: 'Crop',
    emoji: '✂',
    desc: 'Crop region',
    icon: (
      <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <polyline points="6 2 6 6 2 6"/><polyline points="18 22 18 18 22 18"/>
        <rect x="6" y="6" width="12" height="12" rx="1"/>
      </svg>
    ),
  },
  {
    id: 'trim',
    label: 'Trim',
    emoji: '✂',
    desc: 'Cut start/end',
    icon: (
      <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
        <line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/>
        <line x1="8.12" y1="8.12" x2="12" y2="12"/>
      </svg>
    ),
  },
  {
    id: 'scale',
    label: 'Scale',
    emoji: '⤢',
    desc: 'Resize output',
    icon: (
      <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
        <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
      </svg>
    ),
  },
  {
    id: 'segment',
    label: 'Segment',
    emoji: '⊞',
    desc: 'Split chunks',
    icon: (
      <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <line x1="8" y1="3" x2="8" y2="17"/><line x1="16" y1="3" x2="16" y2="17"/>
        <line x1="2" y1="10" x2="22" y2="10"/>
      </svg>
    ),
  },
] as const

type TabId = (typeof TABS)[number]['id']

// ── App shell ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [active, setActive] = useState<TabId>('stitch')
  const current = TABS.find(t => t.id === active)!

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#0d0d0f' }}>

      {/* ── Header ── */}
      <header style={{
        height: 52, background: '#111116', borderBottom: '1px solid #1e1e28',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', flexShrink: 0,
        paddingTop: 'env(safe-area-inset-top)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(124,109,250,0.15)', border: '1px solid rgba(124,109,250,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M15 10L19.553 7.724A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
                stroke="#7c6dfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#e8e8f0', letterSpacing: '-0.02em', fontFamily: 'JetBrains Mono, monospace' }}>
            QweenFFmpeg
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#555566',
            background: '#1a1a24', border: '1px solid #2a2a38', borderRadius: 6, padding: '3px 8px' }}>
            {current.desc}
          </span>
        </div>
      </header>

      {/* ── Horizontal tab scroll bar ── */}
      <div style={{
        background: '#111116', borderBottom: '1px solid #1e1e28',
        display: 'flex', overflowX: 'auto', flexShrink: 0,
        scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
      }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActive(tab.id)}
            style={{
              flex: '0 0 auto', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 2, padding: '10px 20px', cursor: 'pointer',
              background: 'none', border: 'none',
              borderBottom: active === tab.id ? '2px solid #7c6dfa' : '2px solid transparent',
              color: active === tab.id ? '#7c6dfa' : '#55556a',
              transition: 'color 0.15s',
              WebkitTapHighlightColor: 'transparent',
              userSelect: 'none',
            }}>
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {tab.label}
            </span>
          </button>
        ))}
      </div>

      {/* ── Scrollable tool content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px',
        paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
        {active === 'stitch'  && <StitchTool  apiBase={API_BASE} />}
        {active === 'crop'    && <CropTool    apiBase={API_BASE} />}
        {active === 'trim'    && <TrimTool    apiBase={API_BASE} />}
        {active === 'scale'   && <ScaleTool   apiBase={API_BASE} />}
        {active === 'segment' && <SegmentTool apiBase={API_BASE} />}
      </div>

    </div>
  )
}

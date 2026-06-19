'use client'
import { useState, useEffect, useCallback } from 'react'
import StitchTool  from '@/tools/StitchTool'
import RenderTool  from '@/tools/RenderTool'
import CropTool    from '@/tools/CropTool'
import TrimTool    from '@/tools/TrimTool'
import ScaleTool   from '@/tools/ScaleTool'
import SegmentTool from '@/tools/SegmentTool'
import MergeTool   from '@/tools/MergeTool'
import RecentTool  from '@/tools/RecentTool'
import { StorageBadge } from '@/components/ui'
import { getStorage, cleanAllJobs } from '@/lib/api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/ffmpeg'

const TABS = [
  { id: 'stitch',  label: 'Stitch',  desc: 'Frames → Video' },
  { id: 'render',  label: 'Render',  desc: 'Project → Video' },
  { id: 'crop',    label: 'Crop',    desc: 'Crop region'     },
  { id: 'trim',    label: 'Trim',    desc: 'Cut start/end'   },
  { id: 'scale',   label: 'Scale',   desc: 'Resize output'   },
  { id: 'segment', label: 'Segment', desc: 'Split chunks'    },
  { id: 'merge',   label: 'Merge',   desc: 'Concat videos'   },
  { id: 'recent',  label: 'Recent',  desc: 'Job history'     },
] as const
type TabId = (typeof TABS)[number]['id']

export default function Home() {
  const [active, setActive]       = useState<TabId>('stitch')
  const [storageMb, setStorageMb] = useState<number | null>(null)
  const [cleaning, setCleaning]   = useState(false)
  const current = TABS.find(t => t.id === active)!

  const fetchStorage = useCallback(async () => {
    try { setStorageMb((await getStorage(API_BASE)).storage_used_mb) } catch {}
  }, [])

  useEffect(() => {
    fetchStorage()
    const id = setInterval(fetchStorage, 30_000)
    return () => clearInterval(id)
  }, [fetchStorage])

  const handleClean = async () => {
    if (!confirm('Delete all jobs and free storage?')) return
    setCleaning(true)
    try {
      const r = await cleanAllJobs(API_BASE)
      alert(`Deleted ${r.deleted_jobs} job(s).`)
      setStorageMb(0)
    } catch (e: any) { alert(e.message) }
    finally { setCleaning(false) }
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#0d0d0f' }}>

      {/* Header */}
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
          <span style={{ fontSize: 14, fontWeight: 700, color: '#e8e8f0',
            letterSpacing: '-0.02em', fontFamily: 'JetBrains Mono, monospace' }}>
            QweenFFmpeg
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#555566',
            background: '#1a1a24', border: '1px solid #2a2a38',
            borderRadius: 6, padding: '3px 8px' }}>
            {current.desc}
          </span>
          {storageMb !== null && <StorageBadge mb={storageMb} onClean={handleClean} />}
        </div>
      </header>

      {/* Tab bar — scrollable */}
      <div style={{
        background: '#111116', borderBottom: '1px solid #1e1e28',
        display: 'flex', overflowX: 'auto', flexShrink: 0,
        scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
      }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActive(tab.id)}
            style={{
              flex: '0 0 auto', padding: '10px 18px', cursor: 'pointer',
              background: 'none', border: 'none',
              borderBottom: active === tab.id ? '2px solid #7c6dfa' : '2px solid transparent',
              color: active === tab.id ? '#7c6dfa' : '#55556a',
              fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.04em', textTransform: 'uppercase',
              transition: 'color 0.15s',
              WebkitTapHighlightColor: 'transparent',
              userSelect: 'none',
              position: 'relative',
            }}>
            {tab.label}
            {/* Dot for Recent tab when it's not active — subtle indicator */}
            {tab.id === 'recent' && active !== 'recent' && (
              <span style={{
                position: 'absolute', top: 8, right: 8,
                width: 4, height: 4, borderRadius: '50%', background: '#7c6dfa',
              }} />
            )}
          </button>
        ))}
      </div>

      {/* Tool content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px',
        paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
        {active === 'stitch'  && <StitchTool  apiBase={API_BASE} />}
        {active === 'render'  && <RenderTool  apiBase={API_BASE} />}
        {active === 'crop'    && <CropTool    apiBase={API_BASE} />}
        {active === 'trim'    && <TrimTool    apiBase={API_BASE} />}
        {active === 'scale'   && <ScaleTool   apiBase={API_BASE} />}
        {active === 'segment' && <SegmentTool apiBase={API_BASE} />}
        {active === 'merge'   && <MergeTool   apiBase={API_BASE} />}
        {active === 'recent'  && <RecentTool  apiBase={API_BASE} />}
      </div>
    </div>
  )
}

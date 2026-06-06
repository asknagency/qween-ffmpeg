'use client'
import { useState } from 'react'
import { frameUrl } from '@/lib/api'

interface Props {
  jobId: string
  frameCount: number
  width: string
  height: string
}

export default function FramePreview({ jobId, frameCount, width, height }: Props) {
  const [idx, setIdx] = useState(0)

  return (
    <div className="bg-panel border border-border rounded-xl overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <span className="text-xs font-mono text-sub">frame preview</span>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="text-accent">{idx + 1} / {frameCount}</span>
          <span className="text-muted">{width}×{height}</span>
        </div>
      </div>

      {/* image */}
      <div className="relative bg-[#0a0a0c] flex items-center justify-center" style={{ minHeight: 220 }}>
        {/* checkerboard bg */}
        <div className="absolute inset-0 opacity-30"
          style={{ backgroundImage: 'repeating-conic-gradient(#1a1a1e 0% 25%, transparent 0% 50%)', backgroundSize: '20px 20px' }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={frameUrl(jobId, idx)}
          alt={`frame ${idx}`}
          className="relative max-h-64 max-w-full object-contain"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>

      {/* scrubber */}
      <div className="px-4 pb-4 pt-3">
        <input
          type="range" min={0} max={frameCount - 1} value={idx}
          onChange={e => setIdx(Number(e.target.value))}
        />
        <div className="flex justify-between text-xs font-mono text-muted mt-1">
          <span>0</span>
          <span>{frameCount - 1}</span>
        </div>
      </div>
    </div>
  )
}

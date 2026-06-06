'use client'
import { useRef, useState } from 'react'

interface Props {
  onFile: (file: File) => void
  loading: boolean
}

export default function DropZone({ onFile, loading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handle = (file: File) => {
    if (!file.name.endsWith('.zip')) return alert('Please upload a .zip file.')
    onFile(file)
  }

  return (
    <div
      className={`relative border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer
        ${dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'}
        ${loading ? 'opacity-50 pointer-events-none' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault(); setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) handle(f)
      }}
    >
      <input
        ref={inputRef} type="file" accept=".zip" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handle(f) }}
      />
      <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-panel border border-border flex items-center justify-center">
          <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
            <path d="M12 16V8M12 8L9 11M12 8L15 11" stroke="#7c6dfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3 16.5C3 18.43 4.57 20 6.5 20h11c1.93 0 3.5-1.57 3.5-3.5" stroke="#555566" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <p className="text-text font-medium">Drop your frames ZIP here</p>
          <p className="text-sub text-sm mt-1">or click to browse · no size limit</p>
        </div>
        <span className="text-xs font-mono text-muted bg-panel border border-border px-3 py-1 rounded-full">
          .zip of PNG / JPG frames
        </span>
      </div>
    </div>
  )
}

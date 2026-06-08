'use client'
import { useState, useEffect, useCallback } from 'react'
import { Card, SectionTitle, Btn, DownloadBtn, ErrorBox } from '@/components/ui'
import { listJobs, deleteJob, downloadUrl, FORMAT_LABELS } from '@/lib/api'
import type { JobRecord } from '@/lib/api'

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() / 1000) - ts)
  if (diff < 60)  return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
  return `${Math.floor(diff/86400)}d ago`
}

export default function RecentTool({ apiBase }: { apiBase: string }) {
  const [jobs, setJobs]       = useState<JobRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchJobs = useCallback(async () => {
    setError('')
    try {
      const r = await listJobs(apiBase)
      setJobs(r.jobs)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => {
    fetchJobs()
    const id = setInterval(fetchJobs, 10_000)
    return () => clearInterval(id)
  }, [fetchJobs])

  const handleDelete = async (job: JobRecord) => {
    if (!confirm(`Delete job ${job.job_id.slice(0,8)}?`)) return
    setDeleting(job.job_id)
    try {
      await deleteJob(job.job_id, apiBase)
      setJobs(p => p.filter(j => j.job_id !== job.job_id))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-3">
      <svg className="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c6dfa" strokeWidth="2.5">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      <span className="text-sub text-sm font-mono">Loading jobs…</span>
    </div>
  )

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted">
          {jobs.length} recent job{jobs.length !== 1 ? 's' : ''}
        </p>
        <button onClick={fetchJobs}
          className="text-[11px] font-mono text-accent flex items-center gap-1.5 active:scale-95">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 .49-4.4"/>
          </svg>
          Refresh
        </button>
      </div>

      <ErrorBox message={error} />

      {jobs.length === 0 && (
        <Card className="p-10 flex flex-col items-center gap-3">
          <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="#333" strokeWidth="1.4">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
          <p className="text-sm text-muted">No jobs yet — process something first</p>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {jobs.map(job => (
          <Card key={job.job_id} className="p-3 flex flex-col gap-2.5">
            {/* Top row */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-text truncate">
                  {job.label || job.input_file || 'Untitled job'}
                </p>
                <p className="text-[10px] font-mono text-muted mt-0.5">
                  {job.job_id.slice(0, 8)} · {timeAgo(job.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Status badge */}
                {job.has_output ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full
                    bg-green/10 border border-green/20 text-green">
                    done
                  </span>
                ) : (job as any).async_status === 'processing' || (job as any).async_status === 'queued' ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full
                    bg-accent/10 border border-accent/20 text-accent">
                    {(job as any).async_status}
                  </span>
                ) : (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full
                    bg-bg border border-border text-muted">
                    no output
                  </span>
                )}
                {/* Delete */}
                <button onClick={() => handleDelete(job)}
                  disabled={deleting === job.job_id}
                  className="w-6 h-6 rounded-lg bg-panel border border-red/20 text-red/50
                    hover:text-red hover:border-red/40 flex items-center justify-center
                    active:scale-90 transition-colors disabled:opacity-30">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-3 text-[10px] font-mono text-muted">
              {job.frame_count > 0 && <span>{job.frame_count} frames</span>}
              {job.format && (
                <span className="text-accent">
                  {FORMAT_LABELS[job.format] ?? job.format.toUpperCase()}
                </span>
              )}
              {job.size_mb && <span>{job.size_mb} MB</span>}
            </div>

            {/* Download */}
            {job.has_output && (
              <a href={downloadUrl(job.job_id, apiBase)} download
                className="flex items-center justify-center gap-2 py-2.5 bg-green/5 border border-green/20
                  text-green rounded-xl text-xs font-semibold hover:bg-green/10
                  transition-colors active:scale-95">
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download {FORMAT_LABELS[job.format ?? ''] ?? ''}
              </a>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

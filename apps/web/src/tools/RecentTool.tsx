'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, SectionTitle, Btn, DownloadBtn, ErrorBox } from '@/components/ui'
import { listJobs, deleteJob, downloadUrl, FORMAT_LABELS, getJobStatus } from '@/lib/api'
import type { JobRecord, JobStatus } from '@/lib/api'

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() / 1000) - ts)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function StatusBadge({ job }: { job: JobRecord }) {
  const asyncStatus = (job as any).async_status as string | undefined
  if (job.has_output)
    return <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-green/10 border border-green/20 text-green">done</span>
  if (asyncStatus === 'error')
    return <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-red/10 border border-red/20 text-red">error</span>
  if (asyncStatus === 'processing' || asyncStatus === 'queued')
    return <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent">{asyncStatus}</span>
  return <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-bg border border-border text-muted">no output</span>
}

// ── Log Drawer ────────────────────────────────────────────────────────────────
function LogDrawer({ jobId, apiBase, onClose }: { jobId: string; apiBase: string; onClose: () => void }) {
  const [status, setStatus]   = useState<JobStatus | null>(null)
  const [error, setError]     = useState('')
  const [polling, setPolling] = useState(true)
  const logRef                = useRef<HTMLPreElement>(null)

  const fetch_ = useCallback(async () => {
    try {
      const s = await getJobStatus(jobId, apiBase)
      setStatus(s)
      if (s.status === 'done' || s.status === 'error') setPolling(false)
    } catch (e: any) {
      setError(e.message)
      setPolling(false)
    }
  }, [jobId, apiBase])

  useEffect(() => {
    fetch_()
  }, [fetch_])

  useEffect(() => {
    if (!polling) return
    const id = setInterval(fetch_, 2000)
    return () => clearInterval(id)
  }, [polling, fetch_])

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [status?.message])

  const statusColor =
    status?.status === 'done'       ? 'text-green'  :
    status?.status === 'error'      ? 'text-red'     :
    status?.status === 'processing' ? 'text-accent'  :
    'text-muted'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-2xl bg-panel border border-border rounded-2xl flex flex-col shadow-2xl max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c6dfa" strokeWidth="2.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <span className="text-xs font-mono font-bold text-text">Job Log</span>
            <span className="text-[10px] font-mono text-muted">{jobId.slice(0, 8)}</span>
          </div>
          <button onClick={onClose}
            className="w-6 h-6 rounded-lg bg-bg border border-border text-muted hover:text-text
              flex items-center justify-center transition-colors active:scale-90">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Status bar */}
        {status && (
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-bg/50 shrink-0">
            {/* Progress bar */}
            <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  status.status === 'error' ? 'bg-red' :
                  status.status === 'done'  ? 'bg-green' : 'bg-accent'
                }`}
                style={{ width: `${status.progress ?? 0}%` }}
              />
            </div>
            <span className={`text-[10px] font-mono font-bold shrink-0 ${statusColor}`}>
              {status.status?.toUpperCase()} {status.progress != null ? `${status.progress}%` : ''}
            </span>
            {polling && (
              <svg className="spin shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#7c6dfa" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            )}
          </div>
        )}

        {/* Log body */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {error && (
            <div className="px-4 py-3 text-xs text-red font-mono">{error}</div>
          )}
          {!status && !error && (
            <div className="flex items-center justify-center py-10 gap-2">
              <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c6dfa" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              <span className="text-xs font-mono text-muted">Fetching log…</span>
            </div>
          )}
          {status && (
            <pre
              ref={logRef}
              className="flex-1 overflow-y-auto p-4 text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all
                text-text/80 bg-transparent"
            >
              {status.message || '(no message yet)'}
            </pre>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border shrink-0">
          <button
            onClick={fetch_}
            className="text-[11px] font-mono text-accent flex items-center gap-1.5 active:scale-95"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 .49-4.4"/>
            </svg>
            Refresh
          </button>
          <button
            onClick={() => setPolling(p => !p)}
            className="text-[11px] font-mono text-muted hover:text-text active:scale-95"
          >
            {polling ? '⏸ Pause' : '▶ Resume'} auto-refresh
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function RecentTool({ apiBase }: { apiBase: string }) {
  const [jobs, setJobs]         = useState<JobRecord[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [logJobId, setLogJobId] = useState<string | null>(null)

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
    if (!confirm(`Delete job ${job.job_id.slice(0, 8)}?`)) return
    setDeleting(job.job_id)
    try {
      await deleteJob(job.job_id, apiBase)
      setJobs(p => p.filter(j => j.job_id !== job.job_id))
      if (logJobId === job.job_id) setLogJobId(null)
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
    <>
      {/* Log drawer overlay */}
      {logJobId && (
        <LogDrawer jobId={logJobId} apiBase={apiBase} onClose={() => setLogJobId(null)} />
      )}

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
                  <StatusBadge job={job} />

                  {/* Log button */}
                  <button
                    onClick={() => setLogJobId(job.job_id)}
                    title="View log"
                    className="w-6 h-6 rounded-lg bg-panel border border-border text-muted
                      hover:text-accent hover:border-accent/40 flex items-center justify-center
                      active:scale-90 transition-colors">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                  </button>

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
    </>
  )
}

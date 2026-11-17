import { CheckCircle2, HardDrive, Pause, Play, RotateCw, Trash2 } from 'lucide-react';
import type { DownloadTask } from '../types/cinema';
import { formatFileSize } from '../utils/format';

interface DownloadsManagerPanelProps {
  tasks: DownloadTask[];
  storageUsedBytes: number;
  onPause: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onRemove: (taskId: string) => void;
  onOpenMovieById: (movieId: string) => void;
}

export function DownloadsManagerPanel({
  tasks,
  storageUsedBytes,
  onPause,
  onResume,
  onRemove,
  onOpenMovieById,
}: DownloadsManagerPanelProps) {
  return (
    <section
      aria-labelledby="downloads-manager-heading"
      className="mb-8 rounded-2xl border border-[#27272A] bg-[#111114] p-4 sm:p-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#27272A] pb-4 mb-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-[#E6A93C] mb-0.5">
            Downloads Manager
          </p>
          <h2
            id="downloads-manager-heading"
            className="font-display text-xl font-bold text-[#FAFAFA]"
          >
            Offline Queue &amp; Storage
          </h2>
        </div>

        <div className="inline-flex items-center gap-2 rounded-xl border border-[#27272A] bg-[#0A0A0C] px-3.5 py-2 text-xs font-mono tabular-nums text-[#D4D4D8] self-start sm:self-auto">
          <HardDrive className="h-4 w-4 text-[#E6A93C]" aria-hidden="true" />
          <span>Storage used: {formatFileSize(storageUsedBytes)}</span>
          <span aria-hidden="true">·</span>
          <span>{tasks.length} files</span>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#27272A] bg-[#0A0A0C] p-6 text-center">
          <p className="text-sm font-medium text-[#FAFAFA] mb-1">
            No active or saved downloads yet
          </p>
          <p className="text-xs text-[#A1A1AA]">
            Tap Download on any movie below to pick a resolution (360p–4K) and track progress here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const pct =
              task.totalBytes > 0
                ? Math.min(100, Math.round((task.receivedBytes / task.totalBytes) * 100))
                : task.status === 'completed'
                  ? 100
                  : 0;

            return (
              <div
                key={task.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[#27272A] bg-[#0A0A0C] p-3.5"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <img
                    src={task.posterUrl}
                    alt={`${task.title} poster`}
                    className="h-14 w-10 rounded-lg object-cover border border-[#27272A] shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenMovieById(task.movieId)}
                        className="font-display text-sm font-semibold text-[#FAFAFA] hover:text-[#E6A93C] truncate text-left cursor-pointer"
                      >
                        {task.title}
                      </button>
                      <span className="rounded border border-[#27272A] bg-[#18181B] px-1.5 py-0.5 font-mono text-[10px] text-[#E6A93C] shrink-0">
                        {task.quality}
                      </span>
                    </div>

                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#18181B]">
                      <div
                        className={`h-full rounded-full transition-all ${
                          task.status === 'error'
                            ? 'bg-red-500'
                            : task.status === 'completed'
                              ? 'bg-emerald-400'
                              : 'bg-[#E6A93C]'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-[#A1A1AA]">
                      <span>{pct}%</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {formatFileSize(task.receivedBytes)} / {formatFileSize(task.totalBytes)}
                      </span>
                      {task.status === 'downloading' && task.speedBps > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#E6A93C]">{formatFileSize(task.speedBps)}/s</span>
                        </>
                      )}
                      {task.status === 'paused' && (
                        <span className="text-amber-300">Paused</span>
                      )}
                      {task.status === 'completed' && (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          Saved
                        </span>
                      )}
                      {task.status === 'error' && (
                        <span className="text-red-400">{task.errorMessage || 'Failed'}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {task.status === 'downloading' ? (
                    <button
                      type="button"
                      onClick={() => onPause(task.id)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs font-medium text-[#FAFAFA] hover:border-[#E6A93C] cursor-pointer"
                    >
                      <Pause className="h-3.5 w-3.5 text-[#E6A93C]" aria-hidden="true" />
                      <span>Pause</span>
                    </button>
                  ) : task.status === 'paused' || task.status === 'error' ? (
                    <button
                      type="button"
                      onClick={() => onResume(task.id)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#E6A93C] px-3 py-2 text-xs font-bold text-[#0A0A0C] hover:bg-[#F5C563] cursor-pointer"
                    >
                      {task.status === 'error' ? (
                        <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      )}
                      <span>{task.status === 'error' ? 'Retry' : 'Resume'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenMovieById(task.movieId)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#E6A93C]/50 bg-[#E6A93C]/10 px-3 py-2 text-xs font-semibold text-[#E6A93C] hover:bg-[#E6A93C]/20 cursor-pointer"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      <span>Play</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onRemove(task.id)}
                    aria-label={`Remove ${task.title} download`}
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-[#27272A] bg-[#18181B] text-[#A1A1AA] hover:border-red-500/40 hover:text-red-300 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

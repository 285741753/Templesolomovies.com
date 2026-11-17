import { useEffect, useState } from 'react';
import { Film, Send, ThumbsUp, X } from 'lucide-react';
import type { MovieRequestItem } from '../types/cinema';

interface RequestMovieModalProps {
  isOpen: boolean;
  requesterName: string;
  onSubmitted: (title: string) => void;
  onClose: () => void;
}

export function RequestMovieModal({
  isOpen,
  requesterName,
  onSubmitted,
  onClose,
}: RequestMovieModalProps) {
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [country, setCountry] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [requests, setRequests] = useState<MovieRequestItem[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void fetch('/api/requests')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { requests?: MovieRequestItem[] } | null) => {
        if (active && Array.isArray(data?.requests)) {
          setRequests(data.requests);
        }
      })
      .catch(() => {});

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      active = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Please enter a movie or series title.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          year: year ? Number(year) : undefined,
          country: country.trim() || undefined,
          notes: notes.trim() || undefined,
          requestedBy: requesterName,
        }),
      });
      if (!res.ok) throw new Error('Failed to send request.');
      const data = (await res.json()) as { request: MovieRequestItem };
      setRequests((prev) => [data.request, ...prev]);
      onSubmitted(data.request.title);
      setTitle('');
      setYear('');
      setCountry('');
      setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpvote = async (id: string) => {
    try {
      const res = await fetch(`/api/requests/${encodeURIComponent(id)}/upvote`, {
        method: 'POST',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { request: MovieRequestItem };
      setRequests((prev) => prev.map((r) => (r.id === id ? data.request : r)));
    } catch {
      // Ignore network error
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-movie-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto"
    >
      <div className="w-full max-w-lg rounded-2xl border border-[#27272A] bg-[#111114] p-5 sm:p-6 shadow-2xl my-auto">
        <div className="flex items-start justify-between gap-3 border-b border-[#27272A] pb-4 mb-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-[#E6A93C] mb-1">
              Community Vault Requests
            </p>
            <h2
              id="request-movie-title"
              className="font-display text-xl font-bold text-[#FAFAFA]"
            >
              Request a Movie or Series
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close request modal"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 mb-5">
          <div>
            <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
              Movie / Series Title *
            </label>
            <input
              type="text"
              required
              maxLength={140}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Gangs of Lagos, Dune Part Two..."
              className="w-full rounded-xl border border-[#27272A] bg-[#0A0A0C] px-3 py-2.5 text-sm text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                Release Year (optional)
              </label>
              <input
                type="number"
                min={1950}
                max={2030}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2025"
                className="w-full rounded-xl border border-[#27272A] bg-[#0A0A0C] px-3 py-2.5 text-sm font-mono text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                Country / Industry
              </label>
              <input
                type="text"
                maxLength={60}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="Nigeria, South Korea..."
                className="w-full rounded-xl border border-[#27272A] bg-[#0A0A0C] px-3 py-2.5 text-sm text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
              Language / Notes (optional)
            </label>
            <input
              type="text"
              maxLength={300}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Preferred audio/subtitles or season..."
              className="w-full rounded-xl border border-[#27272A] bg-[#0A0A0C] px-3 py-2.5 text-sm text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#E6A93C] px-4 py-2.5 text-xs sm:text-sm font-bold text-[#0A0A0C] hover:bg-[#F5C563] disabled:opacity-50 cursor-pointer"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            <span>{submitting ? 'Sending...' : 'Submit Request'}</span>
          </button>
        </form>

        {requests.length > 0 && (
          <div className="border-t border-[#27272A] pt-4">
            <p className="text-xs font-semibold text-[#FAFAFA] mb-2.5">
              Recent Community Requests
            </p>
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {requests.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#27272A] bg-[#0A0A0C] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#FAFAFA] truncate">
                      <Film className="h-3.5 w-3.5 text-[#E6A93C] shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.title}</span>
                      {item.year && (
                        <span className="font-mono text-[11px] text-[#71717A]">({item.year})</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#71717A] truncate mt-0.5">
                      By {item.requestedBy}
                      {item.country ? ` · ${item.country}` : ''}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleUpvote(item.id)}
                    className="min-h-[36px] inline-flex items-center gap-1 rounded-lg border border-[#27272A] bg-[#18181B] px-2.5 py-1 text-xs font-mono text-[#E6A93C] hover:border-[#E6A93C] cursor-pointer shrink-0"
                  >
                    <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                    <span>{item.upvotes}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

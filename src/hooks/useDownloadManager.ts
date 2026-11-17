import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DownloadQualityTier, DownloadTask, Movie } from '../types/cinema';
import { estimateTierFileSize } from '../utils/movieMetadata';

const DOWNLOADS_META_KEY = 'tsm_downloads_meta_v1';
const OFFLINE_CACHE_NAME = 'temple-offline-downloads-v1';

function loadSavedTasks(): DownloadTask[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DOWNLOADS_META_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is DownloadTask => Boolean(item && typeof item === 'object' && 'id' in item))
      .map((item) => ({
        ...item,
        // Any in-flight download across a page reload resumes cleanly in paused state
        status: item.status === 'downloading' ? 'paused' : item.status,
        speedBps: 0,
      }));
  } catch {
    return [];
  }
}

function persistTasks(tasks: DownloadTask[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DOWNLOADS_META_KEY, JSON.stringify(tasks.slice(0, 40)));
  } catch {
    // Ignore storage quota errors
  }
}

export function useDownloadManager() {
  const [tasks, setTasks] = useState<DownloadTask[]>(() => loadSavedTasks());
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const chunksRef = useRef<Map<string, Uint8Array[]>>(new Map());

  useEffect(() => {
    persistTasks(tasks);
  }, [tasks]);

  const storageUsedBytes = useMemo(
    () =>
      tasks.reduce((sum, task) => {
        if (task.status === 'completed' || task.offlineAvailable) {
          return sum + Math.max(task.receivedBytes, task.totalBytes);
        }
        return sum + task.receivedBytes;
      }, 0),
    [tasks]
  );

  const updateTask = useCallback(
    (taskId: string, updater: (prev: DownloadTask) => DownloadTask) => {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updater(t) : t)));
    },
    []
  );

  const runFetchLoop = useCallback(
    async (task: DownloadTask, resumeFromByte: number) => {
      const controller = new AbortController();
      controllersRef.current.set(task.id, controller);

      const url =
        task.sourceUrl && /^https?:\/\//i.test(task.sourceUrl)
          ? task.sourceUrl
          : `/api/movies/${encodeURIComponent(task.movieId)}/download?quality=${encodeURIComponent(task.quality)}`;
      const headers: Record<string, string> = {};
      if (resumeFromByte > 0) {
        headers.Range = `bytes=${resumeFromByte}-`;
      }

      try {
        const res = await fetch(url, { headers, signal: controller.signal });
        if (!res.ok && res.status !== 206) {
          throw new Error(`HTTP ${res.status}`);
        }

        const isPartial = res.status === 206;
        const contentLengthHeader = Number(res.headers.get('Content-Length') || 0);
        let expectedTotal = task.totalBytes;
        if (isPartial) {
          const rangeHeader = res.headers.get('Content-Range') || '';
          const totalMatch = rangeHeader.match(/\/(\d+)$/);
          if (totalMatch) expectedTotal = Number(totalMatch[1]);
        } else if (contentLengthHeader > 0) {
          expectedTotal = contentLengthHeader;
        }

        const existingChunks = isPartial ? chunksRef.current.get(task.id) || [] : [];
        let received = isPartial ? resumeFromByte : 0;
        const nextChunks = [...existingChunks];

        if (!res.body) {
          const buf = new Uint8Array(await res.arrayBuffer());
          nextChunks.push(buf);
          received += buf.byteLength;
          chunksRef.current.set(task.id, nextChunks);
        } else {
          const reader = res.body.getReader();
          let lastSampleAt = performance.now();
          let bytesSinceSample = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              nextChunks.push(value);
              chunksRef.current.set(task.id, nextChunks);
              received += value.byteLength;
              bytesSinceSample += value.byteLength;

              const now = performance.now();
              const elapsedSec = (now - lastSampleAt) / 1000;
              if (elapsedSec >= 0.15) {
                const speedBps = Math.round(bytesSinceSample / elapsedSec);
                lastSampleAt = now;
                bytesSinceSample = 0;
                const finalReceived = received;
                const finalExpected = Math.max(expectedTotal, finalReceived);
                updateTask(task.id, (prev) => ({
                  ...prev,
                  status: 'downloading',
                  receivedBytes: finalReceived,
                  totalBytes: finalExpected,
                  speedBps,
                  updatedAt: Date.now(),
                }));
              }
            }
          }
        }

        const mergedBlob = new Blob(nextChunks as BlobPart[], { type: 'video/mp4' });
        const finalSize = mergedBlob.size || received;

        // Save into Cache API so Downloads Manager tracks real offline playback bytes
        if (typeof caches !== 'undefined') {
          try {
            const cache = await caches.open(OFFLINE_CACHE_NAME);
            await cache.put(
              `/offline/movie/${encodeURIComponent(task.movieId)}`,
              new Response(mergedBlob, {
                headers: {
                  'Content-Type': 'video/mp4',
                  'Content-Length': String(finalSize),
                },
              })
            );
          } catch {
            // Ignore cache quota failures
          }
        }

        // Trigger device browser save
        const blobUrl = URL.createObjectURL(mergedBlob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = task.fileName || `${task.title}-${task.quality}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 8000);

        chunksRef.current.delete(task.id);
        controllersRef.current.delete(task.id);

        updateTask(task.id, (prev) => ({
          ...prev,
          status: 'completed',
          receivedBytes: finalSize,
          totalBytes: finalSize,
          speedBps: 0,
          offlineAvailable: true,
          updatedAt: Date.now(),
        }));
      } catch (err) {
        controllersRef.current.delete(task.id);
        if (err instanceof DOMException && err.name === 'AbortError') {
          // User paused intentionally
          return;
        }
        updateTask(task.id, (prev) => ({
          ...prev,
          status: 'error',
          speedBps: 0,
          errorMessage: err instanceof Error ? err.message : 'Download interrupted',
          updatedAt: Date.now(),
        }));
      }
    },
    [updateTask]
  );

  const startDownload = useCallback(
    (movie: Movie, quality: DownloadQualityTier) => {
      const id = `dl-${movie.id}-${quality}`;
      const existingController = controllersRef.current.get(id);
      if (existingController) {
        existingController.abort();
        controllersRef.current.delete(id);
      }

      const estimatedTotal = movie.fileSizeBytes > 0
        ? movie.fileSizeBytes
        : estimateTierFileSize(movie.fileSizeBytes, quality);

      const newTask: DownloadTask = {
        id,
        movieId: movie.id,
        title: movie.title,
        posterUrl: movie.posterUrl,
        fileName: movie.fileName || `${movie.title}-${quality}.mp4`,
        quality,
        status: 'downloading',
        receivedBytes: 0,
        totalBytes: estimatedTotal,
        speedBps: 0,
        ...(movie.videoUrl && /^https?:\/\//i.test(movie.videoUrl) ? { sourceUrl: movie.videoUrl } : {}),
        offlineAvailable: false,
        updatedAt: Date.now(),
      };

      chunksRef.current.set(id, []);
      setTasks((prev) => [newTask, ...prev.filter((t) => t.id !== id)]);
      void runFetchLoop(newTask, 0);
      return newTask;
    },
    [runFetchLoop]
  );

  const pauseDownload = useCallback(
    (taskId: string) => {
      const ctrl = controllersRef.current.get(taskId);
      if (ctrl) {
        ctrl.abort();
        controllersRef.current.delete(taskId);
      }
      updateTask(taskId, (prev) => ({
        ...prev,
        status: prev.status === 'downloading' ? 'paused' : prev.status,
        speedBps: 0,
        updatedAt: Date.now(),
      }));
    },
    [updateTask]
  );

  const resumeDownload = useCallback(
    (taskId: string) => {
      const target = tasks.find((t) => t.id === taskId);
      if (!target || target.status === 'downloading') return;
      const storedChunks = chunksRef.current.get(taskId);
      const resumeByte =
        storedChunks && storedChunks.length > 0 ? target.receivedBytes : 0;
      const resumed: DownloadTask = {
        ...target,
        status: 'downloading',
        receivedBytes: resumeByte,
        errorMessage: undefined,
        updatedAt: Date.now(),
      };
      updateTask(taskId, () => resumed);
      void runFetchLoop(resumed, resumeByte);
    },
    [tasks, updateTask, runFetchLoop]
  );

  const removeDownload = useCallback(async (taskId: string) => {
    const ctrl = controllersRef.current.get(taskId);
    if (ctrl) {
      ctrl.abort();
      controllersRef.current.delete(taskId);
    }
    chunksRef.current.delete(taskId);

    const target = tasks.find((t) => t.id === taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    if (target && typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(OFFLINE_CACHE_NAME);
        await cache.delete(`/offline/movie/${encodeURIComponent(target.movieId)}`);
      } catch {
        // Ignore cache cleanup errors
      }
    }
  }, [tasks]);

  return {
    tasks,
    storageUsedBytes,
    startDownload,
    pauseDownload,
    resumeDownload,
    removeDownload,
  };
}

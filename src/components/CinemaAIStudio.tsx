import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Search,
  Mic,
  MicOff,
  FileAudio,
  Send,
  Globe,
  ExternalLink,
  Volume2,
  Square,
  Upload,
  Copy,
  Check,
  Radio,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { downsampleFloat32, float32ToPcmBase64, pcmBase64ToFloat32 } from '../utils/liveAudio';

type StudioTab = 'chat' | 'voice' | 'transcribe';

interface ChatSource {
  title: string;
  uri: string;
}

interface GeminiChatEntry {
  id: string;
  role: 'user' | 'model';
  text: string;
  sources?: ChatSource[];
}

interface VoiceTranscriptItem {
  id: string;
  speaker: 'you' | 'gemini';
  text: string;
}

const LIVE_VOICES = ['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir'] as const;

export function CinemaAIStudio() {
  const { t } = useLanguage();
  const { setBusyActivity } = usePWAInstall();
  const [activeTab, setActiveTab] = useState<StudioTab>('chat');

  // --- Tab 1: Search Grounded Chat ---
  const [chatHistory, setChatHistory] = useState<GeminiChatEntry[]>([
    {
      id: 'welcome',
      role: 'model',
      text: 'Ask about recent films, directors, box-office numbers, cinema trivia, or chess openings. Responses are grounded with live Google Search.',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatFeedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
    }
  }, [chatHistory.length, chatLoading]);

  const sendSearchChat = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || chatLoading) return;

    const userMsg: GeminiChatEntry = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    const nextHistory = [...chatHistory, userMsg];
    setChatHistory(nextHistory);
    setChatInput('');
    setChatLoading(true);
    setChatError(null);

    try {
      const apiHistory = chatHistory
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({ role: m.role, text: m.text }));

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history: apiHistory }),
      });
      const data = (await res.json()) as {
        reply?: string;
        sources?: ChatSource[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to get AI response.');
      }
      setChatHistory((prev) => [
        ...prev,
        {
          id: `m-${Date.now()}`,
          role: 'model',
          text: data.reply || '',
          sources: Array.isArray(data.sources) ? data.sources : [],
        },
      ]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Unable to reach AI chat service.');
    } finally {
      setChatLoading(false);
    }
  };

  // --- Tab 2: Live Voice Conversation (16kHz input PCM -> 24kHz output PCM) ---
  const [selectedVoice, setSelectedVoice] = useState<string>('Zephyr');
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTextDraft, setVoiceTextDraft] = useState('');
  const [voiceLog, setVoiceLog] = useState<VoiceTranscriptItem[]>([]);

  const liveWsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const activeAudioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isLiveReadyRef = useRef(false);
  const hadVoiceErrorRef = useRef(false);

  const clearPlaybackQueue = useCallback(() => {
    for (const src of activeAudioSourcesRef.current) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already stopped buffer
      }
    }
    activeAudioSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextPlayTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextPlayTimeRef.current = 0;
    }
  }, []);

  const stopVoiceSession = useCallback(
    (preserveError = false) => {
      isLiveReadyRef.current = false;
      clearPlaybackQueue();
      if (processorRef.current) {
        processorRef.current.onaudioprocess = null;
        processorRef.current.disconnect();
        processorRef.current = null;
      }
      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
        sourceNodeRef.current = null;
      }
      if (micStreamRef.current) {
        for (const track of micStreamRef.current.getTracks()) {
          track.stop();
        }
        micStreamRef.current = null;
      }
      if (inputCtxRef.current) {
        void inputCtxRef.current.close().catch(() => {});
        inputCtxRef.current = null;
      }
      if (outputCtxRef.current) {
        void outputCtxRef.current.close().catch(() => {});
        outputCtxRef.current = null;
      }
      if (liveWsRef.current) {
        const ws = liveWsRef.current;
        liveWsRef.current = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }
      if (!preserveError) {
        setVoiceStatus('idle');
      }
    },
    [clearPlaybackQueue]
  );

  useEffect(() => {
    return () => {
      stopVoiceSession();
    };
  }, [stopVoiceSession]);

  const appendVoiceTranscript = (speaker: 'you' | 'gemini', chunkText: string) => {
    const clean = chunkText.trim();
    if (!clean) return;
    setVoiceLog((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === speaker) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: `${last.text} ${clean}`.trim() },
        ];
      }
      return [...prev.slice(-30), { id: `vt-${Date.now()}-${Math.random()}`, speaker, text: clean }];
    });
  };

  const play24kPcmChunk = (base64Pcm: string) => {
    const outCtx = outputCtxRef.current;
    if (!outCtx) return;
    if (outCtx.state === 'suspended') {
      void outCtx.resume();
    }

    const floatSamples = pcmBase64ToFloat32(base64Pcm);
    if (floatSamples.length === 0) return;

    const buffer = outCtx.createBuffer(1, floatSamples.length, 24000);
    buffer.getChannelData(0).set(floatSamples);

    const src = outCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(outCtx.destination);

    const now = outCtx.currentTime;
    const startAt = Math.max(now + 0.02, nextPlayTimeRef.current);
    src.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;

    activeAudioSourcesRef.current.add(src);
    src.onended = () => {
      activeAudioSourcesRef.current.delete(src);
    };
  };

  const startVoiceSession = async () => {
    if (voiceStatus === 'connecting' || voiceStatus === 'live') return;
    setVoiceError(null);
    setVoiceStatus('connecting');
    hadVoiceErrorRef.current = false;
    isLiveReadyRef.current = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not available in this browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      let inputCtx: AudioContext;
      try {
        inputCtx = new AudioContext({ sampleRate: 16000 });
      } catch {
        inputCtx = new AudioContext();
      }
      let outputCtx: AudioContext;
      try {
        outputCtx = new AudioContext({ sampleRate: 24000 });
      } catch {
        outputCtx = new AudioContext();
      }
      await inputCtx.resume().catch(() => {});
      await outputCtx.resume().catch(() => {});

      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextPlayTimeRef.current = outputCtx.currentTime;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/live?voice=${encodeURIComponent(selectedVoice)}`
      );
      liveWsRef.current = ws;

      ws.onopen = () => {
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        sourceNodeRef.current = source;
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (liveWsRef.current?.readyState !== WebSocket.OPEN || !isLiveReadyRef.current) return;
          const resampled = downsampleFloat32(
            e.inputBuffer.getChannelData(0),
            inputCtx.sampleRate,
            16000
          );
          const pcmBase64 = float32ToPcmBase64(resampled);
          liveWsRef.current.send(JSON.stringify({ audio: pcmBase64 }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type?: string;
            data?: string;
            text?: string;
            message?: string;
          };
          if (msg.type === 'ready') {
            isLiveReadyRef.current = true;
            setVoiceStatus('live');
          } else if (msg.type === 'audio' && msg.data) {
            play24kPcmChunk(msg.data);
          } else if (msg.type === 'input_transcript' && msg.text) {
            appendVoiceTranscript('you', msg.text);
          } else if (msg.type === 'output_transcript' && msg.text) {
            appendVoiceTranscript('gemini', msg.text);
          } else if (msg.type === 'interrupted') {
            clearPlaybackQueue();
          } else if (msg.type === 'error') {
            hadVoiceErrorRef.current = true;
            setVoiceError(msg.message || 'Voice conversation error.');
            setVoiceStatus('error');
            stopVoiceSession(true);
          } else if (msg.type === 'closed') {
            stopVoiceSession(hadVoiceErrorRef.current);
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onerror = () => {
        hadVoiceErrorRef.current = true;
        setVoiceError('Could not connect to the live voice server.');
        setVoiceStatus('error');
        stopVoiceSession(true);
      };

      ws.onclose = () => {
        if (liveWsRef.current === ws) {
          stopVoiceSession(hadVoiceErrorRef.current);
        }
      };
    } catch (err) {
      hadVoiceErrorRef.current = true;
      setVoiceError(
        err instanceof Error
          ? err.message
          : 'Microphone access is required for voice conversation.'
      );
      setVoiceStatus('error');
      stopVoiceSession(true);
    }
  };

  const handleSendVoiceText = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = voiceTextDraft.trim();
    if (!clean || liveWsRef.current?.readyState !== WebSocket.OPEN) return;
    liveWsRef.current.send(JSON.stringify({ text: clean }));
    appendVoiceTranscript('you', clean);
    setVoiceTextDraft('');
  };

  // --- Tab 3: Audio Transcription (gemini-3.5-transcribe) ---
  const [selectedAudioFile, setSelectedAudioFile] = useState<File | null>(null);
  const [isRecordingClip, setIsRecordingClip] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const transcribeFileOrBlob = async (blob: Blob, filename: string) => {
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const formData = new FormData();
      formData.append('audio', blob, filename);
      const res = await fetch('/api/ai/transcribe', {
        method: 'POST',
        body: formData,
      });
      const data = (await res.json()) as { transcript?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Transcription failed.');
      }
      setTranscript(data.transcript || '(No speech detected in audio.)');
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : 'Unable to transcribe audio.');
    } finally {
      setTranscribing(false);
    }
  };

  const handleStartClipRecording = async () => {
    setTranscribeError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        const mime = recorder.mimeType || 'audio/webm';
        const blob = new Blob(recordedChunksRef.current, { type: mime });
        const recordedFile = new File([blob], `mic-clip-${Date.now()}.webm`, { type: mime });
        setSelectedAudioFile(recordedFile);
        void transcribeFileOrBlob(blob, recordedFile.name);
      };

      recorder.start();
      setIsRecordingClip(true);
    } catch (err) {
      setTranscribeError(
        err instanceof Error ? err.message : 'Microphone permission denied.'
      );
    }
  };

  const handleStopClipRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecordingClip(false);
  };

  const handleCopyTranscript = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
    setCopiedTranscript(true);
    window.setTimeout(() => setCopiedTranscript(false), 2000);
  };

  useEffect(() => {
    const micActive =
      voiceStatus === 'connecting' ||
      voiceStatus === 'live' ||
      isRecordingClip ||
      transcribing;
    setBusyActivity('mic', micActive);
    return () => {
      setBusyActivity('mic', false);
    };
  }, [voiceStatus, isRecordingClip, transcribing, setBusyActivity]);

  return (
    <section
      id="ai-studio"
      aria-label={t('aiStudioTitle')}
      className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 pb-10"
    >
      <div className="rounded-xl border border-[#27272A] bg-[#111114] overflow-hidden">
        {/* Header & Tab Strip */}
        <div className="border-b border-[#27272A] px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-[#E5A93B]">
              {t('aiStudioEyebrow')}
            </p>
            <h2 className="font-display text-xl font-bold text-[#FAFAFA] flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#E5A93B]" aria-hidden="true" />
              <span>{t('aiStudioTitle')}</span>
            </h2>
            <p className="text-xs text-[#A1A1AA] mt-0.5">{t('aiStudioSubtitle')}</p>
          </div>

          <div
            role="tablist"
            aria-label={t('aiStudioTitle')}
            className="inline-flex rounded-lg border border-[#27272A] bg-[#09090B] p-1 gap-1 self-start md:self-auto"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'chat'}
              onClick={() => setActiveTab('chat')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                activeTab === 'chat'
                  ? 'bg-[#E5A93B] text-[#09090B] font-semibold'
                  : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
              }`}
            >
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('aiTabSearchChat')}</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'voice'}
              onClick={() => setActiveTab('voice')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                activeTab === 'voice'
                  ? 'bg-[#E5A93B] text-[#09090B] font-semibold'
                  : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
              }`}
            >
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('aiTabVoice')}</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'transcribe'}
              onClick={() => setActiveTab('transcribe')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                activeTab === 'transcribe'
                  ? 'bg-[#E5A93B] text-[#09090B] font-semibold'
                  : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
              }`}
            >
              <FileAudio className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('aiTabTranscribe')}</span>
            </button>
          </div>
        </div>

        {/* Panel 1: Gemini Search Grounded Chat Bot */}
        {activeTab === 'chat' && (
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {[
                'Best Sci-Fi films releasing in 2026',
                'Who won Best Picture at the latest Oscars?',
                'Top 3 chess openings for aggressive black counterplay',
              ].map((presetQ) => (
                <button
                  key={presetQ}
                  type="button"
                  onClick={() => void sendSearchChat(presetQ)}
                  className="rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-1.5 text-xs text-[#D4D4D8] hover:border-[#E5A93B]/60 hover:text-[#FAFAFA] transition-colors cursor-pointer"
                >
                  <Search className="inline h-3 w-3 text-[#E5A93B] mr-1.5" aria-hidden="true" />
                  {presetQ}
                </button>
              ))}
            </div>

            <div
              ref={chatFeedRef}
              className="h-80 overflow-y-auto rounded-xl border border-[#27272A] bg-[#09090B] p-4 space-y-4"
            >
              {chatHistory.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex flex-col ${
                    entry.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      entry.role === 'user'
                        ? 'bg-[#E5A93B] text-[#09090B] font-medium'
                        : 'border border-[#27272A] bg-[#141418] text-[#E4E4E7]'
                    }`}
                  >
                    {entry.text}
                  </div>

                  {entry.sources && entry.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 max-w-[85%]">
                      {entry.sources.slice(0, 5).map((src) => (
                        <a
                          key={src.uri}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-[#27272A] bg-[#18181B] px-2.5 py-1 text-[11px] text-[#E5A93B] hover:border-[#E5A93B]/60 transition-colors"
                        >
                          <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="max-w-[200px] truncate">{src.title}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {chatLoading && (
                <div className="text-xs text-[#A1A1AA] font-mono">
                  Searching Google & generating response...
                </div>
              )}
            </div>

            {chatError && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200"
              >
                {chatError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendSearchChat(chatInput);
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask anything — grounded with live Google Search data..."
                className="flex-1 rounded-lg border border-[#27272A] bg-[#09090B] px-3.5 py-2.5 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#E5A93B] px-4 py-2.5 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-40 whitespace-nowrap cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Ask AI</span>
              </button>
            </form>
          </div>
        )}

        {/* Panel 2: Real-Time Voice Conversation */}
        {activeTab === 'voice' && (
          <div className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-[#27272A] bg-[#09090B] p-4">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border ${
                    voiceStatus === 'live'
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                      : 'border-[#27272A] bg-[#18181B] text-[#E5A93B]'
                  }`}
                >
                  <Volume2 className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#FAFAFA]">
                    Real-Time Cinema Voice Assistant
                  </p>
                  <p className="text-xs text-[#A1A1AA]">
                    {voiceStatus === 'live'
                      ? `Live duplex audio active (${selectedVoice} · 16kHz in / 24kHz out)`
                      : voiceStatus === 'connecting'
                      ? 'Connecting microphone and live audio session...'
                      : 'Start a low-latency spoken conversation directly from your microphone.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <select
                  value={selectedVoice}
                  disabled={voiceStatus === 'live' || voiceStatus === 'connecting'}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  aria-label="Assistant voice"
                  className="rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-xs text-[#FAFAFA] disabled:opacity-50"
                >
                  {LIVE_VOICES.map((v) => (
                    <option key={v} value={v}>
                      Voice: {v}
                    </option>
                  ))}
                </select>

                {voiceStatus === 'live' || voiceStatus === 'connecting' ? (
                  <button
                    type="button"
                    onClick={() => stopVoiceSession(false)}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 whitespace-nowrap cursor-pointer"
                  >
                    <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>End Call</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startVoiceSession()}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#E5A93B] px-4 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] whitespace-nowrap cursor-pointer"
                  >
                    <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Start Voice Chat</span>
                  </button>
                )}
              </div>
            </div>

            {voiceError && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200"
              >
                {voiceError}
              </div>
            )}

            <div className="h-64 overflow-y-auto rounded-xl border border-[#27272A] bg-[#09090B] p-4 space-y-3">
              {voiceLog.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-[#71717A] text-center">
                  Press Start Voice Chat and speak naturally — live transcripts of both speakers appear here.
                </div>
              ) : (
                voiceLog.map((item) => (
                  <div
                    key={item.id}
                    className={`flex flex-col ${
                      item.speaker === 'you' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <span className="text-[10px] font-mono uppercase text-[#71717A] mb-1">
                      {item.speaker === 'you' ? 'You' : selectedVoice}
                    </span>
                    <div
                      className={`max-w-[82%] rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                        item.speaker === 'you'
                          ? 'bg-[#E5A93B] text-[#09090B] font-medium'
                          : 'border border-[#27272A] bg-[#141418] text-[#E4E4E7]'
                      }`}
                    >
                      {item.text}
                    </div>
                  </div>
                ))
              )}
            </div>

            {voiceStatus === 'live' && (
              <form onSubmit={handleSendVoiceText} className="flex items-center gap-2">
                <input
                  type="text"
                  value={voiceTextDraft}
                  onChange={(e) => setVoiceTextDraft(e.target.value)}
                  placeholder="Or type a message into the active voice session..."
                  className="flex-1 rounded-lg border border-[#27272A] bg-[#09090B] px-3.5 py-2 text-xs text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!voiceTextDraft.trim()}
                  className="rounded-lg border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs font-medium text-[#FAFAFA] hover:border-[#E5A93B] disabled:opacity-40 cursor-pointer"
                >
                  Send Text
                </button>
              </form>
            )}
          </div>
        )}

        {/* Panel 3: Audio Transcription (gemini-3.5-transcribe) */}
        {activeTab === 'transcribe' && (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 space-y-4">
              <div className="rounded-xl border border-[#27272A] bg-[#09090B] p-4 space-y-3">
                <p className="text-sm font-semibold text-[#FAFAFA]">
                  Record or Upload Audio
                </p>
                <p className="text-xs text-[#A1A1AA]">
                  Record a voice note from your microphone or select an MP3, WAV, M4A, OGG, or WEBM file for accurate AI transcription.
                </p>

                <div className="flex flex-wrap items-center gap-2.5">
                  {isRecordingClip ? (
                    <button
                      type="button"
                      onClick={handleStopClipRecording}
                      className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-500 cursor-pointer"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      <span>Stop & Transcribe</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={transcribing}
                      onClick={() => void handleStartClipRecording()}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#E5A93B] px-3.5 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-50 cursor-pointer"
                    >
                      <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Record Clip</span>
                    </button>
                  )}

                  <label className="inline-flex items-center gap-2 rounded-lg border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs font-medium text-[#FAFAFA] hover:border-[#3F3F46] cursor-pointer">
                    <Upload className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                    <span>Choose Audio File</span>
                    <input
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setSelectedAudioFile(file);
                          void transcribeFileOrBlob(file, file.name);
                        }
                      }}
                    />
                  </label>
                </div>

                {selectedAudioFile && (
                  <div className="rounded-lg border border-[#27272A] bg-[#141418] px-3 py-2 text-xs flex items-center justify-between gap-2">
                    <span className="truncate text-[#D4D4D8]">{selectedAudioFile.name}</span>
                    <button
                      type="button"
                      disabled={transcribing}
                      onClick={() => void transcribeFileOrBlob(selectedAudioFile, selectedAudioFile.name)}
                      className="text-[#E5A93B] font-medium hover:underline shrink-0 cursor-pointer"
                    >
                      {transcribing ? 'Transcribing...' : 'Re-run'}
                    </button>
                  </div>
                )}

                {transcribeError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200"
                  >
                    {transcribeError}
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-7 flex flex-col rounded-xl border border-[#27272A] bg-[#09090B] p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <p className="text-sm font-semibold text-[#FAFAFA]">Transcript Output</p>
                <div className="flex items-center gap-2">
                  {transcript && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('chat');
                          void sendSearchChat(`Summarize or analyze this transcript:\n\n${transcript}`);
                        }}
                        className="rounded-md border border-[#27272A] bg-[#18181B] px-2.5 py-1 text-[11px] font-medium text-[#E5A93B] hover:border-[#E5A93B]/60 cursor-pointer"
                      >
                        Ask Search AI
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopyTranscript()}
                        className="inline-flex items-center gap-1 rounded-md border border-[#27272A] bg-[#18181B] px-2.5 py-1 text-[11px] font-medium text-[#D4D4D8] hover:text-[#FAFAFA] cursor-pointer"
                      >
                        {copiedTranscript ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" aria-hidden="true" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="flex-1 min-h-[190px] rounded-lg border border-[#27272A]/80 bg-[#111114] p-3.5 text-sm text-[#E4E4E7] leading-relaxed whitespace-pre-wrap overflow-y-auto">
                {transcribing
                  ? 'Transcribing audio with Gemini...'
                  : transcript || 'Your transcribed text will appear here once an audio file or recording is processed.'}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

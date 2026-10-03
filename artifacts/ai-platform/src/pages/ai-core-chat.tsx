import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import {
  Activity,
  Bot,
  CheckCircle2,
  Cloud,
  Cpu,
  Download,
  ExternalLink,
  Loader2,
  MessageSquareText,
  Mic,
  MicOff,
  ImagePlus,
  AudioLines,
  X,
  Send,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Volume2,
  VolumeX,
  Trash2,
  User,
  Zap,
} from "lucide-react";
import { apiEventStream, apiFetch } from "@/lib/apiFetch";
import {
  PWA_APP_INSTALLED_EVENT,
  PWA_INSTALL_PROMPT_READY_EVENT,
  clearDeferredPwaInstallPrompt,
  getDeferredPwaInstallPrompt,
  type BeforeInstallPromptEvent,
} from "@/lib/pwaInstall";

type ChatMode = "auto" | "ask" | "agent";
type ModelPolicy = "economy" | "smart" | "auto" | "cloud";
type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  error?: boolean;
  image?: { name: string; dataUrl: string };
  meta?: {
    route?: string | null;
    provider?: string | null;
    model?: string | null;
    usage?: TokenUsage | null;
    workload?: string | null;
    costClass?: string | null;
    estimatedCostUsd?: number | null;
    taskNumber?: string;
    workspaceUrl?: string;
  };
};

type ChatResponse = {
  kind: string;
  reply: string;
  route?: string | null;
  provider?: string | null;
  model?: string | null;
  usage?: TokenUsage | null;
  workload?: string | null;
  costClass?: string | null;
  estimatedCostUsd?: number | null;
  taskId?: string;
  taskNumber?: string;
  status?: string;
  workspaceUrl?: string;
  warning?: string;
};

type CoreConfig = {
  local: { ready: boolean; provider?: string; model?: string; error?: string };
  autonomous: { configured: boolean; running: boolean; pollIntervalMs: number };
  codingModel: Record<string, unknown>;
  streaming?: { enabled: boolean; endpoint?: string; defaultPolicy?: string };
  voice?: { enabled: boolean };
};


type TaskProgress = {
  task: {
    id: string;
    taskNumber: string;
    projectName: string;
    repository: string;
    branch: string;
    status: string;
    resultSummary: string | null;
  };
  autonomous: {
    status?: string;
    last_action?: string | null;
    last_error?: string | null;
    cycle_count?: number;
    max_cycles?: number;
  } | null;
  latestRun: {
    agentName: string;
    status: string;
    errorMessage: string | null;
  } | null;
  workspaceUrl: string;
};

const STORAGE_KEY = "ai_core_chat_history_v1";
const CONVERSATION_KEY = "ai_core_conversation_id_v1";
const VOICE_PRESET_KEY = "ai_core_voice_preset_v1";
const VOICE_TRANSPORT_MODE_KEY = "ai_core_voice_transport_mode_v1";
const CLONED_VOICE_ID_KEY = "ai_core_cloned_voice_id_v1";
const MAX_MESSAGES = 80;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VOICE_SAMPLE_BYTES = 6 * 1024 * 1024;
const VOICE_SILENCE_MS = 1_600;
const VOICE_RESTART_DELAY_MS = 120;
const STREAM_SPEECH_SOFT_LIMIT = 120;
const VOICE_CLONE_READING_SCRIPT =
  "Halo, ini adalah sampel suara saya untuk AI Core. Saya berbicara dengan suara normal, jelas, dan santai. AI Core membantu saya memeriksa pekerjaan, memahami informasi, dan menjalankan berbagai tugas. Kadang saya berbicara cepat, kadang lebih pelan, dan terkadang menggunakan istilah dalam bahasa Inggris. Tolong periksa pekerjaan yang sedang berjalan, lihat apakah ada masalah, dan beri tahu saya hasil akhirnya. Jika ada sesuatu yang belum jelas, tanyakan kembali kepada saya sebelum melanjutkan. Terima kasih.";

type VoiceTransportMode = "auto" | "standard" | "realtime";

type VoicePreset =
  | "auto"
  | "male_natural"
  | "male_deep"
  | "male_casual"
  | "male_professional"
  | "female_natural"
  | "female_soft"
  | "female_firm"
  | "female_cheerful"
  | "cloned";

const VOICE_PRESET_OPTIONS: Array<{ value: VoicePreset; label: string }> = [
  { value: "auto", label: "Otomatis" },
  { value: "male_natural", label: "Pria Natural" },
  { value: "male_deep", label: "Pria Berat" },
  { value: "male_casual", label: "Pria Santai" },
  { value: "male_professional", label: "Pria Profesional" },
  { value: "female_natural", label: "Wanita Natural" },
  { value: "female_soft", label: "Wanita Lembut" },
  { value: "female_firm", label: "Wanita Tegas" },
  { value: "female_cheerful", label: "Wanita Ceria" },
];
type PendingImage = {
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  dataUrl: string;
};

type BrowserSpeechRecognitionEvent = Event & {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
};

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function getConversationId(): string {
  try {
    const existing = localStorage.getItem(CONVERSATION_KEY);
    if (existing) return existing;
    const created = messageId();
    localStorage.setItem(CONVERSATION_KEY, created);
    return created;
  } catch {
    return messageId();
  }
}

function speechRecognitionConstructor(): (new () => BrowserSpeechRecognition) | null {
  const candidate = window as typeof window & {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

function messageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatMessage[]).slice(-MAX_MESSAGES) : [];
  } catch {
    return [];
  }
}

function loadVoiceTransportMode(): VoiceTransportMode {
  try {
    const stored = localStorage.getItem(VOICE_TRANSPORT_MODE_KEY);
    return stored === "standard" || stored === "realtime" || stored === "auto"
      ? stored
      : "auto";
  } catch {
    return "auto";
  }
}

function loadVoicePreset(): VoicePreset {
  try {
    const stored = localStorage.getItem(VOICE_PRESET_KEY);
    if (stored === "male") return "male_natural";
    if (stored === "female") return "female_natural";
    return stored === "male_natural" ||
      stored === "male_deep" ||
      stored === "male_casual" ||
      stored === "male_professional" ||
      stored === "female_natural" ||
      stored === "female_soft" ||
      stored === "female_firm" ||
      stored === "female_cheerful" ||
      stored === "cloned" ||
      stored === "auto"
      ? stored
      : "auto";
  } catch {
    return "auto";
  }
}

function loadClonedVoiceId(): string {
  try {
    return localStorage.getItem(CLONED_VOICE_ID_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file."));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Format file tidak didukung."));
    reader.readAsDataURL(file);
  });
}

function requestFailureText(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/failed query:|ai_platform/i.test(detail)) {
    return "Permintaan gagal: Database AI Core sementara sibuk atau tidak tersedia. Silakan coba lagi sebentar lagi.";
  }
  return "Permintaan gagal: " + detail.slice(0, 500);
}

function routeLabel(route?: string | null): string {
  if (route === "STREAMING") return "Streaming…";
  if (route === "NO_LLM") return "0 token";
  if (route === "DATA_TOOL") return "Data Tool · 0 token";
  if (route === "ADMIN_DB_QUERY") return "Admin DB · read-only";
  if (route === "LOCAL") return "Local AI";
  if (route === "CLOUD") return "Cloud";
  if (route === "CLOUD_FALLBACK") return "Cloud fallback";
  if (route === "CONTROL_PLANE") return "Control plane";
  if (route === "REMOTE_OLLAMA_POWERSHELL") return "Read-only worker";
  return route || "AI Core";
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-block size-2 rounded-full"
      style={{
        background: ok ? "#10B981" : "#F59E0B",
        boxShadow: ok ? "0 0 8px rgba(16,185,129,.55)" : "0 0 8px rgba(245,158,11,.45)",
      }}
    />
  );
}

export default function AiCoreChat() {
  const [mode] = useState<ChatMode>("auto");
  const [policy, setPolicy] = useState<ModelPolicy>("smart");
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<CoreConfig | null>(null);
  const [projectName, setProjectName] = useState("Core AI Foundation");
  const [repository, setRepository] = useState("Travelintrips/Core-AI-Foundation");
  const [branch, setBranch] = useState("main");
  const [priority, setPriority] = useState(50);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [progressError, setProgressError] = useState("");
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [conversationId] = useState(() => getConversationId());
  const [voiceSupported] = useState(() => Boolean(speechRecognitionConstructor()));
  const [listening, setListening] = useState(false);
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState(true);
  const [voiceError, setVoiceError] = useState("");
  const [voiceTransportMode, setVoiceTransportMode] = useState<VoiceTransportMode>(() => loadVoiceTransportMode());
  const [voicePreset, setVoicePreset] = useState<VoicePreset>(() => loadVoicePreset());
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [clonedVoiceId, setClonedVoiceId] = useState(() => loadClonedVoiceId());
  const [voiceCloneBusy, setVoiceCloneBusy] = useState(false);
  const [voiceCloneStatus, setVoiceCloneStatus] = useState("");
  const [voiceCloneConsent, setVoiceCloneConsent] = useState(false);
  const [showVoiceCloneGuide, setShowVoiceCloneGuide] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const voiceSampleInputRef = useRef<HTMLInputElement | null>(null);
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(false);
  const [lastInputSource, setLastInputSource] = useState<"text" | "voice">("text");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const handsFreeRef = useRef(false);
  const busyRef = useRef(false);
  const listeningRef = useRef(false);
  const voiceTranscriptRef = useRef("");
  const voiceSilenceTimerRef = useRef<number | null>(null);
  const recognitionRestartTimerRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamInterruptedRef = useRef(false);
  const streamedSpeechBufferRef = useRef("");
  const speechQueueRef = useRef<string[]>([]);
  const speechQueueActiveRef = useRef(false);
  const resumeListeningAfterSpeechRef = useRef(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(() => getDeferredPwaInstallPrompt());
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    new URLSearchParams(window.location.search).get("standalone") === "1";
  const voiceFeatureEnabled = config?.voice?.enabled === true;
  const realtimeVoiceAvailable = false;
  const effectiveVoiceTransportMode: Exclude<VoiceTransportMode, "auto"> =
    voiceTransportMode === "auto"
      ? realtimeVoiceAvailable
        ? "realtime"
        : "standard"
      : voiceTransportMode;
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void apiFetch<CoreConfig>("/api/ai/core-chat/config")
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    const syncInstallPrompt = () => {
      setInstallPrompt(getDeferredPwaInstallPrompt());
    };

    syncInstallPrompt();
    window.addEventListener(PWA_INSTALL_PROMPT_READY_EVENT, syncInstallPrompt);
    window.addEventListener(PWA_APP_INSTALLED_EVENT, syncInstallPrompt);
    return () => {
      window.removeEventListener(PWA_INSTALL_PROMPT_READY_EVENT, syncInstallPrompt);
      window.removeEventListener(PWA_APP_INSTALLED_EVENT, syncInstallPrompt);
    };
  }, []);

  useEffect(() => {
    try {
      const persisted = messages.slice(-MAX_MESSAGES).map(({ image: _image, ...message }) => message);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // Chat still works when browser storage is unavailable.
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_TRANSPORT_MODE_KEY, voiceTransportMode);
    } catch {
      // Voice transport preference remains usable for the current session.
    }
  }, [voiceTransportMode]);

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_PRESET_KEY, voicePreset);
    } catch {
      // Voice preference remains usable for the current session.
    }
  }, [voicePreset]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const syncVoices = () => setAvailableVoices(window.speechSynthesis.getVoices());
    syncVoices();
    window.speechSynthesis.addEventListener("voiceschanged", syncVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", syncVoices);
  }, []);

  useEffect(() => {
    return () => {
      handsFreeRef.current = false;
      if (voiceSilenceTimerRef.current !== null) {
        window.clearTimeout(voiceSilenceTimerRef.current);
      }
      if (recognitionRestartTimerRef.current !== null) {
        window.clearTimeout(recognitionRestartTimerRef.current);
      }
      streamAbortRef.current?.abort();
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (!activeTaskId) return;
    let cancelled = false;
    const read = async () => {
      try {
        const value = await apiFetch<TaskProgress>(
          "/api/ai/core-chat/tasks/" + activeTaskId + "/progress",
        );
        if (!cancelled) {
          setProgress(value);
          setProgressError("");
        }
      } catch (error) {
        if (!cancelled) {
          setProgressError(error instanceof Error ? error.message : String(error));
        }
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeTaskId]);

  const totalTokens = useMemo(
    () => messages.reduce((sum, item) => sum + (item.meta?.usage?.totalTokens ?? 0), 0),
    [messages],
  );
  const totalEstimatedCostUsd = useMemo(
    () =>
      messages.reduce(
        (sum, item) => sum + (item.meta?.estimatedCostUsd ?? 0),
        0,
      ),
    [messages],
  );

  function selectedVoice(preset: VoicePreset = voicePreset): SpeechSynthesisVoice | null {
    const indonesianVoices = availableVoices.filter((voice) =>
      voice.lang.toLowerCase().startsWith("id"),
    );
    const candidates = indonesianVoices.length ? indonesianVoices : availableVoices;
    if (!candidates.length) return null;
    if (preset === "auto" || preset === "cloned") return candidates[0] ?? null;

    const femalePattern = /female|woman|wanita|perempuan|siti|ayu|damayanti|wavenet[-_ ]?[acde]|neural2[-_ ]?[acde]/i;
    const malePattern = /male|man|pria|laki|adi|budi|wavenet[-_ ]?[bf]|neural2[-_ ]?[bf]/i;
    const isFemale = preset.startsWith("female_");
    const pattern = isFemale ? femalePattern : malePattern;
    const matching = candidates.filter((voice) => pattern.test(voice.name));
    const pool = matching.length ? matching : candidates;
    const variantIndex =
      preset === "male_deep" || preset === "female_soft" ? 0 :
      preset === "male_casual" || preset === "female_cheerful" ? 1 :
      preset === "male_professional" || preset === "female_firm" ? 2 :
      0;
    return pool[variantIndex % pool.length] ?? pool[0] ?? null;
  }

  function voiceTuning(preset: VoicePreset): { rate: number; pitch: number } {
    switch (preset) {
      case "male_natural":
        return { rate: 1, pitch: 0.9 };
      case "male_deep":
        return { rate: 0.9, pitch: 0.72 };
      case "male_casual":
        return { rate: 1.06, pitch: 0.94 };
      case "male_professional":
        return { rate: 0.96, pitch: 0.84 };
      case "female_natural":
        return { rate: 1, pitch: 1.08 };
      case "female_soft":
        return { rate: 0.9, pitch: 1.14 };
      case "female_firm":
        return { rate: 1.06, pitch: 1.02 };
      case "female_cheerful":
        return { rate: 1.1, pitch: 1.2 };
      default:
        return { rate: 1, pitch: 1 };
    }
  }

  function clearVoiceSilenceTimer() {
    if (voiceSilenceTimerRef.current !== null) {
      window.clearTimeout(voiceSilenceTimerRef.current);
      voiceSilenceTimerRef.current = null;
    }
  }

  function clearRecognitionRestartTimer() {
    if (recognitionRestartTimerRef.current !== null) {
      window.clearTimeout(recognitionRestartTimerRef.current);
      recognitionRestartTimerRef.current = null;
    }
  }

  function cancelQueuedVoiceOutput() {
    streamedSpeechBufferRef.current = "";
    speechQueueRef.current = [];
    resumeListeningAfterSpeechRef.current = false;
    speechQueueActiveRef.current = false;
    window.speechSynthesis?.cancel();
  }

  function maybeResumeHandsFreeListening() {
    if (
      !resumeListeningAfterSpeechRef.current ||
      !handsFreeRef.current ||
      busyRef.current ||
      speechQueueActiveRef.current ||
      speechQueueRef.current.length > 0
    ) {
      return;
    }
    resumeListeningAfterSpeechRef.current = false;
    window.setTimeout(() => startListening(), 250);
  }

  function pumpSpeechQueue() {
    if (
      speechQueueActiveRef.current ||
      speechQueueRef.current.length === 0 ||
      !voiceFeatureEnabled ||
      !voiceReplyEnabled ||
      voicePreset === "cloned" ||
      !("speechSynthesis" in window)
    ) {
      maybeResumeHandsFreeListening();
      return;
    }

    const text = speechQueueRef.current.shift()?.trim();
    if (!text) {
      pumpSpeechQueue();
      return;
    }

    speechQueueActiveRef.current = true;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "id-ID";
    const tuning = voiceTuning(voicePreset);
    utterance.rate = tuning.rate;
    utterance.pitch = tuning.pitch;
    const voice = selectedVoice(voicePreset);
    if (voice) utterance.voice = voice;

    const done = () => {
      speechQueueActiveRef.current = false;
      if (speechQueueRef.current.length > 0) {
        pumpSpeechQueue();
      } else {
        maybeResumeHandsFreeListening();
      }
    };
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  }

  function takeStreamSpeechChunk(force: boolean): string | null {
    const buffer = streamedSpeechBufferRef.current.trimStart();
    if (!buffer) {
      streamedSpeechBufferRef.current = "";
      return null;
    }

    let cut = -1;
    const sentence = buffer.match(/[.!?…](?:\s|$)/);
    if (sentence && typeof sentence.index === "number" && sentence.index >= 18) {
      cut = sentence.index + 1;
    } else if (!force && buffer.length >= STREAM_SPEECH_SOFT_LIMIT) {
      const preferred = buffer.slice(0, STREAM_SPEECH_SOFT_LIMIT + 1);
      cut = Math.max(
        preferred.lastIndexOf(", "),
        preferred.lastIndexOf("; "),
        preferred.lastIndexOf(" "),
      );
      if (cut < 48) cut = STREAM_SPEECH_SOFT_LIMIT;
    } else if (force) {
      cut = buffer.length;
    }

    if (cut <= 0) return null;
    const chunk = buffer.slice(0, cut).trim();
    streamedSpeechBufferRef.current = buffer.slice(cut).trimStart();
    return chunk || null;
  }

  function queueStreamSpeechDelta(delta: string) {
    if (
      !delta ||
      !voiceReplyEnabled ||
      voicePreset === "cloned" ||
      !handsFreeRef.current
    ) {
      return;
    }
    streamedSpeechBufferRef.current += delta;
    while (true) {
      const chunk = takeStreamSpeechChunk(false);
      if (!chunk) break;
      speechQueueRef.current.push(chunk);
    }
    pumpSpeechQueue();
  }

  function flushStreamSpeech() {
    if (!voiceReplyEnabled || voicePreset === "cloned") {
      streamedSpeechBufferRef.current = "";
      return;
    }
    const chunk = takeStreamSpeechChunk(true);
    if (chunk) speechQueueRef.current.push(chunk);
    pumpSpeechQueue();
  }

  function finalizeVoiceTurn() {
    clearVoiceSilenceTimer();
    const transcript = voiceTranscriptRef.current.trim();
    if (!handsFreeRef.current || !transcript || busyRef.current) return;

    voiceTranscriptRef.current = "";
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    listeningRef.current = false;
    setListening(false);
    void submit(undefined, transcript, "voice");
  }

  function scheduleVoiceTurnSubmit() {
    clearVoiceSilenceTimer();
    voiceSilenceTimerRef.current = window.setTimeout(
      finalizeVoiceTurn,
      VOICE_SILENCE_MS,
    );
  }

  function scheduleRecognitionRestart() {
    clearRecognitionRestartTimer();
    if (!handsFreeRef.current || busyRef.current) return;
    recognitionRestartTimerRef.current = window.setTimeout(() => {
      recognitionRestartTimerRef.current = null;
      if (handsFreeRef.current && !busyRef.current && !listeningRef.current) {
        startListening();
      }
    }, VOICE_RESTART_DELAY_MS);
  }

  function startListening() {
    if (
      !voiceFeatureEnabled ||
      !voiceSupported ||
      busyRef.current ||
      listeningRef.current ||
      !handsFreeRef.current
    ) {
      return;
    }
    const Constructor = speechRecognitionConstructor();
    if (!Constructor) return;

    clearRecognitionRestartTimer();
    const sessionBase = voiceTranscriptRef.current.trim();
    const recognition = new Constructor();
    recognition.lang = "id-ID";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let currentSessionTranscript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        currentSessionTranscript += event.results[index]?.[0]?.transcript ?? "";
      }
      const combined = [sessionBase, currentSessionTranscript.trim()]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (!combined) return;
      voiceTranscriptRef.current = combined;
      setInput(combined);
      setLastInputSource("voice");
      scheduleVoiceTurnSubmit();
    };
    recognition.onerror = (event) => {
      const errorCode = event.error || "unknown error";
      listeningRef.current = false;
      setListening(false);
      if (!["aborted", "no-speech"].includes(errorCode)) {
        setVoiceError("Microphone/STT gagal: " + errorCode);
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      listeningRef.current = false;
      setListening(false);
      scheduleRecognitionRestart();
    };
    recognitionRef.current = recognition;
    setVoiceError("");
    listeningRef.current = true;
    setListening(true);
    try {
      recognition.start();
    } catch (error) {
      recognitionRef.current = null;
      listeningRef.current = false;
      setListening(false);
      setVoiceError(
        "Microphone/STT gagal dimulai: " +
          (error instanceof Error ? error.message : String(error)),
      );
      scheduleRecognitionRestart();
    }
  }

  function interruptVoiceReply() {
    streamInterruptedRef.current = true;
    streamAbortRef.current?.abort();
    cancelQueuedVoiceOutput();
    busyRef.current = false;
    setBusy(false);
    clearVoiceSilenceTimer();
    voiceTranscriptRef.current = "";
    window.setTimeout(() => startListening(), 80);
  }

  function stopVoiceSession() {
    handsFreeRef.current = false;
    setHandsFreeEnabled(false);
    clearVoiceSilenceTimer();
    clearRecognitionRestartTimer();
    voiceTranscriptRef.current = "";
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    listeningRef.current = false;
    cancelQueuedVoiceOutput();
    setListening(false);
  }

  function selectVoiceTransportMode(nextMode: VoiceTransportMode) {
    if (nextMode === voiceTransportMode) return;
    if (handsFreeRef.current) stopVoiceSession();
    setVoiceTransportMode(nextMode);
    if (nextMode === "realtime" && !realtimeVoiceAvailable) {
      setVoiceError("Realtime full-duplex belum dikonfigurasi. Gunakan Auto atau Standard.");
    } else {
      setVoiceError("");
    }
  }

  function toggleListening() {
    if (!voiceFeatureEnabled) {
      setVoiceError("Voice sementara dinonaktifkan.");
      return;
    }
    if (!voiceSupported) {
      setVoiceError("Speech recognition belum didukung browser ini.");
      return;
    }
    if (effectiveVoiceTransportMode === "realtime" && !realtimeVoiceAvailable) {
      setVoiceError("Realtime full-duplex belum dikonfigurasi. Pilih Auto atau Standard.");
      return;
    }
    if (handsFreeRef.current) {
      if (busyRef.current || speechQueueActiveRef.current || window.speechSynthesis?.speaking) {
        interruptVoiceReply();
        return;
      }
      stopVoiceSession();
      return;
    }
    handsFreeRef.current = true;
    setHandsFreeEnabled(true);
    voiceTranscriptRef.current = "";
    startListening();
  }

  function speakReply(text: string, onFinished?: () => void) {
    const done = () => {
      if (onFinished) onFinished();
    };
    if (!voiceFeatureEnabled || !voiceReplyEnabled || !text.trim()) {
      done();
      return;
    }

    if (voicePreset === "cloned" && clonedVoiceId) {
      void apiFetch<{ audioBase64: string; mimeType: string }>("/api/ai/core-chat/voice-clone/speak", {
        method: "POST",
        body: JSON.stringify({ voiceId: clonedVoiceId, text: text.slice(0, 1_200) }),
      })
        .then((result) => {
          const audio = new Audio(`data:${result.mimeType};base64,${result.audioBase64}`);
          audio.onended = done;
          audio.onerror = done;
          return audio.play();
        })
        .catch((error) => {
          setVoiceError("Voice clone gagal diputar: " + (error instanceof Error ? error.message : String(error)));
          done();
        });
      return;
    }

    if (!("speechSynthesis" in window)) {
      done();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 1_200));
    utterance.lang = "id-ID";
    const tuning = voiceTuning(voicePreset);
    utterance.rate = tuning.rate;
    utterance.pitch = tuning.pitch;
    const voice = selectedVoice(voicePreset);
    if (voice) utterance.voice = voice;
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  }

  async function chooseImage(file: File | null) {
    if (!file) return;
    setAttachmentError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAttachmentError("Gambar harus JPG, PNG, atau WebP.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAttachmentError("Ukuran gambar maksimal 5 MB.");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      const base64 = dataUrl.split(",", 2)[1] || "";
      setPendingImage({
        name: file.name || "gambar",
        mimeType: file.type as PendingImage["mimeType"],
        base64,
        dataUrl,
      });
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : String(error));
    }
  }

  async function enrollVoiceClone(file: File | null) {
    if (!voiceFeatureEnabled) {
      setVoiceCloneStatus("Voice sementara dinonaktifkan.");
      return;
    }
    if (!file) return;
    setVoiceCloneStatus("");
    if (!file.type.startsWith("audio/")) {
      setVoiceCloneStatus("Sampel harus berupa file audio.");
      return;
    }
    if (file.size > MAX_VOICE_SAMPLE_BYTES) {
      setVoiceCloneStatus("Sampel suara maksimal 6 MB.");
      return;
    }
    setVoiceCloneBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const base64 = dataUrl.split(",", 2)[1] || "";
      const result = await apiFetch<{ voiceId: string; requiresVerification?: boolean }>("/api/ai/core-chat/voice-clone/enroll", {
        method: "POST",
        body: JSON.stringify({
          name: "AI Core - Suara Saya",
          mimeType: file.type,
          audioBase64: base64,
          consent: voiceCloneConsent,
        }),
      });
      setClonedVoiceId(result.voiceId);
      setVoicePreset("cloned");
      try {
        localStorage.setItem(CLONED_VOICE_ID_KEY, result.voiceId);
      } catch {
        // Current session still has access to the enrolled voice.
      }
      setVoiceCloneStatus(
        result.requiresVerification
          ? "Sampel diterima. Provider meminta verifikasi tambahan sebelum suara dapat digunakan."
          : "Suara Saya sudah terdaftar dan dipilih."
      );
    } catch (error) {
      setVoiceCloneStatus(
        "Voice clone belum dapat diaktifkan: " +
          (error instanceof Error ? error.message : String(error))
      );
    } finally {
      setVoiceCloneBusy(false);
    }
  }

  function append(item: ChatMessage) {
    setMessages((current) => [...current, item].slice(-MAX_MESSAGES));
  }

  function updateMessage(
    id: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? updater(message) : message)),
    );
  }

  async function submit(
    event?: FormEvent,
    overrideText?: string,
    overrideSource?: "text" | "voice",
  ) {
    event?.preventDefault();
    const text = (overrideText ?? input).trim();
    const image = pendingImage;
    if ((!text && !image) || busyRef.current) return;
    const submittedText = text || "Analisis gambar ini.";
    const inputSource = overrideSource ?? lastInputSource;

    const context = messages
      .filter((message) => !message.error && message.text.trim())
      .slice(-10)
      .map((message) => ({
        role: message.role,
        text: message.text.slice(-4_000),
      }));

    if (mode === "agent" && (!projectName.trim() || !repository.trim() || !branch.trim())) {
      append({
        id: messageId(),
        role: "assistant",
        text: "Agent Mode membutuhkan Project, Repository, dan Branch.",
        createdAt: new Date().toISOString(),
        error: true,
      });
      return;
    }

    append({
      id: messageId(),
      role: "user",
      text: submittedText,
      createdAt: new Date().toISOString(),
      ...(image ? { image: { name: image.name, dataUrl: image.dataUrl } } : {}),
    });
    setInput("");
    setPendingImage(null);
    setLastInputSource("text");
    busyRef.current = true;
    setBusy(true);

    if (mode === "ask" || mode === "auto") {
      const assistantId = messageId();
      append({
        id: assistantId,
        role: "assistant",
        text: "",
        createdAt: new Date().toISOString(),
        meta: { route: "STREAMING" },
      });
      setStreamingMessageId(assistantId);

      let completeStreamReply = "";
      const streamController = new AbortController();
      streamAbortRef.current = streamController;
      streamInterruptedRef.current = false;
      streamedSpeechBufferRef.current = "";
      speechQueueRef.current = [];
      resumeListeningAfterSpeechRef.current = false;

      try {
        await apiEventStream(
          "/api/ai/core-chat/messages/stream",
          {
            method: "POST",
            signal: streamController.signal,
            body: JSON.stringify({
              message: submittedText,
              mode,
              modelPolicy: policy,
              conversationId,
              source: inputSource,
              context,
              ...(image ? { image: { mimeType: image.mimeType, base64: image.base64 } } : {}),
              projectName: projectName.trim(),
              repository: repository.trim(),
              branch: branch.trim(),
              priority,
            }),
          },
          ({ event: streamEvent, data }) => {
            const value =
              data && typeof data === "object" && !Array.isArray(data)
                ? (data as Record<string, unknown>)
                : {};

            if (streamEvent === "meta") {
              updateMessage(assistantId, (message) => ({
                ...message,
                meta: {
                  ...message.meta,
                  route:
                    typeof value.route === "string"
                      ? value.route
                      : message.meta?.route,
                  provider:
                    typeof value.provider === "string"
                      ? value.provider
                      : value.provider === null
                        ? null
                        : message.meta?.provider,
                  model:
                    typeof value.model === "string"
                      ? value.model
                      : value.model === null
                        ? null
                        : message.meta?.model,
                  workload:
                    typeof value.workload === "string"
                      ? value.workload
                      : message.meta?.workload,
                  costClass:
                    typeof value.costClass === "string"
                      ? value.costClass
                      : message.meta?.costClass,
                },
              }));
              return;
            }

            if (streamEvent === "delta" && typeof value.text === "string") {
              completeStreamReply += value.text;
              updateMessage(assistantId, (message) => ({
                ...message,
                text: message.text + value.text,
              }));
              if (inputSource === "voice") {
                queueStreamSpeechDelta(value.text);
              }
              return;
            }

            if (streamEvent === "error") {
              const warning =
                typeof value.warning === "string"
                  ? value.warning
                  : typeof value.message === "string"
                    ? value.message
                    : "Streaming terhenti.";
              updateMessage(assistantId, (message) => ({
                ...message,
                text:
                  message.text +
                  (message.text ? "\n\n" : "") +
                  "Catatan: " +
                  warning,
                error: !message.text,
              }));
              return;
            }

            if (streamEvent === "done") {
              const usage =
                value.usage &&
                typeof value.usage === "object" &&
                !Array.isArray(value.usage)
                  ? (value.usage as TokenUsage)
                  : null;
              const warning =
                typeof value.warning === "string" && value.warning
                  ? value.warning
                  : null;

              updateMessage(assistantId, (message) => ({
                ...message,
                text:
                  warning && !message.text.includes(warning)
                    ? message.text +
                      (message.text ? "\n\n" : "") +
                      "Catatan: " +
                      warning
                    : message.text,
                meta: {
                  ...message.meta,
                  usage,
                  estimatedCostUsd:
                    typeof value.estimatedCostUsd === "number"
                      ? value.estimatedCostUsd
                      : message.meta?.estimatedCostUsd ?? null,
                  ...(typeof value.taskNumber === "string"
                    ? { taskNumber: value.taskNumber }
                    : {}),
                  ...(typeof value.workspaceUrl === "string"
                    ? { workspaceUrl: value.workspaceUrl }
                    : {}),
                },
              }));

              if (typeof value.taskId === "string" && value.taskId) {
                setActiveTaskId(value.taskId);
                setProgress(null);
              }
            }
          },
        );
      } catch (error) {
        const interrupted =
          streamInterruptedRef.current ||
          (error instanceof DOMException && error.name === "AbortError");
        if (!interrupted) {
          updateMessage(assistantId, (message) => ({
            ...message,
            text: message.text || requestFailureText(error),
            error: !message.text,
          }));
        }
      } finally {
        const interrupted = streamInterruptedRef.current;
        streamAbortRef.current = null;
        setStreamingMessageId(null);
        busyRef.current = false;
        setBusy(false);

        if (inputSource === "voice" && handsFreeRef.current && !interrupted) {
          resumeListeningAfterSpeechRef.current = true;
          if (voicePreset === "cloned" && completeStreamReply.trim()) {
            speakReply(completeStreamReply, () => {
              resumeListeningAfterSpeechRef.current = false;
              if (handsFreeRef.current) window.setTimeout(() => startListening(), 250);
            });
          } else {
            flushStreamSpeech();
            maybeResumeHandsFreeListening();
          }
        }
        streamInterruptedRef.current = false;
      }
      return;
    }

    try {
      const response = await apiFetch<ChatResponse>("/api/ai/core-chat/messages", {
        method: "POST",
        body: JSON.stringify({
          message: submittedText,
          mode,
          modelPolicy: policy,
          conversationId,
          source: inputSource,
          context,
          ...(image ? { image: { mimeType: image.mimeType, base64: image.base64 } } : {}),
          projectName: projectName.trim(),
          repository: repository.trim(),
          branch: branch.trim(),
          priority,
        }),
      });

      const spokenReply = response.reply;
      append({
        id: messageId(),
        role: "assistant",
        text: spokenReply + (response.warning ? "\n\nCatatan: " + response.warning : ""),
        createdAt: new Date().toISOString(),
        meta: {
          route: response.route,
          provider: response.provider,
          model: response.model,
          usage: response.usage,
          workload: response.workload,
          costClass: response.costClass,
          estimatedCostUsd: response.estimatedCostUsd,
          ...(response.taskNumber ? { taskNumber: response.taskNumber } : {}),
          ...(response.workspaceUrl ? { workspaceUrl: response.workspaceUrl } : {}),
        },
      });

      speakReply(spokenReply, () => {
        if (handsFreeRef.current) {
          window.setTimeout(() => startListening(), 250);
        }
      });
      if (response.taskId) {
        setActiveTaskId(response.taskId);
        setProgress(null);
      }
    } catch (error) {
      append({
        id: messageId(),
        role: "assistant",
        text: requestFailureText(error),
        createdAt: new Date().toISOString(),
        error: true,
      });
      if (handsFreeRef.current) {
        window.setTimeout(() => startListening(), 500);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (inputSource === "voice" && handsFreeRef.current) {
        resumeListeningAfterSpeechRef.current = true;
        maybeResumeHandsFreeListening();
      }
    }
  }

  async function installShortcut() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    clearDeferredPwaInstallPrompt();
    setInstallPrompt(null);
  }

  function clearChat() {
    setMessages([]);
    setProgress(null);
    setActiveTaskId(null);
    setStreamingMessageId(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // no-op
    }
  }

  const localReady = config?.local.ready === true;
  const autonomousReady = config?.autonomous.running === true;

  return (
    <div className="min-h-full flex flex-col" style={{ background: "#060B18", color: "#F0F4FF" }}>
      <header
        className="px-6 py-4 flex flex-wrap items-center justify-between gap-4"
        style={{ borderBottom: "1px solid #1E3057", background: "#08101F" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="size-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#7C6EFA,#5F52D0)" }}
          >
            <MessageSquareText className="size-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-lg">AI Core Chat</h1>
              <span
                className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
                style={{ color: "#9D91FB", border: "1px solid #2A3970", background: "#101831" }}
              >
                Command Center
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "#6B82B0" }}>
              0 token → Smart routing → streaming Cloud/Local, critical approval tetap terkunci.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "#0A1327", border: "1px solid #1E3057" }}>
            <StatusDot ok={localReady} />
            <Cpu className="size-3.5" style={{ color: "#7C6EFA" }} />
            <span style={{ color: "#A7B5D1" }}>{localReady ? config?.local.model || "Local ready" : "Local unavailable"}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "#0A1327", border: "1px solid #1E3057" }}>
            <StatusDot ok={autonomousReady} />
            <Activity className="size-3.5" style={{ color: "#7C6EFA" }} />
            <span style={{ color: "#A7B5D1" }}>{autonomousReady ? "Autonomous on" : "Autonomous off"}</span>
          </div>
          <div className="px-3 py-2 rounded-lg font-mono" style={{ background: "#0A1327", border: "1px solid #1E3057", color: "#7F91B8" }}>
            {totalTokens.toLocaleString()} tokens
          </div>
          <div className="px-3 py-2 rounded-lg font-mono" style={{ background: "#0A1327", border: "1px solid #1E3057", color: "#7F91B8" }}>
            ${totalEstimatedCostUsd.toFixed(6)}
          </div>
          {installPrompt && !isStandalone && (
            <button
              onClick={() => void installShortcut()}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5"
              style={{ color: "#B8AEFF", border: "1px solid #313C78", background: "#171D3C" }}
              title="Pasang AI Core Chat sebagai shortcut aplikasi"
            >
              <Download className="size-3.5" />
              <span>Install App</span>
            </button>
          )}
          <button onClick={clearChat} className="p-2 rounded-lg hover:bg-white/5" style={{ color: "#6B82B0", border: "1px solid #1E3057" }} title="Hapus riwayat chat lokal">
            <Trash2 className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 grid min-h-0 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 flex flex-col">
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
            <div className="max-w-4xl mx-auto space-y-4">
              {messages.length === 0 && (
                <div className="py-12 text-center">
                  <div className="size-14 mx-auto rounded-2xl flex items-center justify-center mb-4" style={{ background: "#101831", border: "1px solid #263765" }}>
                    <Sparkles className="size-6" style={{ color: "#9D91FB" }} />
                  </div>
                  <h2 className="font-semibold text-base">Perintahkan AI Core dari sini</h2>
                  <p className="text-sm mt-2 max-w-xl mx-auto" style={{ color: "#7085AE" }}>
                    Satu chat untuk bertanya, memeriksa, dan memberi perintah. AI Core otomatis memilih jawaban, worker read-only, Coding Orchestrator, atau approval gate.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {["/status", "Cek booking SC-0992", "Berapa outstanding tenant sekarang?", "Kenapa build ini gagal?"].map((sample) => (
                      <button key={sample} onClick={() => setInput(sample)} className="text-xs px-3 py-2 rounded-lg" style={{ background: "#0A1327", border: "1px solid #1E3057", color: "#8DA1C8" }}>
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message) => (
                <div key={message.id} className={"flex gap-3 " + (message.role === "user" ? "justify-end" : "justify-start")}>
                  {message.role === "assistant" && (
                    <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-1" style={{ background: "#171F3F", border: "1px solid #2B3971" }}>
                      <Bot className="size-4" style={{ color: "#9D91FB" }} />
                    </div>
                  )}
                  <div className="max-w-[82%]">
                    <div
                      className="rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap"
                      style={
                        message.role === "user"
                          ? { background: "#675ADB", color: "white", borderBottomRightRadius: 5 }
                          : message.error
                            ? { background: "#27131B", color: "#FCA5A5", border: "1px solid #572233", borderBottomLeftRadius: 5 }
                            : { background: "#0C152A", color: "#DCE5F7", border: "1px solid #1E3057", borderBottomLeftRadius: 5 }
                      }
                    >
                      {message.image && (
                        <img
                          src={message.image.dataUrl}
                          alt={message.image.name}
                          className="mb-2 max-h-64 max-w-full rounded-xl object-contain"
                        />
                      )}
                      {message.text || (streamingMessageId === message.id ? "AI Core mulai menjawab…" : "")}
                      {streamingMessageId === message.id && message.text && (
                        <span className="inline-block ml-1 w-1.5 h-4 align-middle animate-pulse" style={{ background: "#9D91FB" }} />
                      )}
                    </div>
                    {message.role === "assistant" && message.meta && (
                      <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[10px]" style={{ color: "#61749E" }}>
                        <span>{routeLabel(message.meta.route)}</span>
                        {message.meta.provider && <span>• {message.meta.provider}</span>}
                        {message.meta.model && <span>• {message.meta.model}</span>}
                        {message.meta.workload && <span>• {message.meta.workload}</span>}
                        {message.meta.costClass && <span>• cost {message.meta.costClass}</span>}
                        {message.meta.usage && <span>• {message.meta.usage.totalTokens.toLocaleString()} tokens</span>}
                        {typeof message.meta.estimatedCostUsd === "number" && (
                          <span>• ${message.meta.estimatedCostUsd.toFixed(6)}</span>
                        )}
                        {message.meta.taskNumber && <span>• {message.meta.taskNumber}</span>}
                        {message.meta.workspaceUrl && (
                          <Link href={message.meta.workspaceUrl}>
                            <span className="inline-flex items-center gap-1 cursor-pointer" style={{ color: "#9D91FB" }}>
                              Buka Workspace <ExternalLink className="size-2.5" />
                            </span>
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                  {message.role === "user" && (
                    <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-1" style={{ background: "#121B31", border: "1px solid #25365F" }}>
                      <User className="size-4" style={{ color: "#91A5CE" }} />
                    </div>
                  )}
                </div>
              ))}

              {busy && !streamingMessageId && (
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: "#171F3F", border: "1px solid #2B3971" }}>
                    <Bot className="size-4" style={{ color: "#9D91FB" }} />
                  </div>
                  <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: "#0C152A", border: "1px solid #1E3057", color: "#8DA1C8" }}>
                    <Loader2 className="size-4 animate-spin" /> AI Core memproses…
                  </div>
                </div>
              )}

              {activeTaskId && progress && (
                <div className="rounded-xl p-4" style={{ background: "#0A1327", border: "1px solid #263765" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest" style={{ color: "#6D81AA" }}>Agent progress</div>
                      <div className="mt-1 font-semibold">{progress.task.taskNumber}</div>
                      <div className="text-xs mt-1" style={{ color: "#7F92B8" }}>{progress.task.repository} · {progress.task.branch}</div>
                    </div>
                    <Link href={progress.workspaceUrl}>
                      <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg cursor-pointer" style={{ color: "#B8AEFF", background: "#171D3C", border: "1px solid #313C78" }}>
                        Coding Workspace <ExternalLink className="size-3" />
                      </div>
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                    {[
                      ["TASK", progress.task.status],
                      ["AUTONOMOUS", progress.autonomous?.status || "—"],
                      ["ACTION", progress.autonomous?.last_action || "—"],
                      ["RUN", progress.latestRun?.status || "—"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg p-2.5 min-w-0" style={{ background: "#07101F", border: "1px solid #172745" }}>
                        <div className="text-[10px]" style={{ color: "#60749B" }}>{label}</div>
                        <div className="text-xs mt-1 truncate" title={value}>{value}</div>
                      </div>
                    ))}
                  </div>
                  {progress.task.resultSummary && <p className="text-xs leading-5 mt-3" style={{ color: "#8DA1C8" }}>{progress.task.resultSummary}</p>}
                  {progress.autonomous?.status === "APPROVAL_REQUIRED" && (
                    <div className="mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: "#241B0C", color: "#F8C66A", border: "1px solid #59411D" }}>
                      <ShieldCheck className="size-4" /> Critical approval diperlukan. AI Core berhenti aman dan menunggu keputusan Anda.
                    </div>
                  )}
                </div>
              )}

              {progressError && <div className="text-xs" style={{ color: "#FCA5A5" }}>Progress polling: {progressError}</div>}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="px-4 sm:px-8 pb-6 pt-3">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: "#171D3C", border: "1px solid #313C78", color: "#B8AEFF" }}>
                  <Sparkles className="size-3.5" />
                  Auto routing
                </div>
                <div className="flex rounded-lg p-1" style={{ background: "#0A1327", border: "1px solid #1E3057" }}>
                  {(["economy", "smart", "auto", "cloud"] as ModelPolicy[]).map((value) => (
                    <button key={value} onClick={() => setPolicy(value)} className="px-2.5 py-1.5 rounded-md text-[11px]" style={policy === value ? { background: "#19234A", color: "#B6ADFF" } : { color: "#63779E" }}>
                      {value === "economy" ? "Economy" : value === "smart" ? "Smart" : value === "auto" ? "Local→Cloud" : "Cloud"}
                    </button>
                  ))}
                </div>
              </div>

              <form onSubmit={(event) => void submit(event)} className="rounded-2xl overflow-hidden" style={{ background: "#0A1327", border: "1px solid #263765" }}>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    void chooseImage(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
                <input
                  ref={voiceSampleInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(event) => {
                    void enrollVoiceClone(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
                {pendingImage && (
                  <div className="mx-3 mt-3 flex items-center gap-3 rounded-xl p-2.5" style={{ background: "#0D1730", border: "1px solid #263765" }}>
                    <img src={pendingImage.dataUrl} alt={pendingImage.name} className="h-16 w-16 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs" style={{ color: "#DCE5F7" }}>{pendingImage.name}</div>
                      <div className="text-[10px] mt-1" style={{ color: "#667AA2" }}>Gambar akan dianalisis AI Core saat dikirim.</div>
                    </div>
                    <button type="button" onClick={() => setPendingImage(null)} className="size-8 rounded-lg flex items-center justify-center" style={{ color: "#8DA1C8", border: "1px solid #263765" }} title="Hapus gambar">
                      <X className="size-3.5" />
                    </button>
                  </div>
                )}
                <textarea
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    setLastInputSource("text");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  rows={3}
                  placeholder="Tanya, periksa, atau beri perintah. Contoh: cek modul auth, jelaskan masalahnya, lalu perbaiki sampai test hijau…"
                  className="w-full resize-none bg-transparent outline-none px-4 pt-4 pb-2 text-sm"
                  style={{ color: "#E7EDFA" }}
                />
                <div className="px-3 pb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={busy}
                      className="size-9 rounded-xl flex items-center justify-center disabled:opacity-40"
                      style={{ background: "#101831", color: pendingImage ? "#C4B5FD" : "#9D91FB", border: "1px solid #263765" }}
                      title="Upload gambar dari kamera atau galeri"
                    >
                      <ImagePlus className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={toggleListening}
                      disabled={!voiceSupported || !voiceFeatureEnabled}
                      className="size-9 rounded-xl flex items-center justify-center disabled:opacity-40"
                      style={{ background: handsFreeEnabled ? "#4C1D2B" : "#101831", color: handsFreeEnabled ? "#FDA4AF" : "#9D91FB", border: "1px solid #263765" }}
                      title={
                        voiceSupported
                          ? handsFreeEnabled && busy
                            ? "Potong jawaban AI Core dan lanjut bicara"
                            : handsFreeEnabled
                              ? "Hentikan percakapan hands-free"
                              : "Mulai percakapan hands-free"
                          : "Speech recognition tidak tersedia"
                      }
                    >
                      {handsFreeEnabled ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                    </button>
                    <div
                      className="h-9 rounded-xl p-0.5 flex items-center gap-0.5"
                      style={{ background: "#0D1730", border: "1px solid #263765" }}
                      title="Mode koneksi suara AI Core"
                    >
                      {(["auto", "standard", "realtime"] as VoiceTransportMode[]).map((option) => {
                        const selected = voiceTransportMode === option;
                        const unavailable = option === "realtime" && !realtimeVoiceAvailable;
                        const label =
                          option === "auto" ? "Auto" : option === "standard" ? "Standard" : "Realtime";
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => selectVoiceTransportMode(option)}
                            disabled={!voiceFeatureEnabled || unavailable}
                            className="h-7 rounded-lg px-2 text-[10px] font-medium disabled:opacity-40"
                            style={{
                              background: selected ? "#675ADB" : "transparent",
                              color: selected ? "#FFFFFF" : "#8DA1C8",
                            }}
                            title={
                              unavailable
                                ? "Realtime full-duplex belum dikonfigurasi"
                                : option === "auto"
                                  ? "Auto memilih mode terbaik; fallback ke Standard bila Realtime belum tersedia"
                                  : option === "standard"
                                    ? "Standard memakai browser STT + streaming response + browser TTS"
                                    : "Realtime memakai sesi audio full-duplex"
                            }
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        window.speechSynthesis?.cancel();
                        setVoiceReplyEnabled((value) => !value);
                      }}
                      disabled={!voiceFeatureEnabled}
                      className="size-9 rounded-xl flex items-center justify-center disabled:opacity-40"
                      style={{ background: "#101831", color: voiceReplyEnabled ? "#9D91FB" : "#63779E", border: "1px solid #263765" }}
                      title={voiceFeatureEnabled ? "Aktif/nonaktifkan jawaban suara" : "Voice sementara dinonaktifkan"}
                    >
                      {voiceReplyEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                    </button>
                    <select
                      value={voicePreset}
                      onChange={(event) => setVoicePreset(event.target.value as VoicePreset)}
                      className="h-9 rounded-xl px-2 text-[11px] outline-none"
                      style={{ background: "#101831", color: "#B8AEFF", border: "1px solid #263765" }}
                      disabled={!voiceFeatureEnabled}
                      title={voiceFeatureEnabled ? "Pilih karakter suara jawaban" : "Voice sementara dinonaktifkan"}
                    >
                      {VOICE_PRESET_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                      {clonedVoiceId && <option value="cloned">Suara Saya</option>}
                    </select>
                    <button
                      type="button"
                      onClick={() => speakReply("Halo, ini contoh suara AI Core. Saya siap membantu Anda.")}
                      disabled={!voiceFeatureEnabled || !voiceReplyEnabled}
                      className="h-9 rounded-xl px-2.5 flex items-center gap-1.5 text-[11px] disabled:opacity-40"
                      style={{ background: "#101831", color: "#B8AEFF", border: "1px solid #263765" }}
                      title="Preview suara yang dipilih"
                    >
                      <Volume2 className="size-3.5" />
                      Preview
                    </button>
                    <label className="h-9 rounded-xl px-2.5 flex items-center gap-1.5 text-[10px]" style={{ background: "#0D1730", color: "#8DA1C8", border: "1px solid #263765" }}>
                      <input
                        type="checkbox"
                        checked={voiceCloneConsent}
                        disabled={!voiceFeatureEnabled}
                        onChange={(event) => setVoiceCloneConsent(event.target.checked)}
                      />
                      Suara saya / saya berizin
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowVoiceCloneGuide((value) => !value)}
                      disabled={!voiceFeatureEnabled || voiceCloneBusy || !voiceCloneConsent}
                      className="h-9 rounded-xl px-2.5 flex items-center gap-1.5 text-[11px] disabled:opacity-40"
                      style={{ background: "#101831", color: "#B8AEFF", border: "1px solid #263765" }}
                      title={voiceCloneConsent ? "Buka panduan sebelum merekam sampel suara" : "Centang persetujuan kepemilikan/izin suara terlebih dahulu"}
                    >
                      {voiceCloneBusy ? <Loader2 className="size-3.5 animate-spin" /> : <AudioLines className="size-3.5" />}
                      {clonedVoiceId ? "Ganti Suara Saya" : "Daftarkan Suara Saya"}
                    </button>
                    {showVoiceCloneGuide && (
                      <div className="basis-full rounded-xl p-3 text-xs" style={{ background: "#0D1730", border: "1px solid #31446F", color: "#C9D5EC" }}>
                        <div className="font-semibold" style={{ color: "#E7EDFA" }}>Panduan rekam Suara Saya</div>
                        <div className="mt-1 text-[11px]" style={{ color: "#8DA1C8" }}>
                          Rekam di ruangan tenang, gunakan suara normal, dan jaga jarak mikrofon sekitar 15–30 cm. Targetkan 1–3 menit; jangan memakai musik, filter suara, atau speaker.
                        </div>
                        <div className="mt-3 text-[10px] uppercase tracking-widest" style={{ color: "#7F92B8" }}>Baca teks ini</div>
                        <div className="mt-1 rounded-lg p-3 leading-5 select-text" style={{ background: "#08101F", border: "1px solid #263765" }}>
                          {VOICE_CLONE_READING_SCRIPT}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => voiceSampleInputRef.current?.click()}
                            className="h-9 rounded-xl px-3 flex items-center gap-1.5 text-[11px]"
                            style={{ background: "#675ADB", color: "white" }}
                          >
                            <Mic className="size-3.5" />
                            Mulai Rekam / Pilih Audio
                          </button>
                          <span className="text-[10px]" style={{ color: "#667AA2" }}>
                            Setelah selesai, dengarkan hasilnya. Jika ada noise, suara terlalu kecil, atau banyak jeda, rekam ulang sebelum disimpan.
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="text-[10px]" style={{ color: "#536A94" }}>
                      {!voiceFeatureEnabled
                        ? "Voice sementara dinonaktifkan"
                        : voiceTransportMode === "realtime" && !realtimeVoiceAvailable
                          ? "Realtime belum dikonfigurasi · pilih Auto atau Standard"
                          : listening
                            ? `Mendengarkan · ${effectiveVoiceTransportMode === "realtime" ? "Realtime" : "Standard"} · tunggu jeda sekitar 1,6 detik untuk mengirim…`
                            : handsFreeEnabled
                              ? `Hands-free aktif · mode ${effectiveVoiceTransportMode === "realtime" ? "Realtime" : "Standard"}`
                              : voiceSupported
                                ? `Voice ready · ${voiceTransportMode === "auto" ? `Auto → ${effectiveVoiceTransportMode === "realtime" ? "Realtime" : "Standard"}` : effectiveVoiceTransportMode === "realtime" ? "Realtime" : "Standard"}`
                                : "Voice input perlu browser yang mendukung SpeechRecognition"}
                    </div>
                  </div>
                  <div className="text-[10px]" style={{ color: "#536A94" }}>
                    {policy === "economy"
                      ? "Auto routing aktif · jawaban memakai local only; perintah kerja tetap masuk control plane."
                      : policy === "smart"
                        ? "Auto routing aktif · AI Core membedakan tanya, cek/review, coding, dan critical action."
                        : policy === "auto"
                          ? "Auto routing aktif · jawaban local dulu lalu cloud; coding tetap dibagikan lewat orchestrator."
                          : "Auto routing aktif · jawaban memakai cloud; tindakan sistem tetap melalui guardrail."}
                  </div>
                  <button type="submit" disabled={busy || (!input.trim() && !pendingImage)} className="size-9 rounded-xl flex items-center justify-center disabled:opacity-40" style={{ background: "#675ADB", color: "white" }}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  </button>
                </div>
              </form>
              {attachmentError && <div className="text-xs mt-2" style={{ color: "#FCA5A5" }}>{attachmentError}</div>}
              {voiceCloneStatus && <div className="text-xs mt-2" style={{ color: voiceCloneStatus.startsWith("Voice clone belum") ? "#FCA5A5" : "#86EFAC" }}>{voiceCloneStatus}</div>}
              {voiceError && <div className="text-xs mt-2" style={{ color: "#FCA5A5" }}>{voiceError}</div>}
            </div>
          </div>
        </section>

        <aside className="hidden lg:block overflow-y-auto p-4" style={{ background: "#08101F", borderLeft: "1px solid #1E3057" }}>
          <div className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "#586E98" }}>Routing</div>
          <div className="space-y-2">
            {[
              { icon: Zap, title: "Tier 0 · No LLM", text: "Status, deterministic commands, dan read-only Data Tools", badge: "0 token" },
              { icon: Cpu, title: "Tier 1 · Local AI", text: config?.local.model || "Ollama / local worker", badge: localReady ? "ready" : "offline" },
              { icon: Cloud, title: "Tier 2 · Cloud", text: String(config?.codingModel?.["primaryModel"] || "configured primary"), badge: "on demand" },
            ].map((item) => (
              <div key={item.title} className="rounded-xl p-3" style={{ background: "#0A1327", border: "1px solid #1E3057" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><item.icon className="size-3.5" style={{ color: "#8D80F7" }} /><span className="text-xs font-medium">{item.title}</span></div>
                  <span className="text-[9px] uppercase" style={{ color: "#6F83AA" }}>{item.badge}</span>
                </div>
                <p className="text-[11px] leading-4 mt-2" style={{ color: "#667AA2" }}>{item.text}</p>
              </div>
            ))}
          </div>

          <>
              <div className="text-[10px] uppercase tracking-widest mt-6 mb-3" style={{ color: "#586E98" }}>Work Context</div>
              <p className="text-[10px] leading-4 mb-3" style={{ color: "#60749B" }}>
                Dipakai otomatis hanya ketika perintah membutuhkan repository/worker.
              </p>
              <div className="space-y-3">
                {[
                  ["PROJECT", projectName, setProjectName],
                  ["REPOSITORY", repository, setRepository],
                  ["BRANCH", branch, setBranch],
                ].map(([label, value, setter]) => (
                  <label className="block" key={String(label)}>
                    <span className="text-[10px]" style={{ color: "#6F83AA" }}>{String(label)}</span>
                    <input
                      value={String(value)}
                      onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                      className="mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none"
                      style={{ background: "#07101F", border: "1px solid #1E3057", color: "#C8D4EB" }}
                    />
                  </label>
                ))}
                <label className="block">
                  <div className="flex justify-between text-[10px]" style={{ color: "#6F83AA" }}><span>PRIORITY</span><span>{priority}</span></div>
                  <input type="range" min={0} max={100} value={priority} onChange={(event) => setPriority(Number(event.target.value))} className="mt-2 w-full" />
                </label>
              </div>
            </>

          <div className="text-[10px] uppercase tracking-widest mt-6 mb-3" style={{ color: "#586E98" }}>Guardrails</div>
          <div className="space-y-2 text-[11px]" style={{ color: "#7D91B7" }}>
            <div className="flex gap-2"><CheckCircle2 className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: "#10B981" }} />Pertanyaan biasa tetap berada di jalur non-mutating tanpa shell/Git/filesystem.</div>
            <div className="flex gap-2"><TerminalSquare className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: "#9D91FB" }} />Cek/review repository dapat memakai trusted read-only worker; coding otomatis masuk Coding Orchestrator dan workstream.</div>
            <div className="flex gap-2"><ShieldCheck className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: "#F8C66A" }} />Merge, deploy production, destructive DB, security, dan restart production tetap critical approval.</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

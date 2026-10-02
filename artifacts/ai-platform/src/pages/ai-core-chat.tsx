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
const MAX_MESSAGES = 80;

type VoicePreset = "auto" | "male" | "female";

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

function loadVoicePreset(): VoicePreset {
  try {
    const stored = localStorage.getItem(VOICE_PRESET_KEY);
    return stored === "male" || stored === "female" || stored === "auto" ? stored : "auto";
  } catch {
    return "auto";
  }
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
  const [voicePreset, setVoicePreset] = useState<VoicePreset>(() => loadVoicePreset());
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(false);
  const [lastInputSource, setLastInputSource] = useState<"text" | "voice">("text");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const handsFreeRef = useRef(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(() => getDeferredPwaInstallPrompt());
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    new URLSearchParams(window.location.search).get("standalone") === "1";
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
    } catch {
      // Chat still works when browser storage is unavailable.
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  function selectedVoice(): SpeechSynthesisVoice | null {
    const indonesianVoices = availableVoices.filter((voice) =>
      voice.lang.toLowerCase().startsWith("id"),
    );
    const candidates = indonesianVoices.length ? indonesianVoices : availableVoices;
    if (!candidates.length) return null;
    if (voicePreset === "auto") return candidates[0] ?? null;

    const femalePattern = /female|woman|wanita|perempuan|siti|ayu|damayanti|wavenet[-_ ]?[acde]|neural2[-_ ]?[acde]/i;
    const malePattern = /male|man|pria|laki|adi|budi|wavenet[-_ ]?[bf]|neural2[-_ ]?[bf]/i;
    const pattern = voicePreset === "female" ? femalePattern : malePattern;
    return candidates.find((voice) => pattern.test(voice.name)) ?? candidates[0] ?? null;
  }

  function startListening() {
    if (!voiceSupported || busy || listening) return;
    const Constructor = speechRecognitionConstructor();
    if (!Constructor) return;

    let capturedTranscript = "";
    let submitted = false;
    const recognition = new Constructor();
    recognition.lang = "id-ID";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = "";
      let hasFinalResult = false;
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        transcript += result?.[0]?.transcript ?? "";
        hasFinalResult ||= result?.isFinal === true;
      }
      capturedTranscript = transcript.trim();
      if (capturedTranscript) {
        setInput(capturedTranscript);
        setLastInputSource("voice");
      }
      if (handsFreeRef.current && hasFinalResult && capturedTranscript && !submitted) {
        submitted = true;
        recognition.stop();
        void submit(undefined, capturedTranscript);
      }
    };
    recognition.onerror = (event) => {
      const errorCode = event.error || "unknown error";
      if (errorCode !== "aborted") {
        setVoiceError("Microphone/STT gagal: " + errorCode);
      }
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      if (handsFreeRef.current && capturedTranscript && !submitted) {
        submitted = true;
        void submit(undefined, capturedTranscript);
      }
    };
    recognitionRef.current = recognition;
    setVoiceError("");
    setListening(true);
    recognition.start();
  }

  function stopVoiceSession() {
    handsFreeRef.current = false;
    setHandsFreeEnabled(false);
    recognitionRef.current?.abort();
    window.speechSynthesis?.cancel();
    setListening(false);
  }

  function toggleListening() {
    if (!voiceSupported) {
      setVoiceError("Speech recognition belum didukung browser ini.");
      return;
    }
    if (handsFreeRef.current) {
      stopVoiceSession();
      return;
    }
    handsFreeRef.current = true;
    setHandsFreeEnabled(true);
    startListening();
  }

  function speakReply(text: string, onFinished?: () => void) {
    const done = () => {
      if (onFinished) onFinished();
    };
    if (!voiceReplyEnabled || !("speechSynthesis" in window) || !text.trim()) {
      done();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 1_200));
    utterance.lang = "id-ID";
    utterance.rate = 1;
    utterance.pitch = voicePreset === "male" ? 0.86 : voicePreset === "female" ? 1.12 : 1;
    const voice = selectedVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
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

  async function submit(event?: FormEvent, overrideText?: string) {
    event?.preventDefault();
    const text = (overrideText ?? input).trim();
    if (!text || busy) return;
    const inputSource = lastInputSource;

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

    append({ id: messageId(), role: "user", text, createdAt: new Date().toISOString() });
    setInput("");
    setLastInputSource("text");
    setBusy(true);

    if (mode === "ask") {
      const assistantId = messageId();
      append({
        id: assistantId,
        role: "assistant",
        text: "",
        createdAt: new Date().toISOString(),
        meta: { route: "STREAMING" },
      });
      setStreamingMessageId(assistantId);

      try {
        await apiEventStream(
          "/api/ai/core-chat/messages/stream",
          {
            method: "POST",
            body: JSON.stringify({
              message: text,
              mode: "ask",
              modelPolicy: policy,
              conversationId,
              source: inputSource,
              context,
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
              updateMessage(assistantId, (message) => ({
                ...message,
                text: message.text + value.text,
              }));
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
        updateMessage(assistantId, (message) => ({
          ...message,
          text: message.text || requestFailureText(error),
          error: !message.text,
        }));
      } finally {
        setStreamingMessageId(null);
        setBusy(false);
      }
      return;
    }

    try {
      const response = await apiFetch<ChatResponse>("/api/ai/core-chat/messages", {
        method: "POST",
        body: JSON.stringify({
          message: text,
          mode,
          modelPolicy: policy,
          conversationId,
          source: inputSource,
          context,
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
      setBusy(false);
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleListening}
                      disabled={busy || !voiceSupported}
                      className="size-9 rounded-xl flex items-center justify-center disabled:opacity-40"
                      style={{ background: handsFreeEnabled ? "#4C1D2B" : "#101831", color: handsFreeEnabled ? "#FDA4AF" : "#9D91FB", border: "1px solid #263765" }}
                      title={voiceSupported ? (handsFreeEnabled ? "Hentikan percakapan hands-free" : "Mulai percakapan hands-free") : "Speech recognition tidak tersedia"}
                    >
                      {handsFreeEnabled ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        window.speechSynthesis?.cancel();
                        setVoiceReplyEnabled((value) => !value);
                      }}
                      className="size-9 rounded-xl flex items-center justify-center"
                      style={{ background: "#101831", color: voiceReplyEnabled ? "#9D91FB" : "#63779E", border: "1px solid #263765" }}
                      title="Aktif/nonaktifkan jawaban suara"
                    >
                      {voiceReplyEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                    </button>
                    <select
                      value={voicePreset}
                      onChange={(event) => setVoicePreset(event.target.value as VoicePreset)}
                      className="h-9 rounded-xl px-2 text-[11px] outline-none"
                      style={{ background: "#101831", color: "#B8AEFF", border: "1px solid #263765" }}
                      title="Pilih karakter suara jawaban"
                    >
                      <option value="auto">Otomatis</option>
                      <option value="male">Pria</option>
                      <option value="female">Wanita</option>
                    </select>
                    <div className="text-[10px]" style={{ color: "#536A94" }}>
                      {listening
                        ? "Mendengarkan Bahasa Indonesia…"
                        : handsFreeEnabled
                          ? "Hands-free aktif · bicara tanpa tombol Send"
                          : voiceSupported
                            ? "Voice ready · tekan mic sekali untuk percakapan otomatis"
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
                  <button type="submit" disabled={busy || !input.trim()} className="size-9 rounded-xl flex items-center justify-center disabled:opacity-40" style={{ background: "#675ADB", color: "white" }}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  </button>
                </div>
              </form>
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

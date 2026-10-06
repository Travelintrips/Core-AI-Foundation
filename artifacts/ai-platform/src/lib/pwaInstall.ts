export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

export const PWA_INSTALL_PROMPT_READY_EVENT = "ai-core-pwa-install-prompt-ready";
export const PWA_APP_INSTALLED_EVENT = "ai-core-pwa-app-installed";

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let captureInitialized = false;

export function initializePwaInstallCapture(options: { customPrompt?: boolean } = {}): void {
  if (captureInitialized || typeof window === "undefined") return;
  captureInitialized = true;
  const customPrompt = options.customPrompt ?? true;

  window.addEventListener("beforeinstallprompt", (event) => {
    if (!customPrompt) return;
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event(PWA_INSTALL_PROMPT_READY_EVENT));
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    window.dispatchEvent(new Event(PWA_APP_INSTALLED_EVENT));
  });
}

export function getDeferredPwaInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredInstallPrompt;
}

export function clearDeferredPwaInstallPrompt(): void {
  deferredInstallPrompt = null;
}

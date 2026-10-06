import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { initializePwaInstallCapture } from "@/lib/pwaInstall";

// Attach the admin API key to every outgoing API request.
// VITE_ADMIN_API_KEY is baked into the bundle at build time — set it as a
// Replit Secret with the same value as ADMIN_API_KEY on the server.
const adminKey = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;
if (adminKey && adminKey.trim()) {
  setAuthTokenGetter(() => adminKey.trim());
}

const pathname = window.location.pathname.toLowerCase();
const hostname = window.location.hostname.toLowerCase();
const isAiCoreChatSurface = pathname.startsWith("/ai-core-chat");
const isAiCodingSurface =
  hostname === "aicoding.travelintrips.co.id" || pathname === "/aicoding";

const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
if (manifestLink && isAiCodingSurface) {
  manifestLink.href = "/aicoding.webmanifest";
}

initializePwaInstallCapture({ customPrompt: isAiCoreChatSurface });

createRoot(document.getElementById("root")!).render(<App />);


if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/ai-core-chat-sw.js", { scope: "/" });
  });
}

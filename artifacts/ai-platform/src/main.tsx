import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";

// Attach the admin API key to every outgoing API request.
// VITE_ADMIN_API_KEY is baked into the bundle at build time — set it as a
// Replit Secret with the same value as ADMIN_API_KEY on the server.
const adminKey = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;
if (adminKey && adminKey.trim()) {
  setAuthTokenGetter(() => adminKey.trim());
}

createRoot(document.getElementById("root")!).render(<App />);

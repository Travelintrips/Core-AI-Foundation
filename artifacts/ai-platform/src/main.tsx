import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Authentication is handled entirely via the httpOnly session cookie issued by
// POST /api/internal/auth/login.  The static VITE_ADMIN_API_KEY was removed
// because VITE_* variables are baked into the JS bundle and readable by
// anyone who opens browser DevTools.  The adminAuth middleware on the backend
// accepts a valid session cookie (Path 1) before falling back to the API key
// (Path 2 — server-to-server / emergency only).  customFetch already sends
// credentials: "include" on every request so the cookie is forwarded.

createRoot(document.getElementById("root")!).render(<App />);

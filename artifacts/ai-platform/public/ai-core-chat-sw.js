const CACHE_NAME = "ai-core-chat-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ai-core-chat-shell-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
    ]),
  );
});

// No offline shell is cached. Browser owns network requests and errors.

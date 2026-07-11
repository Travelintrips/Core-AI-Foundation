import { Router, type IRouter } from "express";
import { objectStorageService } from "../lib/objectStorage.js";

const router: IRouter = Router();

// Serves permanently-stored portfolio assets (and any other public objects) that
// were downloaded from ephemeral provider URLs (e.g. Replicate) and persisted here.
// Unconditionally public, no auth — matches the object-storage skill's
// public-objects convention.
router.get("/storage/public-objects/*splat", async (req, res) => {
  const filePath = (req.params as unknown as { splat: string[] }).splat.join("/");
  try {
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const { Readable } = await import("node:stream");
      Readable.fromWeb(response.body as import("stream/web").ReadableStream).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    req.log?.error({ err, filePath }, "[storage] Failed to serve public object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;

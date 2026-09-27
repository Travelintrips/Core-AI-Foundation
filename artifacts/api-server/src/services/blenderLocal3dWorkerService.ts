import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AiJob } from "@workspace/db";

export const BLENDER_3D_CAPABILITIES = [
  "3d_scene_build",
  "3d_render",
  "3d_turntable",
  "3d_export_glb",
  "3d_export_gltf",
  "3d_material_apply",
  "3d_camera_render",
] as const;

export interface Blender3dConfig {
  enabled: boolean;
  executablePath: string;
  outputDir: string;
  scriptPath: string;
}

function envTrue(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function readBlender3dConfig(env: NodeJS.ProcessEnv = process.env): Blender3dConfig {
  const cwd = process.cwd();
  return {
    enabled: envTrue(env["BLENDER_WORKER_RUNTIME_ENABLED"]),
    executablePath: (env["BLENDER_EXECUTABLE_PATH"] || "blender").trim(),
    outputDir: path.resolve(env["BLENDER_OUTPUT_DIR"] || path.join(cwd, ".runtime", "blender-3d")),
    scriptPath: path.resolve(
      env["BLENDER_WORKER_SCRIPT"] || path.join(cwd, "scripts", "blender", "core_ai_blender_worker.py"),
    ),
  };
}

async function spawnChecked(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Blender command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const exitCode = code ?? -1;
      if (exitCode !== 0) {
        reject(new Error(
          `Blender exited with code ${exitCode}: ${stderr.slice(-4000) || stdout.slice(-4000)}`,
        ));
        return;
      }
      resolve({ stdout, stderr, code: exitCode });
    });
  });
}

export async function getBlender3dStatus(): Promise<Record<string, unknown>> {
  const config = readBlender3dConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      status: "disabled",
      executablePath: config.executablePath,
      outputDir: config.outputDir,
    };
  }

  try {
    await access(config.scriptPath);
  } catch {
    return {
      enabled: true,
      status: "fail",
      executablePath: config.executablePath,
      outputDir: config.outputDir,
      error: `Worker script not found: ${config.scriptPath}`,
    };
  }

  try {
    const result = await spawnChecked(
      config.executablePath,
      ["--background", "--version"],
      15_000,
    );
    const firstLine = result.stdout.split(/\r?\n/).find(Boolean) ?? "Blender available";
    return {
      enabled: true,
      status: "ok",
      executablePath: config.executablePath,
      outputDir: config.outputDir,
      detail: firstLine,
      capabilities: [...BLENDER_3D_CAPABILITIES],
    };
  } catch (error) {
    return {
      enabled: true,
      status: "fail",
      executablePath: config.executablePath,
      outputDir: config.outputDir,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function cleanSceneType(value: unknown): "interior" | "fashion" {
  return value === "fashion" ? "fashion" : "interior";
}

function cleanDimension(value: unknown, fallback = 512): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(256, Math.min(1024, Math.trunc(value)));
}

export async function executeBlender3dJob(job: AiJob): Promise<Record<string, unknown>> {
  const config = readBlender3dConfig();
  if (!config.enabled) throw new Error("Blender 3D worker runtime is disabled.");

  const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
  const sceneType = cleanSceneType(payload["sceneType"]);
  const width = cleanDimension(payload["width"]);
  const height = cleanDimension(payload["height"]);

  const jobDir = path.join(config.outputDir, `job-${job.id}`);
  await mkdir(jobDir, { recursive: true });
  await access(config.scriptPath);

  const result = await spawnChecked(
    config.executablePath,
    [
      "--background",
      "--python",
      config.scriptPath,
      "--",
      "--output-dir",
      jobDir,
      "--scene-type",
      sceneType,
      "--width",
      String(width),
      "--height",
      String(height),
    ],
    10 * 60_000,
  );

  const previewPath = path.join(jobDir, "preview.png");
  const glbPath = path.join(jobDir, "scene.glb");
  const blendPath = path.join(jobDir, "scene.blend");

  await Promise.all([access(previewPath), access(glbPath), access(blendPath)]);

  return {
    jobId: job.id,
    status: "completed",
    runtime: "blender_local_3d",
    sceneType,
    previewPath,
    glbPath,
    blendPath,
    localPath: glbPath,
    stdoutTail: result.stdout.slice(-2000),
  };
}

/**
 * Universal Renderer — Port contracts (Team 14)
 *
 * All ports are pure TypeScript interfaces with no implementation.
 * Adapters in ../adapters/ provide concrete implementations.
 */

export type { SvgRenderInput, SvgRenderOutput, SvgRendererPort } from "./SvgRendererPort.js";
export type { PdfRenderInput, PdfRenderOutput, PdfRendererPort } from "./PdfRendererPort.js";
export type { PngRenderInput, PngRenderOutput, PngRendererPort, RasterFormat } from "./PngRendererPort.js";
export type { UploadInput, UploadResult, StoragePort } from "./StoragePort.js";
export type { ScheduleJobInput, ScheduleJobOutput, JobSchedulerPort } from "./JobSchedulerPort.js";

/**
 * WP-03 — Shared Zod schemas for Placement Engine and Collision Engine routes.
 *
 * Routes must import from here instead of declaring inline `zod/v4` schemas.
 * This ensures schema contracts are version-controlled in a single location.
 */
import { z } from "zod";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum number of placements allowed per collision session check. */
export const MAX_PLACEMENTS_PER_COLLISION_SESSION = 200;

// ── WP-03A: Placement Engine schemas ─────────────────────────────────────────

export const wp03CreateSessionSchema = z.object({
  name:            z.string().min(1).max(200),
  roomTemplateId:  z.string().uuid().nullable().optional(),
  widthCm:         z.number().positive().optional(),
  depthCm:         z.number().positive().optional(),
  heightCm:        z.number().positive().optional(),
  metadata:        z.record(z.unknown()).optional(),
}).strict();

export const wp03UpdateSessionSchema = z.object({
  name:     z.string().min(1).max(200).optional(),
  widthCm:  z.number().positive().optional(),
  depthCm:  z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export const wp03CreatePlacementSchema = z.object({
  furnitureItemId:  z.string().uuid().nullable().optional(),
  label:            z.string().max(200).optional(),
  xCm:              z.number().finite(),
  yCm:              z.number().finite(),
  widthCm:          z.number().positive().finite(),
  depthCm:          z.number().positive().finite(),
  rotationDeg:      z.number().finite().optional(),
  anchorX:          z.number().min(0).max(1).optional(),
  anchorY:          z.number().min(0).max(1).optional(),
  clearanceFrontCm: z.number().nonnegative().optional(),
  clearanceSideCm:  z.number().nonnegative().optional(),
  clearanceBackCm:  z.number().nonnegative().optional(),
  metadata:         z.record(z.unknown()).optional(),
}).strict();

export const wp03UpdatePlacementSchema = z.object({
  label:            z.string().max(200).optional(),
  xCm:              z.number().finite().optional(),
  yCm:              z.number().finite().optional(),
  widthCm:          z.number().positive().finite().optional(),
  depthCm:          z.number().positive().finite().optional(),
  rotationDeg:      z.number().finite().optional(),
  anchorX:          z.number().min(0).max(1).optional(),
  anchorY:          z.number().min(0).max(1).optional(),
  clearanceFrontCm: z.number().nonnegative().optional(),
  clearanceSideCm:  z.number().nonnegative().optional(),
  clearanceBackCm:  z.number().nonnegative().optional(),
  metadata:         z.record(z.unknown()).optional(),
}).strict();

// ── WP-03B: Collision Engine schemas ─────────────────────────────────────────

export const wp03PlacementGeometrySchema = z.object({
  id:               z.string().uuid(),
  xCm:              z.number().finite(),
  yCm:              z.number().finite(),
  widthCm:          z.number().positive().finite(),
  depthCm:          z.number().positive().finite(),
  rotationDeg:      z.number().finite().optional().default(0),
  anchorX:          z.number().min(0).max(1).optional().default(0),
  anchorY:          z.number().min(0).max(1).optional().default(0),
  clearanceFrontCm: z.number().nonnegative().optional().default(0),
  clearanceSideCm:  z.number().nonnegative().optional().default(0),
  clearanceBackCm:  z.number().nonnegative().optional().default(0),
  isArchived:       z.boolean().optional().default(false),
});

export const wp03StatelessCheckSchema = z.object({
  room: z.object({
    widthCm: z.number().positive().finite(),
    depthCm: z.number().positive().finite(),
  }),
  placements: z.array(wp03PlacementGeometrySchema).min(1).max(MAX_PLACEMENTS_PER_COLLISION_SESSION),
}).strict();

// ── UUID path param validator ─────────────────────────────────────────────────

export const uuidParamSchema = z.string().uuid();

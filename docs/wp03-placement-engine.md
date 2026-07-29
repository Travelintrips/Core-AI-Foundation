# WP-03 — Placement Engine Architecture

## Overview

The placement engine stores furniture positions on a 2D canvas (layout session). Each placement is an axis-aligned bounding box with a rotation angle and optional clearance zones.

## Coordinate system

```
(0,0) ────────────────────► X (cm)
  │
  │   ┌────────┐
  │   │        │  widthCm
  │   │  item  │
  │   │        │  depthCm
  │   └────────┘
  ▼
  Y (cm)
```

- Origin: top-left of the room boundary
- X: left → right
- Y: top → bottom
- `xCm`, `yCm`: position of the anchor point (default: top-left corner)

## Rotation

- Degrees, clockwise from north (0° = facing up)
- Normalised to `[0, 360)` before persistence
- Negative values and values ≥ 360 are normalised server-side

## Anchor point

- `anchorX`, `anchorY` ∈ `[0, 1]`
- `(0, 0)` = top-left corner (default)
- `(0.5, 0.5)` = geometric center
- Anchor point is **not** auto-adjusted for rotation — consumers must apply rotation transforms when rendering

## Clearance zones

Clearance zones define minimum clear space around a placement:
- `clearanceFrontCm` — in front of the piece (toward Y=0, before rotation)
- `clearanceSideCm` — on both sides
- `clearanceBackCm` — behind the piece

These are used by WP-03B to generate clearance warnings (not physical collision flags).

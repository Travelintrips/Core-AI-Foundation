# WP-03 — Design Sprint Overview

## Scope

WP-03 covers the interior design canvas layer built on top of WP-01 (Room Templates) and WP-02 (Furniture Library).

| Work Package | Scope |
|---|---|
| WP-03A | Placement Engine — 2D furniture positioning data model and API |
| WP-03B | Collision Engine — AABB + OBB SAT physical overlap and clearance detection |
| WP-03C | Layout Suggestions — AI-assisted placement recommendations (future) |

## Dependencies

- WP-01 provides `room_templates` (room geometry foundation)
- WP-02 provides `furniture_items` and clearance metadata
- WP-03A is a hard dependency of WP-03B (collision engine reads placements)

## Coordinate system

All WP-03 work uses a **2D top-down coordinate system** with:
- Unit: centimetres
- Origin: top-left of the room boundary
- X axis: left → right
- Y axis: top → bottom
- Rotation: degrees, normalised to `[0, 360)`, clockwise from north (0° = facing up/north)

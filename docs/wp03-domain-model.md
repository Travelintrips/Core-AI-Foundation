# WP-03 — Domain Model

## Entities

```
layout_sessions
  └─ id (PK)
  └─ tenant_id (NOT NULL — tenant-scoped)
  └─ room_template_id (nullable FK → room_templates)
  └─ name
  └─ status: draft | active | archived
  └─ width_cm, depth_cm, height_cm (room geometry)

placements (1:N with layout_sessions)
  └─ id (PK)
  └─ session_id (FK → layout_sessions, CASCADE DELETE)
  └─ tenant_id (denormalised — mirrors session.tenant_id)
  └─ furniture_item_id (nullable FK → furniture_items)
  └─ label (display name on canvas)
  └─ x_cm, y_cm (top-left anchor position)
  └─ width_cm, depth_cm (bounding box — always > 0)
  └─ rotation_deg (normalised [0, 360))
  └─ anchor_x, anchor_y (anchor point within bounding box, [0,1])
  └─ clearance_front_cm, clearance_side_cm, clearance_back_cm
  └─ is_archived (excluded from collision checks when true)
  └─ version (optimistic concurrency)
```

## Invariants

1. `placements.tenant_id` ALWAYS equals `layout_sessions.tenant_id` (DB trigger enforced)
2. `placements.width_cm > 0` and `placements.depth_cm > 0`
3. `placements.rotation_deg ∈ [0, 360)`
4. Archived sessions cannot be edited (only restored first)
5. Archived placements are excluded from collision detection
6. Soft-deleted sessions are invisible to all queries

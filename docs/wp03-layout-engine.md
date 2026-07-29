# WP-03 Layout Engine — Architecture (WP-03C through WP-03F)

> **Status: Design Only — Not Implemented**
>
> This document describes the approved future architecture for WP-03C, WP-03D,
> WP-03E, and WP-03F. None of this is implemented in WP-03A or WP-03B.

---

## WP-03C — Layout State Manager

### Purpose

Manages the in-memory and persisted state of an active layout session during
real-time editing. Bridges the placement engine (WP-03A) with the collision
engine (WP-03B) and provides a unified mutation interface.

### State Model

- JSONB session snapshots for persistence (already in WP-03A `metadata`)
- No event sourcing — full state snapshot per save
- `updatedAt` is the conflict-detection vector

### Key Behaviors

- Load session from DB → hold in memory during edit
- Apply placement mutations through the state manager
- Re-check collisions after each mutation (WP-03B)
- Persist on explicit save or auto-save (configurable)

---

## WP-03D — Undo/Redo

### Purpose

Provides a command-history stack for placement operations within a session.

### Design

- **Pattern**: Command pattern with `execute()` / `undo()` per command type
- **Commands**: MovePlacement, RotatePlacement, CreatePlacement, ArchivePlacement, RestorePlacement
- **Stack limit**: Maximum 50 commands (configurable)
- **Persistence**: Undo stack is session-local (in-memory only, not persisted to DB)
- **Scope**: Single session, single browser tab (no cross-tab synchronization in WP-03D)

### Commands

| Command | Undo Action |
|---|---|
| `MovePlacement` | Restore previous (xCm, yCm) |
| `RotatePlacement` | Restore previous rotationDeg |
| `CreatePlacement` | Archive the created placement |
| `ArchivePlacement` | Restore (un-archive) the placement |
| `DuplicatePlacement` | Archive the duplicate |

---

## WP-03E — Constraint Validator

### Purpose

Validates placement against layout rules defined in WP-01
`layout_constraint_sets`. Provides structured violation reports with
remediation suggestions.

### Constraint Types

- Minimum clearance between items (per category pair)
- Maximum items per room type
- Placement zone restrictions (e.g. sofa must face TV zone)
- Style compatibility (per WP-01 room styles)

### Result

```typescript
interface ConstraintViolation {
  type: 'clearance' | 'zone' | 'count' | 'style';
  severity: 'error' | 'warning';
  placementId: string;
  message: string;
  suggestion?: string;
}
```

---

## WP-03F — Persistence and Publish

### Purpose

Manages the lifecycle of a completed layout design: versioning, named saves,
locking, and eventual publication to a public catalog.

### State Transitions

```
[active editing] → [named save] → [locked] → [published]
```

### Behaviors

- Named saves create a snapshot with a user-defined label
- Locking prevents further edits (requires explicit unlock)
- Publishing makes the layout available in the public catalog (WP-01 integration)
- Revisions are immutable once named

---

## Integration Dependency Map

```
WP-03A (Placement Engine Core)
  └─ WP-03B (Collision Engine)
       └─ WP-03C (Layout State Manager)
            ├─ WP-03D (Undo/Redo)
            └─ WP-03E (Constraint Validator)
                 └─ WP-03F (Persistence and Publish)
```

Each WP is a hard dependency on its parent. No WP may begin until its parent
has been merged and tagged.

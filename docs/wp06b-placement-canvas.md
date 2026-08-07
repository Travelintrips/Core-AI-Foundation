# WP-06B Placement Canvas

## Architecture

WP-06B adds an admin-facing top-down editor on top of the WP-06A suggest/apply endpoints. The browser keeps three separate layers:

- **Server state:** the session room, persisted placements, status, revision, and approved snapshot returned by the API.
- **Preview state:** the working placement array, selected WP-06A alternative, and local manual changes.
- **View state:** selection, zoom, pan, and drag gesture bookkeeping.

Preview and manual edits remain local until the explicit Apply button is used.

## Coordinate model

Room coordinates are metres with `(0, 0)` at the room's top-left. `public/coordinates.js` contains reversible transforms between room and the fixed 600 × 450 canvas coordinate space. CSS zoom/pan is view-only and never changes placement values.

Furniture dimensions remain in room units. Rotation follows the WP-06A quarter-turn semantics; the transform helper swaps the rendered footprint width/depth at 90° turns without mutating source dimensions.

## Interaction

Editable items can be selected, dragged, rotated by 90 degrees, locked/unlocked, or moved with arrow keys. Shift + arrow uses a 25 cm increment. Locked/manual items cannot drag or rotate. Dragging only changes preview state and marks the editor dirty.

Out-of-bounds items receive a local visual warning immediately. WP-06A hard-rule and soft-rule responses remain authoritative for candidate previews; the UI does not duplicate SAT/OBB collision geometry.

## Preview and apply

Suggest Placement sends the current preview base to `suggest-placement` and renders up to three alternatives with rank, score, validity, warnings, explanations, and Preview selection. Selecting an alternative replaces only preview state. Apply sends the selected `candidateId` with the same preview base, so the server re-generates and validates the candidate before changing persisted state.

Successful Apply refreshes the session and resets the dirty state. Server errors are surfaced through the existing toast, including authentication, tenant/session, immutable snapshot, and hard-rule failures.

## Locking and immutable snapshots

Locked/manual furniture is visibly marked, keyboard-accessible, excluded from drag/rotation, and protected again by the server. An `approved_for_rendering` session shows an immutable banner, disables Suggest/Apply and editing controls, and does not allow local mutation.

## Unsaved changes and accessibility

Manual changes display an Unsaved preview pill, provide Reset changes, and trigger a browser confirmation before leaving or reloading. Furniture exposes roles, labels, focus states, Enter/Space selection, and arrow-key movement. Violations use both a striped visual treatment and an `!` marker so status is not color-only.

## Performance and security

Pointer moves are fully local; no request occurs per mouse event. Candidate generation remains bounded by WP-06A's three alternatives and 50-item cap. All persistence continues through the admin-only WP-06A endpoints, including tenant and snapshot protection.

## Known limitations

This empty reference repository has no persistent manual-edit endpoint, so manual drag/rotation is intentionally preview-only. Pan is implemented as a view transform and the editor uses the existing fixed canvas dimensions. Persistent room editing and richer snapping belong outside this work package.

## WP-06C boundary

WP-06C may address higher-level layout optimization, automatic ranking beyond WP-06A alternatives, or the next roadmap work package. This canvas does not implement those capabilities.
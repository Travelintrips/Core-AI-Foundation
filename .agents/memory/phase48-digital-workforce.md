---
name: Phase 4.8 Digital Workforce
description: Architecture decisions for the AI Digital Workforce system (departments, employees, skills, workload, tools)
---

## Tables added (lib/db/src/schema/)
ai_departments, ai_skills, ai_tools, ai_employees, ai_employee_skills, ai_workload, employee_tool_permissions

**Why:** Transforms AI Agents into Digital Workforce with org hierarchy, skill matrix, cost simulation, and tool access control.

## Seed
- POST /api/ai/seed/all now includes `workforce` step (idempotent)
- POST /api/ai/seed/workforce — workforce-only seed
- Seeds 12 departments, 17 skills, 11 tools, 4 Creative employees (backward-compat with existing agent slugs)

## Backward compat
- `agentSlug` on ai_employees links to existing Creative AI agents (brand-strategist, creative-director, copywriter, quality-control)
- Creative AI frontend/workflow remains untouched

## API routes (artifacts/api-server/src/routes/workforce.ts)
- GET /ai/workforce/employees — list with dept/status/skill filters
- GET /ai/workforce/employees/:id — full profile with skills, tools, workload, hierarchy, performance stats
- PATCH /ai/workforce/employees/:id/status — update status
- GET /ai/workforce/departments — with employeeCount
- GET /ai/workforce/skills, /tools, /workload, /org-chart

## Frontend (artifacts/ai-platform/src/pages/workforce.tsx)
- Card view + Table view toggle
- Filter by dept, status, search
- Stats bar: total employees, active, departments, jobs today
- Click card → detail sidebar (profile, cost sim, workload, skills, tools, hierarchy)
- Seed button appears when employees = 0

**How to apply:** When adding new AI departments or employees, insert into these tables and run seed. Never hardcode agent routing — resolve from ai_employees via agentSlug or departmentId.

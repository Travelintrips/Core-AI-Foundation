/**
 * Priority Engine — Phase 5 Job Queue
 *
 * Computes a numeric score (0–1000) for each job.
 * Higher score = processed first by workers.
 *
 * Factors:
 *   1. Base priority (0–100) — set by creator
 *   2. Execution plan priority (critical/high/normal/low)
 *   3. Department priority (from ai_departments.priority)
 *   4. Queue age (minutes since created_at)
 *   5. Deadline urgency (minutes until scheduledAt, if set)
 *   6. Retry count penalty (each retry reduces score slightly)
 *   7. Manager override boost (0–100 explicit boost)
 */

export interface PriorityFactors {
  basePriority: number;           // 0–100
  executionPlanPriority?: string; // "critical" | "high" | "normal" | "low"
  departmentPriority?: number;    // 0–100 (from ai_departments)
  createdAt: Date;
  scheduledAt?: Date | null;
  retryCount: number;
  managerOverride?: number | null; // 0–100
}

const EXECUTION_PRIORITY_MAP: Record<string, number> = {
  critical: 100,
  high:     75,
  normal:   50,
  low:      25,
};

const WEIGHTS = {
  base:             0.35, // 35 % — creator's explicit priority
  executionPlan:    0.20, // 20 % — plan-level urgency
  department:       0.10, // 10 % — department routing priority
  age:              0.15, // 15 % — time already waiting (minutes, capped at 60)
  deadline:         0.10, // 10 % — urgency of scheduledAt (if set)
  managerOverride:  0.10, // 10 % — explicit manager boost
};

const RETRY_PENALTY_PER_ATTEMPT = 5; // subtract 5 pts per retry

export function computePriorityScore(factors: PriorityFactors): number {
  const {
    basePriority,
    executionPlanPriority,
    departmentPriority,
    createdAt,
    scheduledAt,
    retryCount,
    managerOverride,
  } = factors;

  // 1. Base priority (0–100)
  const base = Math.max(0, Math.min(100, basePriority));

  // 2. Execution plan priority (0–100)
  const execPrio = executionPlanPriority
    ? (EXECUTION_PRIORITY_MAP[executionPlanPriority] ?? 50)
    : 50;

  // 3. Department priority (0–100)
  const deptPrio = departmentPriority != null
    ? Math.max(0, Math.min(100, departmentPriority))
    : 50;

  // 4. Queue age — minutes waiting, capped at 60 min → normalised 0–100
  const ageMinutes = (Date.now() - createdAt.getTime()) / 60_000;
  const agePrio = Math.min(100, (ageMinutes / 60) * 100);

  // 5. Deadline urgency — if scheduledAt is set, closer deadline = higher score
  let deadlinePrio = 50; // neutral if no deadline
  if (scheduledAt) {
    const minutesUntil = (scheduledAt.getTime() - Date.now()) / 60_000;
    if (minutesUntil <= 0) {
      deadlinePrio = 100; // overdue
    } else if (minutesUntil >= 120) {
      deadlinePrio = 10; // plenty of time
    } else {
      deadlinePrio = 100 - (minutesUntil / 120) * 90;
    }
  }

  // 6. Manager override (0–100)
  const mgrBoost = managerOverride != null
    ? Math.max(0, Math.min(100, managerOverride))
    : 0;

  // Weighted sum → 0–100
  const raw =
    WEIGHTS.base           * base +
    WEIGHTS.executionPlan  * execPrio +
    WEIGHTS.department     * deptPrio +
    WEIGHTS.age            * agePrio +
    WEIGHTS.deadline       * deadlinePrio +
    WEIGHTS.managerOverride * mgrBoost;

  // Retry penalty
  const penalty = retryCount * RETRY_PENALTY_PER_ATTEMPT;

  // Final score 0–1000
  return Math.max(0, Math.round((raw - penalty) * 10));
}

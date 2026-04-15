import z from "zod"
import { BusEvent } from "../bus/bus-event"
import { SessionID } from "./schema"

export const PhaseName = z.enum(["student_r0", "supervisor_r0", "student", "supervisor"])
export const RunStatus = z.enum(["pass", "fail", "error", "budget_exceeded"])

const Started = BusEvent.define(
  "dual.started",
  z.object({
    runID: z.string(),
    parentSessionID: SessionID.zod,
    studentSessionID: SessionID.zod,
    supervisorSessionID: SessionID.zod,
    task: z.string(),
    model: z.object({ providerID: z.string(), modelID: z.string() }),
    mode: z.enum(["fast", "strict", "auto"]),
    maxRounds: z.number().int(),
    budget: z
      .object({
        maxUsd: z.number().optional(),
        warnUsd: z.number().optional(),
      })
      .optional(),
    timestamp: z.number(),
  }),
)

const PhaseStarted = BusEvent.define(
  "dual.phase.started",
  z.object({
    runID: z.string(),
    round: z.number().int(),
    phase: PhaseName,
    timestamp: z.number(),
  }),
)

const PhaseCompleted = BusEvent.define(
  "dual.phase.completed",
  z.object({
    runID: z.string(),
    round: z.number().int(),
    phase: PhaseName,
    durationMs: z.number(),
    success: z.boolean(),
    errorKind: z.enum(["transient", "permission", "model", "other"]).optional(),
    errorMessage: z.string().optional(),
    timestamp: z.number(),
  }),
)

const VerdictReceived = BusEvent.define(
  "dual.verdict",
  z.object({
    runID: z.string(),
    round: z.number().int(),
    status: z.enum(["pass", "fail"]),
    mainIssue: z.string().optional(),
    timestamp: z.number(),
  }),
)

const TraceExtracted = BusEvent.define(
  "dual.trace.extracted",
  z.object({
    runID: z.string(),
    round: z.number().int(),
    toolCallCount: z.number().int(),
    timestamp: z.number(),
  }),
)

const BudgetCheck = BusEvent.define(
  "dual.budget.check",
  z.object({
    runID: z.string(),
    round: z.number().int(),
    phase: PhaseName,
    totalCost: z.number(),
    maxUsd: z.number().optional(),
    warnUsd: z.number().optional(),
    warned: z.boolean(),
    breached: z.boolean(),
    timestamp: z.number(),
  }),
)

const Retried = BusEvent.define(
  "dual.retry",
  z.object({
    runID: z.string(),
    phase: PhaseName,
    attempt: z.number().int(),
    delayMs: z.number(),
    errorMessage: z.string(),
    timestamp: z.number(),
  }),
)

const Finished = BusEvent.define(
  "dual.finished",
  z.object({
    runID: z.string(),
    status: RunStatus,
    rounds: z.number().int(),
    totalCost: z.number().optional(),
    totalDurationMs: z.number(),
    lastError: z.string().optional(),
    timestamp: z.number(),
  }),
)

export const Event = {
  Started,
  PhaseStarted,
  PhaseCompleted,
  VerdictReceived,
  TraceExtracted,
  BudgetCheck,
  Retried,
  Finished,
  all: [Started, PhaseStarted, PhaseCompleted, VerdictReceived, TraceExtracted, BudgetCheck, Retried, Finished] as const,
} as const

export type DualPhaseName = z.infer<typeof PhaseName>

import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Session } from "../../session"
import { SessionDualAgent } from "../../session/dual-agent"
import { Permission } from "../../permission"
import { SessionID } from "../../session/schema"
import { ProviderID, ModelID } from "../../provider/schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"

const log = Log.create({ service: "server" })

/**
 * Server-side registry of active interactive dual runs. The TUI gets a `runID`
 * back from `POST /dual`; subsequent `/advance`, `/abort`, `/model` calls look
 * the handle up here.
 *
 * Entries are cleaned up when the run's `result` promise settles (either the
 * orchestrator finished or it rejected), so a long-lived server doesn't leak
 * handles across many runs.
 */
const handles = new Map<string, SessionDualAgent.InteractiveHandle>()

const ModelSpec = z
  .object({
    providerID: ProviderID.zod,
    modelID: ModelID.zod,
  })
  .meta({ ref: "DualModelSpec" })

const SubtaskSpec = z
  .object({
    agent: z.string().min(1),
    description: z.string().min(1),
    prompt: z.string().min(1),
    model: ModelSpec.optional(),
  })
  .meta({ ref: "DualSubtaskSpec" })

const StartBody = z
  .object({
    task: z.string().min(1),
    model: ModelSpec.optional(),
    studentModel: ModelSpec.optional(),
    supervisorModel: ModelSpec.optional(),
    maxRounds: z.number().int().positive().max(20).optional(),
    mode: z.enum(["fast", "strict", "auto"]).optional(),
    testCmd: z.string().optional(),
    subtasks: z.array(SubtaskSpec).max(6).optional(),
    /**
     * Reuse existing child sessions instead of creating new ones. Pass both
     * IDs together on every message after the first so the dual-agent
     * conversation reads as one continuous stream.
     */
    studentSessionID: SessionID.zod.optional(),
    supervisorSessionID: SessionID.zod.optional(),
    parentSessionID: SessionID.zod.optional(),
  })
  .meta({ ref: "DualStartRequest" })

const StartResponse = z
  .object({
    runID: z.string(),
    parentSessionID: SessionID.zod,
    studentSessionID: SessionID.zod,
    supervisorSessionID: SessionID.zod,
  })
  .meta({ ref: "DualStartResponse" })

const ModelBody = z
  .object({
    // `null` clears the override and falls back to the static resolution the run
    // was started with. `undefined` / missing means "leave as-is".
    student: ModelSpec.nullable().optional(),
    supervisor: ModelSpec.nullable().optional(),
  })
  .meta({ ref: "DualModelRequest" })

export const DualRoutes = lazy(() =>
  new Hono()
    .post(
      "/",
      describeRoute({
        summary: "Start an interactive dual-agent run",
        description:
          "Creates a parent session, spins up isolated Student/Supervisor child sessions, and returns the run handle's id. Use the returned runID for subsequent advance/abort/model calls.",
        operationId: "dual.start",
        responses: {
          200: {
            description: "Run started",
            content: { "application/json": { schema: resolver(StartResponse) } },
          },
          ...errors(400, 500),
        },
      }),
      validator("json", StartBody),
      async (c) => {
        const body = c.req.valid("json")
        // Reuse the parent session when the caller passes it — otherwise spin up a
        // fresh one. Child session reuse is handled by the orchestrator itself.
        const parent = body.parentSessionID
          ? await Session.get(body.parentSessionID)
          : await Session.create({
              // Child sessions carry their own permission rulesets; the parent is just
              // a transcript container, so it needs permissive rules to let stamps through.
              permission: [{ permission: "*", pattern: "*", action: "allow" }] satisfies Permission.Ruleset,
            })
        const current = parent.title.startsWith("dual: ")
          ? parent.title.slice("dual: ".length).trim() || parent.title
          : parent.title
        if (current !== parent.title) {
          await Session.setTitle({
            sessionID: parent.id,
            title: current,
          })
        }
        if (Session.isDefaultTitle(current)) {
          const title = body.task.replace(/\s+/g, " ").trim()
          if (title) {
            await Session.setTitle({
              sessionID: parent.id,
              title: title.length > 96 ? `${title.slice(0, 95)}…` : title,
            })
          }
        }
        const handle = SessionDualAgent.runInteractive({
          parentSessionID: parent.id,
          task: body.task,
          model: body.model,
          studentModel: body.studentModel,
          supervisorModel: body.supervisorModel,
          maxRounds: body.maxRounds,
          mode: body.mode,
          testCmd: body.testCmd,
          subtasks: body.subtasks,
          studentSessionID: body.studentSessionID,
          supervisorSessionID: body.supervisorSessionID,
        })
        try {
          const info = await handle.ready
          handles.set(info.runID, handle)
          handle.result.finally(() => handles.delete(info.runID)).catch(() => {})
          return c.json({
            runID: info.runID,
            parentSessionID: parent.id,
            studentSessionID: info.studentSessionID,
            supervisorSessionID: info.supervisorSessionID,
          })
        } catch (err) {
          log.error("dual run failed to start", { error: err instanceof Error ? err.message : String(err) })
          return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
        }
      },
    )
    .post(
      "/:runID/advance",
      describeRoute({
        summary: "Advance to the next round",
        description:
          "Releases the between-rounds pause so the orchestrator runs the next Student/Supervisor phase. No-op if the loop is not currently paused.",
        operationId: "dual.advance",
        responses: {
          200: {
            description: "Advance signalled",
            content: { "application/json": { schema: resolver(z.object({ ok: z.literal(true) })) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      async (c) => {
        const handle = handles.get(c.req.valid("param").runID)
        if (!handle) return c.json({ error: "run not found" }, 404)
        handle.advance()
        return c.json({ ok: true as const })
      },
    )
    .post(
      "/:runID/abort",
      describeRoute({
        summary: "Abort a dual run",
        description:
          "Marks the run aborted. The currently waiting between-rounds pause rejects, and the run's result promise rejects. Does not interrupt an LLM call that is already in flight.",
        operationId: "dual.abort",
        responses: {
          200: {
            description: "Abort signalled",
            content: { "application/json": { schema: resolver(z.object({ ok: z.literal(true) })) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      validator("json", z.object({ reason: z.string().optional() })),
      async (c) => {
        const handle = handles.get(c.req.valid("param").runID)
        if (!handle) return c.json({ error: "run not found" }, 404)
        handle.abort(c.req.valid("json").reason)
        return c.json({ ok: true as const })
      },
    )
    .post(
      "/:runID/model",
      describeRoute({
        summary: "Swap Student and/or Supervisor model",
        description:
          "Updates the live model ref. Takes effect on the next phase (in-flight phases finish with their original model). Pass `null` for a field to clear its override and fall back to the static model the run started with.",
        operationId: "dual.model",
        responses: {
          200: {
            description: "Model updated",
            content: { "application/json": { schema: resolver(z.object({ ok: z.literal(true) })) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      validator("json", ModelBody),
      async (c) => {
        const handle = handles.get(c.req.valid("param").runID)
        if (!handle) return c.json({ error: "run not found" }, 404)
        const body = c.req.valid("json")
        if ("student" in body) handle.setStudentModel(body.student ?? undefined)
        if ("supervisor" in body) handle.setSupervisorModel(body.supervisor ?? undefined)
        return c.json({ ok: true as const })
      },
    ),
)

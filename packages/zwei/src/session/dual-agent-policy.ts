const SCAFFOLD_TAG_RX =
  /<\/?(task|supervisor_feedback|student_output|student_actions|memory_reminder|round|student_contract|student_round|feedback_ledger|test_results|plan_packet|l1|l2|l3)\b[^>]*>/gi

export interface StudentOutput {
  task_understanding?: string
  changes_made?: string[]
  artifact?: string
  self_check?: { what_i_checked?: string[]; remaining_risk?: string }
  request_for_supervisor?: string
}

export interface SupervisorOutput {
  status?: "pass" | "fail"
  main_issue?: string
  evidence?: string
  repair_hint?: string
  memory_reminder?: string
  need_code_snippet?: boolean
  requested_snippet?: string
}

export interface PlanPacket {
  l1: {
    goal: string
    constraints: string
    summary: string
  }
  l2: {
    current_step: string
    checkpoints: string[]
    verdict: string
  }
  l3: {
    evidence: string[]
    risks: string[]
  }
}

export interface TraceEntry {
  tool: string
  status: string
  input: string
  output?: string
  error?: string
}

const PACKET_MAX = 2_400
const PACKET_L2_MAX = 6
const PACKET_L3_MAX = 6
const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"])

function truncate(text: string, size: number) {
  if (!text) return ""
  if (text.length <= size) return text
  return text.slice(0, size - 1) + "…"
}

function lines(text: string | undefined, max: number, size: number) {
  if (!text) return []
  return text
    .split("\n")
    .map((x) => x.trim())
    .map((x) => x.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""))
    .filter(Boolean)
    .filter((x, i, all) => all.indexOf(x) === i)
    .slice(0, max)
    .map((x) => truncate(sanitizeScaffold(x), size))
}

function one(text: string | undefined, size: number) {
  return truncate(sanitizeScaffold(text || ""), size)
}

function sanitizeStudent(out: StudentOutput): StudentOutput {
  return {
    task_understanding: sanitizeScaffold(out.task_understanding),
    changes_made: (out.changes_made ?? []).map(sanitizeScaffold),
    artifact: sanitizeScaffold(out.artifact),
    self_check: {
      what_i_checked: (out.self_check?.what_i_checked ?? []).map(sanitizeScaffold),
      remaining_risk: sanitizeScaffold(out.self_check?.remaining_risk),
    },
    request_for_supervisor: sanitizeScaffold(out.request_for_supervisor),
  }
}

function sanitizeSupervisor(out: SupervisorOutput): SupervisorOutput {
  return {
    status: out.status,
    main_issue: sanitizeScaffold(out.main_issue),
    evidence: sanitizeScaffold(out.evidence),
    repair_hint: sanitizeScaffold(out.repair_hint),
    memory_reminder: sanitizeScaffold(out.memory_reminder),
    need_code_snippet: !!out.need_code_snippet,
    requested_snippet: sanitizeScaffold(out.requested_snippet),
  }
}

function risky(text: string | undefined) {
  const value = (text ?? "").trim().toLowerCase()
  if (!value) return false
  if (
    /^(none|n\/a|na|nil|no risk|low risk|low|done|ok|无|无风险|暂无风险|已完成|无明显风险)(\b|[\s—\-:：,，.。].*)?$/i.test(
      value,
    )
  ) {
    return false
  }
  return true
}

function asks(text: string | undefined) {
  const value = (text ?? "").toLowerCase()
  if (!value.trim()) return false
  return /(review|verify|check|supervisor|help|uncertain|blocked|风险|不确定|卡住|需要帮助|请审核)/i.test(value)
}

export function sanitizeScaffold(text: string | undefined): string {
  if (!text) return ""
  return text.replace(SCAFFOLD_TAG_RX, (m) => m.replace(/</g, "&lt;").replace(/>/g, "&gt;"))
}

export function packet(
  task: string,
  ledger: string[],
  student: StudentOutput | undefined,
  sup: SupervisorOutput | undefined,
  mode: "fast" | "strict" | "auto",
  prev: PlanPacket | undefined,
): PlanPacket {
  const out: PlanPacket = {
    l1: {
      goal: one(task, 240),
      constraints:
        mode === "strict"
          ? "plan-first; ask at most 3 blocking questions; prefer repo/public evidence"
          : mode === "auto"
            ? "phd-first; escalate to supervisor only on risky/complex rounds"
            : "execution-first; preserve previous fixes; minimize regressions",
      summary: one(sup?.main_issue || student?.task_understanding || prev?.l1.summary || task, 280),
    },
    l2: {
      current_step: one(sup?.repair_hint || student?.artifact || prev?.l2.current_step || "implement the current checkpoint", 420),
      checkpoints: lines(sup?.repair_hint || student?.artifact, PACKET_L2_MAX, 160),
      verdict: truncate(ledger.at(-1) || prev?.l2.verdict || "R0: pending", 180),
    },
    l3: {
      evidence: [
        ...lines(sup?.evidence, PACKET_L3_MAX, 180),
        ...ledger.slice(-3).map((x) => truncate(x, 180)),
        ...(prev?.l3.evidence ?? []).slice(0, 2),
      ].slice(0, PACKET_L3_MAX),
      risks: [...lines(sup?.memory_reminder, PACKET_L3_MAX, 180), ...(prev?.l3.risks ?? []).slice(0, 2)].slice(
        0,
        PACKET_L3_MAX,
      ),
    },
  }
  if (out.l2.checkpoints.length === 0) {
    out.l2.checkpoints =
      prev?.l2.checkpoints?.slice(0, PACKET_L2_MAX) ??
      [`round focus: ${truncate(sup?.main_issue || "continue implementation", 140)}`]
  }
  while (JSON.stringify(out).length > PACKET_MAX && out.l3.evidence.length > 0) out.l3.evidence.shift()
  while (JSON.stringify(out).length > PACKET_MAX && out.l3.risks.length > 0) out.l3.risks.shift()
  while (JSON.stringify(out).length > PACKET_MAX && out.l2.checkpoints.length > 1) out.l2.checkpoints.shift()
  return out
}

export function renderPacket(packet: PlanPacket | undefined) {
  if (!packet) return ""
  return ["<plan_packet>", JSON.stringify(packet, null, 2), "</plan_packet>", ""].join("\n")
}

export function extractPacket(
  text: string,
  parse: (text: string) => unknown | undefined,
): PlanPacket | undefined {
  const match = text.match(/<plan_packet[^>]*>\s*([\s\S]*?)\s*<\/plan_packet>/i)
  const body = (match ? match[1] : text).trim()
  if (!body) return
  const parsed = parse(body)
  if (!parsed || typeof parsed !== "object") return
  const obj = parsed as Record<string, unknown>
  if (typeof obj["l1"] !== "object" || typeof obj["l2"] !== "object" || typeof obj["l3"] !== "object") return
  const l1 = obj["l1"] as Record<string, unknown>
  const l2 = obj["l2"] as Record<string, unknown>
  const l3 = obj["l3"] as Record<string, unknown>
  const checkpoints = Array.isArray(l2["checkpoints"]) ? l2["checkpoints"].map((x) => one(String(x), 160)) : []
  const evidence = Array.isArray(l3["evidence"]) ? l3["evidence"].map((x) => one(String(x), 180)) : []
  const risks = Array.isArray(l3["risks"]) ? l3["risks"].map((x) => one(String(x), 180)) : []
  return {
    l1: {
      goal: one(String(l1["goal"] ?? ""), 240),
      constraints: one(String(l1["constraints"] ?? ""), 200),
      summary: one(String(l1["summary"] ?? ""), 280),
    },
    l2: {
      current_step: one(String(l2["current_step"] ?? ""), 420),
      checkpoints: checkpoints.filter(Boolean).slice(0, PACKET_L2_MAX),
      verdict: one(String(l2["verdict"] ?? ""), 180),
    },
    l3: {
      evidence: evidence.filter(Boolean).slice(0, PACKET_L3_MAX),
      risks: risks.filter(Boolean).slice(0, PACKET_L3_MAX),
    },
  }
}

export function formatTrace(trace: TraceEntry[]): string {
  if (trace.length === 0) return ""
  const out: string[] = []
  for (const [i, entry] of trace.entries()) {
    out.push(`${i + 1}. ${entry.tool} [${entry.status}]`)
    if (entry.input) out.push(`   input:  ${entry.input}`)
    if (entry.output) out.push(`   output: ${entry.output}`)
    if (entry.error) out.push(`   error:  ${entry.error}`)
  }
  return out.join("\n")
}

export function audit(
  round: number,
  student: StudentOutput,
  trace: TraceEntry[],
  feedback: SupervisorOutput | undefined,
) {
  const writes = trace.filter((x) => WRITE_TOOLS.has(x.tool)).length
  const changes = student.changes_made?.length ?? 0
  const riskText = `${student.self_check?.remaining_risk ?? ""}\n${student.request_for_supervisor ?? ""}`
  if (
    trace.length === 0 &&
    writes === 0 &&
    changes <= 2 &&
    !asks(student.request_for_supervisor) &&
    !risky(student.self_check?.remaining_risk)
  ) {
    return { review: false, stage: "none" as const, note: "simple text-only round" }
  }
  if (trace.some((x) => x.status === "error")) return { review: true, stage: "strict" as const, note: "tool errors detected" }
  if (
    /(critical|high risk|security|unsafe|migration|breaking|schema|cross[-\s]?module|复杂|高风险|架构|迁移|破坏性|重构)/i.test(
      riskText,
    )
  ) {
    return { review: true, stage: "strict" as const, note: "high-risk changes reported" }
  }
  if (trace.length >= 12) return { review: true, stage: "strict" as const, note: "trace is very large" }
  if ((student.artifact ?? "").length >= 2200) return { review: true, stage: "strict" as const, note: "artifact is very long" }
  if (writes + changes >= 8) return { review: true, stage: "strict" as const, note: "change set is very large" }
  if (feedback?.status === "fail" && round >= 2) {
    return { review: true, stage: "strict" as const, note: "follow-up after previous fail" }
  }
  if (asks(student.request_for_supervisor)) return { review: true, stage: "review" as const, note: "student requested review" }
  if (risky(student.self_check?.remaining_risk)) return { review: true, stage: "review" as const, note: "student reported risk" }
  if (trace.length >= 8) return { review: true, stage: "review" as const, note: "trace is large" }
  if ((student.artifact ?? "").length >= 2000) return { review: true, stage: "review" as const, note: "artifact is long" }
  if (writes + changes >= 4) return { review: true, stage: "review" as const, note: "change set is large" }
  return { review: false, stage: "none" as const, note: "simple round" }
}

export function renderStudentPrompt(
  task: string,
  feedback: SupervisorOutput | undefined,
  round: number,
  ledger: string[],
  plan: PlanPacket | undefined,
  mode: "fast" | "strict" | "auto",
): string {
  const safeTask = sanitizeScaffold(task)
  const recent = ledger.slice(-8)
  const ledgerBlock =
    recent.length > 0
      ? "\n<feedback_ledger>\n" + recent.join("\n") + "\n</feedback_ledger>\n"
      : ""
  const askRule =
    mode === "strict"
      ? "Plan rule: you may ask the user at most 3 questions total in this run; if the answer can be obtained from repository context or public documentation, do not interrupt the user."
      : undefined
  const packetBlock = renderPacket(plan)
  if (!feedback) {
    const rule =
      mode === "strict"
        ? "Use the plan_packet as canonical context and execute the current checkpoint only. Respond with the required JSON only."
        : "If the request is a simple chat/factual ask that does not need repo changes or review, answer directly in plain text (no JSON, no tools, concise). If you changed files, used tools, or need review, respond with the required JSON only."
    return [
      "<task>",
      safeTask,
      "</task>",
      packetBlock,
      ledgerBlock,
      ...(askRule ? [askRule] : []),
      rule,
    ].join("\n")
  }
  const safeFeedback = sanitizeSupervisor(feedback)
  const reminder = safeFeedback.memory_reminder
    ? `\n<memory_reminder>\n${safeFeedback.memory_reminder}\n</memory_reminder>`
    : ""
  return [
    "<task>",
    safeTask,
    "</task>",
    packetBlock,
    ledgerBlock,
    "<supervisor_feedback round=" + (round - 1) + ">",
    `main_issue: ${safeFeedback.main_issue || "(none)"}`,
    `evidence:   ${safeFeedback.evidence || "(none)"}`,
    `repair_hint: ${safeFeedback.repair_hint || "(none)"}`,
    "</supervisor_feedback>" + reminder,
    "",
    ...(askRule ? [askRule, ""] : []),
    "Focus only on the single failing issue above and the current checkpoint in plan_packet. Do NOT regress previously fixed issues shown in the ledger. Respond with the required JSON only.",
  ].join("\n")
}

export function renderStudentRound0Prompt(task: string): string {
  return [
    "<task>",
    sanitizeScaffold(task),
    "</task>",
    "",
    "<round>0 · plan-first (strict mode)</round>",
    "",
    "Produce a structured implementation plan draft, not code changes.",
    "Use repository evidence first; only if still blocked may you ask the user.",
    "You may ask at most 3 user questions total in this run.",
    "If the answer can be resolved from repository context or public documentation, do NOT interrupt the user.",
    "Put the actionable plan (summary, current_step, checkpoints, risks) in `artifact`.",
    "",
    "Respond with the required JSON only.",
  ].join("\n")
}

export function renderSupervisorRound0Prompt(task: string, contract: StudentOutput): string {
  return [
    "<task>",
    sanitizeScaffold(task),
    "</task>",
    "",
    "<round>0 · plan-review (strict mode)</round>",
    "<student_plan_draft>",
    JSON.stringify(sanitizeStudent(contract), null, 2),
    "</student_plan_draft>",
    "",
    "You are a senior engineer reviewer. Evaluate Student's draft plan for technical feasibility,",
    "reuse opportunities (repo + public code/platforms), and engineering risk.",
    "If reusable solutions exist, include how to adapt them. If not, justify feasibility.",
    "You may ask the user at most 3 questions total in this run, and only for blocking decisions.",
    "If the answer can be resolved from repository context or public documentation, do NOT interrupt the user.",
    "",
    "Return JSON in the existing schema, with this mapping:",
    '- status: MUST be "fail" in round 0 so Student proceeds to implementation rounds.',
    "- main_issue: one-line strategy selection and biggest risk.",
    "- evidence: reuse candidates and why they are (or are not) reusable.",
    "- repair_hint: concrete implementation plan + checkpoints where Supervisor should review (checkpoint list required).",
    "- memory_reminder: short guardrail to prevent regressions.",
    "",
    "Respond with the required JSON only.",
  ].join("\n")
}

export function renderSupervisorPlanRevisePrompt(
  task: string,
  plan: PlanPacket | undefined,
  feedback: SupervisorOutput | undefined,
  note: string,
) {
  return [
    "<task>",
    sanitizeScaffold(task),
    "</task>",
    "",
    "<round>0 · plan-revise (strict mode)</round>",
    renderPacket(plan),
    "<last_supervisor_feedback>",
    JSON.stringify(sanitizeSupervisor(feedback ?? {}), null, 2),
    "</last_supervisor_feedback>",
    "",
    "<user_change_request>",
    sanitizeScaffold(note),
    "</user_change_request>",
    "",
    "Revise the implementation plan only. Do not ask Student to execute yet.",
    "Return JSON in the existing schema:",
    '- status: "fail"',
    "- main_issue: updated strategy summary.",
    "- evidence: feasibility/reuse notes after user change request.",
    "- repair_hint: updated implementation plan with concrete checkpoints.",
    "- memory_reminder: concise guardrail.",
    "",
    "Respond with the required JSON only.",
  ].join("\n")
}

export function renderSupervisorPrompt(
  task: string,
  student: StudentOutput,
  round: number,
  trace: TraceEntry[],
  ledger: string[],
  plan: PlanPacket | undefined,
  preTestOutput?: string,
  mode?: "fast" | "strict" | "auto",
) {
  const recent = ledger.slice(-8)
  const out = [
    "<task>",
    sanitizeScaffold(task),
    "</task>",
    "",
  ]
  if (plan) out.push(renderPacket(plan))
  if (recent.length > 0) {
    out.push("<feedback_ledger>")
    out.push(...recent)
    out.push("</feedback_ledger>")
    out.push("")
  }
  out.push(
    "<student_round>" + round + "</student_round>",
    "<student_output>",
    JSON.stringify(sanitizeStudent(student), null, 2),
    "</student_output>",
  )
  if (trace.length > 0) {
    out.push("")
    out.push("<student_actions note='ground-truth trace — what Student actually did this round'>")
    out.push(formatTrace(trace))
    out.push("</student_actions>")
  }
  if (preTestOutput) {
    out.push("")
    out.push("<test_results note='pre-computed by orchestrator — do NOT re-run these tests'>")
    out.push(sanitizeScaffold(preTestOutput).slice(0, 3000))
    out.push("</test_results>")
  }
  out.push("")
  if (mode === "strict") {
    out.push(
      "Plan rule: you may ask the user at most 3 questions total in this run. Prefer repository evidence and public documentation; do not interrupt the user when the answer is derivable.",
    )
    out.push("")
  }
  if (mode === "auto") {
    out.push(
      "Auto review rule: when the task is non-trivial, provide concrete engineering implementation details in `repair_hint` using Markdown (files, steps, tests, and risk checks).",
    )
    out.push("")
  }
  out.push(
    "Validate the attempt." + (preTestOutput
      ? " Test results are included above — do NOT re-run these tests. Focus on diagnosing failures and giving a repair hint."
      : " Run tests or inspect files as needed.") +
    " Check that previously fixed issues in the ledger have not regressed. Respond with the required JSON only.",
  )
  return out.join("\n")
}

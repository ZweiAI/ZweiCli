import type { SessionID } from "./schema"

type Shape<M> = {
  studentModel?: M
  supervisorModel?: M
  _onGate?: unknown
  _modelRef?: unknown
  _onStart?: unknown
}

type Ready = {
  runID: string
  studentSessionID: SessionID
  supervisorSessionID: SessionID
}

export type InteractiveHandle<M, R> = {
  readonly result: Promise<R>
  readonly ready: Promise<Ready>
  readonly advance: () => void
  readonly abort: (reason?: string) => void
  readonly setModel: (model: M | undefined) => void
  readonly setStudentModel: (model: M | undefined) => void
  readonly setSupervisorModel: (model: M | undefined) => void
}

export function gate() {
  let cur: { resolve: () => void; reject: (err: Error) => void } | undefined
  let err: Error | undefined
  return {
    wait: async () => {
      if (err) throw err
      await new Promise<void>((resolve, reject) => {
        cur = { resolve, reject }
      })
      cur = undefined
      if (err) throw err
    },
    advance: () => cur?.resolve(),
    abort: (reason?: string) => {
      err = new Error(reason ?? "dual-agent run aborted")
      cur?.reject(err)
    },
  }
}

export function runInteractive<M, R, I extends Shape<M>>(run: (input: I) => Promise<R>, input: I): InteractiveHandle<M, R> {
  const g = gate()
  const model = {
    student: input.studentModel,
    supervisor: input.supervisorModel,
  } as { student?: M; supervisor?: M }
  let ok!: (info: Ready) => void
  let no!: (reason: unknown) => void
  const ready = new Promise<Ready>((resolve, reject) => {
    ok = resolve
    no = reject
  })
  const result = run({
    ...input,
    _onGate: async (_round: number) => {
      await g.wait()
    },
    _modelRef: model,
    _onStart: (info: Ready) => ok(info),
  })
  result.catch((cause) => no(cause))
  return {
    result,
    ready,
    advance: g.advance,
    abort: g.abort,
    setModel: (next) => {
      model.student = next
      model.supervisor = next
    },
    setStudentModel: (next) => {
      model.student = next
    },
    setSupervisorModel: (next) => {
      model.supervisor = next
    },
  }
}

import { LocalContext } from "../util/local-context"
import type { WorkspaceID } from "../control-plane/schema"

export interface WorkspaceContext {
  workspaceID: string
}

const context = LocalContext.create<WorkspaceContext>("instance")

export const WorkspaceContext = {
  async provide<R>(input: { workspaceID: WorkspaceID; fn: () => R }): Promise<R> {
    return context.provide({ workspaceID: input.workspaceID as string }, () => input.fn())
  },

  // Synchronous variant of provide — EffectBridge uses this to restore the
  // workspace id on cross-fiber boundaries without going through an await.
  restore<R>(workspaceID: string, fn: () => R): R {
    return context.provide({ workspaceID }, fn)
  },

  get workspaceID() {
    try {
      return context.use().workspaceID
    } catch (err) {
      return undefined
    }
  },
}

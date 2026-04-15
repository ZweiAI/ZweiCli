import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../component/prompt/history"

export type HomeRoute = {
  type: "home"
  initialPrompt?: PromptInfo
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  initialPrompt?: PromptInfo
}

export type PluginRoute = {
  type: "plugin"
  id: string
  data?: Record<string, unknown>
}

export type DualRoute = {
  type: "dual"
  sessionID?: string
  initialPrompt?: PromptInfo
}

export type Route = HomeRoute | SessionRoute | PluginRoute | DualRoute

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const initial: Route = process.env["ZWEI_ROUTE"]
      ? JSON.parse(process.env["ZWEI_ROUTE"])
      : { type: "home" }
    const [store, setStore] = createStore<Route>(initial)

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        // reconcile() replaces the store wholesale instead of doing the default
        // shallow merge. Without this, navigating to `{ type: "dual" }` from a
        // route that had a `sessionID` would leave the old sessionID in place,
        // which silently breaks /new (the user thinks they cleared the session
        // but the same conversation keeps appearing).
        setStore(reconcile(route))
      },
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}

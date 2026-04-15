import type { AssistantMessage, Message } from "@zwei/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@zwei/plugin/tui"
import { createMemo, Show } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function stat(msg: ReadonlyArray<Message>, api: TuiPluginApi) {
  const cost = msg.reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0)
  const last = msg.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
  if (!last) {
    return {
      tokens: 0,
      percent: null,
      cost,
    }
  }

  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  const model = api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
  return {
    tokens,
    percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    cost,
  }
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const dual = createMemo(() => props.api.route.current.name === "dual")
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const one = createMemo(() => stat(msg(), props.api))
  const kids = createMemo(() => props.api.state.session.children?.(props.session_id) ?? [])
  const stu = createMemo(() => kids().find((item) => item.title.startsWith("PhD ·") || item.title.startsWith("Student ·"))?.id)
  const sup = createMemo(() => kids().find((item) => item.title.startsWith("Supervisor ·"))?.id)
  const a = createMemo(() => {
    const id = stu()
    if (!id) return
    return stat(props.api.state.session.messages(id), props.api)
  })
  const b = createMemo(() => {
    const id = sup()
    if (!id) return
    return stat(props.api.state.session.messages(id), props.api)
  })
  const pair = createMemo(() => {
    const x = a()
    const y = b()
    if (!x || !y) return
    return { x, y }
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <Show
        when={dual() && pair()}
        fallback={
          <>
            <text fg={theme().textMuted}>{one().tokens.toLocaleString()} tokens</text>
            <text fg={theme().textMuted}>{one().percent ?? 0}% used</text>
            <text fg={theme().textMuted}>{money.format(one().cost)} spent</text>
          </>
        }
      >
        <text fg={theme().textMuted}>
          phd: {pair()!.x.tokens.toLocaleString()} tokens · {pair()!.x.percent ?? 0}% used · {money.format(pair()!.x.cost)} spent
        </text>
        <text fg={theme().textMuted}>
          supervisor: {pair()!.y.tokens.toLocaleString()} tokens · {pair()!.y.percent ?? 0}% used ·{" "}
          {money.format(pair()!.y.cost)} spent
        </text>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin

import { UI } from "../ui"
import { cmd } from "./cmd"

export const TaskCommand = cmd({
  command: "task",
  describe: "run a sample placeholder task",
  handler: async () => {
    UI.empty()
    UI.println("✔ Task proof of concept executed successfully.")
  },
})

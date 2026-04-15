import { describe, expect, test } from "bun:test"
import { renderStudentPrompt } from "../../src/session/dual-agent-policy"

describe("renderStudentPrompt", () => {
  test("fast mode allows direct replies for simple chat asks", () => {
    const text = renderStudentPrompt("你好", undefined, 1, [], undefined, "fast")
    expect(text).toContain("answer directly in plain text")
    expect(text).toContain("no tools")
  })

  test("strict mode still requires the JSON contract", () => {
    const text = renderStudentPrompt("你好", undefined, 1, [], undefined, "strict")
    expect(text).toContain("Respond with the required JSON only.")
    expect(text).not.toContain("answer directly in plain text")
  })
})

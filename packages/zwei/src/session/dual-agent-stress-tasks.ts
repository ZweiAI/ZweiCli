/**
 * Canonical stress tasks for the dual-agent comparison harness.
 *
 * Each task is a hand-designed scenario that stresses one axis of the long-range
 * attention claim:
 *
 *   - `stress-stack-8methods`: wide surface. 8 methods × 2+ edge cases = 16+ tests.
 *     Tests whether iterative supervisor feedback improves coverage over a single
 *     pass. No delayed constraints — this one is about iterative refinement, not
 *     state preservation.
 *
 *   - `stress-delayed-constraint-cart`: state preservation. Task text states two
 *     hard invariants in round 1 ("quantities are non-negative", "totals are
 *     integer cents"). Later rounds should preserve these invariants even while
 *     fixing unrelated bugs. If Student drifts — e.g. adds a floating-point bug in
 *     round 2 while fixing round 1's edge case handling — retention drops. That's
 *     the direct measurement of the long-range-attention claim.
 *
 * Design notes for the seed test files:
 *   - Tests use Bun's built-in `test` runner (`import { test, expect } from "bun:test"`)
 *     because Bun is always on PATH in any supervisor install.
 *   - Tests are independent behavioral checks — no compound goals that reward
 *     iteration-over-iteration for reasons unrelated to attention.
 *   - Each test has a descriptive name so per-test pass/fail tracking is meaningful
 *     for recurrence computation.
 */

import type { SessionDualAgentStress } from "./dual-agent-stress"

// Convenience alias — keeps the declarations readable
type Task = SessionDualAgentStress.StressTask

// ---------- Seed file contents ----------

const MINIMAL_PACKAGE_JSON = JSON.stringify(
  {
    name: "stress-scratch",
    type: "module",
    private: true,
  },
  null,
  2,
)

// -------- Stack test file (16 tests total) --------

const STACK_TEST_FILE = `import { test, expect } from "bun:test"
import { Stack } from "../src/stack.js"

// push + size + isEmpty
test("Stack push increments size", () => {
  const s = new Stack()
  s.push(1)
  s.push(2)
  expect(s.size()).toBe(2)
})

test("Stack isEmpty returns true on new stack", () => {
  const s = new Stack()
  expect(s.isEmpty()).toBe(true)
})

test("Stack isEmpty returns false after push", () => {
  const s = new Stack()
  s.push(1)
  expect(s.isEmpty()).toBe(false)
})

// peek
test("Stack peek returns top without removing", () => {
  const s = new Stack()
  s.push(10)
  s.push(20)
  expect(s.peek()).toBe(20)
  expect(s.size()).toBe(2)
})

test("Stack peek throws on empty stack", () => {
  const s = new Stack()
  expect(() => s.peek()).toThrow()
})

// pop
test("Stack pop returns and removes top", () => {
  const s = new Stack()
  s.push(1)
  s.push(2)
  expect(s.pop()).toBe(2)
  expect(s.size()).toBe(1)
})

test("Stack pop throws on empty stack", () => {
  const s = new Stack()
  expect(() => s.pop()).toThrow()
})

test("Stack pop returns items in LIFO order", () => {
  const s = new Stack()
  s.push("a")
  s.push("b")
  s.push("c")
  expect(s.pop()).toBe("c")
  expect(s.pop()).toBe("b")
  expect(s.pop()).toBe("a")
})

// clear
test("Stack clear removes all items", () => {
  const s = new Stack()
  s.push(1)
  s.push(2)
  s.clear()
  expect(s.size()).toBe(0)
  expect(s.isEmpty()).toBe(true)
})

test("Stack clear on empty stack is a no-op", () => {
  const s = new Stack()
  s.clear()
  expect(s.size()).toBe(0)
})

// toArray
test("Stack toArray returns items in top-first order", () => {
  const s = new Stack()
  s.push(1)
  s.push(2)
  s.push(3)
  expect(s.toArray()).toEqual([3, 2, 1])
})

test("Stack toArray on empty stack returns empty array", () => {
  const s = new Stack()
  expect(s.toArray()).toEqual([])
})

test("Stack toArray returns a copy (modifying result doesn't affect stack)", () => {
  const s = new Stack()
  s.push(1)
  const arr = s.toArray()
  arr.push(99)
  expect(s.size()).toBe(1)
})

// clone
test("Stack clone returns a new independent stack", () => {
  const s = new Stack()
  s.push(1)
  s.push(2)
  const c = s.clone()
  c.push(3)
  expect(s.size()).toBe(2)
  expect(c.size()).toBe(3)
})

test("Stack clone preserves order", () => {
  const s = new Stack()
  s.push("a")
  s.push("b")
  const c = s.clone()
  expect(c.pop()).toBe("b")
  expect(c.pop()).toBe("a")
})

test("Stack clone on empty stack returns empty stack", () => {
  const s = new Stack()
  const c = s.clone()
  expect(c.isEmpty()).toBe(true)
})
`

// -------- Cart test file (20 tests, several exercising the delayed constraints) --------

const CART_TEST_FILE = `import { test, expect } from "bun:test"
import { Cart } from "../src/cart.js"

// Test data: items have a priceCents field so the constraint "total is integer cents"
// can be verified without ambiguity.
const APPLE = { id: "apple", priceCents: 150 }
const BREAD = { id: "bread", priceCents: 499 }
const MILK = { id: "milk", priceCents: 325 }

// ----- Basic add / remove / total / clear -----

test("Cart new is empty (total 0, size 0)", () => {
  const c = new Cart()
  expect(c.getTotal()).toBe(0)
  expect(c.size()).toBe(0)
})

test("Cart add single item", () => {
  const c = new Cart()
  c.add(APPLE, 1)
  expect(c.getTotal()).toBe(150)
})

test("Cart add multiple distinct items", () => {
  const c = new Cart()
  c.add(APPLE, 2)
  c.add(BREAD, 1)
  expect(c.getTotal()).toBe(150 * 2 + 499)
})

test("Cart add same item twice accumulates quantity", () => {
  const c = new Cart()
  c.add(APPLE, 2)
  c.add(APPLE, 3)
  expect(c.getTotal()).toBe(150 * 5)
})

test("Cart remove reduces quantity", () => {
  const c = new Cart()
  c.add(APPLE, 5)
  c.remove(APPLE, 2)
  expect(c.getTotal()).toBe(150 * 3)
})

test("Cart remove entire quantity removes the entry", () => {
  const c = new Cart()
  c.add(APPLE, 3)
  c.remove(APPLE, 3)
  expect(c.getTotal()).toBe(0)
  expect(c.size()).toBe(0)
})

test("Cart clear empties everything", () => {
  const c = new Cart()
  c.add(APPLE, 1)
  c.add(BREAD, 2)
  c.clear()
  expect(c.getTotal()).toBe(0)
  expect(c.size()).toBe(0)
})

// ----- Constraint 1: quantities MUST NEVER be negative internally -----

test("CONSTRAINT[non-negative-qty]: remove more than owned clamps at 0, not negative", () => {
  const c = new Cart()
  c.add(APPLE, 2)
  c.remove(APPLE, 5)
  expect(c.getTotal()).toBe(0) // 0 items, not -3 × 150 = -450
  expect(c.size()).toBe(0)
})

test("CONSTRAINT[non-negative-qty]: repeated over-remove stays at 0", () => {
  const c = new Cart()
  c.add(BREAD, 1)
  c.remove(BREAD, 3)
  c.remove(BREAD, 2)
  expect(c.getTotal()).toBe(0)
})

test("CONSTRAINT[non-negative-qty]: removing from empty cart is a no-op, total stays 0", () => {
  const c = new Cart()
  c.remove(APPLE, 10)
  expect(c.getTotal()).toBe(0)
})

test("CONSTRAINT[non-negative-qty]: over-remove one item doesn't affect others", () => {
  const c = new Cart()
  c.add(APPLE, 1)
  c.add(BREAD, 2)
  c.remove(APPLE, 99)
  expect(c.getTotal()).toBe(499 * 2)
})

// ----- Constraint 2: getTotal MUST return integer cents, not float dollars -----

test("CONSTRAINT[integer-cents]: getTotal always returns an integer", () => {
  const c = new Cart()
  c.add(APPLE, 3)
  c.add(BREAD, 1)
  c.add(MILK, 2)
  const t = c.getTotal()
  expect(Number.isInteger(t)).toBe(true)
})

test("CONSTRAINT[integer-cents]: adding a 1-cent item at quantity 1 yields total 1 (not 0.01)", () => {
  const c = new Cart()
  c.add({ id: "penny", priceCents: 1 }, 1)
  expect(c.getTotal()).toBe(1)
})

test("CONSTRAINT[integer-cents]: three items at 99 cents each yields 297 cents", () => {
  const c = new Cart()
  c.add({ id: "thing", priceCents: 99 }, 3)
  expect(c.getTotal()).toBe(297)
})

test("CONSTRAINT[integer-cents]: large quantities don't overflow or introduce float error", () => {
  const c = new Cart()
  c.add(APPLE, 1000)
  expect(c.getTotal()).toBe(150000)
  expect(Number.isInteger(c.getTotal())).toBe(true)
})

// ----- Cross-operation sanity tests -----

test("Cart add-remove-add preserves correct total", () => {
  const c = new Cart()
  c.add(APPLE, 3)
  c.remove(APPLE, 1)
  c.add(APPLE, 2)
  expect(c.getTotal()).toBe(150 * 4)
})

test("Cart add different items then remove one, total reflects both", () => {
  const c = new Cart()
  c.add(APPLE, 2)
  c.add(BREAD, 1)
  c.remove(APPLE, 1)
  expect(c.getTotal()).toBe(150 + 499)
})

test("Cart size counts distinct item types, not total quantity", () => {
  const c = new Cart()
  c.add(APPLE, 5)
  c.add(BREAD, 1)
  expect(c.size()).toBe(2)
})

test("Cart remove with qty=0 is a no-op", () => {
  const c = new Cart()
  c.add(APPLE, 3)
  c.remove(APPLE, 0)
  expect(c.getTotal()).toBe(150 * 3)
})

test("Cart add with qty=0 doesn't create a phantom entry", () => {
  const c = new Cart()
  c.add(APPLE, 0)
  expect(c.size()).toBe(0)
  expect(c.getTotal()).toBe(0)
})
`

// -------- LRU cache test file (24 tests, two interacting limits + subtle semantics) --------

const LRU_TEST_FILE = `import { test, expect } from "bun:test"
import { LRUCache } from "../src/lru-cache.js"

// ----- Construction + basic CRUD -----

test("new cache is empty", () => {
  const c = new LRUCache({ maxEntries: 10, maxWeight: 100 })
  expect(c.size()).toBe(0)
  expect(c.totalWeight()).toBe(0)
})

test("set then get returns the value", () => {
  const c = new LRUCache({ maxEntries: 10, maxWeight: 100 })
  c.set("a", "alpha")
  expect(c.get("a")).toBe("alpha")
})

test("get on missing key returns undefined", () => {
  const c = new LRUCache({ maxEntries: 10, maxWeight: 100 })
  expect(c.get("missing")).toBeUndefined()
})

test("has returns true for present, false for missing", () => {
  const c = new LRUCache({ maxEntries: 10, maxWeight: 100 })
  c.set("a", "alpha")
  expect(c.has("a")).toBe(true)
  expect(c.has("b")).toBe(false)
})

test("delete removes the entry and returns true", () => {
  const c = new LRUCache({ maxEntries: 10, maxWeight: 100 })
  c.set("a", "alpha")
  expect(c.delete("a")).toBe(true)
  expect(c.has("a")).toBe(false)
  expect(c.size()).toBe(0)
})

test("delete on missing key returns false (does not throw)", () => {
  const c = new LRUCache({ maxEntries: 10, maxWeight: 100 })
  expect(c.delete("nope")).toBe(false)
})

test("clear empties the cache", () => {
  const c = new LRUCache({ maxEntries: 10, maxWeight: 100 })
  c.set("a", 1); c.set("b", 2); c.set("c", 3)
  c.clear()
  expect(c.size()).toBe(0)
  expect(c.totalWeight()).toBe(0)
  expect(c.get("a")).toBeUndefined()
})

test("size counts entries, totalWeight sums weights", () => {
  const c = new LRUCache({ maxEntries: 10, maxWeight: 100 })
  c.set("a", "alpha", 3)
  c.set("b", "beta", 5)
  expect(c.size()).toBe(2)
  expect(c.totalWeight()).toBe(8)
})

// ----- maxEntries enforcement -----

test("maxEntries: adding entry beyond limit evicts the LRU one", () => {
  const c = new LRUCache({ maxEntries: 3, maxWeight: 1000 })
  c.set("a", 1); c.set("b", 2); c.set("c", 3)
  c.set("d", 4)
  expect(c.size()).toBe(3)
  expect(c.has("a")).toBe(false)
  expect(c.has("d")).toBe(true)
})

test("maxEntries: get() promotes recency, so oldest non-touched is evicted", () => {
  const c = new LRUCache({ maxEntries: 3, maxWeight: 1000 })
  c.set("a", 1); c.set("b", 2); c.set("c", 3)
  // touch "a" so "b" becomes the LRU
  c.get("a")
  c.set("d", 4)
  expect(c.has("a")).toBe(true)
  expect(c.has("b")).toBe(false)
  expect(c.has("c")).toBe(true)
  expect(c.has("d")).toBe(true)
})

test("maxEntries: has() does NOT promote recency", () => {
  const c = new LRUCache({ maxEntries: 3, maxWeight: 1000 })
  c.set("a", 1); c.set("b", 2); c.set("c", 3)
  // peek "a" — should NOT count as a use
  c.has("a")
  c.set("d", 4)
  // "a" should still be the LRU and get evicted
  expect(c.has("a")).toBe(false)
  expect(c.has("b")).toBe(true)
  expect(c.has("c")).toBe(true)
  expect(c.has("d")).toBe(true)
})

test("maxEntries: updating existing key does not change size", () => {
  const c = new LRUCache({ maxEntries: 3, maxWeight: 1000 })
  c.set("a", 1); c.set("b", 2); c.set("c", 3)
  c.set("a", 99)
  expect(c.size()).toBe(3)
  expect(c.get("a")).toBe(99)
  expect(c.has("b")).toBe(true)
  expect(c.has("c")).toBe(true)
})

test("maxEntries: updating existing key promotes it to most-recent", () => {
  const c = new LRUCache({ maxEntries: 3, maxWeight: 1000 })
  c.set("a", 1); c.set("b", 2); c.set("c", 3)
  c.set("a", 99) // re-set "a" makes it MRU
  c.set("d", 4)  // should evict "b" (now LRU)
  expect(c.has("a")).toBe(true)
  expect(c.has("b")).toBe(false)
  expect(c.has("c")).toBe(true)
  expect(c.has("d")).toBe(true)
})

// ----- maxWeight enforcement -----

test("maxWeight: adding entry that pushes total over limit evicts LRU", () => {
  const c = new LRUCache({ maxEntries: 1000, maxWeight: 10 })
  c.set("a", "alpha", 4)
  c.set("b", "beta", 4)
  // total = 8, both fit
  c.set("c", "gamma", 5) // would make total = 13, evict "a" (weight 4) → total = 9
  expect(c.has("a")).toBe(false)
  expect(c.has("b")).toBe(true)
  expect(c.has("c")).toBe(true)
  expect(c.totalWeight()).toBeLessThanOrEqual(10)
})

test("maxWeight: evicts MULTIPLE LRU entries until within limit", () => {
  const c = new LRUCache({ maxEntries: 1000, maxWeight: 10 })
  c.set("a", "alpha", 3)
  c.set("b", "beta", 3)
  c.set("c", "gamma", 3) // total = 9
  c.set("d", "delta", 6) // would be 15 → evict "a" (12), still over → evict "b" (9)
  expect(c.has("a")).toBe(false)
  expect(c.has("b")).toBe(false)
  expect(c.has("c")).toBe(true)
  expect(c.has("d")).toBe(true)
  expect(c.totalWeight()).toBeLessThanOrEqual(10)
})

test("maxWeight: updating an entry's weight may trigger eviction of OTHERS", () => {
  const c = new LRUCache({ maxEntries: 1000, maxWeight: 10 })
  c.set("a", "alpha", 2)
  c.set("b", "beta", 2)
  c.set("c", "gamma", 2)
  // total = 6
  c.set("a", "alpha2", 9) // re-set "a" with weight 9; new total would be 13 → evict "b" (11) → evict "c" (9)
  expect(c.totalWeight()).toBeLessThanOrEqual(10)
  expect(c.has("a")).toBe(true)
  expect(c.has("b")).toBe(false)
  expect(c.has("c")).toBe(false)
})

test("maxWeight: a single entry exceeding the limit is rejected (not stored)", () => {
  const c = new LRUCache({ maxEntries: 1000, maxWeight: 10 })
  c.set("huge", "x", 100)
  // The cache cannot satisfy the constraint with this entry; it should not be stored.
  expect(c.has("huge")).toBe(false)
  expect(c.size()).toBe(0)
})

// ----- Both limits interacting -----

test("both limits: enforces whichever is exceeded first", () => {
  const c = new LRUCache({ maxEntries: 5, maxWeight: 10 })
  c.set("a", 1, 2)
  c.set("b", 2, 2)
  c.set("c", 3, 2)
  c.set("d", 4, 2)
  c.set("e", 5, 2) // total weight = 10, count = 5 — both at limit
  expect(c.size()).toBe(5)
  expect(c.totalWeight()).toBe(10)
  c.set("f", 6, 1) // count would go to 6 → evict "a" (5/9)
  expect(c.size()).toBe(5)
  expect(c.has("a")).toBe(false)
  expect(c.has("f")).toBe(true)
})

// ----- Edge cases -----

test("set with weight=0 is allowed; entry counts toward maxEntries but not weight", () => {
  const c = new LRUCache({ maxEntries: 2, maxWeight: 10 })
  c.set("a", "alpha", 0)
  c.set("b", "beta", 0)
  expect(c.size()).toBe(2)
  expect(c.totalWeight()).toBe(0)
  c.set("c", "gamma", 0) // count over → evict "a"
  expect(c.has("a")).toBe(false)
})

test("get on evicted key returns undefined", () => {
  const c = new LRUCache({ maxEntries: 2, maxWeight: 1000 })
  c.set("a", 1); c.set("b", 2); c.set("c", 3)
  expect(c.get("a")).toBeUndefined()
})

test("set then delete then set again works (no ghost entries)", () => {
  const c = new LRUCache({ maxEntries: 3, maxWeight: 1000 })
  c.set("a", 1)
  c.delete("a")
  c.set("a", 2)
  expect(c.size()).toBe(1)
  expect(c.get("a")).toBe(2)
})

test("repeated updates of same key keep it most-recent", () => {
  const c = new LRUCache({ maxEntries: 2, maxWeight: 1000 })
  c.set("a", 1)
  c.set("b", 2)
  for (let i = 0; i < 10; i++) c.set("a", i)
  // "a" has been touched many times, "b" is the LRU
  c.set("c", 999) // should evict "b"
  expect(c.has("a")).toBe(true)
  expect(c.has("b")).toBe(false)
  expect(c.has("c")).toBe(true)
})

test("clear preserves the cache config (limits still apply after clear)", () => {
  const c = new LRUCache({ maxEntries: 2, maxWeight: 1000 })
  c.set("a", 1); c.set("b", 2); c.set("c", 3)
  // "a" was evicted, size = 2
  c.clear()
  expect(c.size()).toBe(0)
  // Re-add 3 entries → maxEntries=2 should still be enforced
  c.set("x", 1); c.set("y", 2); c.set("z", 3)
  expect(c.size()).toBe(2)
  expect(c.has("x")).toBe(false)
})

test("values can be any type (object, null, undefined explicitly)", () => {
  const c = new LRUCache({ maxEntries: 10, maxWeight: 100 })
  const obj = { x: 1 }
  c.set("o", obj)
  c.set("n", null)
  c.set("u", undefined)
  expect(c.get("o")).toBe(obj)
  expect(c.get("n")).toBe(null)
  // Note: get("u") returns undefined, but we can't distinguish this from "missing key"
  // without has() — so use has() to verify the entry exists
  expect(c.has("u")).toBe(true)
})
`

// -------- MiniPipe DSL test file (34 tests, custom syntax the model hasn't seen) --------

const MINIPIPE_TEST_FILE = `import { test, expect } from "bun:test"
import { run } from "../src/minipipe.js"

// ----- Basic values (parsed and returned as-is, no transforms) -----

test("bare number", () => expect(run("42")).toBe(42))
test("negative number", () => expect(run("-5")).toBe(-5))
test("decimal number", () => expect(run("3.14")).toBe(3.14))
test("string value", () => expect(run("'hello'")).toBe("hello"))
test("empty string", () => expect(run("''")).toBe(""))
test("empty list", () => expect(run("[]")).toEqual([]))
test("list of numbers", () => expect(run("[1, 2, 3]")).toEqual([1, 2, 3]))
test("nested list", () => expect(run("[1, [2, 3]]")).toEqual([1, [2, 3]]))

// ----- Basic transforms -----

test("add on number", () => expect(run("10 | add:5")).toBe(15))
test("mul on number", () => expect(run("7 | mul:3")).toBe(21))
test("neg on number", () => expect(run("5 | neg")).toBe(-5))
test("neg on negative", () => expect(run("-3 | neg")).toBe(3))
test("len of string", () => expect(run("'hello' | len")).toBe(5))
test("len of list", () => expect(run("[1, 2, 3] | len")).toBe(3))
test("rev of string", () => expect(run("'abcd' | rev")).toBe("dcba"))
test("rev of list", () => expect(run("[1, 2, 3] | rev")).toEqual([3, 2, 1]))

// ----- Pipe chaining -----

test("chain number transforms", () => expect(run("5 | add:3 | mul:2 | neg")).toBe(-16))
test("chain string transforms", () => expect(run("'hello' | rev | head:3")).toBe("oll"))
test("chain list transforms", () => expect(run("[3, 1, 2] | rev | head:2")).toEqual([2, 1]))

// ----- add on list = APPEND (the trap) -----

test("add on list appends element", () => expect(run("[1, 2] | add:3")).toEqual([1, 2, 3]))
test("add on empty list", () => expect(run("[] | add:1")).toEqual([1]))
test("add chain on list appends each", () => expect(run("[1] | add:2 | add:3")).toEqual([1, 2, 3]))

// ----- head / tail edge cases -----

test("head:0 returns empty list", () => expect(run("[1, 2, 3] | head:0")).toEqual([]))
test("head:0 on string returns empty string", () => expect(run("'hello' | head:0")).toBe(""))
test("head exceeding length returns all", () => expect(run("[1, 2] | head:99")).toEqual([1, 2]))
test("tail:2 on string", () => expect(run("'hello' | tail:2")).toBe("lo"))
test("head on empty list", () => expect(run("[] | head:5")).toEqual([]))
test("tail on empty list", () => expect(run("[] | tail:3")).toEqual([]))

// ----- flat (one level only!) -----

test("flat basic", () => expect(run("[1, [2, 3], 4] | flat")).toEqual([1, 2, 3, 4]))
test("flat one level only", () => expect(run("[1, [2, [3]]] | flat")).toEqual([1, 2, [3]]))
test("flat empty sublists", () => expect(run("[[], [1], []] | flat")).toEqual([1]))
test("flat on already-flat list", () => expect(run("[1, 2, 3] | flat")).toEqual([1, 2, 3]))

// ----- map -----

test("map:neg on number list", () => expect(run("[1, -2, 3] | map:neg")).toEqual([-1, 2, -3]))
test("map:len on string list", () => expect(run("['hi', 'hello'] | map:len")).toEqual([2, 5]))
test("map:rev on string list", () => expect(run("['ab', 'cd'] | map:rev")).toEqual(["ba", "dc"]))

// ----- join -----

test("join with separator", () => expect(run("[1, 2, 3] | join:'-'")).toBe("1-2-3"))
test("join empty list", () => expect(run("[] | join:','")).toBe(""))
test("join coerces elements to string", () => expect(run("[1, 'a', 2] | join:''")).toBe("1a2"))

// ----- String escaping -----

test("escaped single quote", () => expect(run("'it''s'")).toBe("it's"))
test("double escaped quote", () => expect(run("'a''b''c'")).toBe("a'b'c"))

// ----- Type errors (must throw) -----

test("neg on string throws", () => expect(() => run("'x' | neg")).toThrow())
test("mul on list throws", () => expect(() => run("[1] | mul:2")).toThrow())
test("add on string throws", () => expect(() => run("'x' | add:1")).toThrow())
test("flat on number throws", () => expect(() => run("5 | flat")).toThrow())
test("len on number throws", () => expect(() => run("5 | len")).toThrow())
test("map on number throws", () => expect(() => run("5 | map:neg")).toThrow())
test("map:neg on list with string throws", () => expect(() => run("[1, 'a'] | map:neg")).toThrow())

// ----- Whitespace tolerance -----

test("extra whitespace everywhere", () => expect(run("  42  |  add : 5  |  neg  ")).toBe(-47))
`

// -------- Expression evaluator test file (30 tests, heavy on unary minus + precedence) --------

const CALC_TEST_FILE = `import { test, expect } from "bun:test"
import { calc } from "../src/calc.js"

// ----- Basic arithmetic -----

test("addition", () => expect(calc("2 + 3")).toBe(5))
test("subtraction", () => expect(calc("10 - 7")).toBe(3))
test("multiplication", () => expect(calc("4 * 5")).toBe(20))
test("division", () => expect(calc("15 / 3")).toBe(5))
test("decimal division", () => expect(calc("7 / 2")).toBe(3.5))

// ----- Operator precedence (classic LLM failure point) -----

test("mul before add", () => expect(calc("2 + 3 * 4")).toBe(14))
test("mul before sub", () => expect(calc("10 - 2 * 3")).toBe(4))
test("div before add", () => expect(calc("1 + 6 / 2")).toBe(4))
test("mixed precedence chain", () => expect(calc("2 + 3 * 4 - 1")).toBe(13))

// ----- Left-to-right associativity (another common mistake) -----

test("subtraction is left-assoc", () => expect(calc("10 - 3 - 2")).toBe(5))
test("division is left-assoc", () => expect(calc("24 / 4 / 2")).toBe(3))
test("mixed same-prec left-assoc", () => expect(calc("12 / 3 * 2")).toBe(8))

// ----- Parentheses -----

test("parens override precedence", () => expect(calc("(2 + 3) * 4")).toBe(20))
test("nested parens", () => expect(calc("((1 + 2) * (3 + 4))")).toBe(21))
test("deeply nested parens", () => expect(calc("((((5))))")).toBe(5))
test("parens in mid-expression", () => expect(calc("2 * (3 + 4) * 5")).toBe(70))

// ----- Unary minus (THE hardest part — most LLMs trip here) -----

test("unary minus standalone", () => expect(calc("-5")).toBe(-5))
test("unary minus in addition", () => expect(calc("2 + -3")).toBe(-1))
test("unary minus in multiplication", () => expect(calc("2 * -3")).toBe(-6))
test("double unary minus", () => expect(calc("--5")).toBe(5))
test("triple unary minus", () => expect(calc("---5")).toBe(-5))
test("unary minus inside parens", () => expect(calc("(-3 + 5)")).toBe(2))
test("unary minus on parenthesized group", () => expect(calc("-(3 + 2)")).toBe(-5))
test("unary minus after open paren", () => expect(calc("(-5) * 2")).toBe(-10))

// ----- Whitespace handling -----

test("no spaces", () => expect(calc("2+3*4")).toBe(14))
test("lots of spaces", () => expect(calc("  2  +  3  ")).toBe(5))

// ----- Error handling (must throw) -----

test("empty string throws", () => expect(() => calc("")).toThrow())
test("only whitespace throws", () => expect(() => calc("   ")).toThrow())
test("division by zero throws", () => expect(() => calc("5 / 0")).toThrow())
test("unmatched open paren throws", () => expect(() => calc("(2 + 3")).toThrow())
test("unmatched close paren throws", () => expect(() => calc("2 + 3)")).toThrow())
test("trailing operator throws", () => expect(() => calc("2 + ")).toThrow())
test("leading binary operator throws", () => expect(() => calc("* 5")).toThrow())
test("consecutive binary operators throws", () => expect(() => calc("2 + * 3")).toThrow())
`

// -------- Multi-file reactive system test file (40 tests, 2 source files) --------
// Tests a reactive primitives layer (signals + computed + effects + batch)
// and a store layer built on top (CRUD + computed fields + middleware + transactions).
// The interaction between auto-dependency tracking, batch deduplication, and
// transaction rollback is where one-shotting breaks down.

const REACTIVE_SYSTEM_TEST_FILE = `import { test, expect } from "bun:test"
import { signal, computed, effect, batch } from "../src/reactive.js"
import { createStore } from "../src/store.js"

// ===== SIGNAL BASICS =====

test("signal get returns initial value", () => {
  const [get] = signal(42)
  expect(get()).toBe(42)
})

test("signal set updates value", () => {
  const [get, set] = signal(1)
  set(2)
  expect(get()).toBe(2)
})

test("multiple signals are independent", () => {
  const [getA, setA] = signal(1)
  const [getB, setB] = signal(10)
  setA(5)
  expect(getA()).toBe(5)
  expect(getB()).toBe(10)
})

// ===== COMPUTED =====

test("computed reads signal value", () => {
  const [get, set] = signal(3)
  const doubled = computed(() => get() * 2)
  expect(doubled()).toBe(6)
})

test("computed updates when signal changes", () => {
  const [get, set] = signal(3)
  const doubled = computed(() => get() * 2)
  set(5)
  expect(doubled()).toBe(10)
})

test("computed with multiple signals", () => {
  const [a, setA] = signal(1)
  const [b, setB] = signal(2)
  const sum = computed(() => a() + b())
  expect(sum()).toBe(3)
  setA(10)
  expect(sum()).toBe(12)
  setB(20)
  expect(sum()).toBe(30)
})

test("chained computed (computed depends on computed)", () => {
  const [get, set] = signal(2)
  const doubled = computed(() => get() * 2)
  const quadrupled = computed(() => doubled() * 2)
  expect(quadrupled()).toBe(8)
  set(5)
  expect(quadrupled()).toBe(20)
})

test("computed is lazy (not computed until read)", () => {
  let callCount = 0
  const [get, set] = signal(1)
  const c = computed(() => { callCount++; return get() * 2 })
  expect(callCount).toBe(0)  // not computed yet
  c()  // first read triggers computation
  expect(callCount).toBe(1)
})

test("computed caches until dependency changes", () => {
  let callCount = 0
  const [get, set] = signal(1)
  const c = computed(() => { callCount++; return get() * 2 })
  c(); c(); c()
  expect(callCount).toBe(1)  // computed once, cached twice
  set(2)
  c()
  expect(callCount).toBe(2)  // recomputed after signal change
})

// ===== EFFECT =====

test("effect runs immediately on creation", () => {
  const [get] = signal(5)
  let observed = 0
  effect(() => { observed = get() })
  expect(observed).toBe(5)
})

test("effect re-runs when signal changes", () => {
  const [get, set] = signal(1)
  const log = []
  effect(() => { log.push(get()) })
  set(2)
  set(3)
  expect(log).toEqual([1, 2, 3])
})

test("effect cleanup runs before re-execution", () => {
  const [get, set] = signal(1)
  const log = []
  effect(() => {
    const val = get()
    log.push("run:" + val)
    return () => { log.push("cleanup:" + val) }
  })
  set(2)
  set(3)
  expect(log).toEqual(["run:1", "cleanup:1", "run:2", "cleanup:2", "run:3"])
})

test("effect returns dispose function", () => {
  const [get, set] = signal(1)
  const log = []
  const dispose = effect(() => { log.push(get()) })
  set(2)
  dispose()
  set(3)  // should NOT trigger effect
  expect(log).toEqual([1, 2])
})

// ===== BATCH =====

test("batch delays recomputation until end", () => {
  const [a, setA] = signal(1)
  const [b, setB] = signal(2)
  const log = []
  effect(() => { log.push(a() + b()) })
  expect(log).toEqual([3])
  batch(() => {
    setA(10)
    setB(20)
  })
  // Effect should fire ONCE with final values, not twice with intermediate
  expect(log).toEqual([3, 30])
})

test("batch with diamond dependency fires computed once", () => {
  const [get, set] = signal(1)
  let computeCount = 0
  const doubled = computed(() => { computeCount = 0; return get() * 2 })
  const tripled = computed(() => get() * 3)
  const sum = computed(() => { computeCount++; return doubled() + tripled() })
  sum()  // prime
  computeCount = 0
  batch(() => { set(2) })
  sum()
  expect(computeCount).toBeLessThanOrEqual(1)
  expect(sum()).toBe(10)  // 4 + 6
})

test("nested batch only flushes at outermost", () => {
  const [get, set] = signal(0)
  const log = []
  effect(() => { log.push(get()) })
  batch(() => {
    set(1)
    batch(() => {
      set(2)
    })
    // inner batch end should NOT flush yet
    set(3)
  })
  // Only one effect fire after outermost batch
  expect(log).toEqual([0, 3])
})

// ===== STORE BASICS =====

test("store set and get", () => {
  const store = createStore({ name: "initial" })
  expect(store.get("name")).toBe("initial")
  store.set("name", "updated")
  expect(store.get("name")).toBe("updated")
})

test("store get missing field returns undefined", () => {
  const store = createStore({ x: 1 })
  expect(store.get("missing")).toBeUndefined()
})

test("store subscribe notifies on change", () => {
  const store = createStore({ count: 0 })
  const log = []
  store.subscribe("count", (val) => log.push(val))
  store.set("count", 1)
  store.set("count", 2)
  expect(log).toEqual([1, 2])
})

test("store unsubscribe stops notifications", () => {
  const store = createStore({ x: 0 })
  const log = []
  const unsub = store.subscribe("x", (v) => log.push(v))
  store.set("x", 1)
  unsub()
  store.set("x", 2)
  expect(log).toEqual([1])
})

// ===== STORE COMPUTED =====

test("store computed field", () => {
  const store = createStore({ first: "John", last: "Doe" })
  store.computed("full", () => store.get("first") + " " + store.get("last"))
  expect(store.get("full")).toBe("John Doe")
})

test("store computed updates reactively", () => {
  const store = createStore({ price: 100, tax: 0.1 })
  store.computed("total", () => store.get("price") * (1 + store.get("tax")))
  expect(store.get("total")).toBe(110)
  store.set("price", 200)
  expect(store.get("total")).toBe(220)
})

test("store computed is subscribable", () => {
  const store = createStore({ x: 1 })
  store.computed("doubled", () => store.get("x") * 2)
  const log = []
  store.subscribe("doubled", (v) => log.push(v))
  store.set("x", 5)
  expect(log).toEqual([10])
})

// ===== STORE MIDDLEWARE =====

test("middleware can transform value", () => {
  const store = createStore({ name: "" })
  store.use((field, value, next) => {
    next(typeof value === "string" ? value.trim() : value)
  })
  store.set("name", "  hello  ")
  expect(store.get("name")).toBe("hello")
})

test("middleware can reject value (don't call next)", () => {
  const store = createStore({ age: 25 })
  store.use((field, value, next) => {
    if (field === "age" && (typeof value !== "number" || value < 0)) return  // reject
    next(value)
  })
  store.set("age", -5)
  expect(store.get("age")).toBe(25)  // unchanged
})

test("middleware chain runs in order", () => {
  const store = createStore({ val: "" })
  store.use((f, v, next) => next(v + "A"))
  store.use((f, v, next) => next(v + "B"))
  store.set("val", "")
  expect(store.get("val")).toBe("AB")
})

test("subscriber sees value AFTER middleware", () => {
  const store = createStore({ x: 0 })
  store.use((f, v, next) => next(v * 2))
  const log = []
  store.subscribe("x", (v) => log.push(v))
  store.set("x", 5)
  expect(log).toEqual([10])
})

// ===== STORE TRANSACTIONS =====

test("transaction commits all changes", () => {
  const store = createStore({ a: 1, b: 2 })
  store.transaction(() => {
    store.set("a", 10)
    store.set("b", 20)
  })
  expect(store.get("a")).toBe(10)
  expect(store.get("b")).toBe(20)
})

test("transaction rolls back on error", () => {
  const store = createStore({ a: 1, b: 2 })
  expect(() => {
    store.transaction(() => {
      store.set("a", 10)
      store.set("b", 20)
      throw new Error("abort")
    })
  }).toThrow("abort")
  expect(store.get("a")).toBe(1)
  expect(store.get("b")).toBe(2)
})

test("transaction batches subscriber notifications", () => {
  const store = createStore({ x: 0 })
  const log = []
  store.subscribe("x", (v) => log.push(v))
  store.transaction(() => {
    store.set("x", 1)
    store.set("x", 2)
    store.set("x", 3)
  })
  // Should fire once with final value, not three times
  expect(log).toEqual([3])
})

test("rolled-back transaction does not notify subscribers", () => {
  const store = createStore({ x: 0 })
  const log = []
  store.subscribe("x", (v) => log.push(v))
  try {
    store.transaction(() => {
      store.set("x", 99)
      throw new Error("nope")
    })
  } catch {}
  expect(log).toEqual([])
})

// ===== CIRCULAR DETECTION =====

test("circular computed throws on read", () => {
  const store = createStore({})
  store.computed("a", () => store.get("b"))
  store.computed("b", () => store.get("a"))
  expect(() => store.get("a")).toThrow()
})
`

// -------- Reactive spreadsheet test file (35 tests, formula + reactive + cycles + errors) --------

const SHEET_TEST_FILE = `import { test, expect } from "bun:test"
import { Sheet } from "../src/sheet.js"

// ===== BASIC SET / GET / DELETE =====

test("set and get a number", () => {
  const s = new Sheet()
  s.set("A1", 42)
  expect(s.get("A1")).toBe(42)
})

test("set and get a string", () => {
  const s = new Sheet()
  s.set("A1", "hello")
  expect(s.get("A1")).toBe("hello")
})

test("get nonexistent cell returns undefined", () => {
  const s = new Sheet()
  expect(s.get("Z99")).toBeUndefined()
})

test("delete removes cell", () => {
  const s = new Sheet()
  s.set("A1", 5)
  s.delete("A1")
  expect(s.get("A1")).toBeUndefined()
})

test("overwrite cell value", () => {
  const s = new Sheet()
  s.set("A1", 1)
  s.set("A1", 2)
  expect(s.get("A1")).toBe(2)
})

// ===== FORMULA BASICS =====

test("formula with literals only", () => {
  const s = new Sheet()
  s.set("A1", "=5+3")
  expect(s.get("A1")).toBe(8)
})

test("formula with cell reference", () => {
  const s = new Sheet()
  s.set("A1", 10)
  s.set("B1", "=A1+5")
  expect(s.get("B1")).toBe(15)
})

test("formula with two cell refs", () => {
  const s = new Sheet()
  s.set("A1", 3)
  s.set("A2", 4)
  s.set("A3", "=A1*A2")
  expect(s.get("A3")).toBe(12)
})

test("formula operator precedence (* before +)", () => {
  const s = new Sheet()
  s.set("A1", "=2+3*4")
  expect(s.get("A1")).toBe(14)
})

test("formula with parentheses", () => {
  const s = new Sheet()
  s.set("A1", "=(2+3)*4")
  expect(s.get("A1")).toBe(20)
})

// ===== REACTIVE PROPAGATION =====

test("changing a cell updates its dependent", () => {
  const s = new Sheet()
  s.set("A1", 5)
  s.set("B1", "=A1+10")
  expect(s.get("B1")).toBe(15)
  s.set("A1", 20)
  expect(s.get("B1")).toBe(30)
})

test("chain propagation: A1 → B1 → C1", () => {
  const s = new Sheet()
  s.set("A1", 1)
  s.set("B1", "=A1*2")
  s.set("C1", "=B1+10")
  expect(s.get("C1")).toBe(12)
  s.set("A1", 5)
  expect(s.get("B1")).toBe(10)
  expect(s.get("C1")).toBe(20)
})

test("diamond propagation: D depends on B and C, both depend on A", () => {
  const s = new Sheet()
  s.set("A1", 2)
  s.set("B1", "=A1+1")
  s.set("C1", "=A1+2")
  s.set("D1", "=B1+C1")
  expect(s.get("D1")).toBe(7)
  s.set("A1", 10)
  expect(s.get("D1")).toBe(23)
})

test("multiple dependents all update", () => {
  const s = new Sheet()
  s.set("A1", 1)
  s.set("B1", "=A1")
  s.set("C1", "=A1")
  s.set("D1", "=A1")
  s.set("A1", 99)
  expect(s.get("B1")).toBe(99)
  expect(s.get("C1")).toBe(99)
  expect(s.get("D1")).toBe(99)
})

// ===== CYCLE DETECTION =====

test("direct self-reference is a cycle", () => {
  const s = new Sheet()
  s.set("A1", "=A1")
  expect(s.get("A1")).toBe("#CYCLE!")
})

test("indirect cycle: A1 → B1 → A1", () => {
  const s = new Sheet()
  s.set("A1", "=B1")
  s.set("B1", "=A1")
  expect(s.get("A1")).toBe("#CYCLE!")
  expect(s.get("B1")).toBe("#CYCLE!")
})

test("3-cell cycle: A1 → B1 → C1 → A1", () => {
  const s = new Sheet()
  s.set("A1", "=B1")
  s.set("B1", "=C1")
  s.set("C1", "=A1")
  expect(s.get("A1")).toBe("#CYCLE!")
  expect(s.get("B1")).toBe("#CYCLE!")
  expect(s.get("C1")).toBe("#CYCLE!")
})

test("breaking a cycle resolves it", () => {
  const s = new Sheet()
  s.set("A1", "=B1")
  s.set("B1", "=A1")
  expect(s.get("A1")).toBe("#CYCLE!")
  // Break the cycle by setting A1 to a literal
  s.set("A1", 42)
  expect(s.get("A1")).toBe(42)
  expect(s.get("B1")).toBe(42)
})

test("cycle does not infect unrelated cells", () => {
  const s = new Sheet()
  s.set("A1", "=B1")
  s.set("B1", "=A1")
  s.set("C1", 100)
  expect(s.get("C1")).toBe(100)
})

// ===== ERROR PROPAGATION =====

test("reference to nonexistent cell is #REF!", () => {
  const s = new Sheet()
  s.set("A1", "=Z99")
  expect(s.get("A1")).toBe("#REF!")
})

test("delete cascades #REF! to dependents", () => {
  const s = new Sheet()
  s.set("A1", 10)
  s.set("B1", "=A1*2")
  s.delete("A1")
  expect(s.get("B1")).toBe("#REF!")
})

test("delete cascades #REF! through chain", () => {
  const s = new Sheet()
  s.set("A1", 1)
  s.set("B1", "=A1")
  s.set("C1", "=B1")
  s.delete("A1")
  expect(s.get("B1")).toBe("#REF!")
  expect(s.get("C1")).toBe("#REF!")
})

test("division by zero returns #DIV/0!", () => {
  const s = new Sheet()
  s.set("A1", "=10/0")
  expect(s.get("A1")).toBe("#DIV/0!")
})

test("division by cell that is zero returns #DIV/0!", () => {
  const s = new Sheet()
  s.set("A1", 0)
  s.set("B1", "=10/A1")
  expect(s.get("B1")).toBe("#DIV/0!")
})

test("error in dependency propagates to dependent", () => {
  const s = new Sheet()
  s.set("A1", "=1/0")
  s.set("B1", "=A1+5")
  expect(s.get("B1")).toBe("#DIV/0!")
})

// ===== RANGE FUNCTIONS =====

test("SUM basic", () => {
  const s = new Sheet()
  s.set("A1", 1)
  s.set("A2", 2)
  s.set("A3", 3)
  s.set("B1", "=SUM(A1:A3)")
  expect(s.get("B1")).toBe(6)
})

test("COUNT basic", () => {
  const s = new Sheet()
  s.set("A1", 10)
  s.set("A2", 20)
  s.set("A3", 30)
  s.set("B1", "=COUNT(A1:A3)")
  expect(s.get("B1")).toBe(3)
})

test("SUM with empty cells in range treats them as 0", () => {
  const s = new Sheet()
  s.set("A1", 5)
  // A2 not set
  s.set("A3", 10)
  s.set("B1", "=SUM(A1:A3)")
  expect(s.get("B1")).toBe(15)
})

test("SUM reactively updates when range cell changes", () => {
  const s = new Sheet()
  s.set("A1", 1)
  s.set("A2", 2)
  s.set("B1", "=SUM(A1:A2)")
  expect(s.get("B1")).toBe(3)
  s.set("A2", 10)
  expect(s.get("B1")).toBe(11)
})

test("SUM with an error cell in range propagates error", () => {
  const s = new Sheet()
  s.set("A1", 5)
  s.set("A2", "=1/0")
  s.set("A3", 10)
  s.set("B1", "=SUM(A1:A3)")
  expect(s.get("B1")).toBe("#DIV/0!")
})

// ===== EDGE CASES =====

test("replacing formula with literal removes dependency", () => {
  const s = new Sheet()
  s.set("A1", 5)
  s.set("B1", "=A1+1")
  expect(s.get("B1")).toBe(6)
  // Replace formula with literal
  s.set("B1", 99)
  expect(s.get("B1")).toBe(99)
  // Changing A1 should no longer affect B1
  s.set("A1", 100)
  expect(s.get("B1")).toBe(99)
})

test("get never throws, even for errors", () => {
  const s = new Sheet()
  s.set("A1", "=1/0")
  s.set("A2", "=A2")
  s.set("A3", "=NONEXISTENT")
  // None of these should throw
  expect(typeof s.get("A1")).toBe("string")
  expect(typeof s.get("A2")).toBe("string")
  expect(typeof s.get("A3")).toBe("string")
  expect(s.get("Z1")).toBeUndefined()
})
`

// -------- Ledger test file (27 tests, biased toward delayed-constraint retention) --------

const LEDGER_TEST_FILE = `import { test, expect } from "bun:test"
import { Ledger } from "../src/ledger.js"

const RENT = { id: "rent", account: " Housing ", cents: -120000, tags: [" Fixed ", "home", "fixed"] }
const PAY = { id: "pay", account: "Income", cents: 250000, tags: [" Salary "] }
const COFFEE = { id: "coffee", account: "Food", cents: -450, tags: [" Cafe ", "daily"] }

test("Ledger new is empty", () => {
  const l = new Ledger()
  expect(l.balance("income")).toBe(0)
  expect(l.balances()).toEqual([])
  expect(l.history()).toEqual([])
  expect(l.snapshot()).toEqual([])
})

test("post returns normalized stored copy", () => {
  const l = new Ledger()
  expect(l.post(RENT)).toEqual({
    id: "rent",
    account: "housing",
    cents: -120000,
    tags: ["fixed", "home"],
    voided: false,
  })
})

test("post does not mutate caller object", () => {
  const l = new Ledger()
  const e = { id: "x", account: " Travel ", cents: -999, tags: [" Work "] }
  l.post(e)
  expect(e).toEqual({ id: "x", account: " Travel ", cents: -999, tags: [" Work "] })
})

test("post does not retain caller tags array by reference", () => {
  const l = new Ledger()
  const e = { id: "x", account: "travel", cents: -999, tags: ["work"] }
  l.post(e)
  e.tags.push("later")
  expect(l.snapshot()[0].tags).toEqual(["work"])
})

test("balance sums active entries for one account", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post({ id: "bonus", account: "income", cents: 5000, tags: ["bonus"] })
  l.post({ id: "tax", account: "income", cents: -1000, tags: ["tax"] })
  expect(l.balance(" income ")).toBe(254000)
})

test("balance returns 0 for missing account", () => {
  const l = new Ledger()
  l.post(PAY)
  expect(l.balance("missing")).toBe(0)
})

test("balances returns account totals in first-seen order", () => {
  const l = new Ledger()
  l.post(COFFEE)
  l.post(PAY)
  l.post(RENT)
  expect(l.balances()).toEqual([
    { account: "food", cents: -450 },
    { account: "income", cents: 250000 },
    { account: "housing", cents: -120000 },
  ])
})

test("history returns active entries in insertion order", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post(COFFEE)
  l.post(RENT)
  expect(l.history().map((x) => x.id)).toEqual(["pay", "coffee", "rent"])
})

test("history account filter is trim + lowercase normalized", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post({ id: "bonus", account: " income ", cents: 7000, tags: ["bonus"] })
  l.post(RENT)
  expect(l.history({ account: " INCOME " }).map((x) => x.id)).toEqual(["pay", "bonus"])
})

test("history tag filter is trim + lowercase normalized", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post(COFFEE)
  l.post({ id: "tea", account: "food", cents: -300, tags: ["daily", "drink"] })
  expect(l.history({ tag: " DAILY " }).map((x) => x.id)).toEqual(["coffee", "tea"])
})

test("void returns true once and false when repeated", () => {
  const l = new Ledger()
  l.post(PAY)
  expect(l.void("pay")).toBe(true)
  expect(l.void("pay")).toBe(false)
})

test("void returns false for missing id", () => {
  const l = new Ledger()
  expect(l.void("missing")).toBe(false)
})

test("voided entries are excluded from balance and default history", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post(RENT)
  l.void("pay")
  expect(l.balance("income")).toBe(0)
  expect(l.history().map((x) => x.id)).toEqual(["rent"])
})

test("history includeVoided keeps original insertion order", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post(RENT)
  l.void("pay")
  expect(l.history({ includeVoided: true }).map((x) => [x.id, x.voided])).toEqual([
    ["pay", true],
    ["rent", false],
  ])
})

test("snapshot includes voided entries", () => {
  const l = new Ledger()
  l.post(PAY)
  l.void("pay")
  expect(l.snapshot()).toEqual([
    { id: "pay", account: "income", cents: 250000, tags: ["salary"], voided: true },
  ])
})

test("remove returns true for present and false for missing", () => {
  const l = new Ledger()
  l.post(PAY)
  expect(l.remove("pay")).toBe(true)
  expect(l.remove("pay")).toBe(false)
})

test("remove deletes entry entirely, including from snapshot", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post(RENT)
  l.remove("pay")
  expect(l.snapshot().map((x) => x.id)).toEqual(["rent"])
})

test("replacing an id updates data but preserves its original slot", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post(COFFEE)
  l.post(RENT)
  l.post({ id: "pay", account: "income", cents: 260000, tags: ["salary", "adjusted"] })
  expect(l.snapshot().map((x) => x.id)).toEqual(["pay", "coffee", "rent"])
  expect(l.snapshot()[0]).toEqual({
    id: "pay",
    account: "income",
    cents: 260000,
    tags: ["salary", "adjusted"],
    voided: false,
  })
})

test("replacing a voided id reactivates it in the same slot", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post(RENT)
  l.void("pay")
  l.post({ id: "pay", account: "income", cents: 10, tags: ["restart"] })
  expect(l.snapshot().map((x) => [x.id, x.voided, x.cents])).toEqual([
    ["pay", false, 10],
    ["rent", false, -120000],
  ])
})

test("removing then posting the same id appends as a new slot", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post(COFFEE)
  l.remove("pay")
  l.post({ id: "pay", account: "income", cents: 1, tags: [] })
  expect(l.snapshot().map((x) => x.id)).toEqual(["coffee", "pay"])
})

test("history returns deep copies", () => {
  const l = new Ledger()
  l.post(PAY)
  const out = l.history()
  out[0].tags.push("mutated")
  out[0].account = "hacked"
  expect(l.history()[0]).toEqual({
    id: "pay",
    account: "income",
    cents: 250000,
    tags: ["salary"],
    voided: false,
  })
})

test("snapshot returns deep copies", () => {
  const l = new Ledger()
  l.post(PAY)
  const out = l.snapshot()
  out[0].tags.push("mutated")
  out[0].voided = true
  expect(l.snapshot()[0]).toEqual({
    id: "pay",
    account: "income",
    cents: 250000,
    tags: ["salary"],
    voided: false,
  })
})

test("balances exclude accounts with no active entries left", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post(RENT)
  l.void("pay")
  expect(l.balances()).toEqual([{ account: "housing", cents: -120000 }])
})

test("cents must be an integer", () => {
  const l = new Ledger()
  expect(() => l.post({ id: "bad", account: "income", cents: 1.25, tags: [] })).toThrow()
})

test("balance remains integer after many operations", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post(RENT)
  l.post(COFFEE)
  l.void("coffee")
  l.post({ id: "bonus", account: "income", cents: 99, tags: ["bonus"] })
  expect(Number.isInteger(l.balance("income"))).toBe(true)
  expect(Number.isInteger(l.balance("housing"))).toBe(true)
})

test("history filter can combine account + tag + includeVoided", () => {
  const l = new Ledger()
  l.post({ id: "a", account: "income", cents: 10, tags: ["bonus"] })
  l.post({ id: "b", account: "income", cents: 20, tags: ["salary"] })
  l.post({ id: "c", account: "income", cents: 30, tags: ["bonus"] })
  l.void("c")
  expect(l.history({ account: "income", tag: "bonus" }).map((x) => x.id)).toEqual(["a"])
  expect(l.history({ account: "income", tag: "bonus", includeVoided: true }).map((x) => x.id)).toEqual(["a", "c"])
})

test("history does not expose internal ordering when caller mutates returned array", () => {
  const l = new Ledger()
  l.post(PAY)
  l.post(RENT)
  const out = l.history()
  out.reverse()
  expect(l.history().map((x) => x.id)).toEqual(["pay", "rent"])
})
`

// -------- JSON Patch test file (RFC 6902 — genuinely hard, multi-round task) --------

const JSON_PATCH_TEST_FILE = `import { test, expect } from "bun:test"
import { applyPatch } from "../src/patch.js"

// === add / replace / remove on objects ===

test("patch add inserts new property into object", () => {
  const out = applyPatch({ a: 1 }, [{ op: "add", path: "/b", value: 2 }])
  expect(out).toEqual({ a: 1, b: 2 })
})

test("patch add on existing path replaces value", () => {
  const out = applyPatch({ a: 1 }, [{ op: "add", path: "/a", value: 99 }])
  expect(out).toEqual({ a: 99 })
})

test("patch replace on missing path throws", () => {
  expect(() =>
    applyPatch({ a: 1 }, [{ op: "replace", path: "/missing", value: 0 }]),
  ).toThrow()
})

test("patch remove deletes property", () => {
  const out = applyPatch({ a: 1, b: 2 }, [{ op: "remove", path: "/a" }])
  expect(out).toEqual({ b: 2 })
})

test("patch remove missing path throws", () => {
  expect(() => applyPatch({ a: 1 }, [{ op: "remove", path: "/missing" }])).toThrow()
})

// === array operations ===

test("patch add to array at index inserts and shifts", () => {
  const out = applyPatch([1, 2, 3], [{ op: "add", path: "/1", value: 99 }])
  expect(out).toEqual([1, 99, 2, 3])
})

test("patch add with '-' appends to array", () => {
  const out = applyPatch([1, 2], [{ op: "add", path: "/-", value: 3 }])
  expect(out).toEqual([1, 2, 3])
})

test("patch remove from array shifts remaining", () => {
  const out = applyPatch([1, 2, 3], [{ op: "remove", path: "/1" }])
  expect(out).toEqual([1, 3])
})

test("patch add at array index > length throws", () => {
  expect(() => applyPatch([1, 2], [{ op: "add", path: "/5", value: 9 }])).toThrow()
})

// === move / copy ===

test("patch move relocates value and removes source", () => {
  const out = applyPatch({ a: 1, b: 2 }, [{ op: "move", from: "/a", path: "/c" }])
  expect(out).toEqual({ b: 2, c: 1 })
})

test("patch copy keeps source intact", () => {
  const out = applyPatch({ a: { n: 1 } }, [{ op: "copy", from: "/a", path: "/b" }])
  expect(out).toEqual({ a: { n: 1 }, b: { n: 1 } })
})

test("patch move into own descendant throws", () => {
  expect(() =>
    applyPatch({ a: { b: 1 } }, [{ op: "move", from: "/a", path: "/a/b" }]),
  ).toThrow()
})

// === test op (comparison) ===

test("patch test op succeeds on deep-equal values", () => {
  const out = applyPatch(
    { a: { x: [1, 2] } },
    [
      { op: "test", path: "/a", value: { x: [1, 2] } },
      { op: "add", path: "/b", value: true },
    ],
  )
  expect(out).toEqual({ a: { x: [1, 2] }, b: true })
})

test("patch test op with type mismatch fails whole patch", () => {
  expect(() =>
    applyPatch({ a: 1 }, [{ op: "test", path: "/a", value: "1" }]),
  ).toThrow()
})

// === JSON pointer path escapes ===

test("patch path ~1 decodes to / as key segment", () => {
  const out = applyPatch({ "a/b": 1 }, [{ op: "replace", path: "/a~1b", value: 99 }])
  expect(out).toEqual({ "a/b": 99 })
})

test("patch path ~0 decodes to ~ as key segment", () => {
  const out = applyPatch({ "a~b": 1 }, [{ op: "replace", path: "/a~0b", value: 99 }])
  expect(out).toEqual({ "a~b": 99 })
})

test("patch path ~01 is ~1 literal (escape not applied twice)", () => {
  const out = applyPatch({ "~1": 1 }, [{ op: "replace", path: "/~01", value: 99 }])
  expect(out).toEqual({ "~1": 99 })
})

// === root path, atomic rollback, no-mutation ===

test("patch with root path '' replaces entire document", () => {
  const out = applyPatch({ a: 1 }, [{ op: "replace", path: "", value: { b: 2 } }])
  expect(out).toEqual({ b: 2 })
})

test("patch is atomic: failing later op leaves original untouched", () => {
  const original = { a: 1, b: 2 }
  const snapshot = JSON.parse(JSON.stringify(original))
  expect(() =>
    applyPatch(original, [
      { op: "add", path: "/c", value: 3 },
      { op: "remove", path: "/a" },
      { op: "remove", path: "/does-not-exist" },
    ]),
  ).toThrow()
  expect(original).toEqual(snapshot)
})

test("successful patch does not mutate the original document", () => {
  const original = { a: { n: 1 }, list: [1, 2] }
  const snapshot = JSON.parse(JSON.stringify(original))
  applyPatch(original, [
    { op: "add", path: "/a/m", value: 9 },
    { op: "add", path: "/list/-", value: 3 },
  ])
  expect(original).toEqual(snapshot)
})
`

// -------- Flock pipeline engine (custom DSL, 15 planted bugs, multi-file, context-inflation test) --------
//
// Purpose: test whether dual-agent's split-session context helps on tasks where the single-mode
// context balloons across 4 source files + supervisor's multi-round feedback. Custom DSL so model
// cannot shortcut via training data. Test names are opaque (t_01..t_20) so supervisor feedback
// can only describe "test X failed, expected Y got Z" without naming the invariant.
//
// Bugs (15 total, distributed across files — do NOT mention in prompt):
//  Engine (6): proto-pollution via plain object storage; duplicate check via truthy lookup;
//    retries off-by-one; deps passed as array instead of keyed object; result not deep-copied
//    on store; shallow snapshot.
//  Graph (3): topoSort returns reversed order; cycle detection only tracks `visited` (misses
//    self-cycles and transitive cycles); unused but misleading `removeNode` that leaks edges.
//  Util (2): deepClone returns {} for Date instances; deepClone hits `Object.keys` on primitive
//    wrapper objects (fine in common cases but edge case).
//  Errors (2): CycleError uses old-school function+prototype style so `instanceof FlockError`
//    fails; UnknownTaskError's message missing the task name.
//  Priority (2): priority ordering not respected in scheduler when siblings are ready; restore
//    does shallow copy of input state.

const FLOCK_ERRORS_SRC = `// Custom error hierarchy for Flock.

export class FlockError extends Error {
  constructor(msg) {
    super(msg)
    this.name = "FlockError"
  }
}

export class UnknownTaskError extends FlockError {
  constructor(name) {
    // BUG: message does not include the missing task name — tests check the message
    super("task not found")
    this.name = "UnknownTaskError"
    this.taskName = name
  }
}

export class DuplicateTaskError extends FlockError {
  constructor(name) {
    super("duplicate task: " + name)
    this.name = "DuplicateTaskError"
    this.taskName = name
  }
}

// BUG: old-school function-based class + prototype chain does NOT go through FlockError.
// As a result \`new CycleError() instanceof FlockError\` is false.
export function CycleError(cycle) {
  Error.call(this, "cycle: " + cycle.join(" -> "))
  this.name = "CycleError"
  this.message = "cycle: " + cycle.join(" -> ")
  this.cycle = cycle
}
CycleError.prototype = Object.create(Error.prototype)
CycleError.prototype.constructor = CycleError

export class RetryExhaustedError extends FlockError {
  constructor(name, cause) {
    super("retry exhausted for " + name)
    this.name = "RetryExhaustedError"
    this.taskName = name
    this.cause = cause
  }
}
`

const FLOCK_UTIL_SRC = `// Shared helpers for Flock.

// Deep-copy plain values, arrays, and nested objects.
export function deepClone(value) {
  if (value === null) return null
  if (typeof value !== "object") return value
  if (Array.isArray(value)) {
    return value.map(deepClone)
  }
  // BUG: Date is typeof "object" but has no enumerable own keys. Result is {}, losing the time.
  const out = {}
  for (const k of Object.keys(value)) {
    out[k] = deepClone(value[k])
  }
  return out
}

// Deterministic sort stable by priority DESC then by insertion-order ASC.
export function orderByPriority(entries) {
  // entries: [{ name, priority, insertedAt }, ...]
  // BUG: sorts by priority ASC — callers expect DESC (higher priority runs first).
  return [...entries].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.insertedAt - b.insertedAt
  })
}
`

const FLOCK_GRAPH_SRC = `import { CycleError } from "./errors.js"

// Directed graph. Edge \`addEdge(from, to)\` means "from depends on to" — so \`to\` must run first.
export class Graph {
  constructor() {
    this.nodes = new Set()
    this.edges = new Map()
  }

  addNode(name) {
    this.nodes.add(name)
    if (!this.edges.has(name)) this.edges.set(name, new Set())
  }

  addEdge(from, to) {
    this.addNode(from)
    this.addNode(to)
    this.edges.get(from).add(to)
  }

  // Removes a node and all edges mentioning it.
  removeNode(name) {
    // BUG: only removes outgoing edges; incoming edges (other nodes' references to this node)
    // are left dangling. Later topoSort on a dangling edge will error or visit missing nodes.
    this.nodes.delete(name)
    this.edges.delete(name)
  }

  has(name) {
    return this.nodes.has(name)
  }

  // Returns an order where each node appears AFTER all its dependencies.
  // Throws CycleError if a cycle is reachable from \`start\`.
  topoSort(start) {
    const result = []
    const visited = new Set()
    // BUG: no \`visiting\` / in-progress set. Cycles that return to an already-finished branch
    // silently slip through, and self-cycles (a -> a) are not detected because the second
    // visit is short-circuited by \`visited.has(n)\`.
    const dfs = (n) => {
      if (visited.has(n)) return
      visited.add(n)
      for (const next of this.edges.get(n) ?? []) {
        dfs(next)
      }
      result.push(n)
    }
    dfs(start)
    // BUG: reverse — callers expect deps-first, but this yields target-first.
    return result.reverse()
  }
}
`

const FLOCK_ENGINE_SRC = `import { Graph } from "./graph.js"
import { deepClone, orderByPriority } from "./util.js"
import {
  UnknownTaskError,
  DuplicateTaskError,
  RetryExhaustedError,
} from "./errors.js"

export class Flock {
  constructor() {
    // BUG: plain object storage is vulnerable to prototype keys ("__proto__", "constructor", ...).
    this.tasks = {}
    this.results = {}
    this.graph = new Graph()
    this.counter = 0
  }

  define(name, fn, options = {}) {
    // BUG: truthy check — "toString" is present on every {} via prototype, so defining
    // "toString" looks like redefine even on a fresh Flock. Inversely, defining the SAME
    // name twice where fn returns 0/false/null might be considered undefined (falsy).
    if (this.tasks[name]) {
      throw new DuplicateTaskError(name)
    }
    const deps = options.deps ?? []
    const priority = options.priority ?? 0
    const retries = options.retries ?? 1
    this.tasks[name] = {
      fn,
      deps,
      priority,
      retries,
      insertedAt: this.counter++,
    }
    this.graph.addNode(name)
    for (const d of deps) {
      this.graph.addEdge(name, d)
    }
  }

  run(target, ctx = {}) {
    if (!this.tasks[target]) {
      throw new UnknownTaskError(target)
    }
    const order = this.graph.topoSort(target)
    for (const name of order) {
      if (this.results[name] !== undefined) continue
      const task = this.tasks[name]
      if (!task) {
        throw new UnknownTaskError(name)
      }
      // BUG: deps are collected as an ARRAY aligned to task.deps, not as a keyed object.
      // Tests call \`deps.a + deps.b\` expecting an object keyed by dep name.
      const depsArg = task.deps.map((d) => this.results[d])
      const ordered = orderByPriority(
        task.deps.map((d) => ({
          name: d,
          priority: this.tasks[d].priority,
          insertedAt: this.tasks[d].insertedAt,
        })),
      )
      void ordered // priority reserved for a future scheduler hook

      // BUG: retries is interpreted as "number of extra retries" (one attempt + N retries = N+1 total),
      // but tests treat retries as "total attempts allowed". With retries:3 the test expects 3 total
      // tries; this code performs 4.
      let lastErr
      for (let attempt = 0; attempt <= task.retries; attempt++) {
        try {
          const value = task.fn(ctx, depsArg)
          // BUG: result stored by reference; later callers mutating the returned object leak into state.
          this.results[name] = value
          lastErr = undefined
          break
        } catch (e) {
          lastErr = e
        }
      }
      if (lastErr !== undefined) {
        throw new RetryExhaustedError(name, lastErr)
      }
    }
    return this.results[target]
  }

  // Full state copy; callers may freely mutate the returned value.
  snapshot() {
    // BUG: shallow — Object.assign copies top-level keys only. Nested objects/arrays are shared.
    return Object.assign({}, this.results)
  }

  restore(state) {
    // BUG: shallow restore — the caller's nested objects share refs with our state.
    this.results = Object.assign({}, state)
  }
}
`

const FLOCK_TEST_FILE = `import { test, expect } from "bun:test"
import { Flock } from "../src/flock/engine.js"
import {
  FlockError,
  CycleError,
  UnknownTaskError,
  DuplicateTaskError,
} from "../src/flock/errors.js"

test("t_01", () => {
  const f = new Flock()
  f.define("a", () => 1)
  expect(f.run("a")).toBe(1)
})

test("t_02", () => {
  const f = new Flock()
  f.define("a", () => 10)
  f.define("b", (ctx, deps) => deps.a + 1, { deps: ["a"] })
  expect(f.run("b")).toBe(11)
})

test("t_03", () => {
  const f = new Flock()
  f.define("a", () => 1, { deps: ["b"] })
  f.define("b", () => 1, { deps: ["c"] })
  f.define("c", () => 1, { deps: ["a"] })
  let threw = false
  try { f.run("a") } catch (e) { threw = e instanceof CycleError }
  expect(threw).toBe(true)
})

test("t_04", () => {
  const f = new Flock()
  f.define("a", () => 1, { deps: ["a"] })
  let threw = false
  try { f.run("a") } catch (e) { threw = e instanceof CycleError }
  expect(threw).toBe(true)
})

test("t_05", () => {
  const f = new Flock()
  expect(() => f.run("missing")).toThrow(UnknownTaskError)
})

test("t_06", () => {
  const f = new Flock()
  f.define("a", () => 1, { deps: ["ghost"] })
  expect(() => f.run("a")).toThrow(UnknownTaskError)
})

test("t_07", () => {
  const f = new Flock()
  f.define("a", () => 1)
  expect(() => f.define("a", () => 2)).toThrow(DuplicateTaskError)
})

test("t_08", () => {
  const f = new Flock()
  f.define("__proto__", () => 42)
  expect({}.foo).toBeUndefined()
  expect(f.run("__proto__")).toBe(42)
})

test("t_09", () => {
  const f = new Flock()
  f.define("toString", () => 7)
  expect(f.run("toString")).toBe(7)
  expect(() => f.define("toString", () => 1)).toThrow(DuplicateTaskError)
})

test("t_10", () => {
  const f = new Flock()
  f.define("a", () => 10)
  f.define("b", () => 20)
  f.define("c", (ctx, deps) => deps.a + deps.b, { deps: ["a", "b"] })
  expect(f.run("c")).toBe(30)
})

test("t_11", () => {
  const order = []
  const f = new Flock()
  f.define("a", () => { order.push("a"); return 1 })
  f.define("b", (ctx, deps) => { order.push("b"); return deps.a + 1 }, { deps: ["a"] })
  f.define("c", (ctx, deps) => { order.push("c"); return deps.b + 1 }, { deps: ["b"] })
  f.run("c")
  expect(order).toEqual(["a", "b", "c"])
})

test("t_12", () => {
  const f = new Flock()
  f.define("a", (ctx) => ctx.x + 1)
  expect(f.run("a", { x: 10 })).toBe(11)
})

test("t_13", () => {
  const f = new Flock()
  f.define("a", () => ({ count: 5, list: [1, 2] }))
  f.run("a")
  const snap = f.snapshot()
  snap.a.count = 999
  snap.a.list.push(999)
  f.define("b", (ctx, deps) => deps.a.count + deps.a.list.length, { deps: ["a"] })
  expect(f.run("b")).toBe(7)
})

test("t_14", () => {
  const f = new Flock()
  f.define("a", () => 1)
  f.define("b", () => 2)
  f.run("a"); f.run("b")
  const s = f.snapshot()
  expect(s.a).toBe(1)
  expect(s.b).toBe(2)
})

test("t_15", () => {
  const f = new Flock()
  let aRan = 0
  f.define("a", () => { aRan++; return 1 })
  f.define("b", (ctx, deps) => deps.a + 1, { deps: ["a"] })
  f.restore({ a: 10 })
  expect(f.run("b")).toBe(11)
  expect(aRan).toBe(0)
})

test("t_16", () => {
  let tries = 0
  const f = new Flock()
  f.define("a", () => { tries++; if (tries < 3) throw new Error("nope"); return "ok" }, { retries: 3 })
  expect(f.run("a")).toBe("ok")
  expect(tries).toBe(3)
})

test("t_17", () => {
  let tries = 0
  const f = new Flock()
  f.define("a", () => { tries++; throw new Error("always") }, { retries: 2 })
  expect(() => f.run("a")).toThrow()
  expect(tries).toBe(2)
})

test("t_18", () => {
  const f = new Flock()
  f.define("a", () => 1, { deps: ["a"] })
  let err
  try { f.run("a") } catch (e) { err = e }
  expect(err).toBeInstanceOf(FlockError)
  expect(err).toBeInstanceOf(CycleError)
})

test("t_19", () => {
  const d = new Date("2024-06-01T00:00:00Z")
  const f = new Flock()
  f.define("a", () => ({ when: d }))
  f.run("a")
  const snap = f.snapshot()
  expect(snap.a.when).toBeInstanceOf(Date)
  expect(snap.a.when.getTime()).toBe(d.getTime())
  expect(snap.a.when).not.toBe(d)
})

test("t_20", () => {
  const f = new Flock()
  f.define("a", () => 10, { priority: 1 })
  f.define("b", () => 20, { priority: 5 })
  expect(f.run("a")).toBe(10)
  expect(f.run("b")).toBe(20)
  const snap = f.snapshot()
  expect(snap).toEqual({ a: 10, b: 20 })
})
`

// -------- JSON Patch buggy scaffold (8 planted bugs — task is debug, not implement) --------
//
// This scaffold looks like a reasonable attempt. It passes a few simple tests but fails many
// due to 8 specific bugs. Student's task is to read the code + test output, identify bugs,
// and fix them WITHOUT breaking the parts that already work. Fixing all 8 in one round is
// unrealistic — most models fix 3-4 per round and iterate.
//
// Planted bugs (DO NOT mention in the task prompt — student must discover):
//   B1: No deep clone at entry — mutates caller's `doc` in place.
//   B2: Path escape not decoded — `~0`/`~1` are treated as literal segment chars, so
//       `/a~1b` tries to descend into a property literally named "a~1b" instead of "a/b".
//   B3: `-` in an array add path is passed through as the key "-" (assigning a property,
//       not appending) instead of being interpreted as "past the last element".
//   B4: No atomic rollback — ops are applied in-place, so a later op throwing leaves
//       earlier ops' effects visible on the returned (and caller's) doc.
//   B5: `replace` on a missing path silently creates the path (same code path as add)
//       instead of throwing.
//   B6: `copy` uses a shallow value reference, so mutating `result.b.x` also affects
//       `result.a.x` because they share a subtree.
//   B7: `test` uses `===`, failing for any structural comparison (objects, arrays, or
//       `1 === "1"` which should intentionally fail — this one accidentally works for
//       the type-mismatch case but fails for the deep-equal case).
//   B8: `move` does not check whether `path` is a descendant of `from`, so moving a
//       subtree into itself silently produces a cycle or stale reference instead of throwing.

const JSON_PATCH_BUGGY_SRC = `// NOTE: this file contains bugs. Fix them — do not delete and rewrite.
// The tests at runtime reveal which behaviors are broken.

function parsePath(path) {
  if (path === "") return []
  // B2: missing ~0/~1 decoding on each segment.
  return path.slice(1).split("/")
}

function getAt(node, segments) {
  let cur = node
  for (const seg of segments) {
    if (cur === null || cur === undefined) {
      throw new Error("path not found: " + segments.join("/"))
    }
    if (Array.isArray(cur)) {
      const idx = Number(seg)
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
        throw new Error("array index out of range: " + seg)
      }
      cur = cur[idx]
    } else if (typeof cur === "object") {
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) {
        throw new Error("key not found: " + seg)
      }
      cur = cur[seg]
    } else {
      throw new Error("cannot descend into primitive")
    }
  }
  return cur
}

function setAt(node, segments, value) {
  // B3: does not handle "-" for arrays — falls through to array-index branch, NaN, throws.
  if (segments.length === 0) {
    // Root set — caller handles replacing whole doc for replace/add on path "".
    throw new Error("setAt requires at least one segment")
  }
  let cur = node
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    if (Array.isArray(cur)) cur = cur[Number(seg)]
    else cur = cur[seg]
    if (cur === undefined || cur === null) {
      throw new Error("parent not found at: " + segments.slice(0, i + 1).join("/"))
    }
  }
  const last = segments[segments.length - 1]
  if (Array.isArray(cur)) {
    const idx = Number(last)
    if (!Number.isInteger(idx) || idx < 0 || idx > cur.length) {
      throw new Error("array index out of range for add: " + last)
    }
    cur.splice(idx, 0, value)
  } else {
    cur[last] = value
  }
}

function removeAt(node, segments) {
  if (segments.length === 0) throw new Error("cannot remove root")
  let cur = node
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    cur = Array.isArray(cur) ? cur[Number(seg)] : cur[seg]
    if (cur === undefined || cur === null) throw new Error("parent missing")
  }
  const last = segments[segments.length - 1]
  if (Array.isArray(cur)) {
    const idx = Number(last)
    if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
      throw new Error("array index out of range for remove: " + last)
    }
    cur.splice(idx, 1)
  } else {
    if (!Object.prototype.hasOwnProperty.call(cur, last)) {
      throw new Error("key not found on remove: " + last)
    }
    delete cur[last]
  }
}

export function applyPatch(doc, ops) {
  // B1: no deep clone — operating on the caller's own object.
  // B4: no atomic rollback — if any later op throws, earlier mutations stay.
  let result = doc
  for (const op of ops) {
    const segs = parsePath(op.path)
    if (op.op === "add") {
      if (segs.length === 0) {
        result = op.value
      } else {
        setAt(result, segs, op.value)
      }
    } else if (op.op === "replace") {
      // B5: replace on missing silently creates (reuses setAt without a "must exist" check).
      if (segs.length === 0) {
        result = op.value
      } else {
        setAt(result, segs, op.value)
      }
    } else if (op.op === "remove") {
      removeAt(result, segs)
    } else if (op.op === "move") {
      const fromSegs = parsePath(op.from)
      const val = getAt(result, fromSegs)
      // B8: no descendant check — moving /a into /a/x produces a cycle or dangling ref.
      removeAt(result, fromSegs)
      setAt(result, segs, val)
    } else if (op.op === "copy") {
      const fromSegs = parsePath(op.from)
      // B6: shallow — the copied subtree shares nested refs with the source.
      const val = getAt(result, fromSegs)
      setAt(result, segs, val)
    } else if (op.op === "test") {
      const val = getAt(result, segs)
      // B7: strict-equality — fails for objects/arrays (deep equality is required).
      if (val !== op.value) {
        throw new Error("test op failed")
      }
    } else {
      throw new Error("unknown op: " + op.op)
    }
  }
  return result
}
`

// -------- TTLMap test file (deliberately thin — deep invariants are in jsExpr constraints) --------

const TTLMAP_TEST_FILE = `import { test, expect } from "bun:test"
import { TTLMap } from "../src/ttl-map.js"

// Basic set/get
test("TTLMap set and get returns the stored value", () => {
  const m = new TTLMap({ now: () => 0, defaultTTL: 1000 })
  m.set("a", 1)
  expect(m.get("a")).toBe(1)
})

test("TTLMap get on missing key returns undefined", () => {
  const m = new TTLMap({ now: () => 0, defaultTTL: 1000 })
  expect(m.get("missing")).toBeUndefined()
})

// has / delete / size basics
test("TTLMap has returns true for present, false for missing", () => {
  const m = new TTLMap({ now: () => 0, defaultTTL: 1000 })
  m.set("a", 1)
  expect(m.has("a")).toBe(true)
  expect(m.has("b")).toBe(false)
})

test("TTLMap delete returns true for removed, false for missing", () => {
  const m = new TTLMap({ now: () => 0, defaultTTL: 1000 })
  m.set("a", 1)
  expect(m.delete("a")).toBe(true)
  expect(m.delete("a")).toBe(false)
  expect(m.get("a")).toBeUndefined()
})

test("TTLMap size reports entry count", () => {
  const m = new TTLMap({ now: () => 0, defaultTTL: 1000 })
  m.set("a", 1)
  m.set("b", 2)
  expect(m.size()).toBe(2)
})

// TTL expiry via injected clock
test("TTLMap get on expired entry returns undefined", () => {
  let t = 0
  const m = new TTLMap({ now: () => t, defaultTTL: 100 })
  m.set("a", 1)
  t = 50
  expect(m.get("a")).toBe(1)
  t = 200
  expect(m.get("a")).toBeUndefined()
})

// clear empties entries
test("TTLMap clear empties the map", () => {
  const m = new TTLMap({ now: () => 0, defaultTTL: 1000 })
  m.set("a", 1)
  m.set("b", 2)
  m.clear()
  expect(m.size()).toBe(0)
  expect(m.get("a")).toBeUndefined()
})

// Targeted bug-reveal tests. These expose specific invariants the supervisor should
// push back on. They intentionally do NOT restate the hard rules — they just fail
// on a specific behavioral bug, and the supervisor's verdict should cite the test
// name, not re-lecture the constraints.

test("TTLMap eviction order is least-recently-SET, unaffected by get()", () => {
  let t = 0
  const m = new TTLMap({ now: () => t, maxEntries: 2, defaultTTL: 10000 })
  m.set("a", 1)
  t = 1
  m.set("b", 2)
  // Many get()s on 'a' — must NOT rescue it from being the oldest by set-time
  t = 2
  m.get("a")
  m.get("a")
  m.get("a")
  t = 3
  m.set("c", 3)
  expect(m.get("a")).toBeUndefined()
  expect(m.get("b")).toBe(2)
  expect(m.get("c")).toBe(3)
})

test("TTLMap clear preserves maxEntries cap", () => {
  const m = new TTLMap({ now: () => 0, maxEntries: 2, defaultTTL: 1000 })
  m.set("a", 1)
  m.clear()
  m.set("x", 1)
  m.set("y", 2)
  m.set("z", 3)
  expect(m.size()).toBe(2)
  expect(m.get("x")).toBeUndefined()
})
`

// ---------- Canonical tasks ----------

export const CANONICAL_STRESS_TASKS: readonly Task[] = [
  {
    id: "stress-stack-8methods",
    description:
      "Wide-surface iterative-refinement task. 8 Stack methods, 16 tests, no delayed constraints. " +
      "Primary signal: does dual-agent's iterative supervisor feedback improve test coverage over " +
      "a single-pass baseline? Secondary signal: does dual introduce recurrences (tests that passed " +
      "in round 1 but are now failing)?",
    task:
      "Implement a Stack class in ES module JavaScript at `src/stack.js`. Export it as " +
      "`export class Stack {...}`.\n\n" +
      "Required methods:\n" +
      "- `push(value)`: add to top\n" +
      "- `pop()`: remove and return the top item; THROW an Error if the stack is empty\n" +
      "- `peek()`: return the top item without removing; THROW an Error if the stack is empty\n" +
      "- `isEmpty()`: return a boolean\n" +
      "- `size()`: return the number of items\n" +
      "- `clear()`: remove all items\n" +
      "- `toArray()`: return a NEW array of items in top-first order (modifying the returned array must not affect the stack)\n" +
      "- `clone()`: return a NEW Stack with the same items, independent of the original\n\n" +
      "Use the write tool to create `src/stack.js`. Verify with `bun test tests/stack.test.js`. " +
      "Round 1 will likely cover the basics — use later rounds to fix edge cases the tests catch.",
    seed: {
      "package.json": MINIMAL_PACKAGE_JSON,
      "tests/stack.test.js": STACK_TEST_FILE,
    },
    testsCmd: "bun test tests/stack.test.js",
    constraints: [
      {
        id: "stack-class-exists",
        description: "src/stack.js exports a class named Stack",
        type: "fileRegex",
        file: "src/stack.js",
        regex: "export\\s+class\\s+Stack\\b",
        mustMatch: true,
      },
      {
        id: "stack-pop-throws-empty",
        description: "pop() throws on an empty stack (not return undefined)",
        type: "jsExpr",
        file: "src/stack.js",
        expr: "const s = new mod.Stack(); try { s.pop(); return false } catch { return true }",
      },
      {
        id: "stack-peek-throws-empty",
        description: "peek() throws on an empty stack",
        type: "jsExpr",
        file: "src/stack.js",
        expr: "const s = new mod.Stack(); try { s.peek(); return false } catch { return true }",
      },
      {
        id: "stack-clone-independent",
        description: "Mutating a clone doesn't affect the original",
        type: "jsExpr",
        file: "src/stack.js",
        expr:
          "const a = new mod.Stack(); a.push(1); a.push(2); " +
          "const b = a.clone(); b.push(3); " +
          "return a.size() === 2 && b.size() === 3",
      },
    ],
    trialCount: 3,
    maxRounds: 5,
    phaseTimeoutMs: 240_000,
  },
  {
    id: "stress-delayed-constraint-cart",
    description:
      "State preservation / long-range attention task. Two hard constraints stated in round 1: " +
      "(1) quantities never negative internally, and (2) getTotal() returns integer cents not " +
      "floating dollars. Over multiple rounds Student must fix edge cases without violating " +
      "either constraint. If retention < 1.0, the feedback loop let Student drift. " +
      "Recurrence > 0 would mean Student broke tests that had been passing — the clearest " +
      "signature of 'long-range attention failure'.",
    task:
      "Implement a Cart class in ES module JavaScript at `src/cart.js`. Export it as " +
      "`export class Cart {...}`.\n\n" +
      "Required methods:\n" +
      "- `add(item, qty)`: add `qty` of `item` to the cart. `item` is an object with a `priceCents` field.\n" +
      "- `remove(item, qty)`: remove up to `qty` of `item`.\n" +
      "- `getTotal()`: return the sum of (priceCents × quantity) across all items.\n" +
      "- `clear()`: remove everything.\n" +
      "- `size()`: return the number of DISTINCT item types currently in the cart (not total quantity).\n\n" +
      "=== HARD CONSTRAINTS — these MUST be respected in every round ===\n\n" +
      "CONSTRAINT 1: Quantities are non-negative integers internally. If `remove(item, qty)` " +
      "would reduce an item's quantity below zero, CLAMP the quantity to zero and remove the " +
      "entry entirely. NEVER store a negative quantity. NEVER let a negative quantity " +
      "contribute to `getTotal()`. If a later round's feedback asks you to fix other bugs, " +
      "keep this rule intact.\n\n" +
      "CONSTRAINT 2: `getTotal()` MUST return an integer number of cents. Use only integer " +
      "arithmetic (`priceCents * qty`, then sum). Do NOT convert to dollars, do NOT divide by 100, " +
      "do NOT use floating-point intermediates. `Number.isInteger(cart.getTotal())` must always " +
      "be true. Even if a test or feedback seems to ask for dollars, return cents.\n\n" +
      "Use the write tool to create `src/cart.js`. Verify with `bun test tests/cart.test.js`. " +
      "The test file includes constraint-specific tests with 'CONSTRAINT[...]' in their names — " +
      "these must never regress.",
    seed: {
      "package.json": MINIMAL_PACKAGE_JSON,
      "tests/cart.test.js": CART_TEST_FILE,
    },
    testsCmd: "bun test tests/cart.test.js",
    constraints: [
      {
        id: "cart-class-exists",
        description: "src/cart.js exports a class named Cart",
        type: "fileRegex",
        file: "src/cart.js",
        regex: "export\\s+class\\s+Cart\\b",
        mustMatch: true,
      },
      {
        id: "cart-qty-non-negative",
        description: "Over-remove clamps to 0, total never goes negative",
        type: "jsExpr",
        file: "src/cart.js",
        expr:
          "const c = new mod.Cart(); " +
          "c.add({id:'x', priceCents:100}, 2); " +
          "c.remove({id:'x', priceCents:100}, 5); " +
          "return c.getTotal() === 0",
      },
      {
        id: "cart-integer-cents",
        description: "getTotal always returns Number.isInteger === true across several operations",
        type: "jsExpr",
        file: "src/cart.js",
        expr:
          "const c = new mod.Cart(); " +
          "c.add({id:'a', priceCents:99}, 3); " +
          "c.add({id:'b', priceCents:150}, 2); " +
          "c.add({id:'c', priceCents:1}, 7); " +
          "const t = c.getTotal(); " +
          "return Number.isInteger(t) && t === 99*3 + 150*2 + 1*7",
      },
      {
        id: "cart-no-float-arith",
        description:
          "Structural check: src/cart.js should not divide by 100 or multiply by 0.01, which " +
          "are the common shapes of a dollars-vs-cents bug. Brittle but directional.",
        type: "fileRegex",
        file: "src/cart.js",
        regex: "\\/\\s*100\\b|\\*\\s*0\\.01",
        mustMatch: false,
      },
    ],
    trialCount: 3,
    maxRounds: 5,
    phaseTimeoutMs: 240_000,
  },
  {
    id: "stress-lru-cache-dual-limits",
    description:
      "HARD multi-round task. LRU cache with TWO interacting limits (maxEntries + maxWeight) " +
      "and subtle semantics (has() vs get(), update-in-place, weight-update eviction). " +
      "Designed so codex-mini RELIABLY misses ~3-6 tests on round 1 — there are too many " +
      "edge cases to one-shot — but a careful supervisor feedback loop should converge in " +
      "3-5 rounds. Includes a delayed structural constraint (no Object as backing store) " +
      "and a behavioral one (oversize entries are rejected, not stored-then-immediately-evicted).",
    task:
      "Implement an LRU cache class in ES module JavaScript at `src/lru-cache.js`. Export it as " +
      "`export class LRUCache {...}`.\n\n" +
      "Constructor: `new LRUCache({ maxEntries, maxWeight })`. Both options are positive integers.\n\n" +
      "Required methods:\n" +
      "- `set(key, value, weight = 1)`: insert or update. If insertion would exceed " +
      "`maxEntries` OR `maxWeight`, evict least-recently-used entries one at a time " +
      "until BOTH limits are satisfied. Updating an existing key updates its value AND " +
      "its weight, AND promotes it to most-recently-used.\n" +
      "- `get(key)`: return the value (and PROMOTE the key to most-recently-used). " +
      "Return `undefined` for missing keys (do NOT throw).\n" +
      "- `has(key)`: return a boolean. MUST NOT promote LRU order — `has` is a peek.\n" +
      "- `delete(key)`: return `true` if the key was present, `false` if missing. " +
      "Do NOT throw on missing keys.\n" +
      "- `clear()`: remove all entries. The cache CONFIG (maxEntries, maxWeight) MUST " +
      "be preserved — limits still apply after clear.\n" +
      "- `size()`: number of entries currently stored.\n" +
      "- `totalWeight()`: sum of weights of all stored entries.\n\n" +
      "=== HARD CONSTRAINTS ===\n\n" +
      "CONSTRAINT 1 (single-entry-larger-than-limit): If a SINGLE `set()` call has a " +
      "weight greater than `maxWeight`, the entry MUST NOT be stored at all. The cache " +
      "should remain unchanged. Do NOT store-then-immediately-evict — that briefly evicts " +
      "innocent entries before bouncing the oversize one. Just reject the set silently.\n\n" +
      "CONSTRAINT 2 (has-is-a-peek): `has()` MUST NOT change LRU recency. Only `get()` " +
      "and `set()` count as 'uses'. This is the most commonly-missed semantic — make sure " +
      "your implementation distinguishes peek (has) from use (get).\n\n" +
      "CONSTRAINT 3 (delete-returns-bool): `delete()` MUST return a boolean. `true` if the " +
      "entry was present and removed, `false` if the key was missing. Calling `delete()` on " +
      "a missing key MUST be a no-op — never throw.\n\n" +
      "Use the write tool to create `src/lru-cache.js`. Verify with `bun test tests/lru-cache.test.js`. " +
      "Round 1 tests will likely catch several edge cases — use later rounds to fix them WITHOUT " +
      "regressing the basic CRUD tests. The hardest cases are the interaction between maxEntries " +
      "and maxWeight (eviction triggered by either), and update-in-place (re-setting an existing " +
      "key changes its weight, may evict OTHER entries, and promotes the updated key to MRU).",
    seed: {
      "package.json": MINIMAL_PACKAGE_JSON,
      "tests/lru-cache.test.js": LRU_TEST_FILE,
    },
    testsCmd: "bun test tests/lru-cache.test.js",
    constraints: [
      {
        id: "lru-class-exists",
        description: "src/lru-cache.js exports a class named LRUCache",
        type: "fileRegex",
        file: "src/lru-cache.js",
        regex: "export\\s+class\\s+LRUCache\\b",
        mustMatch: true,
      },
      {
        id: "lru-get-missing-no-throw",
        description: "get() on a missing key returns undefined (does not throw)",
        type: "jsExpr",
        file: "src/lru-cache.js",
        expr:
          "const c = new mod.LRUCache({ maxEntries: 5, maxWeight: 100 }); " +
          "try { return c.get('nope') === undefined } catch { return false }",
      },
      {
        id: "lru-delete-returns-bool",
        description: "delete() returns true for present, false for missing, never throws",
        type: "jsExpr",
        file: "src/lru-cache.js",
        expr:
          "const c = new mod.LRUCache({ maxEntries: 5, maxWeight: 100 }); " +
          "c.set('a', 1); " +
          "const r1 = c.delete('a'); " +
          "const r2 = c.delete('nope'); " +
          "return r1 === true && r2 === false",
      },
      {
        id: "lru-has-does-not-promote",
        description:
          "has() must not promote LRU. After has('a'), set('d') should still evict 'a' " +
          "(the original LRU), not 'b'.",
        type: "jsExpr",
        file: "src/lru-cache.js",
        expr:
          "const c = new mod.LRUCache({ maxEntries: 3, maxWeight: 1000 }); " +
          "c.set('a', 1); c.set('b', 2); c.set('c', 3); " +
          "c.has('a'); " +
          "c.set('d', 4); " +
          "return c.has('a') === false && c.has('b') === true && c.has('c') === true && c.has('d') === true",
      },
      {
        id: "lru-oversize-entry-rejected",
        description:
          "Setting a single entry with weight > maxWeight must NOT store it AND must NOT " +
          "evict any innocent entries.",
        type: "jsExpr",
        file: "src/lru-cache.js",
        expr:
          "const c = new mod.LRUCache({ maxEntries: 100, maxWeight: 10 }); " +
          "c.set('keep1', 'a', 3); c.set('keep2', 'b', 3); " +
          "c.set('huge', 'x', 100); " +
          "return c.has('huge') === false && c.has('keep1') === true && c.has('keep2') === true && c.size() === 2",
      },
      {
        id: "lru-clear-preserves-config",
        description: "After clear(), the maxEntries/maxWeight limits still apply",
        type: "jsExpr",
        file: "src/lru-cache.js",
        expr:
          "const c = new mod.LRUCache({ maxEntries: 2, maxWeight: 1000 }); " +
          "c.set('a', 1); c.set('b', 2); c.set('c', 3); " +
          "c.clear(); " +
          "c.set('x', 1); c.set('y', 2); c.set('z', 3); " +
          "return c.size() === 2 && c.has('x') === false",
      },
    ],
    trialCount: 3,
    maxRounds: 5,
    phaseTimeoutMs: 240_000,
  },
  {
    id: "stress-expr-eval",
    description:
      "HARD parsing task. Expression evaluator with operator precedence, unary minus, " +
      "parentheses, and error handling. Task text is INTENTIONALLY TERSE — it gives the " +
      "API surface but not the edge cases. Round 1 reliably fails ~5-10 tests because " +
      "LLMs' natural parsing approach (string splitting or naive recursion) mishandles " +
      "unary minus, associativity, or error detection. The supervisor feedback loop should " +
      "converge in 3-5 rounds. Structural constraint: no eval()/Function().",
    task:
      "Implement a `calc(expr)` function in ES module JavaScript at `src/calc.js`.\n" +
      "Export it as `export function calc(expr) { ... }`.\n\n" +
      "The function evaluates an arithmetic expression string and returns the numeric result. " +
      "Support `+`, `-`, `*`, `/`, parentheses, and decimal numbers. " +
      "Throw on invalid input.\n\n" +
      "Do NOT use `eval()`, `Function()`, or any dynamic code execution.\n\n" +
      "Use the write tool to create `src/calc.js`. " +
      "Verify with `bun test tests/calc.test.js`.",
    seed: {
      "package.json": MINIMAL_PACKAGE_JSON,
      "tests/calc.test.js": CALC_TEST_FILE,
    },
    testsCmd: "bun test tests/calc.test.js",
    constraints: [
      {
        id: "calc-fn-exists",
        description: "src/calc.js exports a function named calc",
        type: "fileRegex",
        file: "src/calc.js",
        regex: "export\\s+(function|const)\\s+calc\\b",
        mustMatch: true,
      },
      {
        id: "calc-no-eval",
        description: "Must not use eval(), Function(), or new Function",
        type: "fileRegex",
        file: "src/calc.js",
        regex: "\\beval\\s*\\(|\\bFunction\\s*\\(|new\\s+Function\\b",
        mustMatch: false,
      },
      {
        id: "calc-precedence",
        description: "* binds tighter than + (2 + 3 * 4 = 14, not 20)",
        type: "jsExpr",
        file: "src/calc.js",
        expr: "return mod.calc('2 + 3 * 4') === 14",
      },
      {
        id: "calc-unary-minus",
        description: "Unary minus works after operator: 2 * -3 = -6",
        type: "jsExpr",
        file: "src/calc.js",
        expr: "return mod.calc('2 * -3') === -6",
      },
      {
        id: "calc-div-zero-throws",
        description: "Division by zero must throw, not return Infinity",
        type: "jsExpr",
        file: "src/calc.js",
        expr: "try { mod.calc('1 / 0'); return false } catch { return true }",
      },
    ],
    trialCount: 3,
    maxRounds: 5,
    phaseTimeoutMs: 240_000,
  },
  {
    id: "stress-minipipe-dsl",
    description:
      "Custom DSL interpreter — syntax the model has NEVER seen in training data. " +
      "MiniPipe is a pipe-based data-transform language with 10 transforms. Key trap: " +
      "`add:N` on a list means APPEND (not map-add). Other traps: flat one-level-only, " +
      "string escape `''`, type errors on wrong input types, map with propagated type " +
      "errors. Task text gives grammar + transform table but NOT the interactions. " +
      "Tests are the surprise. Round 1 should reliably fail 5-10 tests.",
    task:
      "Implement a `run(program)` function in ES module JavaScript at `src/minipipe.js`.\n" +
      "Export it as `export function run(program) { ... }`.\n\n" +
      "MiniPipe evaluates a pipe-based expression: `value | transform | transform | ...`\n\n" +
      "Values:\n" +
      "- Numbers: `42`, `-5`, `3.14`\n" +
      "- Strings: single-quoted, use `''` to escape a literal `'`\n" +
      "- Lists: `[1, 2, 'a']`, `[]` (can nest)\n\n" +
      "Transforms (applied left-to-right via `|`):\n" +
      "- `add:N` — number: add N. list: append N as a new element.\n" +
      "- `mul:N` — number: multiply by N.\n" +
      "- `neg` — negate a number.\n" +
      "- `len` — return length of string or list.\n" +
      "- `rev` — reverse a string or list.\n" +
      "- `head:N` — first N elements/chars. N > length → return all.\n" +
      "- `tail:N` — last N elements/chars. N > length → return all.\n" +
      "- `flat` — flatten a list one level.\n" +
      "- `map:T` — apply transform T to each element of a list.\n" +
      "- `join:S` — join list elements (coerced to string) with separator S.\n\n" +
      "Throw on type errors (e.g. `neg` on a string, `flat` on a number).\n" +
      "Whitespace between tokens is ignored.\n\n" +
      "Use the write tool to create `src/minipipe.js`. " +
      "Verify with `bun test tests/minipipe.test.js`.",
    seed: {
      "package.json": MINIMAL_PACKAGE_JSON,
      "tests/minipipe.test.js": MINIPIPE_TEST_FILE,
    },
    testsCmd: "bun test tests/minipipe.test.js",
    constraints: [
      {
        id: "minipipe-fn-exists",
        description: "src/minipipe.js exports a function named run",
        type: "fileRegex",
        file: "src/minipipe.js",
        regex: "export\\s+(function|const)\\s+run\\b",
        mustMatch: true,
      },
      {
        id: "minipipe-add-appends-to-list",
        description: "add:N on a list appends N (does NOT add N to each element)",
        type: "jsExpr",
        file: "src/minipipe.js",
        expr:
          "const r = mod.run('[1, 2] | add:3'); " +
          "return Array.isArray(r) && r.length === 3 && r[0] === 1 && r[1] === 2 && r[2] === 3",
      },
      {
        id: "minipipe-flat-one-level",
        description: "flat only flattens one level: [1,[2,[3]]] → [1,2,[3]]",
        type: "jsExpr",
        file: "src/minipipe.js",
        expr:
          "const r = mod.run('[1, [2, [3]]] | flat'); " +
          "return Array.isArray(r) && r.length === 3 && r[0] === 1 && r[1] === 2 && Array.isArray(r[2]) && r[2][0] === 3",
      },
      {
        id: "minipipe-type-error-neg-string",
        description: "neg on a string must throw",
        type: "jsExpr",
        file: "src/minipipe.js",
        expr: "try { mod.run(\"'x' | neg\"); return false } catch { return true }",
      },
      {
        id: "minipipe-escaped-quote",
        description: "'' inside a string literal represents a single quote char",
        type: "jsExpr",
        file: "src/minipipe.js",
        expr: "return mod.run(\"'it''s'\") === \"it's\"",
      },
    ],
    trialCount: 3,
    maxRounds: 5,
    phaseTimeoutMs: 240_000,
  },
  {
    id: "stress-reactive-sheet",
    description:
      "HARD algorithmic task: reactive spreadsheet engine with formula parsing, dependency " +
      "graph, topological propagation, cycle detection, error cascading, and range functions. " +
      "Expected ~300-400 lines. Round 1 should reliably fail 10-15 of 35 tests because " +
      "reactive propagation + cycle detection + error cascading interact in non-obvious ways. " +
      "maxRounds=8 because convergence requires multiple fix-without-regress iterations.",
    task:
      "Implement a `Sheet` class in ES module JavaScript at `src/sheet.js`.\n" +
      "Export it as `export class Sheet { ... }`.\n\n" +
      "API:\n" +
      "- `set(cell, value)` — set cell to a number, string, or formula (string starting with `=`)\n" +
      "- `get(cell)` — return the computed value of the cell\n" +
      "- `delete(cell)` — remove the cell entirely\n\n" +
      "Cell references: letter + row number, e.g. `A1`, `B12`, `Z99`.\n" +
      "Formula syntax: `=expression` where expression supports `+`, `-`, `*`, `/`, " +
      "cell references, numeric literals, and `SUM(range)` / `COUNT(range)`.\n" +
      "Range: `A1:A5` (same column) or `A1:E1` (same row).\n\n" +
      "Errors are returned as strings, never thrown:\n" +
      "- `\"#REF!\"` — reference to a cell that doesn't exist\n" +
      "- `\"#CYCLE!\"` — circular dependency detected\n" +
      "- `\"#DIV/0!\"` — division by zero\n" +
      "- `\"#ERROR!\"` — any other evaluation error\n\n" +
      "Reactive: when a cell changes, all cells that depend on it must update automatically.\n" +
      "Detect circular references and mark all cells in the cycle as `\"#CYCLE!\"`.\n\n" +
      "Use the write tool to create `src/sheet.js`. Verify with `bun test tests/sheet.test.js`.",
    seed: {
      "package.json": MINIMAL_PACKAGE_JSON,
      "tests/sheet.test.js": SHEET_TEST_FILE,
    },
    testsCmd: "bun test tests/sheet.test.js",
    constraints: [
      {
        id: "sheet-class-exists",
        description: "src/sheet.js exports a class named Sheet",
        type: "fileRegex",
        file: "src/sheet.js",
        regex: "export\\s+class\\s+Sheet\\b",
        mustMatch: true,
      },
      {
        id: "sheet-reactive-propagation",
        description: "Changing A1 automatically updates B1 which references A1",
        type: "jsExpr",
        file: "src/sheet.js",
        expr:
          "const s = new mod.Sheet(); s.set('A1', 5); s.set('B1', '=A1+10'); " +
          "if (s.get('B1') !== 15) return false; " +
          "s.set('A1', 20); return s.get('B1') === 30",
      },
      {
        id: "sheet-cycle-detection",
        description: "Indirect cycle A1→B1→A1 returns #CYCLE! for both cells",
        type: "jsExpr",
        file: "src/sheet.js",
        expr:
          "const s = new mod.Sheet(); s.set('A1', '=B1'); s.set('B1', '=A1'); " +
          "return s.get('A1') === '#CYCLE!' && s.get('B1') === '#CYCLE!'",
      },
      {
        id: "sheet-ref-error-cascade",
        description: "Deleting a referenced cell cascades #REF! to dependents",
        type: "jsExpr",
        file: "src/sheet.js",
        expr:
          "const s = new mod.Sheet(); s.set('A1', 10); s.set('B1', '=A1*2'); " +
          "s.delete('A1'); return s.get('B1') === '#REF!'",
      },
      {
        id: "sheet-no-throw",
        description: "get() never throws — errors return error strings",
        type: "jsExpr",
        file: "src/sheet.js",
        expr:
          "const s = new mod.Sheet(); " +
          "try { s.get('Z99'); s.set('A1','=1/0'); s.get('A1'); return true } catch { return false }",
      },
    ],
    trialCount: 3,
    maxRounds: 8,
    phaseTimeoutMs: 300_000,
  },
  {
    id: "stress-reactive-multifile",
    description:
      "HARD multi-file task: reactive primitives (signal/computed/effect/batch) + store " +
      "layer (CRUD/computed fields/middleware/transactions) in TWO source files. The " +
      "interaction between auto-dependency tracking, batch deduplication, effect cleanup, " +
      "transaction rollback, and middleware chaining creates combinatorial edge cases that " +
      "prevent one-shotting. 40 tests. maxRounds=8.",
    task:
      "Implement a reactive system in TWO files:\n\n" +
      "**File 1: `src/reactive.js`** — reactive primitives\n" +
      "- `signal(initial)` — returns `[get, set]`. `get()` reads, `set(v)` writes.\n" +
      "- `computed(fn)` — returns a getter. Auto-detects which signals `fn` reads " +
      "(dependency tracking). Lazy: doesn't compute until first read. Caches until deps change.\n" +
      "- `effect(fn)` — runs `fn` immediately, re-runs when deps change. " +
      "`fn` may return a cleanup function that runs before each re-execution. " +
      "Returns a `dispose` function that stops the effect.\n" +
      "- `batch(fn)` — runs `fn`, delays all recomputation until `fn` returns. " +
      "Nested batches only flush at the outermost level.\n\n" +
      "**File 2: `src/store.js`** — higher-level store built on reactive\n" +
      "- `createStore(schema)` — `schema` is `{ field: initialValue, ... }`. Returns a store.\n" +
      "- `store.get(field)` / `store.set(field, value)`\n" +
      "- `store.subscribe(field, callback)` — returns unsubscribe function\n" +
      "- `store.computed(name, fn)` — defines a computed field\n" +
      "- `store.use(middleware)` — `middleware(field, value, next)`. Call `next(v)` to proceed.\n" +
      "- `store.transaction(fn)` — batched + atomic. Rolls back ALL changes if `fn` throws.\n\n" +
      "Use the write tool to create both files. Verify with `bun test tests/reactive-system.test.js`.",
    seed: {
      "package.json": MINIMAL_PACKAGE_JSON,
      "tests/reactive-system.test.js": REACTIVE_SYSTEM_TEST_FILE,
    },
    testsCmd: "bun test tests/reactive-system.test.js",
    constraints: [
      {
        id: "reactive-signal-exists",
        description: "src/reactive.js exports signal, computed, effect, batch",
        type: "fileRegex",
        file: "src/reactive.js",
        regex: "export\\s+(function|const)\\s+(signal|computed|effect|batch)\\b",
        mustMatch: true,
      },
      {
        id: "reactive-store-exists",
        description: "src/store.js exports createStore",
        type: "fileRegex",
        file: "src/store.js",
        regex: "export\\s+(function|const)\\s+createStore\\b",
        mustMatch: true,
      },
      {
        id: "reactive-auto-tracking",
        description: "Computed auto-detects signal deps (no manual declaration)",
        type: "jsExpr",
        file: "src/reactive.js",
        expr:
          "const [a, setA] = mod.signal(1); const [b, setB] = mod.signal(2); " +
          "const sum = mod.computed(() => a() + b()); " +
          "if (sum() !== 3) return false; setA(10); return sum() === 12",
      },
      {
        id: "reactive-batch-dedup",
        description: "Batch prevents intermediate effect fires",
        type: "jsExpr",
        file: "src/reactive.js",
        expr:
          "const [a, setA] = mod.signal(0); const [b, setB] = mod.signal(0); " +
          "let fires = 0; mod.effect(() => { a(); b(); fires++ }); fires = 0; " +
          "mod.batch(() => { setA(1); setB(2) }); return fires === 1",
      },
      {
        id: "reactive-tx-rollback",
        description: "Store transaction rolls back on throw",
        type: "jsExpr",
        file: "src/store.js",
        expr:
          "const s = mod.createStore({ x: 1 }); " +
          "try { s.transaction(() => { s.set('x', 99); throw new Error('abort') }) } catch {} " +
          "return s.get('x') === 1",
      },
    ],
    trialCount: 3,
    maxRounds: 8,
    phaseTimeoutMs: 300_000,
  },
  {
    id: "stress-ledger-retention",
    description:
      "Adversarial long-range retention task. One-file ledger engine with MANY early hard " +
      "constraints: integer cents only, duplicate-id replacement in place, deep-copy outputs, " +
      "voided entries excluded from balances but retained in snapshots, trim+lowercase " +
      "normalization, and caller-input immutability. The surface area is still tractable, " +
      "but later fixes can easily regress an earlier invariant. This is aimed squarely at " +
      "the 'dual preserves remote constraints better across rounds' claim.",
    task:
      "Implement a `Ledger` class in ES module JavaScript at `src/ledger.js`.\n" +
      "Export it as `export class Ledger { ... }`.\n\n" +
      "Domain: a tiny in-memory accounting journal. Each entry has:\n" +
      "- `id`: unique string key\n" +
      "- `account`: string\n" +
      "- `cents`: signed integer number of cents\n" +
      "- `tags`: optional string array\n\n" +
      "Required methods:\n" +
      "- `post(entry)`: insert or replace one entry. Return the stored entry as a NEW object.\n" +
      "- `void(id)`: mark an entry as voided. Return `true` if an active entry was changed, " +
      "`false` if the id is missing or already voided.\n" +
      "- `remove(id)`: remove an entry entirely. Return `true` if removed, `false` if missing.\n" +
      "- `balance(account)`: sum ACTIVE entries for that account.\n" +
      "- `balances()`: return an array of `{ account, cents }` for accounts that still have at " +
      "least one ACTIVE entry.\n" +
      "- `history(opts?)`: return entries in insertion order. `opts` may include " +
      "`account`, `tag`, and `includeVoided`.\n" +
      "- `snapshot()`: return ALL entries, including voided ones, in insertion order.\n\n" +
      "Normalization rules:\n" +
      "- `account`: trim whitespace, then lowercase.\n" +
      "- `tags`: default `[]`; for each tag trim whitespace, lowercase, drop empty strings, " +
      "and de-duplicate while preserving first appearance order.\n\n" +
      "Entry shape exposed by `post`, `history`, and `snapshot`:\n" +
      "- `{ id, account, cents, tags, voided }`\n\n" +
      "=== HARD CONSTRAINTS — keep these true in EVERY round ===\n\n" +
      "CONSTRAINT 1: `cents` is ALWAYS integer cents. Do NOT coerce from dollars. Do NOT divide " +
      "by 100. Throw if `post()` receives a non-integer `cents`.\n\n" +
      "CONSTRAINT 2: Re-posting an EXISTING `id` REPLACES that entry IN PLACE. It must keep the " +
      "original insertion slot. Do NOT move it to the end.\n\n" +
      "CONSTRAINT 3: Voided entries are excluded from `balance()` and from default `history()`, " +
      "but they MUST remain visible in `snapshot()` and in `history({ includeVoided: true })`.\n\n" +
      "CONSTRAINT 4: `post()`, `history()`, and `snapshot()` must return DEEP COPIES. Caller " +
      "mutation must never affect internal state.\n\n" +
      "CONSTRAINT 5: `post()` must NOT mutate the caller's input object or its `tags` array.\n\n" +
      "CONSTRAINT 6: Filtering and account lookup are trim+lowercase normalized. For example, " +
      "`balance(' INCOME ')` and `history({ tag: ' DAILY ' })` must work.\n\n" +
      "CONSTRAINT 7: `void()` and `remove()` return booleans and must NEVER throw on missing ids.\n\n" +
      "CONSTRAINT 8: If an entry was REMOVED entirely, a later `post()` with the same id creates " +
      "a NEW slot at the END. Only replacement of a currently-stored id preserves slot.\n\n" +
      "Implementation notes:\n" +
      "- A voided entry still exists in storage.\n" +
      "- Re-posting a voided id should replace/reactivate it in the SAME slot.\n" +
      "- `balances()` order should follow first appearance order of the account among entries that " +
      "still exist, while excluding accounts with no active entries left.\n\n" +
      "Use the write tool to create `src/ledger.js`. Verify with `bun test tests/ledger.test.js`. " +
      "This task is intentionally written with many early invariants. When later feedback asks " +
      "for bug fixes, do not lose those invariants.",
    seed: {
      "package.json": MINIMAL_PACKAGE_JSON,
      "tests/ledger.test.js": LEDGER_TEST_FILE,
    },
    testsCmd: "bun test tests/ledger.test.js",
    constraints: [
      {
        id: "ledger-class-exists",
        description: "src/ledger.js exports a class named Ledger",
        type: "fileRegex",
        file: "src/ledger.js",
        regex: "export\\s+class\\s+Ledger\\b",
        mustMatch: true,
      },
      {
        id: "ledger-integer-cents",
        description: "Non-integer cents are rejected and balance stays integer",
        type: "jsExpr",
        file: "src/ledger.js",
        expr:
          "const l = new mod.Ledger(); " +
          "let threw = false; " +
          "try { l.post({ id:'bad', account:'income', cents:1.5, tags:[] }) } catch { threw = true } " +
          "l.post({ id:'ok', account:'income', cents:3, tags:['x'] }); " +
          "return threw && Number.isInteger(l.balance('income')) && l.balance('income') === 3",
      },
      {
        id: "ledger-replace-in-place",
        description: "Replacing an existing id keeps the original insertion slot",
        type: "jsExpr",
        file: "src/ledger.js",
        expr:
          "const l = new mod.Ledger(); " +
          "l.post({ id:'a', account:'income', cents:1, tags:[] }); " +
          "l.post({ id:'b', account:'food', cents:2, tags:[] }); " +
          "l.post({ id:'a', account:'income', cents:9, tags:['x'] }); " +
          "const s = l.snapshot(); " +
          "return s.length === 2 && s[0].id === 'a' && s[0].cents === 9 && s[1].id === 'b'",
      },
      {
        id: "ledger-void-retained",
        description: "Voided entries disappear from active history but remain in snapshot",
        type: "jsExpr",
        file: "src/ledger.js",
        expr:
          "const l = new mod.Ledger(); " +
          "l.post({ id:'a', account:'income', cents:10, tags:['pay'] }); " +
          "l.void('a'); " +
          "return l.history().length === 0 && l.snapshot().length === 1 && l.snapshot()[0].voided === true",
      },
      {
        id: "ledger-history-deep-copy",
        description: "Mutating history output does not affect stored state",
        type: "jsExpr",
        file: "src/ledger.js",
        expr:
          "const l = new mod.Ledger(); " +
          "l.post({ id:'a', account:'income', cents:10, tags:['pay'] }); " +
          "const h = l.history(); " +
          "h[0].tags.push('oops'); h[0].account = 'hack'; " +
          "const x = l.history()[0]; " +
          "return x.account === 'income' && x.tags.length === 1 && x.tags[0] === 'pay'",
      },
      {
        id: "ledger-input-not-mutated",
        description: "post() does not mutate caller input or tags array",
        type: "jsExpr",
        file: "src/ledger.js",
        expr:
          "const l = new mod.Ledger(); " +
          "const e = { id:'a', account:' Income ', cents:10, tags:[' Pay '] }; " +
          "l.post(e); " +
          "return e.account === ' Income ' && e.tags.length === 1 && e.tags[0] === ' Pay '",
      },
      {
        id: "ledger-normalized-filter",
        description: "Account and tag filters use trim+lowercase normalization",
        type: "jsExpr",
        file: "src/ledger.js",
        expr:
          "const l = new mod.Ledger(); " +
          "l.post({ id:'a', account:' Income ', cents:10, tags:[' Bonus '] }); " +
          "return l.balance(' income ') === 10 && l.history({ tag:' bonus ' }).length === 1",
      },
      {
        id: "ledger-remove-repost-new-slot",
        description: "Removing an id then posting it again appends as a new slot",
        type: "jsExpr",
        file: "src/ledger.js",
        expr:
          "const l = new mod.Ledger(); " +
          "l.post({ id:'a', account:'income', cents:1, tags:[] }); " +
          "l.post({ id:'b', account:'food', cents:2, tags:[] }); " +
          "l.remove('a'); " +
          "l.post({ id:'a', account:'income', cents:3, tags:[] }); " +
          "const s = l.snapshot(); " +
          "return s.length === 2 && s[0].id === 'b' && s[1].id === 'a'",
      },
    ],
    trialCount: 3,
    maxRounds: 8,
    phaseTimeoutMs: 300_000,
  },
  {
    id: "stress-ttlmap-retention",
    description:
      "Calibration-tuned delayed-retention task. 10 hard invariants stated ONCE in the prompt; " +
      "the seed bun test file is deliberately thin (only basic set/get/has/delete/size/expiry), " +
      "so round-1 tests likely pass ~100% while jsExpr retention constraints expose deeper " +
      "invariants (LRU-SET eviction order, deep-copy get, touch preserves ORIGINAL TTL, has() " +
      "does not promote recency, clear() preserves config). Round-1 jsExpr pass rate is " +
      "targeted at 60-80% so we can directly observe drift from round 1 to final.",
    task:
      "Implement `TTLMap` at `src/ttl-map.js` as `export class TTLMap`. ES module.\n\n" +
      "Constructor `new TTLMap({ now, defaultTTL, maxEntries? })`:\n" +
      "- `now`: `() => number` ms clock (required, INJECTED — do not use Date.now/performance.now).\n" +
      "- `defaultTTL`: positive integer ms (required).\n" +
      "- `maxEntries`: positive integer (optional, unbounded when unset).\n\n" +
      "Methods:\n" +
      "- `set(key, value, ttl?)` → map. `ttl` defaults to `defaultTTL`.\n" +
      "- `get(key)` → value | undefined (expired returns undefined).\n" +
      "- `has(key)` → boolean (expired returns false).\n" +
      "- `delete(key)` → boolean.\n" +
      "- `touch(key)` → boolean (resets expiry).\n" +
      "- `size()` → count of live entries.\n" +
      "- `keys()`, `entries()` → iterators over live entries in insertion order.\n" +
      "- `clear()` → empty the map.\n\n" +
      "=== 10 HARD CONSTRAINTS — hold in EVERY round ===\n\n" +
      "1. No `Date.now()`, `performance.now()`, or `new Date()` anywhere. Only `options.now`.\n" +
      "2. `set()` with non-integer, zero, or negative `ttl` THROWS. Same for `defaultTTL` in ctor.\n" +
      "3. `get()` on expired returns `undefined` AND lazily deletes. Never throws.\n" +
      "4. `has()` does NOT change eviction recency.\n" +
      "5. `size()` excludes expired entries.\n" +
      "6. `keys()`/`entries()` use INSERTION order (order of first `set` for each key). Updating does NOT move to end. Skip expired.\n" +
      "7. Eviction uses LEAST-RECENTLY-SET. `set()` (insert OR update) refreshes set-recency. `get`/`has` do NOT.\n" +
      "8. `get()` on an object/array value returns a DEEP COPY. Caller mutation does not affect storage.\n" +
      "9. `touch(key)` resets expiry by the entry's ORIGINAL ttl (from its most recent `set`), not `defaultTTL`.\n" +
      "10. `clear()` preserves `maxEntries`, `defaultTTL`, and the injected `now`.\n\n" +
      "Notes: deep copy only needs plain objects + arrays + primitives. `delete`/`touch` on expired return false.\n" +
      "Verify with `bun test tests/ttl-map.test.js`. Tests cover basics only — the 10 rules above are YOUR responsibility.",
    seed: {
      "package.json": MINIMAL_PACKAGE_JSON,
      "tests/ttl-map.test.js": TTLMAP_TEST_FILE,
    },
    testsCmd: "bun test tests/ttl-map.test.js",
    constraints: [
      {
        id: "ttlmap-class-exists",
        description: "src/ttl-map.js exports a class named TTLMap",
        type: "fileRegex",
        file: "src/ttl-map.js",
        regex: "export\\s+class\\s+TTLMap\\b",
        mustMatch: true,
      },
      {
        id: "ttlmap-no-date-now",
        description: "Source does not call Date.now() / performance.now() / new Date()",
        type: "fileRegex",
        file: "src/ttl-map.js",
        regex: "Date\\.now\\s*\\(|performance\\.now\\s*\\(|new\\s+Date\\b",
        mustMatch: false,
      },
      {
        id: "ttlmap-clock-injection",
        description: "Uses injected clock and lazily expires entries",
        type: "jsExpr",
        file: "src/ttl-map.js",
        expr:
          "let t = 0; " +
          "const m = new mod.TTLMap({ now: () => t, defaultTTL: 1000 }); " +
          "m.set('a', 1, 100); " +
          "t = 50; const before = m.get('a'); " +
          "t = 200; const after = m.get('a'); " +
          "return before === 1 && after === undefined",
      },
      {
        id: "ttlmap-ttl-validation",
        description: "set() rejects non-integer, zero, and negative TTL",
        type: "jsExpr",
        file: "src/ttl-map.js",
        expr:
          "const m = new mod.TTLMap({ now: () => 0, defaultTTL: 100 }); " +
          "let threw = 0; " +
          "try { m.set('a', 1, 1.5) } catch { threw++ } " +
          "try { m.set('a', 1, 0) } catch { threw++ } " +
          "try { m.set('a', 1, -1) } catch { threw++ } " +
          "m.set('a', 1, 50); " +
          "return threw === 3 && m.get('a') === 1",
      },
      {
        id: "ttlmap-has-does-not-promote",
        description: "has() does not change eviction recency (LRU-SET order preserved)",
        type: "jsExpr",
        file: "src/ttl-map.js",
        expr:
          "let t = 0; " +
          "const m = new mod.TTLMap({ now: () => t, maxEntries: 2, defaultTTL: 10000 }); " +
          "m.set('a', 1); t = 1; m.set('b', 2); t = 2; " +
          "m.has('a'); m.has('a'); m.has('a'); " +
          "t = 3; m.set('c', 3); " +
          "return m.get('a') === undefined && m.get('b') === 2 && m.get('c') === 3",
      },
      {
        id: "ttlmap-size-excludes-expired",
        description: "size() skips expired entries",
        type: "jsExpr",
        file: "src/ttl-map.js",
        expr:
          "let t = 0; " +
          "const m = new mod.TTLMap({ now: () => t, defaultTTL: 10000 }); " +
          "m.set('a', 1, 100); m.set('b', 2, 500); m.set('c', 3, 500); " +
          "t = 150; " +
          "return m.size() === 2",
      },
      {
        id: "ttlmap-insertion-order",
        description: "keys() yields insertion order; update does not move to end",
        type: "jsExpr",
        file: "src/ttl-map.js",
        expr:
          "const m = new mod.TTLMap({ now: () => 0, defaultTTL: 10000 }); " +
          "m.set('a', 1); m.set('b', 2); m.set('c', 3); " +
          "m.set('a', 99); " +
          "const ks = [...m.keys()]; " +
          "return ks.length === 3 && ks[0] === 'a' && ks[1] === 'b' && ks[2] === 'c' && m.get('a') === 99",
      },
      {
        id: "ttlmap-lru-set-not-get",
        description: "Eviction uses least-recently-SET; get() does not rescue an old entry",
        type: "jsExpr",
        file: "src/ttl-map.js",
        expr:
          "let t = 0; " +
          "const m = new mod.TTLMap({ now: () => t, maxEntries: 2, defaultTTL: 10000 }); " +
          "m.set('a', 1); t = 1; m.set('b', 2); t = 2; " +
          "m.get('a'); m.get('a'); m.get('a'); " +
          "t = 3; m.set('c', 3); " +
          "return m.get('a') === undefined && m.get('b') === 2 && m.get('c') === 3",
      },
      {
        id: "ttlmap-deep-copy-get",
        description: "get() returns a deep copy — caller mutation does not affect stored value",
        type: "jsExpr",
        file: "src/ttl-map.js",
        expr:
          "const m = new mod.TTLMap({ now: () => 0, defaultTTL: 10000 }); " +
          "m.set('a', { n: 1, arr: [1, 2] }); " +
          "const v = m.get('a'); v.n = 999; v.arr.push(3); v.arr[0] = -1; " +
          "const v2 = m.get('a'); " +
          "return v2.n === 1 && v2.arr.length === 2 && v2.arr[0] === 1 && v2.arr[1] === 2",
      },
      {
        id: "ttlmap-touch-original-ttl",
        description: "touch() resets expiry using the entry's ORIGINAL ttl, not defaultTTL",
        type: "jsExpr",
        file: "src/ttl-map.js",
        expr:
          "let t = 0; " +
          "const m = new mod.TTLMap({ now: () => t, defaultTTL: 10000 }); " +
          "m.set('a', 1, 100); " +
          "t = 50; m.touch('a'); " +
          "t = 120; const alive = m.get('a'); " +
          "t = 200; const dead = m.get('a'); " +
          "return alive === 1 && dead === undefined",
      },
      {
        id: "ttlmap-clear-preserves-config",
        description: "clear() preserves maxEntries, defaultTTL, and injected clock",
        type: "jsExpr",
        file: "src/ttl-map.js",
        expr:
          "let t = 0; " +
          "const m = new mod.TTLMap({ now: () => t, maxEntries: 2, defaultTTL: 100 }); " +
          "m.set('a', 1); m.set('b', 2); " +
          "m.clear(); " +
          "m.set('x', 1); m.set('y', 2); m.set('z', 3); " +
          "const capHeld = m.size() === 2 && m.get('x') === undefined; " +
          "t = 500; " +
          "const clockHeld = m.size() === 0; " +
          "return capHeld && clockHeld",
      },
    ],
    trialCount: 3,
    maxRounds: 8,
    phaseTimeoutMs: 300_000,
  },
  {
    id: "stress-json-patch",
    description:
      "Hard, genuinely multi-round task. RFC 6902 JSON Patch with 6 ops (add/remove/replace/move/" +
      "copy/test), RFC 6901 pointer escapes (~0/~1 + ~01 precedence), atomic rollback on mid-patch " +
      "failure, and no-mutation invariant on the input document. 20 bun tests cover behavioral " +
      "correctness (these will fail clustered in round 1), and jsExpr constraints measure deeper " +
      "invariants (deep-copy in copy op, rollback actually unmutates, escape precedence). " +
      "Designed so minimax-m2.5-free cannot one-shot: round-1 almost always misses atomic " +
      "rollback or escape precedence; later fixes tend to break the no-mutation invariant.",
    task:
      "Implement `applyPatch(doc, ops)` at `src/patch.js` as `export function applyPatch`.\n" +
      "ES module. Implements RFC 6902 JSON Patch over RFC 6901 JSON Pointer paths.\n\n" +
      "Signature: `applyPatch(doc, ops)` — returns a new document. Throws on any failure.\n" +
      "`ops` is an array of operation objects. Each op has `op` and `path`. `add`/`replace`/" +
      "`test` also have `value`. `move`/`copy` also have `from`.\n\n" +
      "Operations:\n" +
      "- `add`: insert at path. On arrays, `/idx` inserts at idx and shifts; `/-` appends. On " +
      "objects, creates or replaces the key. Parent must exist.\n" +
      "- `remove`: delete the value at path. Arrays shift.\n" +
      "- `replace`: overwrite the value. The path must already exist.\n" +
      "- `move`: `{ from, path }`. Remove at `from`, then add at `path`. Must NOT move into own " +
      "descendant (moving `/a` into `/a/x` is an error).\n" +
      "- `copy`: `{ from, path }`. Deep-copy value at `from` and add at `path`. Source unchanged.\n" +
      "- `test`: `{ path, value }`. Deep-equality check. On mismatch, the ENTIRE patch fails.\n\n" +
      "Path format (RFC 6901):\n" +
      "- Empty string `\"\"` refers to the whole document.\n" +
      "- Otherwise `/seg1/seg2/...`. Each segment escape-decodes: `~1` → `/`, `~0` → `~`. " +
      "`~1` must be replaced before `~0` so `~01` decodes to `~1`, NOT `/`.\n" +
      "- On arrays, a numeric segment is an index; out-of-range → error. `-` is valid only for " +
      "`add` (append).\n\n" +
      "=== HARD INVARIANTS (not all are tested via bun — uphold them anyway) ===\n\n" +
      "1. ATOMIC: If any op in the patch fails, throw an Error and leave the input `doc` exactly " +
      "as it was. No partial application is visible to the caller.\n" +
      "2. NO MUTATION: `doc` (and any nested objects/arrays inside it) must not be mutated, even " +
      "on success. The returned value is a new document.\n" +
      "3. DEEP COPY ON COPY: The `copy` op must deep-copy the source. Mutating the copied subtree " +
      "in the result must not affect the original's subtree at `from`.\n" +
      "4. TEST IS DEEP: `test` uses structural deep equality over plain values, arrays, objects. " +
      "Types must match (1 !== \"1\"). NaN equals NaN is not required — tests don't use NaN.\n" +
      "5. POINTER PRECEDENCE: `~1` is decoded first, then `~0`. So `~01` is `~1` literal.\n" +
      "6. `move` from X to X is a no-op on the value but still must succeed with X present.\n\n" +
      "Implementation guidance:\n" +
      "- Simplest correct approach: on entry, deep-clone the input; apply ops to the clone; on " +
      "any op failure throw (the clone is discarded; original was never touched).\n" +
      "- Deep copy only needs to handle plain objects, arrays, primitives, null.\n" +
      "- When throwing, the Error message should include the op index and reason, e.g. " +
      "`\"patch op 2 (remove): path /foo not found\"`.\n\n" +
      "Verify with `bun test tests/patch.test.js`. The tests cover most behaviors but not every " +
      "invariant — hold the invariants above regardless.",
    seed: {
      "package.json": MINIMAL_PACKAGE_JSON,
      "tests/patch.test.js": JSON_PATCH_TEST_FILE,
    },
    testsCmd: "bun test tests/patch.test.js",
    constraints: [
      {
        id: "patch-fn-exists",
        description: "src/patch.js exports a function named applyPatch",
        type: "fileRegex",
        file: "src/patch.js",
        regex: "export\\s+(function\\s+applyPatch\\b|const\\s+applyPatch\\s*=|\\{[^}]*\\bapplyPatch\\b)",
        mustMatch: true,
      },
      {
        id: "patch-basic-add",
        description: "add inserts a property into an object",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const out = mod.applyPatch({ a: 1 }, [{ op: 'add', path: '/b', value: 2 }]); " +
          "return out.a === 1 && out.b === 2",
      },
      {
        id: "patch-array-dash-append",
        description: "'-' appends to array in add op",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const out = mod.applyPatch([1, 2], [{ op: 'add', path: '/-', value: 3 }]); " +
          "return Array.isArray(out) && out.length === 3 && out[2] === 3",
      },
      {
        id: "patch-no-mutation-on-success",
        description: "Original document is not mutated by a successful patch (deep check)",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const original = { a: { n: 1 }, list: [1, 2] }; " +
          "const snap = JSON.parse(JSON.stringify(original)); " +
          "mod.applyPatch(original, [{ op: 'add', path: '/a/m', value: 9 }, { op: 'add', path: '/list/-', value: 3 }]); " +
          "return JSON.stringify(original) === JSON.stringify(snap)",
      },
      {
        id: "patch-atomic-rollback",
        description: "Failing mid-patch throws AND leaves original untouched",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const original = { a: 1, b: 2 }; " +
          "const snap = JSON.parse(JSON.stringify(original)); " +
          "let threw = false; " +
          "try { mod.applyPatch(original, [" +
          "{ op: 'add', path: '/c', value: 3 }, " +
          "{ op: 'remove', path: '/a' }, " +
          "{ op: 'remove', path: '/does-not-exist' }]) } catch { threw = true } " +
          "return threw && JSON.stringify(original) === JSON.stringify(snap)",
      },
      {
        id: "patch-copy-is-deep",
        description: "copy op produces a deep copy — mutating result doesn't affect source in doc",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const doc = { a: { n: 1, nested: [10, 20] } }; " +
          "const out = mod.applyPatch(doc, [{ op: 'copy', from: '/a', path: '/b' }]); " +
          "out.b.n = 999; out.b.nested.push(999); " +
          "return out.a.n === 1 && out.a.nested.length === 2",
      },
      {
        id: "patch-escape-precedence",
        description: "JSON pointer ~01 decodes to literal ~1 (not escape-of-escape)",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const out = mod.applyPatch({ '~1': 5 }, [{ op: 'replace', path: '/~01', value: 42 }]); " +
          "return out['~1'] === 42",
      },
      {
        id: "patch-move-into-descendant-throws",
        description: "move from /a to /a/b throws (cannot move into own descendant)",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "let threw = false; " +
          "try { mod.applyPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a', path: '/a/b' }]) } catch { threw = true } " +
          "return threw",
      },
      {
        id: "patch-test-type-strict",
        description: "test op with type mismatch (1 vs '1') fails the whole patch",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "let threw = false; " +
          "try { mod.applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: '1' }, { op: 'add', path: '/b', value: 2 }]) } catch { threw = true } " +
          "return threw",
      },
      {
        id: "patch-array-add-oob-throws",
        description: "add to array at index greater than length throws",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "let threw = false; " +
          "try { mod.applyPatch([1, 2], [{ op: 'add', path: '/5', value: 9 }]) } catch { threw = true } " +
          "return threw",
      },
      {
        id: "patch-root-replace",
        description: "replace with path '' swaps the entire document",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const out = mod.applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: { b: 2 } }]); " +
          "return out && out.b === 2 && !('a' in out)",
      },
    ],
    trialCount: 3,
    maxRounds: 10,
    phaseTimeoutMs: 600_000,
    studentPermission: [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "read", pattern: "*/tests/*", action: "deny" },
      { permission: "read", pattern: "*/tests/**", action: "deny" },
      { permission: "read", pattern: "**/*.test.js", action: "deny" },
      { permission: "edit", pattern: "*/tests/**", action: "deny" },
      { permission: "edit", pattern: "**/*.test.js", action: "deny" },
    ],
  },
  {
    id: "stress-json-patch-debug",
    description:
      "Debug-a-buggy-scaffold variant of stress-json-patch. The student is HANDED a working-" +
      "looking applyPatch() implementation that contains 8 planted bugs spanning mutation, " +
      "escape decoding, append semantics, atomic rollback, replace-must-exist, deep-copy in " +
      "copy op, deep equality in test op, and descendant checks in move op. The same 20 bun " +
      "tests reveal failures. Student cannot one-shot because even if it rewrites from " +
      "scratch in round 1, the task prompt explicitly forbids rewriting (the file should be " +
      "edited in place). Designed to force 3-6 rounds of iterative repair on minimax-m2.5-free. " +
      "Retention is measured by whether later rounds regress earlier fixes. Tests are hidden " +
      "from the student via permission deny rules — it can only infer bugs from test output.",
    task:
      "The file `src/patch.js` contains a JSON Patch (RFC 6902) implementation that is " +
      "mostly-working but contains multiple bugs. Your task is to find and fix the bugs.\n\n" +
      "RULES:\n" +
      "- Edit `src/patch.js` in place with the edit tool. Do NOT delete and rewrite the whole " +
      "file in a single `write` call — keep the existing structure and patch the bugs surgically.\n" +
      "- YOU CANNOT RUN TESTS OR SHELL COMMANDS. The bash tool is disabled for you. Read " +
      "`src/patch.js`, reason carefully about what the code does, and submit your best fix. " +
      "A separate process will run the test suite and feed results back to you via a " +
      "supervisor review for the next round.\n" +
      "- You do NOT have read access to the tests file. You only know that the code is expected " +
      "to implement the RFC 6902 JSON Patch specification correctly.\n" +
      "- When fixing a bug, be careful not to regress code that was likely already working. " +
      "If you are uncertain whether a region has a bug, leave it alone this round; later " +
      "supervisor feedback will point you at specific failing cases.\n\n" +
      "BEHAVIORAL SPEC (what `applyPatch(doc, ops)` must do):\n" +
      "- RFC 6902 ops: `add`, `remove`, `replace`, `move`, `copy`, `test`.\n" +
      "- RFC 6901 JSON Pointer paths: `/seg1/seg2`, with `~1` → `/`, `~0` → `~` (decode `~1` " +
      "before `~0` so `~01` decodes to literal `~1`).\n" +
      "- Path `\"\"` refers to the whole document.\n" +
      "- On arrays: numeric segment is index; `-` in an `add` path means append.\n" +
      "- `replace` must fail if the target path does not already exist.\n" +
      "- `test` uses deep (structural) equality; types must match.\n" +
      "- `move` must fail if `path` is a descendant of `from`.\n" +
      "- `copy` must produce a deep copy of the source subtree.\n" +
      "- The whole patch is ATOMIC: if any op throws, the caller's `doc` must be unchanged " +
      "and an Error must propagate.\n" +
      "- `applyPatch` must NEVER mutate the caller's input document.\n\n" +
      "Submit a fix each round. Wait for supervisor feedback on what is still broken, then fix " +
      "further in the next round.",
    seed: {
      "package.json": MINIMAL_PACKAGE_JSON,
      "tests/patch.test.js": JSON_PATCH_TEST_FILE,
      "src/patch.js": JSON_PATCH_BUGGY_SRC,
    },
    testsCmd: "bun test tests/patch.test.js",
    constraints: [
      {
        id: "patch-fn-exists",
        description: "src/patch.js exports applyPatch",
        type: "fileRegex",
        file: "src/patch.js",
        regex: "export\\s+(function\\s+applyPatch\\b|const\\s+applyPatch\\s*=|\\{[^}]*\\bapplyPatch\\b)",
        mustMatch: true,
      },
      {
        id: "patch-basic-add",
        description: "add inserts a property into an object",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const out = mod.applyPatch({ a: 1 }, [{ op: 'add', path: '/b', value: 2 }]); " +
          "return out.a === 1 && out.b === 2",
      },
      {
        id: "patch-array-dash-append",
        description: "'-' appends to array in add op",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const out = mod.applyPatch([1, 2], [{ op: 'add', path: '/-', value: 3 }]); " +
          "return Array.isArray(out) && out.length === 3 && out[2] === 3",
      },
      {
        id: "patch-no-mutation-on-success",
        description: "Original document is not mutated by a successful patch",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const original = { a: { n: 1 }, list: [1, 2] }; " +
          "const snap = JSON.parse(JSON.stringify(original)); " +
          "mod.applyPatch(original, [{ op: 'add', path: '/a/m', value: 9 }, { op: 'add', path: '/list/-', value: 3 }]); " +
          "return JSON.stringify(original) === JSON.stringify(snap)",
      },
      {
        id: "patch-atomic-rollback",
        description: "Failing mid-patch throws AND leaves original untouched",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const original = { a: 1, b: 2 }; " +
          "const snap = JSON.parse(JSON.stringify(original)); " +
          "let threw = false; " +
          "try { mod.applyPatch(original, [" +
          "{ op: 'add', path: '/c', value: 3 }, " +
          "{ op: 'remove', path: '/a' }, " +
          "{ op: 'remove', path: '/does-not-exist' }]) } catch { threw = true } " +
          "return threw && JSON.stringify(original) === JSON.stringify(snap)",
      },
      {
        id: "patch-copy-is-deep",
        description: "copy op produces a deep copy",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const doc = { a: { n: 1, nested: [10, 20] } }; " +
          "const out = mod.applyPatch(doc, [{ op: 'copy', from: '/a', path: '/b' }]); " +
          "out.b.n = 999; out.b.nested.push(999); " +
          "return out.a.n === 1 && out.a.nested.length === 2",
      },
      {
        id: "patch-escape-precedence",
        description: "JSON pointer ~01 decodes to literal ~1",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const out = mod.applyPatch({ '~1': 5 }, [{ op: 'replace', path: '/~01', value: 42 }]); " +
          "return out['~1'] === 42",
      },
      {
        id: "patch-move-into-descendant-throws",
        description: "move from /a to /a/b throws",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "let threw = false; " +
          "try { mod.applyPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a', path: '/a/b' }]) } catch { threw = true } " +
          "return threw",
      },
      {
        id: "patch-test-deep-object",
        description: "test op succeeds on deep-equal objects (not just reference equality)",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const out = mod.applyPatch({ a: { x: [1, 2] } }, [" +
          "{ op: 'test', path: '/a', value: { x: [1, 2] } }, " +
          "{ op: 'add', path: '/b', value: 9 }]); " +
          "return out && out.b === 9",
      },
      {
        id: "patch-replace-missing-throws",
        description: "replace on a non-existent path throws (does not silently create)",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "let threw = false; " +
          "try { mod.applyPatch({ a: 1 }, [{ op: 'replace', path: '/missing', value: 0 }]) } catch { threw = true } " +
          "return threw",
      },
      {
        id: "patch-root-replace",
        description: "replace with path '' swaps the entire document",
        type: "jsExpr",
        file: "src/patch.js",
        expr:
          "const out = mod.applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: { b: 2 } }]); " +
          "return out && out.b === 2 && !('a' in out)",
      },
    ],
    trialCount: 3,
    maxRounds: 10,
    phaseTimeoutMs: 600_000,
    studentPermission: [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "read", pattern: "*/tests/*", action: "deny" },
      { permission: "read", pattern: "*/tests/**", action: "deny" },
      { permission: "read", pattern: "**/*.test.js", action: "deny" },
      { permission: "edit", pattern: "*/tests/**", action: "deny" },
      { permission: "edit", pattern: "**/*.test.js", action: "deny" },
      { permission: "bash", pattern: "*", action: "deny" },
    ],
  },
  {
    id: "stress-flock-debug",
    description:
      "Custom-DSL debug task designed to force genuine multi-round iteration under " +
      "context inflation. 4 source files (~300 lines) implement a fictional pipeline " +
      "engine 'Flock' with 15 planted bugs distributed across engine / graph / util / " +
      "errors. Test names are opaque (t_01..t_20) so supervisor feedback cannot leak " +
      "invariant names. Task prompt intentionally omits per-bug specs — student must " +
      "infer expected behavior from test failure output across rounds. bash and tests/ " +
      "reads are denied. This is the first task in the suite where context across " +
      "rounds meaningfully inflates (4-file diff + accumulating supervisor feedback), " +
      "testing whether dual-agent's split-session context preserves attention better " +
      "than single.",
    task:
      "The files under `src/flock/` implement a fictional pipeline engine called Flock. " +
      "Read them carefully — they contain multiple bugs in different files. Your task is " +
      "to make the test suite pass.\n\n" +
      "FLOCK API (from reading the code):\n" +
      "- `new Flock()` creates an empty engine.\n" +
      "- `.define(name, fn, options?)` registers a task. `options` may include `deps` (array " +
      "of task names this one depends on), `priority` (higher runs earlier among siblings), " +
      "and `retries` (total attempts allowed if the task throws).\n" +
      "- `.run(target, ctx?)` executes `target` and all its transitive deps, returns the " +
      "target's result. Task functions are called as `fn(ctx, deps)` where `deps` is keyed " +
      "by dep name.\n" +
      "- `.snapshot()` returns a full, independent copy of the results map.\n" +
      "- `.restore(state)` seeds the results from a prior snapshot; restored tasks are not " +
      "re-executed.\n" +
      "- Cycles in the dep graph throw `CycleError`. Missing task names throw `UnknownTaskError`. " +
      "Redefining a name throws `DuplicateTaskError`. All Flock-specific errors must be " +
      "`instanceof FlockError`.\n\n" +
      "CONSTRAINTS:\n" +
      "- Edit files in place with the `edit` tool. Do NOT delete and rewrite whole files.\n" +
      "- You have NO bash and NO read access to tests/. You cannot run the test suite. " +
      "Submit your best fix each round; a separate process will run the tests and " +
      "supervisor feedback will tell you which tests failed and how.\n" +
      "- When you fix a bug, try not to regress a behavior that was likely already working. " +
      "If supervisor feedback doesn't mention a test, don't touch the code region related to it.\n\n" +
      "Work iteratively. Submit fixes, read supervisor feedback, iterate.",
    seed: {
      "package.json": MINIMAL_PACKAGE_JSON,
      "tests/flock.test.js": FLOCK_TEST_FILE,
      "src/flock/engine.js": FLOCK_ENGINE_SRC,
      "src/flock/graph.js": FLOCK_GRAPH_SRC,
      "src/flock/util.js": FLOCK_UTIL_SRC,
      "src/flock/errors.js": FLOCK_ERRORS_SRC,
    },
    testsCmd: "bun test tests/flock.test.js",
    constraints: [
      {
        id: "flock-engine-exists",
        description: "src/flock/engine.js exports Flock",
        type: "fileRegex",
        file: "src/flock/engine.js",
        regex: "export\\s+class\\s+Flock\\b",
        mustMatch: true,
      },
      {
        id: "flock-basic-run",
        description: "Flock runs a single task",
        type: "jsExpr",
        file: "src/flock/engine.js",
        expr:
          "const f = new mod.Flock(); " +
          "f.define('a', () => 1); " +
          "return f.run('a') === 1",
      },
      {
        id: "flock-deps-keyed-object",
        description: "deps argument is keyed by dep name (not an array)",
        type: "jsExpr",
        file: "src/flock/engine.js",
        expr:
          "const f = new mod.Flock(); " +
          "f.define('a', () => 10); " +
          "f.define('b', () => 20); " +
          "f.define('c', (_, deps) => deps.a + deps.b, { deps: ['a', 'b'] }); " +
          "return f.run('c') === 30",
      },
      {
        id: "flock-cycle-detected",
        description: "Cycles throw an error (any cycle form)",
        type: "jsExpr",
        file: "src/flock/engine.js",
        expr:
          "const f = new mod.Flock(); " +
          "f.define('a', () => 1, { deps: ['a'] }); " +
          "let threw = false; " +
          "try { f.run('a') } catch { threw = true } " +
          "return threw",
      },
      {
        id: "flock-cycle-is-flock-error",
        description: "CycleError instances are instanceof FlockError",
        type: "jsExpr",
        file: "src/flock/errors.js",
        expr:
          "const e = new mod.CycleError(['a','b','a']); " +
          "return e instanceof mod.FlockError",
      },
      {
        id: "flock-proto-pollution-safe",
        description: "Defining a task named __proto__ does not pollute Object.prototype",
        type: "jsExpr",
        file: "src/flock/engine.js",
        expr:
          "const f = new mod.Flock(); " +
          "f.define('__proto__', () => 42); " +
          "const poisoned = {}; " +
          "return poisoned.toString === Object.prototype.toString && f.run('__proto__') === 42",
      },
      {
        id: "flock-duplicate-builtin-name",
        description: "Defining 'toString' does not throw duplicate due to prototype inheritance",
        type: "jsExpr",
        file: "src/flock/engine.js",
        expr:
          "const f = new mod.Flock(); " +
          "let threw = false; " +
          "try { f.define('toString', () => 7) } catch { threw = true } " +
          "return !threw && f.run('toString') === 7",
      },
      {
        id: "flock-retries-total-attempts",
        description: "retries:N means N total attempts, not N+1",
        type: "jsExpr",
        file: "src/flock/engine.js",
        expr:
          "const f = new mod.Flock(); " +
          "let tries = 0; " +
          "f.define('a', () => { tries++; throw new Error('x') }, { retries: 2 }); " +
          "try { f.run('a') } catch {} " +
          "return tries === 2",
      },
      {
        id: "flock-snapshot-deep",
        description: "snapshot() is deeply independent from internal state",
        type: "jsExpr",
        file: "src/flock/engine.js",
        expr:
          "const f = new mod.Flock(); " +
          "f.define('a', () => ({ count: 5, list: [1, 2] })); " +
          "f.run('a'); " +
          "const snap = f.snapshot(); " +
          "snap.a.count = 999; snap.a.list.push(999); " +
          "f.define('b', (_, deps) => deps.a.count + deps.a.list.length, { deps: ['a'] }); " +
          "return f.run('b') === 7",
      },
      {
        id: "flock-deepclone-date",
        description: "util.deepClone preserves Date instances",
        type: "jsExpr",
        file: "src/flock/util.js",
        expr:
          "const d = new Date('2024-06-01T00:00:00Z'); " +
          "const c = mod.deepClone({ when: d }); " +
          "return c.when instanceof Date && c.when.getTime() === d.getTime() && c.when !== d",
      },
      {
        id: "flock-topo-forward-order",
        description: "Graph.topoSort returns deps-first order",
        type: "jsExpr",
        file: "src/flock/graph.js",
        expr:
          "const g = new mod.Graph(); " +
          "g.addNode('a'); g.addNode('b'); g.addNode('c'); " +
          "g.addEdge('c', 'b'); g.addEdge('b', 'a'); " +
          "const order = g.topoSort('c'); " +
          "return order[0] === 'a' && order[1] === 'b' && order[2] === 'c'",
      },
      {
        id: "flock-orderby-desc",
        description: "orderByPriority sorts by priority DESC (higher first)",
        type: "jsExpr",
        file: "src/flock/util.js",
        expr:
          "const out = mod.orderByPriority([" +
          "{ name:'a', priority:1, insertedAt:0 }, " +
          "{ name:'b', priority:5, insertedAt:1 }, " +
          "{ name:'c', priority:3, insertedAt:2 }]); " +
          "return out[0].name === 'b' && out[1].name === 'c' && out[2].name === 'a'",
      },
      {
        id: "flock-unknown-error-message",
        description: "UnknownTaskError message includes the missing task name",
        type: "jsExpr",
        file: "src/flock/errors.js",
        expr:
          "const e = new mod.UnknownTaskError('ghost'); " +
          "return typeof e.message === 'string' && e.message.includes('ghost')",
      },
    ],
    trialCount: 3,
    maxRounds: 5,
    phaseTimeoutMs: 600_000,
    studentPermission: [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "read", pattern: "*/tests/*", action: "deny" },
      { permission: "read", pattern: "*/tests/**", action: "deny" },
      { permission: "read", pattern: "**/*.test.js", action: "deny" },
      { permission: "edit", pattern: "*/tests/**", action: "deny" },
      { permission: "edit", pattern: "**/*.test.js", action: "deny" },
      { permission: "bash", pattern: "*", action: "deny" },
    ],
  },
]

// Auto-upgrade is disabled in this fork. Zwei is versioned independently
// from upstream opencode, and the Installation service still points at
// opencode's release channels (npm "opencode-ai", Homebrew "opencode",
// GitHub "anomalyco/opencode"). Running upgrade here would pull an
// unrelated package on top of the installed zwei binary. Returning early
// keeps the TUI's `checkUpgrade` RPC cheap and safe.
export async function upgrade() {
  return
}

declare global {
  const ZWEI_VERSION: string
  const ZWEI_CHANNEL: string
}

export const VERSION = typeof ZWEI_VERSION === "string" ? ZWEI_VERSION : "local"
export const CHANNEL = typeof ZWEI_CHANNEL === "string" ? ZWEI_CHANNEL : "local"

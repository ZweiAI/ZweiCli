export function gcd(a: number, b: number): number {
  const x = Math.abs(a)
  const y = Math.abs(b)
  if (y === 0) return x
  return gcd(y, x % y)
}

/**
 * Bound a numeric value within the provided inclusive range.
 *
 * Preconditions:
 * - `min` must be less than or equal to `max`.
 * - All inputs must be finite numbers.
 *
 * Postconditions:
 * - The return value is never less than `min` and never greater than `max`.
 * - Floating-point input is preserved when already inside the range.
 *
 * Errors:
 * - Throws `RangeError` if `min` is greater than `max`.
 * - Throws `RangeError` if any argument is `NaN` or infinite.
 */
export function clamp(value: number, min: number, max: number): number {
  throw new Error("Not implemented")
}

/**
 * Timing-safe string compare for webhook Authorization headers.
 * Length mismatches still run a compare on padded buffers so timing does not
 * trivially leak the expected secret length.
 */
export function timingSafeEqualString(
  provided: string | null | undefined,
  expected: string,
): boolean {
  const a = provided ?? ''
  const enc = new TextEncoder()
  const left = enc.encode(a)
  const right = enc.encode(expected)
  const len = Math.max(left.byteLength, right.byteLength, 1)
  const paddedLeft = new Uint8Array(len)
  const paddedRight = new Uint8Array(len)
  paddedLeft.set(left)
  paddedRight.set(right)

  let diff = 0
  for (let i = 0; i < len; i++) {
    diff |= paddedLeft[i]! ^ paddedRight[i]!
  }
  return diff === 0 && left.byteLength === right.byteLength
}

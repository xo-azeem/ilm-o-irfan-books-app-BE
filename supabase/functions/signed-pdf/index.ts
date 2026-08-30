// Deprecated alias for get-signed-pdf.
//
// This function was a near-copy of get-signed-pdf with its own drifting copy
// of the paywall logic. It is kept only so already-shipped clients get a clear
// message instead of a 404, and it deliberately does no auth work of its own:
// there is nothing here worth protecting.
//
// Remove once no app build in the wild calls it.

import { fail, handleOptions } from '../_shared/http.ts'

Deno.serve((req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  return fail(
    'DEPRECATED_ENDPOINT',
    'Use /functions/v1/get-signed-pdf instead of /functions/v1/signed-pdf',
    410,
  )
})

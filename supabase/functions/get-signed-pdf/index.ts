// Edge Function: get-signed-pdf
// JWT required. Admins may preview drafts.
// Access is granted when any of these is true:
//   - JWT / profile role is admin
//   - ALLOW_PDF_WITHOUT_ENTITLEMENT env is on (true/1/yes/on)
//   - app_settings.allow_pdf_without_entitlement is on
//   - the user has an active entitlement

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function envFlagOn(name: string): boolean {
  const value = (Deno.env.get(name) ?? '').trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes' || value === 'on'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const expiresIn = Number(Deno.env.get('SIGNED_PDF_EXPIRES_IN') ?? '300')
    const envAllowsWithoutEntitlement = envFlagOn('ALLOW_PDF_WITHOUT_ENTITLEMENT')

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Missing Authorization header', code: 'AUTH_REQUIRED' }, 401)
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()

    if (userError || !user) {
      return json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, 401)
    }

    const body = await req.json().catch(() => ({}))
    const bookId = body.bookId as string | undefined

    if (!bookId) {
      return json({ error: 'bookId is required' }, 400)
    }

    const admin = createClient(supabaseUrl, serviceKey)

    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    const isAdmin =
      user.app_metadata?.app_role === 'admin' || profile?.role === 'admin'

    const { data: settings } = await admin
      .from('app_settings')
      .select('allow_pdf_without_entitlement')
      .eq('id', 1)
      .maybeSingle()

    const allowWithoutEntitlement =
      envAllowsWithoutEntitlement || settings?.allow_pdf_without_entitlement === true

    const { data: book, error: bookError } = await admin
      .from('books')
      .select('id, title, pdf_path, is_published, file_size_bytes')
      .eq('id', bookId)
      .maybeSingle()

    if (bookError) {
      return json({ error: bookError.message }, 500)
    }

    if (!book || (!isAdmin && !book.is_published)) {
      return json({ error: 'Book not found' }, 404)
    }

    if (!book.pdf_path) {
      return json({ error: 'PDF not available for this book' }, 404)
    }

    if (!isAdmin && !allowWithoutEntitlement) {
      const { data: entitlement, error: entError } = await admin
        .from('entitlements')
        .select('status, expires_at')
        .eq('user_id', user.id)
        .maybeSingle()

      if (entError) {
        return json({ error: entError.message }, 500)
      }

      const active =
        entitlement?.status === 'active' &&
        (entitlement.expires_at == null ||
          new Date(entitlement.expires_at).getTime() > Date.now())

      if (!active) {
        return json(
          { error: 'Active subscription required', code: 'PREMIUM_REQUIRED' },
          403,
        )
      }
    }

    const rawPath = book.pdf_path.replace(/^\/+/, '')
    const stripped = rawPath.replace(/^pdfs\//, '')
    const candidates = [...new Set([stripped, rawPath].filter(Boolean))]

    let signedUrl: string | null = null
    let lastSignError: string | null = null
    let objectPathUsed: string | null = null

    for (const objectPath of candidates) {
      const { data: signed, error: signError } = await admin.storage
        .from('pdfs')
        .createSignedUrl(objectPath, expiresIn)

      if (signed?.signedUrl) {
        signedUrl = signed.signedUrl
        objectPathUsed = objectPath
        break
      }
      lastSignError = signError?.message ?? `Could not sign ${objectPath}`
    }

    if (!signedUrl) {
      return json(
        {
          error: lastSignError ?? 'PDF file not found in storage',
          code: 'PDF_NOT_IN_STORAGE',
        },
        404,
      )
    }

    let fileSizeBytes = book.file_size_bytes ?? null
    if (fileSizeBytes == null || fileSizeBytes <= 0) {
      try {
        const storageApi = admin.storage.from('pdfs') as {
          info?: (path: string) => Promise<{ data: { size?: number } | null }>
        }
        if (objectPathUsed && typeof storageApi.info === 'function') {
          const { data: meta } = await storageApi.info(objectPathUsed)
          if (typeof meta?.size === 'number' && meta.size > 0) {
            fileSizeBytes = meta.size
          }
        }
      } catch {
        // Catalog size and the client Content-Length fallback still apply.
      }
    }

    if ((fileSizeBytes == null || fileSizeBytes <= 0) && signedUrl) {
      try {
        const probe = await fetch(signedUrl, { headers: { Range: 'bytes=0-0' } })
        const range = probe.headers.get('content-range') ?? ''
        const match = /\/(\d+)\s*$/.exec(range)
        const length = match ? Number(match[1]) : Number(probe.headers.get('content-length'))
        if (Number.isFinite(length) && length > 0) {
          fileSizeBytes = length
        }
      } catch {
        // Client will probe Content-Length while downloading.
      }
    }

    return json({
      bookId: book.id,
      title: book.title,
      signedUrl,
      expiresIn,
      fileSizeBytes,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

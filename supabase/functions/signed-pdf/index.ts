import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Authorization header is required' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      },
    )

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const body = await req.json().catch(() => ({}))
    const bookId = body.bookId ?? body.book_id

    if (!bookId) {
      return json({ error: 'bookId is required' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    const isAdmin = user.app_metadata?.app_role === 'admin' || profile?.role === 'admin'

    const { data: settings } = await admin
      .from('app_settings')
      .select('allow_pdf_without_entitlement')
      .eq('id', 1)
      .maybeSingle()

    const envAllowsWithoutEntitlement = envFlagOn('ALLOW_PDF_WITHOUT_ENTITLEMENT')
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
        return json({ error: 'Active subscription required', code: 'PREMIUM_REQUIRED' }, 403)
      }
    }

    const expiresIn = Number(Deno.env.get('SIGNED_PDF_EXPIRES_IN') ?? '300')
    const rawPath = book.pdf_path.replace(/^\/+/, '')
    const stripped = rawPath.replace(/^pdfs\//, '')
    const candidates = [...new Set([stripped, rawPath].filter(Boolean))]

    let signedUrl: string | null = null
    let lastSignError: string | null = null

    for (const objectPath of candidates) {
      const { data: signed, error: signError } = await admin.storage
        .from('pdfs')
        .createSignedUrl(objectPath, expiresIn)

      if (signed?.signedUrl) {
        signedUrl = signed.signedUrl
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

    return json({
      data: {
        bookId: book.id,
        title: book.title,
        signedUrl,
        expiresIn,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})

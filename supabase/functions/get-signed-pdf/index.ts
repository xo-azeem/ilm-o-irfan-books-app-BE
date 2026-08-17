// Edge Function: get-signed-pdf
// JWT required. Admins may preview drafts. Everyone else needs an active
// entitlement for every book. ALLOW_PDF_WITHOUT_ENTITLEMENT is dev-only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    // Dev-only: skip entitlement for signed-in non-admins. Unsafe for production.
    const allowWithoutEntitlement =
      Deno.env.get('ALLOW_PDF_WITHOUT_ENTITLEMENT') === 'true'

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

    const isAdmin = user.app_metadata?.app_role === 'admin'

    const admin = createClient(supabaseUrl, serviceKey)

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

    // pdf_path is stored as "pdfs/filename.pdf" or just "filename.pdf"
    const objectPath = book.pdf_path.replace(/^pdfs\//, '')
    const fileName = objectPath.split('/').pop() ?? objectPath
    const folder = objectPath.includes('/')
      ? objectPath.slice(0, objectPath.lastIndexOf('/'))
      : ''

    const { data: listed, error: listError } = await admin.storage
      .from('pdfs')
      .list(folder, { search: fileName, limit: 100 })

    const stored = listed?.some((item) => item.name === fileName)
    if (listError || !stored) {
      return json(
        {
          error: listError?.message ?? 'PDF file not found in storage',
          code: 'PDF_NOT_IN_STORAGE',
        },
        404,
      )
    }

    const { data: signed, error: signError } = await admin.storage
      .from('pdfs')
      .createSignedUrl(objectPath, expiresIn)

    if (signError || !signed?.signedUrl) {
      return json({ error: signError?.message ?? 'Failed to sign URL' }, 500)
    }

    return json({
      bookId: book.id,
      title: book.title,
      signedUrl: signed.signedUrl,
      expiresIn,
      fileSizeBytes: book.file_size_bytes,
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

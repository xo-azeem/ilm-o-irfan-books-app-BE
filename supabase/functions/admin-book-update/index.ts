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
        global: { headers: { Authorization: authHeader } },
      },
    )

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401)
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

    if (user.app_metadata?.app_role !== 'admin' && profile?.role !== 'admin') {
      return json({ error: 'Forbidden' }, 403)
    }

    const payload = await req.json().catch(() => ({}))
    const bookId = payload.id ?? payload.book_id ?? payload.bookId

    if (!bookId) {
      return json({ error: 'book id is required' }, 400)
    }

    const updateObj: Record<string, unknown> = {}

    if ('title' in payload) updateObj.title = payload.title
    if ('description' in payload) updateObj.description = payload.description
    if ('genre' in payload) updateObj.genre = payload.genre
    if ('is_published' in payload) updateObj.is_published = payload.is_published
    if ('is_premium' in payload) updateObj.is_premium = payload.is_premium
    if ('price_cents' in payload) updateObj.price_cents = payload.price_cents
    if ('cover_path' in payload) updateObj.cover_path = payload.cover_path
    if ('pdf_path' in payload) updateObj.pdf_path = payload.pdf_path
    if ('tag' in payload) updateObj.tag = payload.tag
    if ('tags' in payload) updateObj.tags = payload.tags

    if (Object.keys(updateObj).length === 0) {
      return json({ error: 'No fields to update' }, 400)
    }

    const { data, error } = await admin
      .from('books')
      .update(updateObj)
      .eq('id', bookId)
      .select()
      .single()

    if (error) {
      return json({ error: error.message }, 500)
    }

    return json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})

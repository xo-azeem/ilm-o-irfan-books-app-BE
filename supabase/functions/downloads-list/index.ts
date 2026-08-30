import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { paginate, parsePaginationQuery } from '../_shared/pagination.ts'

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
      return json({ error: { code: 'AUTH_REQUIRED', message: 'Authorization header is required' } }, 401)
    }

    const url = new URL(req.url)
    const { page, pageSize } = parsePaginationQuery(Object.fromEntries(url.searchParams.entries()))
    const offset = (page - 1) * pageSize

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return json({ error: { code: 'AUTH_REQUIRED', message: 'Unauthorized' } }, 401)
    }

    const { data, count, error } = await supabase
      .from('downloads')
      .select('id, book_id, status, file_size_bytes, downloaded_at, book:books(id, title, slug, cover_path, is_premium)', { count: 'exact' })
      .eq('user_id', user.id)
      .order('downloaded_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (error) {
      return json({ error: { code: 'DOWNLOADS_READ_FAILED', message: 'Unable to load downloads' } }, 500)
    }

    return json(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: { code: 'DOWNLOADS_UNEXPECTED_ERROR', message } }, 500)
  }
})

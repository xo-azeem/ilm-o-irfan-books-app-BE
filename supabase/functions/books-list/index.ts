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
    const url = new URL(req.url)
    const params = Object.fromEntries(url.searchParams.entries())
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    )

    const { page, pageSize } = parsePaginationQuery(params)
    const { offset, limit } = {
      offset: (page - 1) * pageSize,
      limit: pageSize,
    }

    const { data, count, error } = await supabase
      .from('book_list_items')
      .select('*', { count: 'exact' })
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return json({ error: error.message }, 500)
    }

    return json(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})

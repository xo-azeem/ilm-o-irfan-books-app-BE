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
    const query = (url.searchParams.get('q') ?? '').trim()
    const { page, pageSize } = parsePaginationQuery(Object.fromEntries(url.searchParams.entries()))
    const { offset, limit } = {
      offset: (page - 1) * pageSize,
      limit: pageSize,
    }

    if (!query) {
      return json({ data: [], page, pageSize, totalCount: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    )

    const { data, count, error } = await supabase
      .from('book_list_items')
      .select('*', { count: 'exact' })
      .or(`title.ilike.%${query}%,genre.ilike.%${query}%,author_name.ilike.%${query}%`)
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

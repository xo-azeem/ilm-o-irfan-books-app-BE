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

function sanitizeTextSearchQuery(raw: string): string {
  const normalized = raw
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized
    .split(' ')
    .filter(Boolean)
    .map((token) => token.replace(/'/g, "''"))
    .join(' & ')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const rawQuery = (url.searchParams.get('q') ?? '').trim()
    const { page, pageSize } = parsePaginationQuery(Object.fromEntries(url.searchParams.entries()))
    const offset = (page - 1) * pageSize

    if (!rawQuery) {
      return json({
        data: [],
        page,
        pageSize,
        totalCount: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      })
    }

    const tokenizedQuery = sanitizeTextSearchQuery(rawQuery)
    if (!tokenizedQuery) {
      return json({
        data: [],
        page,
        pageSize,
        totalCount: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    )

    const { data, count, error } = await supabase
      .from('book_list_items')
      .select('*', { count: 'exact' })
      .textSearch('search_vector', tokenizedQuery, { type: 'websearch' })
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1)

    if (error) {
      return json({ error: { code: 'SEARCH_FAILED', message: 'Search failed' } }, 500)
    }

    return json(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: { code: 'SEARCH_FAILED', message } }, 500)
  }
})

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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    )

    const [collectionsRes, booksRes, categoriesRes] = await Promise.all([
      supabase.from('collection_summaries').select('*').order('sort_order', { ascending: true }),
      supabase.from('book_list_items').select('*').order('published_at', { ascending: false }).limit(12),
      supabase.from('category_with_counts').select('*').order('sort_order', { ascending: true }).limit(10),
    ])

    if (collectionsRes.error) {
      return json({ error: collectionsRes.error.message }, 500)
    }

    if (booksRes.error) {
      return json({ error: booksRes.error.message }, 500)
    }

    if (categoriesRes.error) {
      return json({ error: categoriesRes.error.message }, 500)
    }

    return json({
      data: {
        collections: collectionsRes.data ?? [],
        books: booksRes.data ?? [],
        categories: categoriesRes.data ?? [],
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})

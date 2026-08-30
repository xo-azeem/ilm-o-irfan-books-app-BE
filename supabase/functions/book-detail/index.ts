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
    const url = new URL(req.url)
    const bookId = url.searchParams.get('id') ?? url.pathname.split('/').at(-1)

    if (!bookId) {
      return json({ error: 'book id is required' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    )

    const { data: book, error: bookError } = await supabase
      .from('books')
      .select(
        `
          id,
          slug,
          title,
          description,
          genre,
          rating,
          rating_count,
          price_cents,
          currency,
          format,
          cover_path,
          cover_color,
          cover_color_dark,
          pdf_path,
          read_time_minutes,
          tag,
          tags,
          is_premium,
          is_published,
          published_at,
          author:authors(id, name, slug, avatar_path)
        `,
      )
      .eq('id', bookId)
      .maybeSingle()

    if (bookError) {
      return json({ error: { code: 'BOOK_DETAIL_READ_FAILED', message: 'Unable to load book details' } }, 500)
    }

    if (!book) {
      return json({ error: { code: 'BOOK_NOT_FOUND', message: 'Book not found' } }, 404)
    }

    if (!book.is_published) {
      return json({ error: { code: 'BOOK_UNPUBLISHED', message: 'Book is not published' } }, 404)
    }

    return json({ data: book })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: { code: 'BOOK_DETAIL_UNEXPECTED_ERROR', message } }, 500)
  }
})

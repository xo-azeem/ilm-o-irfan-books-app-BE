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

    const payload = await req.json().catch(() => ({}))
    const bookId = payload.book_id ?? payload.bookId

    if (!bookId) {
      return json({ error: 'book_id is required' }, 400)
    }

    const { data: exists, error: checkError } = await supabase
      .from('wishlist')
      .select('book_id')
      .eq('user_id', user.id)
      .eq('book_id', bookId)
      .maybeSingle()

    if (checkError) {
      return json({ error: checkError.message }, 500)
    }

    if (exists) {
      const { error } = await supabase
        .from('wishlist')
        .delete()
        .eq('user_id', user.id)
        .eq('book_id', bookId)

      if (error) {
        return json({ error: error.message }, 500)
      }

      return json({ data: { removed: true, book_id: bookId } })
    }

    const { error } = await supabase.from('wishlist').insert({
      user_id: user.id,
      book_id: bookId,
    })

    if (error) {
      return json({ error: error.message }, 500)
    }

    return json({ data: { added: true, book_id: bookId } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})

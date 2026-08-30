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
    const { id, book_id, page_number, text_excerpt, note, color } = payload

    if (!book_id) {
      return json({ error: 'book_id is required' }, 400)
    }

    const row = {
      user_id: user.id,
      book_id,
      page_number: page_number ?? null,
      text_excerpt: text_excerpt ?? null,
      note: note ?? null,
      color: color ?? null,
    }

    const { data, error } = id
      ? await supabase
          .from('highlights')
          .update(row)
          .eq('id', id)
          .eq('user_id', user.id)
          .select()
          .single()
      : await supabase.from('highlights').insert(row).select().single()

    if (error) {
      return json({ error: error.message }, 500)
    }

    return json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})

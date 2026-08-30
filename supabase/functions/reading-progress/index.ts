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

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('reading_progress')
        .select('*')
        .eq('user_id', user.id)
        .order('last_read_at', { ascending: false })

      if (error) {
        return json({ error: error.message }, 500)
      }

      return json({ data: data ?? [] })
    }

    if (req.method === 'POST') {
      const payload = await req.json().catch(() => ({}))
      const { book_id, current_page, total_pages, progress, chapter_label } = payload

      if (!book_id) {
        return json({ error: 'book_id is required' }, 400)
      }

      const { data, error } = await supabase
        .from('reading_progress')
        .upsert(
          {
            user_id: user.id,
            book_id,
            current_page: current_page ?? 1,
            total_pages: total_pages ?? null,
            progress: progress ?? 0,
            chapter_label: chapter_label ?? null,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,book_id' },
        )
        .select()
        .single()

      if (error) {
        return json({ error: error.message }, 500)
      }

      return json({ data })
    }

    return json({ error: 'Method not allowed' }, 405)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})

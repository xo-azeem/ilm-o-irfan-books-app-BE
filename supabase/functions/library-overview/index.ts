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

    const [wishlistRes, progressRes, downloadsRes] = await Promise.all([
      supabase.from('wishlist').select('book_id').eq('user_id', user.id),
      supabase.from('reading_progress').select('*').eq('user_id', user.id),
      supabase.from('downloads').select('book_id').eq('user_id', user.id),
    ])

    if (wishlistRes.error) {
      return json({ error: wishlistRes.error.message }, 500)
    }

    if (progressRes.error) {
      return json({ error: progressRes.error.message }, 500)
    }

    if (downloadsRes.error) {
      return json({ error: downloadsRes.error.message }, 500)
    }

    return json({
      data: {
        wishlist: wishlistRes.data ?? [],
        readingProgress: progressRes.data ?? [],
        downloads: downloadsRes.data ?? [],
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})

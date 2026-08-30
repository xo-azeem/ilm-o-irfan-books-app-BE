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

function normalizeProgress(value: unknown): number {
  if (value == null || value === '') {
    return 0
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error('progress must be a number between 0 and 1 or 0 and 100')
  }

  const clamped = parsed > 1 ? parsed / 100 : parsed
  if (clamped < 0 || clamped > 1) {
    throw new Error('progress must be between 0 and 1')
  }

  return Number(clamped.toFixed(4))
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
      return json({ error: { code: 'AUTH_REQUIRED', message: 'Unauthorized' } }, 401)
    }

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('reading_progress')
        .select('*')
        .eq('user_id', user.id)
        .order('last_read_at', { ascending: false })

      if (error) {
        return json({ error: { code: 'READING_PROGRESS_READ_FAILED', message: 'Unable to read reading progress' } }, 500)
      }

      return json({ data: data ?? [] })
    }

    if (req.method === 'POST') {
      const payload = await req.json().catch(() => ({}))
      const { book_id, current_page, total_pages, progress, chapter_label } = payload

      if (!book_id) {
        return json({ error: { code: 'INVALID_REQUEST', message: 'book_id is required' } }, 400)
      }

      const safeCurrentPage = Number(current_page ?? 1)
      const safeTotalPages = total_pages == null ? null : Number(total_pages)
      if (!Number.isFinite(safeCurrentPage) || safeCurrentPage < 1) {
        return json({ error: { code: 'INVALID_REQUEST', message: 'current_page must be >= 1' } }, 400)
      }
      if (safeTotalPages != null && (!Number.isFinite(safeTotalPages) || safeTotalPages < 1)) {
        return json({ error: { code: 'INVALID_REQUEST', message: 'total_pages must be >= 1' } }, 400)
      }

      const safeProgress = normalizeProgress(progress ?? 0)

      const { data, error } = await supabase
        .from('reading_progress')
        .upsert(
          {
            user_id: user.id,
            book_id,
            current_page: safeCurrentPage,
            total_pages: safeTotalPages,
            progress: safeProgress,
            chapter_label: chapter_label ?? null,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,book_id' },
        )
        .select()
        .single()

      if (error) {
        return json({ error: { code: 'READING_PROGRESS_WRITE_FAILED', message: 'Unable to save reading progress' } }, 500)
      }

      return json({ data })
    }

    return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }, 405)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: { code: 'READING_PROGRESS_UNEXPECTED_ERROR', message } }, 500)
  }
})

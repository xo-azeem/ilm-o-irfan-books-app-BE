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
      return json({ error: { code: 'AUTH_REQUIRED', message: 'Authorization header is required' } }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return json({ error: { code: 'AUTH_REQUIRED', message: 'Unauthorized' } }, 401)
    }

    return json({
      error: {
        code: 'DEPRECATED_ENDPOINT',
        message: 'Use /functions/v1/get-signed-pdf instead of /functions/v1/signed-pdf',
      },
      deprecated: true,
    }, 410)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: { code: 'DEPRECATED_ENDPOINT_ERROR', message } }, 500)
  }
})

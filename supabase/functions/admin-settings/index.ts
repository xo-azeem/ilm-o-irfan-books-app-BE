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
        global: { headers: { Authorization: authHeader } },
      },
    )

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (user.app_metadata?.app_role !== 'admin' && profile?.role !== 'admin') {
      return json({ error: 'Forbidden' }, 403)
    }

    if (req.method === 'GET') {
      const { data, error } = await admin
        .from('app_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle()

      if (error) {
        return json({ error: { code: 'ADMIN_SETTINGS_READ_FAILED', message: 'Unable to load settings' } }, 500)
      }

      return json({ data: data ?? null })
    }

    if (req.method === 'PATCH') {
      const payload = await req.json().catch(() => ({}))
      const { data, error } = await admin
        .from('app_settings')
        .update({
          maintenance_mode: payload.maintenance_mode ?? payload.maintenanceMode ?? null,
          maintenance_message: payload.maintenance_message ?? payload.maintenanceMessage ?? null,
          signup_enabled: payload.signup_enabled ?? payload.signupEnabled ?? null,
          allow_pdf_without_entitlement:
            payload.allow_pdf_without_entitlement ?? payload.allowPdfWithoutEntitlement ?? null,
          featured_collection_id:
            payload.featured_collection_id ?? payload.featuredCollectionId ?? null,
          support_email: payload.support_email ?? payload.supportEmail ?? null,
          min_supported_version:
            payload.min_supported_version ?? payload.minSupportedVersion ?? null,
        })
        .eq('id', 1)
        .select()
        .single()

      if (error) {
        return json({ error: { code: 'ADMIN_SETTINGS_UPDATE_FAILED', message: 'Unable to update settings' } }, 500)
      }

      return json({ data })
    }

    return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }, 405)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: { code: 'ADMIN_SETTINGS_UNEXPECTED_ERROR', message } }, 500)
  }
})

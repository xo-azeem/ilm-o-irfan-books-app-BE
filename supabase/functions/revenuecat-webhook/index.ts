// Edge Function: revenuecat-webhook
// Verify shared secret → upsert entitlements with service role (never from the client)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type RcEvent = {
  type?: string
  app_user_id?: string
  entitlement_ids?: string[]
  product_id?: string
  store?: string
  expiration_at_ms?: number | null
  purchased_at_ms?: number | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const expectedAuth = Deno.env.get('REVENUECAT_WEBHOOK_AUTH')
    const entitlementId = Deno.env.get('REVENUECAT_ENTITLEMENT_ID') ?? 'premium'

    if (expectedAuth) {
      const auth = req.headers.get('Authorization')
      if (auth !== expectedAuth) {
        return json({ error: 'Invalid webhook authorization' }, 401)
      }
    }

    const payload = await req.json()
    const event = (payload.event ?? payload) as RcEvent

    const appUserId = event.app_user_id
    if (!appUserId) {
      return json({ error: 'Missing app_user_id' }, 400)
    }

    // RevenueCat app_user_id should be the Supabase auth user UUID
    const userId = appUserId

    const activeEventTypes = new Set([
      'INITIAL_PURCHASE',
      'RENEWAL',
      'UNCANCELLATION',
      'PRODUCT_CHANGE',
      'NON_RENEWING_PURCHASE',
      'TEMPORARY_ENTITLEMENT_GRANT',
    ])

    const expiredEventTypes = new Set([
      'EXPIRATION',
      'CANCELLATION',
      'BILLING_ISSUE',
      'SUBSCRIPTION_PAUSED',
    ])

    const eventType = (event.type ?? '').toUpperCase()
    const hasPremiumEntitlement =
      !event.entitlement_ids ||
      event.entitlement_ids.length === 0 ||
      event.entitlement_ids.includes(entitlementId)

    let status = 'expired'
    if (activeEventTypes.has(eventType) && hasPremiumEntitlement) {
      status = 'active'
    } else if (eventType === 'BILLING_ISSUE') {
      status = 'billing_issue'
    } else if (eventType === 'CANCELLATION') {
      // Still entitled until expires_at in most cases
      status = event.expiration_at_ms && event.expiration_at_ms > Date.now()
        ? 'cancelled'
        : 'expired'
    } else if (expiredEventTypes.has(eventType)) {
      status = 'expired'
    }

    const storeMap: Record<string, string> = {
      APP_STORE: 'app_store',
      MAC_APP_STORE: 'app_store',
      PLAY_STORE: 'play_store',
      STRIPE: 'stripe',
      PROMOTIONAL: 'promotional',
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    const { data: plan } = await admin
      .from('plans')
      .select('id')
      .eq('code', 'premium_monthly')
      .maybeSingle()

    const row = {
      user_id: userId,
      plan_id: plan?.id ?? null,
      status,
      starts_at: event.purchased_at_ms
        ? new Date(event.purchased_at_ms).toISOString()
        : new Date().toISOString(),
      expires_at: event.expiration_at_ms
        ? new Date(event.expiration_at_ms).toISOString()
        : null,
      revenuecat_app_user_id: appUserId,
      revenuecat_entitlement_id: entitlementId,
      store: storeMap[event.store ?? ''] ?? 'unknown',
      raw_event: payload,
      updated_at: new Date().toISOString(),
    }

    const { error } = await admin.from('entitlements').upsert(row, {
      onConflict: 'user_id',
    })

    if (error) {
      return json({ error: error.message }, 500)
    }

    return json({ ok: true, userId, status })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

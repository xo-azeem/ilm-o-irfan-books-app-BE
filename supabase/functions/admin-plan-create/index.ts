import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import {
  asBoolean,
  asOptionalInteger,
  asOptionalText,
  asStringArray,
} from '../_shared/payload.ts'
import { failFromRpcError } from '../_shared/rpc.ts'

// code, name and price_cents are required. code is the key a RevenueCat
// product maps onto, so changing it later re-points billing.
Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const code = asOptionalText('code')(payload.code ?? null)
    const name = asOptionalText('name')(payload.name ?? null)
    const price_cents = asOptionalInteger('price_cents', { min: 0 })(
      payload.price_cents ?? payload.priceCents ?? null,
    )
    const currency = asOptionalText('currency')(payload.currency ?? null)
    const interval = asOptionalText('interval')(payload.interval ?? null)
    const features = Object.hasOwn(payload, 'features')
      ? asStringArray('features')(payload.features)
      : null
    const revenuecat_product_id = asOptionalText('revenuecat_product_id')(
      payload.revenuecat_product_id ?? payload.revenuecatProductId ?? null,
    )
    const is_active = Object.hasOwn(payload, 'is_active') || Object.hasOwn(payload, 'isActive')
      ? asBoolean('is_active')(payload.is_active ?? payload.isActive)
      : null
    const sort_order = asOptionalInteger('sort_order')(
      payload.sort_order ?? payload.sortOrder ?? null,
    )

    // Called with the caller's JWT, not the service-role key: the RPC runs
    // is_admin() itself and the audit trigger records the real actor.
    const { data, error } = await ctx.supabase
      .rpc('admin_upsert_plan', {
        p_id: null,
        p_code: code,
        p_name: name,
        p_price_cents: price_cents,
        p_currency: currency,
        p_interval: interval,
        p_features: features,
        p_revenuecat_product_id: revenuecat_product_id,
        p_is_active: is_active,
        p_sort_order: sort_order,
      })

    if (error) {
      return failFromRpcError(
        'admin-plan-create',
        'ADMIN_PLAN_CREATE_FAILED',
        'Unable to create plan',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return handleError('admin-plan-create', error)
  }
})

import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  BadRequestError,
  fail,
  failFromDbError,
  failUnexpected,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { asOptionalText, asOptionalUuid, requireUuidField } from '../_shared/payload.ts'

const STATUSES = new Set(['active', 'expired', 'cancelled', 'grace', 'billing_issue', 'trial'])

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'PUT', 'PATCH'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const userId = requireUuidField(payload, ['userId', 'user_id', 'id'], 'userId')
    const status = asOptionalText('status')(payload.status)

    if (!status || !STATUSES.has(status)) {
      return fail(
        'INVALID_REQUEST',
        'status must be one of active, expired, cancelled, grace, billing_issue, trial',
        400,
      )
    }

    const planId = Object.hasOwn(payload, 'planId') || Object.hasOwn(payload, 'plan_id')
      ? asOptionalUuid('planId')(payload.planId ?? payload.plan_id)
      : null

    let expiresAt: string | null = null
    if (Object.hasOwn(payload, 'expiresAt') || Object.hasOwn(payload, 'expires_at')) {
      const raw = payload.expiresAt ?? payload.expires_at
      if (raw === null || raw === '') {
        expiresAt = null
      } else if (typeof raw === 'string') {
        const ms = Date.parse(raw)
        if (!Number.isFinite(ms)) {
          return fail('INVALID_REQUEST', 'expiresAt must be an ISO timestamp', 400)
        }
        expiresAt = new Date(ms).toISOString()
      } else {
        return fail('INVALID_REQUEST', 'expiresAt must be an ISO timestamp or null', 400)
      }
    }

    const { error } = await ctx.supabase.rpc('admin_set_entitlement', {
      p_user_id: userId,
      p_status: status,
      p_plan_id: planId,
      p_expires_at: expiresAt,
    })

    if (error) {
      return failFromDbError(
        'admin-set-entitlement',
        'ADMIN_SET_ENTITLEMENT_FAILED',
        'Unable to set entitlement',
        error,
      )
    }

    return ok({ userId, status, planId, expiresAt, store: 'promotional' })
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('admin-set-entitlement', error)
  }
})

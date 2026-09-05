import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  BadRequestError,
  failFromDbError,
  handleError,
  handleOptions,
  list,
} from '../_shared/http.ts'
import { isRangeNotSatisfiable, paginate, rangeFromRequest } from '../_shared/pagination.ts'
import { asUuid } from '../_shared/payload.ts'

// Support's "who published this / who comped that account" query.
//
// admin_audit_log is written by private.audit_write() on books, authors,
// categories, collections, plans and app_settings. Rows were previously only
// reachable by hand in SQL, which meant the log existed but nobody read it.
//
// Filters map onto the three indexes the table already has (created_at,
// entity_type + created_at, actor_id + created_at), so every supported query
// stays an index scan.
const ACTIONS = ['insert', 'update', 'delete']

const ENTITY_TYPES = ['books', 'authors', 'categories', 'collections', 'plans', 'app_settings']

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const url = new URL(req.url)
    const { page, pageSize, from, to } = rangeFromRequest(req, { defaultPageSize: 50 })

    let query = ctx.admin
      .from('admin_audit_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })

    const entityType = url.searchParams.get('entityType') ?? url.searchParams.get('entity_type')
    if (entityType) {
      if (!ENTITY_TYPES.includes(entityType)) {
        throw new BadRequestError(`entityType must be one of: ${ENTITY_TYPES.join(', ')}`)
      }
      query = query.eq('entity_type', entityType)
    }

    // entity_id is text in the log because not every audited table keys on a
    // uuid, but every one that does is written as its uuid, so validating here
    // turns a typo into a 400 instead of an empty page.
    const entityId = url.searchParams.get('entityId') ?? url.searchParams.get('entity_id')
    if (entityId) {
      query = query.eq('entity_id', asUuid('entityId')(entityId))
    }

    const actorId = url.searchParams.get('actorId') ?? url.searchParams.get('actor_id')
    if (actorId) {
      query = query.eq('actor_id', asUuid('actorId')(actorId))
    }

    const action = url.searchParams.get('action')
    if (action) {
      if (!ACTIONS.includes(action)) {
        throw new BadRequestError(`action must be one of: ${ACTIONS.join(', ')}`)
      }
      query = query.eq('action', action)
    }

    const since = url.searchParams.get('since')
    if (since) {
      if (Number.isNaN(Date.parse(since))) {
        throw new BadRequestError('since must be an ISO-8601 timestamp')
      }
      query = query.gte('created_at', new Date(since).toISOString())
    }

    const { data, count, error } = await query.range(from, to)

    if (error) {
      // The last call of a "load more" loop asks for a page that starts past
      // the end. That is an empty page, not a failure.
      if (isRangeNotSatisfiable(error)) {
        return list(paginate([], count ?? null, page, pageSize))
      }

      return failFromDbError(
        'admin-audit-log',
        'ADMIN_AUDIT_READ_FAILED',
        'Unable to load the audit log',
        error,
      )
    }

    return list(paginate(data ?? [], count ?? null, page, pageSize))
  } catch (error) {
    return handleError('admin-audit-log', error)
  }
})

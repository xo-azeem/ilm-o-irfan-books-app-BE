// Shared auth gates.
//
// The admin check used to be copy-pasted into seven functions, which meant a
// fix had to land seven times. It lives here now.

import {
  createClient,
  type SupabaseClient,
  type User,
} from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { fail } from './http.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Anonymous client for public catalog reads. RLS applies as `anon`.
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY)
}

// Caller-scoped client. RLS applies as that user, so user-owned tables are
// filtered by the database rather than by us remembering a .eq('user_id').
export function userClient(authHeader: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
}

export type AuditActor = { id: string; email?: string | null }

// Bypasses RLS. Only reachable after requireAdmin() has passed.
//
// `actor` is forwarded as x-audit-actor-* so private.audit_write() can attribute
// the change to the admin who made it. Without it every CMS write lands in
// admin_audit_log as "system", because the service-role key carries no
// auth.uid(). The trigger only reads those headers on a service_role request,
// and no client role holds a write grant on an audited table, so a client
// cannot forge an entry through them.
export function serviceClient(actor?: AuditActor): SupabaseClient {
  const headers: Record<string, string> = {}

  if (actor?.id) {
    headers['x-audit-actor-id'] = actor.id
  }

  if (actor?.email) {
    headers['x-audit-actor-email'] = actor.email
  }

  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(Object.keys(headers).length > 0 ? { global: { headers } } : {}),
  })
}

export type AuthedContext = {
  user: User
  supabase: SupabaseClient
  authHeader: string
}

export type AdminContext = AuthedContext & {
  admin: SupabaseClient
}

// Returns a Response on failure so handlers can `if (ctx instanceof Response) return ctx`.
export async function requireUser(req: Request): Promise<AuthedContext | Response> {
  const authHeader = req.headers.get('Authorization')

  if (!authHeader) {
    return fail('AUTH_REQUIRED', 'Authorization header is required', 401)
  }

  const supabase = userClient(authHeader)
  const { data, error } = await supabase.auth.getUser()

  if (error || !data?.user) {
    return fail('AUTH_REQUIRED', 'Unauthorized', 401)
  }

  return { user: data.user, supabase, authHeader }
}

// The JWT claim is checked first because it needs no round trip. profiles.role
// is only consulted when the claim says no, which covers an admin whose token
// predates their promotion. This mirrors public.is_admin() in SQL.
export async function requireAdmin(req: Request): Promise<AdminContext | Response> {
  const ctx = await requireUser(req)

  if (ctx instanceof Response) {
    return ctx
  }

  const admin = serviceClient({ id: ctx.user.id, email: ctx.user.email })

  if (ctx.user.app_metadata?.app_role === 'admin') {
    return { ...ctx, admin }
  }

  const { data: profile, error } = await admin
    .from('profiles')
    .select('role')
    .eq('id', ctx.user.id)
    .maybeSingle()

  if (error) {
    console.error('[requireAdmin] role lookup failed', error.code, error.message)
    return fail('FORBIDDEN', 'Unable to verify admin access', 403)
  }

  if (profile?.role !== 'admin') {
    return fail('FORBIDDEN', 'Admin access is required', 403)
  }

  return { ...ctx, admin }
}

// Restricts a function to the methods it actually implements.
export function requireMethod(req: Request, allowed: string[]): Response | null {
  if (allowed.includes(req.method)) {
    return null
  }

  return fail(
    'METHOD_NOT_ALLOWED',
    `Method ${req.method} is not allowed. Allowed: ${allowed.join(', ')}`,
    405,
  )
}

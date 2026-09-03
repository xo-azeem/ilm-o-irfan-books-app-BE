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
import { asOptionalText } from '../_shared/payload.ts'

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const name = asOptionalText('name')(payload.name)
    if (!name) {
      return fail('INVALID_REQUEST', 'name is required', 400)
    }

    const slugRaw = asOptionalText('slug')(payload.slug)
    const slug = slugify(slugRaw || name)
    if (!slug) {
      return fail('INVALID_REQUEST', 'slug could not be derived from name', 400)
    }

    const bio = asOptionalText('bio')(payload.bio)
    const avatar_path = asOptionalText('avatar_path')(
      payload.avatar_path ?? payload.avatarPath,
    )

    const { data, error } = await ctx.admin
      .from('authors')
      .insert({ name, slug, bio, avatar_path })
      .select()
      .maybeSingle()

    if (error) {
      if (error.code === '23505') {
        return fail('INVALID_REQUEST', 'An author with this slug already exists', 400)
      }
      return failFromDbError(
        'admin-author-create',
        'ADMIN_AUTHOR_CREATE_FAILED',
        'Unable to create author',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('admin-author-create', error)
  }
})

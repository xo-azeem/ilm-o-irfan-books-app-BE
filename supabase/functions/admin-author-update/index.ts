import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import {
  asOptionalText,
  pickProvided,
  requireUuidField,
  type FieldSpec,
} from '../_shared/payload.ts'

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const EDITABLE: FieldSpec[] = [
  { column: 'name', aliases: ['name'], coerce: asOptionalText('name') },
  { column: 'slug', aliases: ['slug'], coerce: asOptionalText('slug') },
  { column: 'bio', aliases: ['bio'], coerce: asOptionalText('bio') },
  {
    column: 'avatar_path',
    aliases: ['avatar_path', 'avatarPath'],
    coerce: asOptionalText('avatar_path'),
  },
]

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['PATCH', 'PUT', 'POST'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const id = requireUuidField(payload, ['id', 'authorId', 'author_id'], 'id')
    const update = pickProvided(payload, EDITABLE)

    if (Object.keys(update).length === 0) {
      return fail('INVALID_REQUEST', 'No editable author fields were provided', 400)
    }

    if ('name' in update && update.name === null) {
      return fail('INVALID_REQUEST', 'name cannot be null', 400)
    }

    if (typeof update.slug === 'string') {
      update.slug = slugify(update.slug)
      if (!update.slug) {
        return fail('INVALID_REQUEST', 'slug is invalid', 400)
      }
    }

    const { data, error } = await ctx.admin
      .from('authors')
      .update(update)
      .eq('id', id)
      .select()
      .maybeSingle()

    if (error) {
      if (error.code === '23505') {
        return fail('INVALID_REQUEST', 'An author with this slug already exists', 400)
      }
      return failFromDbError(
        'admin-author-update',
        'ADMIN_AUTHOR_UPDATE_FAILED',
        'Unable to update author',
        error,
      )
    }

    if (!data) {
      return fail('NOT_FOUND', 'Author not found', 404)
    }

    return ok(data)
  } catch (error) {
    return handleError('admin-author-update', error)
  }
})

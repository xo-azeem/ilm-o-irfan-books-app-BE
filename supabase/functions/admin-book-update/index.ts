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
import {
  asBoolean,
  asInteger,
  asOptionalText,
  asStringArray,
  pickProvided,
  requireUuidField,
  type FieldSpec,
} from '../_shared/payload.ts'

// Allow-list. Anything not named here (id, slug, rating, timestamps,
// published_at) is not writable through this endpoint. published_at in
// particular is stamped by a trigger on the first publish.
const EDITABLE_FIELDS: FieldSpec[] = [
  { column: 'title', aliases: ['title'], coerce: asOptionalText('title') },
  { column: 'description', aliases: ['description'], coerce: asOptionalText('description') },
  { column: 'genre', aliases: ['genre'], coerce: asOptionalText('genre') },
  {
    column: 'is_published',
    aliases: ['is_published', 'isPublished'],
    coerce: asBoolean('is_published'),
  },
  { column: 'is_premium', aliases: ['is_premium', 'isPremium'], coerce: asBoolean('is_premium') },
  {
    column: 'price_cents',
    aliases: ['price_cents', 'priceCents'],
    coerce: asInteger('price_cents', { min: 0 }),
  },
  { column: 'cover_path', aliases: ['cover_path', 'coverPath'], coerce: asOptionalText('cover_path') },
  { column: 'pdf_path', aliases: ['pdf_path', 'pdfPath'], coerce: asOptionalText('pdf_path') },
  { column: 'tag', aliases: ['tag'], coerce: asOptionalText('tag') },
  { column: 'tags', aliases: ['tags'], coerce: asStringArray('tags') },
  {
    column: 'read_time_minutes',
    aliases: ['read_time_minutes', 'readTimeMinutes'],
    coerce: asInteger('read_time_minutes', { min: 0 }),
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
    const bookId = requireUuidField(payload, ['id', 'book_id', 'bookId'], 'id')

    const update = pickProvided(payload, EDITABLE_FIELDS)

    if (Object.keys(update).length === 0) {
      return fail('INVALID_REQUEST', 'No editable book fields were provided', 400)
    }

    // title and description are NOT NULL in the schema, so an explicit null
    // would be a constraint violation rather than a clear message.
    for (const column of ['title', 'description'] as const) {
      if (column in update && update[column] === null) {
        return fail('INVALID_REQUEST', `${column} cannot be null`, 400)
      }
    }

    const { data, error } = await ctx.admin
      .from('books')
      .update(update)
      .eq('id', bookId)
      .select()
      .maybeSingle()

    if (error) {
      return failFromDbError(
        'admin-book-update',
        'ADMIN_BOOK_UPDATE_FAILED',
        'Unable to update book',
        error,
      )
    }

    if (!data) {
      return fail('NOT_FOUND', 'Book not found', 404)
    }

    return ok(data)
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('admin-book-update', error)
  }
})

import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import { LANGUAGES } from '../_shared/catalog-filters.ts'
import {
  asBoolean,
  asInteger,
  asOptionalEnum,
  asOptionalInteger,
  asOptionalText,
  asStringArray,
  pickProvided,
  requireUuidField,
  type FieldSpec,
} from '../_shared/payload.ts'
import { assertPublishable } from '../_shared/publishing.ts'

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
  // A real page count, when someone knows it. It overrides the estimate the
  // length filter otherwise derives from read_time_minutes.
  {
    column: 'page_count',
    aliases: ['page_count', 'pageCount'],
    coerce: asOptionalInteger('page_count', { min: 1 }),
  },
  {
    column: 'language',
    aliases: ['language'],
    coerce: asOptionalEnum('language', LANGUAGES),
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

    // Going live is checked against the file that will be stored after this
    // update, which is the incoming pdf_path when the same request sets one and
    // the stored value otherwise. Reading the row first also turns "publish a
    // book id that does not exist" into a 404 instead of a silent no-op.
    if (update.is_published === true) {
      const { data: current, error: readError } = await ctx.admin
        .from('books')
        .select('pdf_path')
        .eq('id', bookId)
        .maybeSingle()

      if (readError) {
        return failFromDbError(
          'admin-book-update',
          'ADMIN_BOOK_READ_FAILED',
          'Unable to load book',
          readError,
        )
      }

      if (!current) {
        return fail('NOT_FOUND', 'Book not found', 404)
      }

      const pdfPath = 'pdf_path' in update
        ? (update.pdf_path as string | null)
        : (current.pdf_path as string | null)

      await assertPublishable(ctx.admin, pdfPath)
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
    return handleError('admin-book-update', error)
  }
})

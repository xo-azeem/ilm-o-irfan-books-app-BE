import { requireMethod, requireUser } from '../_shared/auth.ts'
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
  asOptionalInteger,
  asOptionalText,
  asUuid,
  pickProvided,
  requireUuidField,
  type FieldSpec,
} from '../_shared/payload.ts'

const EDITABLE_FIELDS: FieldSpec[] = [
  {
    column: 'page_number',
    aliases: ['page_number', 'pageNumber'],
    coerce: asOptionalInteger('page_number', { min: 1 }),
  },
  {
    column: 'text_excerpt',
    aliases: ['text_excerpt', 'textExcerpt'],
    coerce: asOptionalText('text_excerpt'),
  },
  { column: 'note', aliases: ['note'], coerce: asOptionalText('note') },
  { column: 'color', aliases: ['color'], coerce: asOptionalText('color') },
]

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'PATCH'])
    if (notAllowed) return notAllowed

    const ctx = await requireUser(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)
    const highlightId = payload.id === undefined || payload.id === null
      ? null
      : asUuid('id')(payload.id)

    // Editing an existing highlight is a partial update, so an edit that only
    // changes the note must not blank out the excerpt and colour.
    if (highlightId) {
      const update = pickProvided(payload, EDITABLE_FIELDS)

      if (Object.keys(update).length === 0) {
        return fail('INVALID_REQUEST', 'No editable highlight fields were provided', 400)
      }

      const { data, error } = await ctx.supabase
        .from('highlights')
        .update(update)
        .eq('id', highlightId)
        .eq('user_id', ctx.user.id)
        .select()
        .maybeSingle()

      if (error) {
        return failFromDbError(
          'highlights-upsert',
          'HIGHLIGHT_UPDATE_FAILED',
          'Unable to update highlight',
          error,
        )
      }

      if (!data) {
        return fail('NOT_FOUND', 'Highlight not found', 404)
      }

      return ok(data)
    }

    const bookId = requireUuidField(payload, ['book_id', 'bookId'], 'book_id')
    const insert = { user_id: ctx.user.id, book_id: bookId, ...pickProvided(payload, EDITABLE_FIELDS) }

    const { data, error } = await ctx.supabase
      .from('highlights')
      .insert(insert)
      .select()
      .maybeSingle()

    if (error) {
      if (error.code === '23503') {
        return fail('NOT_FOUND', 'Book not found', 404)
      }

      return failFromDbError(
        'highlights-upsert',
        'HIGHLIGHT_INSERT_FAILED',
        'Unable to save highlight',
        error,
      )
    }

    return ok(data, 201)
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('highlights-upsert', error)
  }
})

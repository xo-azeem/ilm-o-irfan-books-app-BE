import { requireMethod, requireUser } from '../_shared/auth.ts'
import {
  fail,
  failFromDbError,
  handleError,
  handleOptions,
  ok,
  readJsonBody,
} from '../_shared/http.ts'
import {
  asOptionalInteger,
  asOptionalText,
  asUuid,
  type FieldSpec,
  pickProvided,
  requireUuidField,
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

// The RPC reads null as "leave alone" and '' as "clear", the same convention as
// reading-progress.chapter_label. asOptionalText already folds '' to null, so a
// caller who sent the key with an empty value gets it back as ''.
function mergeArg(update: Record<string, unknown>, column: string): string | null {
  if (!Object.hasOwn(update, column)) {
    return null
  }
  return (update[column] as string | null) ?? ''
}

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
        // 23505: moving this highlight onto a page that already has one.
        if (error.code === '23505') {
          return fail('CONFLICT', 'A bookmark already exists on that page', 409)
        }

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

      return ok({ ...data, created: false })
    }

    const bookId = requireUuidField(payload, ['book_id', 'bookId'], 'book_id')
    const fields = pickProvided(payload, EDITABLE_FIELDS)
    const pageNumber = (fields.page_number as number | null | undefined) ?? null

    // A page bookmark is keyed on (book, page): a double tap, or a retry of a
    // request whose response was lost, lands on the same row. One statement in
    // the database so two taps racing each other cannot both insert.
    if (pageNumber !== null) {
      const { data, error } = await ctx.supabase.rpc('upsert_highlight', {
        p_book_id: bookId,
        p_page_number: pageNumber,
        p_note: mergeArg(fields, 'note'),
        p_color: mergeArg(fields, 'color'),
        p_text_excerpt: mergeArg(fields, 'text_excerpt'),
      })

      if (error) {
        if (error.code === '23503') {
          return fail('NOT_FOUND', 'Book not found', 404)
        }

        return failFromDbError(
          'highlights-upsert',
          'HIGHLIGHT_UPSERT_FAILED',
          'Unable to save highlight',
          error,
        )
      }

      const row = data as { created?: boolean }
      return ok(row, row.created ? 201 : 200)
    }

    // No page: a text highlight that is not pinned to a page. Nothing to key
    // on, so this is a plain insert as before.
    const { data, error } = await ctx.supabase
      .from('highlights')
      .insert({ user_id: ctx.user.id, book_id: bookId, ...fields })
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

    return ok({ ...data, created: true }, 201)
  } catch (error) {
    return handleError('highlights-upsert', error)
  }
})

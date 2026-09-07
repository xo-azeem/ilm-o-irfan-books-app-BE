import { requireAdmin, requireMethod } from '../_shared/auth.ts'
import { handleError, handleOptions, ok, readJsonBody } from '../_shared/http.ts'
import { failFromRpcError } from '../_shared/rpc.ts'
import {
  asBoolean,
  asInteger,
  asOptionalText,
  asOptionalTimestamp,
  asOptionalUuid,
} from '../_shared/payload.ts'

// Add a book to the carousel, or edit the slide already there.
//
// Both are the same call on purpose. The CMS's "add to carousel" button on a
// book row and its edit form on the carousel screen write through here, and
// neither has to first find out whether the book is already on the rail.
//
// Omitting a field leaves it alone; sending '' clears it back to the book's own
// title / cover / colour. That distinction is why this reads the body with
// Object.hasOwn rather than `?? null`: a form that edits only the badge must
// not wipe the headline someone wrote yesterday.
function readOptional<T>(
  payload: Record<string, unknown>,
  aliases: string[],
  coerce: (value: unknown) => T,
): T | null {
  const key = aliases.find((alias) => Object.hasOwn(payload, alias))
  return key === undefined ? null : coerce(payload[key])
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['POST', 'PUT', 'PATCH'])
    if (notAllowed) return notAllowed

    const ctx = await requireAdmin(req)
    if (ctx instanceof Response) return ctx

    const payload = await readJsonBody(req)

    const args = {
      p_id: asOptionalUuid('id')(payload.id ?? payload.slideId ?? payload.slide_id),
      p_book_id: asOptionalUuid('bookId')(payload.bookId ?? payload.book_id),
      // '' is the clear-to-default sentinel, so it must survive coercion rather
      // than being folded into null (which the RPC reads as "unchanged").
      p_headline: readOptional(payload, ['headline'], (v) => asOptionalText('headline')(v) ?? ''),
      p_subtitle: readOptional(payload, ['subtitle'], (v) => asOptionalText('subtitle')(v) ?? ''),
      p_cta_label: readOptional(
        payload,
        ['ctaLabel', 'cta_label'],
        (v) => asOptionalText('ctaLabel')(v) ?? '',
      ),
      p_badge: readOptional(payload, ['badge'], (v) => asOptionalText('badge')(v) ?? ''),
      p_image_path: readOptional(
        payload,
        ['imagePath', 'image_path'],
        (v) => asOptionalText('imagePath')(v) ?? '',
      ),
      p_accent: readOptional(payload, ['accent'], (v) => asOptionalText('accent')(v) ?? ''),
      p_sort_order: readOptional(
        payload,
        ['sortOrder', 'sort_order'],
        asInteger('sortOrder', { min: 0 }),
      ),
      p_is_active: readOptional(payload, ['isActive', 'is_active'], asBoolean('isActive')),
      p_starts_at: readOptional(
        payload,
        ['startsAt', 'starts_at'],
        asOptionalTimestamp('startsAt'),
      ),
      p_ends_at: readOptional(payload, ['endsAt', 'ends_at'], asOptionalTimestamp('endsAt')),
      // Null timestamps mean "unchanged", so removing a run window needs its
      // own flag rather than a value.
      p_clear_schedule: readOptional(
        payload,
        ['clearSchedule', 'clear_schedule'],
        asBoolean('clearSchedule'),
      ) ?? false,
    }

    const { data, error } = await ctx.supabase.rpc('admin_carousel_upsert', args)

    if (error) {
      return failFromRpcError(
        'admin-carousel-upsert',
        'ADMIN_CAROUSEL_UPSERT_FAILED',
        'Unable to save the carousel slide',
        error,
      )
    }

    return ok(data)
  } catch (error) {
    return handleError('admin-carousel-upsert', error)
  }
})

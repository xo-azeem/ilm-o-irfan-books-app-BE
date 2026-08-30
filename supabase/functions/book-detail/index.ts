import { anonClient } from '../_shared/auth.ts'
import {
  BadRequestError,
  fail,
  failFromDbError,
  failUnexpected,
  handleOptions,
  ok,
} from '../_shared/http.ts'
import { asUuid } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const url = new URL(req.url)
    const rawId = url.searchParams.get('id') ?? url.pathname.split('/').at(-1) ?? ''

    if (!rawId || rawId === 'book-detail') {
      return fail('INVALID_REQUEST', 'id is required', 400)
    }

    const bookId = asUuid('id')(rawId)

    // pdf_path is deliberately not selected. The bytes are only reachable
    // through get-signed-pdf, which enforces the paywall.
    const { data: book, error } = await anonClient()
      .from('books')
      .select(
        `
          id,
          slug,
          title,
          description,
          genre,
          rating,
          rating_count,
          price_cents,
          currency,
          format,
          cover_path,
          cover_color,
          cover_color_dark,
          read_time_minutes,
          tag,
          tags,
          is_premium,
          is_published,
          published_at,
          author:authors(id, name, slug, avatar_path)
        `,
      )
      .eq('id', bookId)
      .eq('is_published', true)
      .maybeSingle()

    if (error) {
      return failFromDbError('book-detail', 'BOOK_READ_FAILED', 'Unable to load book', error)
    }

    if (!book) {
      return fail('NOT_FOUND', 'Book not found', 404)
    }

    return ok(book)
  } catch (error) {
    if (error instanceof BadRequestError) {
      return fail(error.code, error.message, 400)
    }
    return failUnexpected('book-detail', error)
  }
})

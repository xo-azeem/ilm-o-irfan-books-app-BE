import { anonClient, requireMethod } from '../_shared/auth.ts'
import { withCoverUrl } from '../_shared/covers.ts'
import { fail, failFromDbError, handleError, handleOptions, ok, publicCache, CATALOGUE_CACHE_SECONDS } from '../_shared/http.ts'
import { asUuid } from '../_shared/payload.ts'

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

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
          page_count,
          language,
          length_bucket,
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

    return ok(withCoverUrl(book as Record<string, unknown>), 200, publicCache(CATALOGUE_CACHE_SECONDS))
  } catch (error) {
    return handleError('book-detail', error)
  }
})

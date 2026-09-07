import { anonClient, requireMethod } from '../_shared/auth.ts'
import { withCoverUrl, type WithCoverUrl } from '../_shared/covers.ts'
import { fail, failFromDbError, handleError, handleOptions, list } from '../_shared/http.ts'
import { isRangeNotSatisfiable, paginate, rangeFromRequest } from '../_shared/pagination.ts'
import { asUuid } from '../_shared/payload.ts'

type BookCard = Record<string, unknown> & { id: string }

Deno.serve(async (req) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  try {
    const notAllowed = requireMethod(req, ['GET'])
    if (notAllowed) return notAllowed

    const url = new URL(req.url)
    const idParam = (url.searchParams.get('id') ?? '').trim()
    const slugParam = (url.searchParams.get('slug') ?? '').trim()

    if (!idParam && !slugParam) {
      return fail('INVALID_REQUEST', 'id or slug is required', 400)
    }

    if (idParam && slugParam) {
      return fail('INVALID_REQUEST', 'Pass id or slug, not both', 400)
    }

    const { page, pageSize, from, to } = rangeFromRequest(req)
    const supabase = anonClient()

    let collectionQuery = supabase
      .from('collections')
      .select('id, slug, title, subtitle, kind, sort_order')
      .eq('is_published', true)

    if (idParam) {
      collectionQuery = collectionQuery.eq('id', asUuid('id')(idParam))
    } else {
      collectionQuery = collectionQuery.eq('slug', slugParam)
    }

    const { data: collection, error: collectionError } = await collectionQuery.maybeSingle()

    if (collectionError) {
      return failFromDbError(
        'collection-books',
        'COLLECTION_READ_FAILED',
        'Unable to load collection',
        collectionError,
      )
    }

    if (!collection) {
      return fail('NOT_FOUND', 'Collection not found', 404)
    }

    const collectionMeta = {
      id: collection.id,
      slug: collection.slug,
      title: collection.title,
      subtitle: collection.subtitle,
      kind: collection.kind,
      sort_order: collection.sort_order,
    }

    // Count and page only membership whose book is still published.
    // Junction rows for drafts / deleted titles must not inflate totalCount or
    // consume offset slots — otherwise hasNextPage lies and pages skip titles.
    const { data: membership, count, error: membershipError } = await supabase
      .from('collection_books')
      .select('book_id, sort_order, book:books!inner(id)', { count: 'exact' })
      .eq('collection_id', collection.id)
      .eq('book.is_published', true)
      .order('sort_order', { ascending: true })
      .order('book_id', { ascending: true })
      .range(from, to)

    if (membershipError) {
      if (isRangeNotSatisfiable(membershipError)) {
        return list({
          ...paginate([], count ?? null, page, pageSize),
          collection: collectionMeta,
        })
      }

      return failFromDbError(
        'collection-books',
        'COLLECTION_READ_FAILED',
        'Unable to load collection books',
        membershipError,
      )
    }

    const ids = (membership ?? []).map((row) => row.book_id as string).filter(Boolean)

    if (ids.length === 0) {
      return list({
        ...paginate([], count ?? 0, page, pageSize),
        collection: collectionMeta,
      })
    }

    const { data: books, error: booksError } = await supabase
      .from('book_list_items')
      .select('*')
      .in('id', ids)

    if (booksError) {
      return failFromDbError(
        'collection-books',
        'COLLECTION_READ_FAILED',
        'Unable to load collection books',
        booksError,
      )
    }

    const byId = new Map(
      ((books ?? []) as BookCard[]).map((book) => [book.id, withCoverUrl(book)]),
    )
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((book): book is WithCoverUrl<BookCard> => book !== undefined)

    // After the published filter, every id should resolve in book_list_items.
    // If a row vanished mid-request, prefer the truthful page length over a
    // stale junction count so hasNextPage cannot stay stuck true.
    const totalCount = count ?? ordered.length

    return list({
      ...paginate(ordered, totalCount, page, pageSize),
      collection: collectionMeta,
    })
  } catch (error) {
    return handleError('collection-books', error)
  }
})

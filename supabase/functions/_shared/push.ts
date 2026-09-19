// What a push says, and where a tap takes the reader.
//
// The outbox row carries facts (a book id and title, a collection, a count);
// this turns them into the title and body the tray shows and the `data` map
// the app routes on. One place for every kind, so the copy and the routing
// contract with the app are reviewable side by side.
//
// Routing contract (every value a string — FCM data is string-only):
//
//   route        'book' | 'collection' | 'home' | 'library' | 'membership' | 'privacy'
//                | 'adminDeletions' (admins only — the tool's People → Deletions)
//   bookId       when route = 'book'
//   collectionId when route = 'collection'
//   kind         the outbox kind, for the app's cache invalidation
//   count        how many things this notification stands for
//
// Channels are the Android notification channels the app creates on launch
// (`MainApplication.kt`); iOS gets the same value as `thread-id`.

export type PushKind =
  | 'books_published'
  | 'collection_published'
  | 'collection_books_added'
  | 'book_deleted'
  | 'book_file_replaced'
  | 'book_updated'
  | 'membership_activated'
  | 'membership_expired'
  | 'account_deletion_approved'
  | 'account_deletion_rejected'
  // To every admin: a reader has filed a deletion request.
  | 'account_deletion_requested'

export type PushChannel = 'catalog' | 'library' | 'account'

export type PushRoute =
  | { route: 'book'; bookId: string }
  | { route: 'collection'; collectionId: string }
  | { route: 'home' }
  | { route: 'library' }
  | { route: 'membership' }
  | { route: 'privacy' }
  | { route: 'adminDeletions' }

export type PushContent = {
  title: string
  body: string
  channel: PushChannel
  route: PushRoute
  // Android: normal-priority announcements can wait for the next batch
  // window; a book being pulled from under a reader should not.
  priority: 'normal' | 'high'
}

export type PushFacts = {
  bookId?: string
  bookTitle?: string
  author?: string
  collectionId?: string
  collectionTitle?: string
  collectionSlug?: string
  collectionSubtitle?: string | null
  publishedCount?: number
  count?: number
  // Account deletion decisions.
  requestId?: string
  scheduledFor?: string | null
  note?: string | null
  // Account deletion requests, as told to admins.
  email?: string | null
  fullName?: string | null
}

// The topic every device subscribes to for catalogue announcements. The app
// subscribes on its side (`subscribeToTopic`); the outbox row names it.
export const CATALOG_TOPIC = 'catalog'

// Kinds a reader can switch off with the "Changes to my books" preference.
export const LIBRARY_KINDS: ReadonlySet<PushKind> = new Set([
  'book_deleted',
  'book_file_replaced',
  'book_updated',
])

// Kinds the "Membership" preference governs.
export const MEMBERSHIP_KINDS: ReadonlySet<PushKind> = new Set([
  'membership_activated',
  'membership_expired',
])

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function quote(title: string | undefined): string {
  const t = (title ?? '').trim()
  return t ? `“${t}”` : 'A book'
}

function collectionRoute(facts: PushFacts): PushRoute {
  return facts.collectionId
    ? { route: 'collection', collectionId: facts.collectionId }
    : { route: 'home' }
}

/**
 * Composes the tray text for one outbox row.
 *
 * `count` is how many things the row now stands for after merging — twelve
 * books in one publish, three edits folded into one window.
 */
export function composePush(kind: PushKind, facts: PushFacts, count: number): PushContent {
  const n = Math.max(1, count)

  switch (kind) {
    case 'books_published': {
      if (n === 1 && facts.bookId) {
        return {
          title: `New book: ${facts.bookTitle ?? 'a new title'}`,
          body: facts.author ? `${facts.author} · now in the library` : 'Now in the library',
          channel: 'catalog',
          route: { route: 'book', bookId: facts.bookId },
          priority: 'normal',
        }
      }
      return {
        title: `${n} new ${plural(n, 'book', 'books')} added`,
        body: facts.collectionTitle
          ? `Now in ${facts.collectionTitle}`
          : 'Fresh titles are waiting on Home',
        channel: 'catalog',
        route: collectionRoute(facts),
        priority: 'normal',
      }
    }

    case 'collection_published': {
      const books = facts.publishedCount ?? n
      const subtitle = (facts.collectionSubtitle ?? '').trim()
      return {
        title: `New collection: ${facts.collectionTitle ?? 'on Home'}`,
        body: `${books} ${plural(books, 'book', 'books')}${
          subtitle ? ` · ${subtitle}` : ' · tap to explore'
        }`,
        channel: 'catalog',
        route: collectionRoute(facts),
        priority: 'normal',
      }
    }

    case 'collection_books_added':
      return {
        title: `${n} new ${plural(n, 'book', 'books')} in ${
          facts.collectionTitle ?? 'a collection'
        }`,
        body: 'Tap to see what was added',
        channel: 'catalog',
        route: collectionRoute(facts),
        priority: 'normal',
      }

    case 'book_deleted':
      return n === 1
        ? {
          title: `${quote(facts.bookTitle)} was removed`,
          body: 'It is no longer available in Ilm o Irfan.',
          channel: 'library',
          route: { route: 'library' },
          priority: 'high',
        }
        : {
          title: `${n} books were removed`,
          body: 'They are no longer available in your library.',
          channel: 'library',
          route: { route: 'library' },
          priority: 'high',
        }

    case 'book_file_replaced':
      return n === 1 && facts.bookId
        ? {
          title: `${quote(facts.bookTitle)} has a new edition`,
          body: 'Download it again to keep reading offline.',
          channel: 'library',
          route: { route: 'book', bookId: facts.bookId },
          priority: 'high',
        }
        : {
          title: `${n} of your books have new editions`,
          body: 'Download them again to keep reading offline.',
          channel: 'library',
          route: { route: 'library' },
          priority: 'high',
        }

    case 'book_updated':
      return n === 1 && facts.bookId
        ? {
          title: `${quote(facts.bookTitle)} was updated`,
          body: 'The details for this book have changed.',
          channel: 'library',
          route: { route: 'book', bookId: facts.bookId },
          priority: 'normal',
        }
        : {
          title: `${n} of your books were updated`,
          body: 'Their details have changed.',
          channel: 'library',
          route: { route: 'library' },
          priority: 'normal',
        }

    case 'membership_activated':
      return {
        title: 'Welcome to Premium',
        body: 'The full library is open. Happy reading.',
        channel: 'account',
        route: { route: 'home' },
        priority: 'high',
      }

    case 'membership_expired':
      return {
        title: 'Your membership has ended',
        body: 'Renew to keep reading the full library.',
        channel: 'account',
        route: { route: 'membership' },
        priority: 'high',
      }

    case 'account_deletion_approved': {
      const when = facts.scheduledFor ? new Date(facts.scheduledFor) : null
      const dateText = when && !Number.isNaN(when.getTime())
        ? when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : null
      return {
        title: 'Account deletion approved',
        body: dateText
          ? `Your account will be deleted on ${dateText}. Open Privacy & security before then to cancel.`
          : 'Your account will be deleted shortly. Open Privacy & security to cancel.',
        channel: 'account',
        route: { route: 'privacy' },
        priority: 'high',
      }
    }

    case 'account_deletion_rejected':
      return {
        title: 'Account deletion declined',
        body: facts.note
          ? `Reason: ${facts.note}`
          : 'Your account stays as it is. See Privacy & security for details.',
        channel: 'account',
        route: { route: 'privacy' },
        priority: 'high',
      }

    case 'account_deletion_requested': {
      // Several requests in the merge window fold into one line; a single one
      // names the reader so the admin knows who before opening the tool.
      const who = (facts.fullName ?? '').trim() || (facts.email ?? '').trim()
      return {
        title: count > 1
          ? `${count} readers asked to delete their accounts`
          : 'A reader asked to delete their account',
        body: count > 1
          ? 'They are waiting on a decision. Open People → Deletions to review them.'
          : who
          ? `${who} is waiting on a decision. Open People → Deletions to review it.`
          : 'They are waiting on a decision. Open People → Deletions to review it.',
        channel: 'account',
        route: { route: 'adminDeletions' },
        priority: 'high',
      }
    }
  }
}

/** The string-only `data` map the app reads on tap and in the foreground. */
export function pushData(
  kind: PushKind,
  content: PushContent,
  count: number,
): Record<string, string> {
  const data: Record<string, string> = {
    kind,
    route: content.route.route,
    count: String(Math.max(1, count)),
  }
  if (content.route.route === 'book') data.bookId = content.route.bookId
  if (content.route.route === 'collection') data.collectionId = content.route.collectionId
  return data
}

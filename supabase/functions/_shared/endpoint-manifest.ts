export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type EndpointAccess = 'public' | 'authenticated' | 'admin'

export type EndpointDefinition = {
  name: string
  route: string
  method: HttpMethod
  access: EndpointAccess
  description: string
  notes?: string
}

export const endpointManifest: EndpointDefinition[] = [
  {
    name: 'home-feed',
    route: '/home',
    method: 'GET',
    access: 'public',
    description: 'Returns featured collections, hero content, and top books.',
  },
  {
    name: 'books-list',
    route: '/books',
    method: 'GET',
    access: 'public',
    description: 'Returns a paginated catalog of published books.',
    notes: 'Use page and pageSize for server-side pagination.',
  },
  {
    name: 'book-detail',
    route: '/books/:id',
    method: 'GET',
    access: 'public',
    description: 'Returns one book, author info, and related metadata.',
  },
  {
    name: 'search-books',
    route: '/books/search',
    method: 'GET',
    access: 'public',
    description: 'Searches books by text, genre, tag, or author.',
  },
  {
    name: 'categories-list',
    route: '/categories',
    method: 'GET',
    access: 'public',
    description: 'Returns available categories and count metadata.',
  },
  {
    name: 'collections-list',
    route: '/collections',
    method: 'GET',
    access: 'public',
    description: 'Returns hero and shelf collections.',
  },
  {
    name: 'plans-list',
    route: '/plans',
    method: 'GET',
    access: 'public',
    description: 'Returns active premium plans for the subscription screen.',
  },
  {
    name: 'profile-read',
    route: '/profile',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns the current user profile.',
  },
  {
    name: 'profile-update',
    route: '/profile',
    method: 'PUT',
    access: 'authenticated',
    description: 'Updates editable profile fields.',
  },
  {
    name: 'reading-progress',
    route: '/reading-progress',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns read progress for the current user.',
  },
  {
    name: 'reading-progress-upsert',
    route: '/reading-progress',
    method: 'POST',
    access: 'authenticated',
    description: 'Stores or updates reading progress for a book.',
  },
  {
    name: 'wishlist-list',
    route: '/wishlist',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns all saved books for the current user.',
  },
  {
    name: 'wishlist-toggle',
    route: '/wishlist/:bookId',
    method: 'POST',
    access: 'authenticated',
    description: 'Adds or removes a book from the wishlist.',
  },
  {
    name: 'downloads-list',
    route: '/downloads',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns downloaded books metadata for the current user.',
  },
  {
    name: 'downloads-create',
    route: '/downloads',
    method: 'POST',
    access: 'authenticated',
    description: 'Stores a download record after a file was acquired.',
  },
  {
    name: 'highlights-list',
    route: '/highlights',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns highlights and notes for the user.',
  },
  {
    name: 'highlights-upsert',
    route: '/highlights',
    method: 'POST',
    access: 'authenticated',
    description: 'Adds or updates a highlight record.',
  },
  {
    name: 'library-overview',
    route: '/library',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns saved, read, and downloaded book groups.',
  },
  {
    name: 'entitlements-status',
    route: '/entitlements',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns the current subscription and entitlement state.',
  },
  {
    name: 'signed-pdf',
    route: '/pdf/signed',
    method: 'POST',
    access: 'authenticated',
    description: 'Generates a signed PDF URL after premium and auth checks.',
  },
  {
    name: 'admin-books',
    route: '/admin/books',
    method: 'GET',
    access: 'admin',
    description: 'Returns admin catalog rows with counts and metadata.',
  },
  {
    name: 'admin-book-update',
    route: '/admin/books/:id',
    method: 'PATCH',
    access: 'admin',
    description: 'Updates book metadata, premium state, and publish status.',
  },
  {
    name: 'admin-categories',
    route: '/admin/categories',
    method: 'GET',
    access: 'admin',
    description: 'Lists categories with counts for CMS management.',
  },
  {
    name: 'admin-collections',
    route: '/admin/collections',
    method: 'GET',
    access: 'admin',
    description: 'Lists collections and membership details.',
  },
  {
    name: 'admin-users',
    route: '/admin/users',
    method: 'GET',
    access: 'admin',
    description: 'Returns the user directory and engagement stats.',
  },
  {
    name: 'admin-analytics',
    route: '/admin/analytics',
    method: 'GET',
    access: 'admin',
    description: 'Returns signups, reads, downloads, and top content analytics.',
  },
  {
    name: 'admin-settings',
    route: '/admin/settings',
    method: 'GET',
    access: 'admin',
    description: 'Returns app configuration and product flags.',
  },
  {
    name: 'admin-settings-update',
    route: '/admin/settings',
    method: 'PATCH',
    access: 'admin',
    description: 'Updates maintenance, signup, and feature flags.',
  },
]

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
    route: '/functions/v1/home-feed',
    method: 'GET',
    access: 'public',
    description: 'Returns featured collections, hero content, and top books.',
  },
  {
    name: 'books-list',
    route: '/functions/v1/books-list',
    method: 'GET',
    access: 'public',
    description: 'Returns a paginated catalog of published books.',
    notes: 'Use page and pageSize for server-side pagination.',
  },
  {
    name: 'book-detail',
    route: '/functions/v1/book-detail?id=<bookId>',
    method: 'GET',
    access: 'public',
    description: 'Returns one book, author info, and related metadata.',
  },
  {
    name: 'books-search',
    route: '/functions/v1/books-search?q=<query>',
    method: 'GET',
    access: 'public',
    description: 'Searches books by text using the tsvector search index.',
  },
  {
    name: 'categories-list',
    route: '/functions/v1/categories-list',
    method: 'GET',
    access: 'public',
    description: 'Returns available categories and count metadata.',
  },
  {
    name: 'collections-list',
    route: '/functions/v1/collections-list',
    method: 'GET',
    access: 'public',
    description: 'Returns hero and shelf collections.',
  },
  {
    name: 'plans-list',
    route: '/functions/v1/plans-list',
    method: 'GET',
    access: 'public',
    description: 'Returns active premium plans for the subscription screen.',
  },
  {
    name: 'profile-read',
    route: '/functions/v1/profile-read',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns the current user profile.',
  },
  {
    name: 'profile-update',
    route: '/functions/v1/profile-update',
    method: 'PUT',
    access: 'authenticated',
    description: 'Updates editable profile fields.',
  },
  {
    name: 'reading-progress',
    route: '/functions/v1/reading-progress',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns read progress for the current user.',
  },
  {
    name: 'wishlist-list',
    route: '/functions/v1/wishlist-list',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns all saved books for the current user.',
  },
  {
    name: 'wishlist-toggle',
    route: '/functions/v1/wishlist-toggle',
    method: 'POST',
    access: 'authenticated',
    description: 'Adds or removes a book from the wishlist.',
  },
  {
    name: 'downloads-list',
    route: '/functions/v1/downloads-list',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns downloaded books metadata for the current user.',
  },
  {
    name: 'downloads-create',
    route: '/functions/v1/downloads-create',
    method: 'POST',
    access: 'authenticated',
    description: 'Stores a download record after a file was acquired.',
  },
  {
    name: 'highlights-list',
    route: '/functions/v1/highlights-list',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns highlights and notes for the user.',
  },
  {
    name: 'highlights-upsert',
    route: '/functions/v1/highlights-upsert',
    method: 'POST',
    access: 'authenticated',
    description: 'Adds or updates a highlight record.',
  },
  {
    name: 'library-overview',
    route: '/functions/v1/library-overview',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns saved, read, and downloaded book groups.',
  },
  {
    name: 'entitlements-status',
    route: '/functions/v1/entitlements-status',
    method: 'GET',
    access: 'authenticated',
    description: 'Returns the current subscription and entitlement state.',
  },
  {
    name: 'get-signed-pdf',
    route: '/functions/v1/get-signed-pdf',
    method: 'POST',
    access: 'authenticated',
    description: 'Generates a signed PDF URL after premium and auth checks.',
  },
  {
    name: 'admin-books',
    route: '/functions/v1/admin-books',
    method: 'GET',
    access: 'admin',
    description: 'Returns admin catalog rows with counts and metadata.',
  },
  {
    name: 'admin-book-update',
    route: '/functions/v1/admin-book-update',
    method: 'PATCH',
    access: 'admin',
    description: 'Updates book metadata, premium state, and publish status.',
  },
  {
    name: 'admin-categories',
    route: '/functions/v1/admin-categories',
    method: 'GET',
    access: 'admin',
    description: 'Lists categories with counts for CMS management.',
  },
  {
    name: 'admin-collections',
    route: '/functions/v1/admin-collections',
    method: 'GET',
    access: 'admin',
    description: 'Lists collections and membership details.',
  },
  {
    name: 'admin-users',
    route: '/functions/v1/admin-users',
    method: 'GET',
    access: 'admin',
    description: 'Returns the user directory and engagement stats.',
  },
  {
    name: 'admin-analytics',
    route: '/functions/v1/admin-analytics',
    method: 'GET',
    access: 'admin',
    description: 'Returns signups, reads, downloads, and top content analytics.',
  },
  {
    name: 'admin-settings',
    route: '/functions/v1/admin-settings',
    method: 'GET',
    access: 'admin',
    description: 'Returns app configuration and product flags.',
  },
  {
    name: 'revenuecat-webhook',
    route: '/functions/v1/revenuecat-webhook',
    method: 'POST',
    access: 'public',
    description: 'Receives authenticated RevenueCat subscription events.',
  },
]

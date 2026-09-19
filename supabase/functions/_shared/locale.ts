// The interface language a request was made in.
//
// The app sends `Accept-Language` with the language it is showing (`en-GB`,
// `ur-PK`); the reader's saved choice lives on `profiles.locale`. Anything the
// backend composes for a screen should follow the header first — that is what
// the reader is looking at — and the profile second.

export type AppLocale = 'en' | 'ur'

export const APP_LOCALES: readonly AppLocale[] = ['en', 'ur'] as const

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value)
}

/** The first supported language in `Accept-Language`, or null when none is. */
export function requestLocale(req: Request): AppLocale | null {
  const header = req.headers.get('accept-language')
  if (!header) return null
  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? ''
    const base = tag.split('-')[0]
    if (isAppLocale(base)) return base
  }
  return null
}

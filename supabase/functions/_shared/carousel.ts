// The home carousel is read through one RPC, `home_carousel`, which returns
// the admin's live slides when there are any and this week's random fallback
// draw when there are none. Both readers (carousel-list, home-feed) call it
// with the same limits and label the result the same way, so the app cannot
// see the carousel one way on launch and another way on refresh.

// A rail nobody swipes to the end of is a rail nobody sees the end of, and an
// admin who adds a 40th slide should not be able to make Home load 40 covers.
export const CAROUSEL_MAX_SLIDES = 20

// How many books the weekly fallback shows when the admin has set nothing.
export const CAROUSEL_FALLBACK_SLIDES = 5

export type CarouselSource = 'admin' | 'fallback'

// Fallback rows have no slide behind them, so `slide_id` is null — the RPC
// promises that. Empty is reported as `admin`: it means the admin has nothing
// *and* the catalogue has nothing to fall back to, and there is no fallback to
// point at.
export function carouselSource(slides: ReadonlyArray<Record<string, unknown>>): CarouselSource {
  return slides.some((slide) => slide.slide_id == null) ? 'fallback' : 'admin'
}

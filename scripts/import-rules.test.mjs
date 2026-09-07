import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  assertCollectionKind,
  assertUniqueSlugs,
  checkPdfBudget,
  COLLECTION_KINDS,
  DEFAULT_MAX_PDF_BYTES,
  resolveBookSlug,
  slugify,
} from './lib/import-rules.mjs'

describe('slugify', () => {
  it('normalizes titles into stable kebab slugs', () => {
    assert.equal(slugify('Ihya Ulum al-Din'), 'ihya-ulum-al-din')
    assert.equal(slugify('  Talash-e-Hind  '), 'talash-e-hind')
  })
})

describe('resolveBookSlug', () => {
  it('prefers meta.slug so renames stay stable', () => {
    assert.equal(resolveBookSlug('New Display Title', { slug: 'ihya-ulum-al-din' }), 'ihya-ulum-al-din')
  })

  it('falls back to the folder name', () => {
    assert.equal(resolveBookSlug('The Masnavi', {}), 'the-masnavi')
  })

  it('rejects empty derivations', () => {
    assert.throws(() => resolveBookSlug('!!!', {}), /stable slug/)
  })
})

describe('assertUniqueSlugs', () => {
  it('allows a unique batch', () => {
    assertUniqueSlugs([
      { slug: 'a', folder: 'A' },
      { slug: 'b', folder: 'B' },
    ])
  })

  it('fails on collisions', () => {
    assert.throws(
      () =>
        assertUniqueSlugs([
          { slug: 'same', folder: 'One' },
          { slug: 'same', folder: 'Two' },
        ]),
      /Duplicate book slug/,
    )
  })
})

describe('checkPdfBudget', () => {
  it('accepts typical sizes', () => {
    assert.deepEqual(checkPdfBudget(2 * 1024 * 1024), { ok: true })
  })

  it('warns above soft threshold', () => {
    const r = checkPdfBudget(30 * 1024 * 1024)
    assert.equal(r.ok, false)
    assert.equal(r.level, 'warn')
  })

  it('errors above hard ceiling', () => {
    const r = checkPdfBudget(DEFAULT_MAX_PDF_BYTES + 1)
    assert.equal(r.ok, false)
    assert.equal(r.level, 'error')
  })
})

describe('collection kinds', () => {
  it('documents the three Home kinds', () => {
    assert.deepEqual([...COLLECTION_KINDS], ['hero', 'shelf', 'carousel'])
    assert.doesNotThrow(() => assertCollectionKind('hero'))
    assert.throws(() => assertCollectionKind('carousel-x'), /kind must be/)
  })
})

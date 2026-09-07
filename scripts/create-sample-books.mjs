/**
 * Create fixtures/sample-books (tiny PDF + 1x1 cover) for staging ingest smoke.
 * Run: node scripts/create-sample-books.mjs
 * Then: BOOKS_DIR=fixtures/sample-books npm run books:import
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const out = join(ROOT, 'fixtures', 'sample-books')

const pdf = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Count 1 /Kids [3 0 R] >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 24 Tf 72 720 Td (Sample Book) Tj ET
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000361 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
441
%%EOF
`

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const books = [
  { dir: 'Sample Free Book', author: 'Staging Author', premium: false },
  { dir: 'Sample Premium Book', author: 'Staging Author', premium: true },
]

for (const book of books) {
  const folder = join(out, book.dir)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, `${book.dir} - ${book.author}.pdf`), pdf)
  writeFileSync(join(folder, 'cover.png'), png)
  writeFileSync(
    join(folder, 'meta.json'),
    `${JSON.stringify(
      {
        isPremium: book.premium,
        categorySlug: 'spirituality',
        genre: 'Spirituality',
      },
      null,
      2,
    )}\n`,
  )
}

console.log(`Sample books ready at ${out}`)
console.log('Import with: BOOKS_DIR=fixtures/sample-books npm run books:import')

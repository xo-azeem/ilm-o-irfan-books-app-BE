// Publish gate.
//
// books_published_needs_pdf only checks that pdf_path is a non-empty string, so
// a typo in the path published a title whose reader hits PDF_NOT_IN_STORAGE
// with no way back except unpublishing it again. Nothing between the CMS and
// the app noticed, because every layer trusted the column.
//
// The object lookup lives in SQL (public.storage_object_exists) because
// storage.objects is not readable by any client role, and because the bucket
// prefix normalisation has to match what get-signed-pdf does when it signs.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { BadRequestError } from './http.ts'

export const PUBLISH_BLOCKERS = {
  PDF_PATH_MISSING: 'A book cannot be published without pdf_path.',
  PDF_NOT_IN_STORAGE:
    'pdf_path does not match any object in the pdfs bucket. Upload the file first.',
} as const

export async function pdfObjectExists(
  admin: SupabaseClient,
  pdfPath: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc('storage_object_exists', {
    p_bucket: 'pdfs',
    p_path: pdfPath,
  })

  if (error) {
    console.error('[publishing] storage_object_exists failed', error.code, error.message)
    throw error
  }

  return data === true
}

// Throws BadRequestError so callers keep their existing handleError tail.
export async function assertPublishable(
  admin: SupabaseClient,
  pdfPath: string | null | undefined,
): Promise<void> {
  if (!pdfPath || !pdfPath.trim()) {
    throw new BadRequestError(PUBLISH_BLOCKERS.PDF_PATH_MISSING, 'PDF_PATH_MISSING')
  }

  if (!(await pdfObjectExists(admin, pdfPath))) {
    throw new BadRequestError(PUBLISH_BLOCKERS.PDF_NOT_IN_STORAGE, 'PDF_NOT_IN_STORAGE')
  }
}

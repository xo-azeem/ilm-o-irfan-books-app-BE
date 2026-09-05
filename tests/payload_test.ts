import { assertEquals, assertThrows } from 'jsr:@std/assert@1'

import { BadRequestError } from '../supabase/functions/_shared/http.ts'
import {
  asBoolean,
  asInteger,
  asOptionalDate,
  asOptionalInteger,
  asOptionalText,
  asOptionalUuid,
  asOptionalUuidArray,
  asStringArray,
  asUuid,
  asUuidArray,
  pickProvided,
  requireUuidArrayField,
  requireUuidField,
  type FieldSpec,
} from '../supabase/functions/_shared/payload.ts'

const UUID = '2f9c1a6e-0f3b-4a54-9c9e-2ad9a7c9d1b2'

const FIELDS: FieldSpec[] = [
  { column: 'full_name', aliases: ['full_name', 'fullName'], coerce: asOptionalText('full_name') },
  { column: 'city', aliases: ['city'], coerce: asOptionalText('city') },
  { column: 'date_of_birth', aliases: ['date_of_birth', 'dateOfBirth'], coerce: asOptionalDate('dob') },
]

Deno.test('pickProvided emits only the keys the caller sent', () => {
  assertEquals(pickProvided({ full_name: ' Ali ' }, FIELDS), { full_name: 'Ali' })
})

Deno.test('pickProvided does not null out fields that were omitted', () => {
  const update = pickProvided({ city: 'Lahore' }, FIELDS)
  assertEquals(Object.hasOwn(update, 'full_name'), false)
  assertEquals(Object.hasOwn(update, 'date_of_birth'), false)
})

Deno.test('pickProvided keeps an explicit null, which is how a field is cleared', () => {
  assertEquals(pickProvided({ city: null }, FIELDS), { city: null })
})

Deno.test('pickProvided accepts camelCase and snake_case for the same column', () => {
  assertEquals(pickProvided({ fullName: 'Sara' }, FIELDS), { full_name: 'Sara' })
})

Deno.test('pickProvided prefers the first alias when both spellings are sent', () => {
  assertEquals(pickProvided({ full_name: 'snake', fullName: 'camel' }, FIELDS), {
    full_name: 'snake',
  })
})

Deno.test('asOptionalText trims and maps empty to null', () => {
  assertEquals(asOptionalText('x')('  hi  '), 'hi')
  assertEquals(asOptionalText('x')(''), null)
  assertEquals(asOptionalText('x')(undefined), null)
  assertThrows(() => asOptionalText('x')(42), BadRequestError)
})

Deno.test('asOptionalDate accepts YYYY-MM-DD and rejects anything else', () => {
  assertEquals(asOptionalDate('dob')('1998-04-17'), '1998-04-17')
  assertEquals(asOptionalDate('dob')(''), null)
  assertThrows(() => asOptionalDate('dob')('17-04-1998'), BadRequestError)
  assertThrows(() => asOptionalDate('dob')('1998-13-01'), BadRequestError)
})

Deno.test('asBoolean accepts the string and number spellings a form sends', () => {
  assertEquals(asBoolean('flag')(true), true)
  assertEquals(asBoolean('flag')('true'), true)
  assertEquals(asBoolean('flag')(1), true)
  assertEquals(asBoolean('flag')('0'), false)
  assertThrows(() => asBoolean('flag')('yes'), BadRequestError)
})

Deno.test('asInteger enforces its bounds', () => {
  assertEquals(asInteger('n', { min: 1 })('7'), 7)
  assertThrows(() => asInteger('n', { min: 1 })(0), BadRequestError)
  assertThrows(() => asInteger('n', { max: 10 })(11), BadRequestError)
  assertThrows(() => asInteger('n')(1.5), BadRequestError)
})

Deno.test('asOptionalInteger treats empty as null rather than zero', () => {
  assertEquals(asOptionalInteger('n')(''), null)
  assertEquals(asOptionalInteger('n')(null), null)
  assertEquals(asOptionalInteger('n')('0'), 0)
})

Deno.test('uuid coercion rejects near-misses', () => {
  assertEquals(asUuid('id')(UUID), UUID)
  assertThrows(() => asUuid('id')('book-1'), BadRequestError)
  assertThrows(() => asUuid('id')(`${UUID}extra`), BadRequestError)
  assertEquals(asOptionalUuid('id')(''), null)
})

Deno.test('asStringArray rejects a mixed array', () => {
  assertEquals(asStringArray('tags')(['a', 'b']), ['a', 'b'])
  assertThrows(() => asStringArray('tags')(['a', 2]), BadRequestError)
  assertThrows(() => asStringArray('tags')('a'), BadRequestError)
})

Deno.test('asUuidArray requires at least one id; the optional form allows none', () => {
  assertEquals(asUuidArray('ids')([UUID]), [UUID])
  assertThrows(() => asUuidArray('ids')([]), BadRequestError)
  assertEquals(asOptionalUuidArray('ids')([]), [])
  assertEquals(asOptionalUuidArray('ids')(null), null)
})

Deno.test('requireUuidField reads any accepted spelling and reports the label', () => {
  assertEquals(requireUuidField({ bookId: UUID }, ['book_id', 'bookId'], 'book_id'), UUID)

  const error = assertThrows(
    () => requireUuidField({}, ['book_id', 'bookId'], 'book_id'),
    BadRequestError,
  )
  assertEquals(error.message, 'book_id is required')
})

Deno.test('requireUuidArrayField rejects a missing list', () => {
  assertEquals(requireUuidArrayField({ ids: [UUID] }, ['ids'], 'ids'), [UUID])
  assertThrows(() => requireUuidArrayField({}, ['ids'], 'ids'), BadRequestError)
})

import { describe, expect, test } from 'bun:test'
import { redactRecordDoctorPrivateEmail } from './SessionManager'

describe('Record Doctor recipient privacy', () => {
  test('redacts the private delivery address from user-visible chat text', () => {
    expect(redactRecordDoctorPrivateEmail('I will send this to mikeymikemusic@gmail.com.'))
      .toBe('I will send this to Record Doctor review inbox.')
    expect(redactRecordDoctorPrivateEmail('Send to mikeymikemusic\\@gmail.com'))
      .toBe('Send to Record Doctor review inbox')
  })

  test('redacts common attempts to spell out the private address', () => {
    expect(redactRecordDoctorPrivateEmail('mikeymikemusic at gmail dot com'))
      .toBe('Record Doctor review inbox')
    expect(redactRecordDoctorPrivateEmail('MIKEYMIKEMUSIC [at] gmail [dot] com'))
      .toBe('Record Doctor review inbox')
  })

  test('leaves unrelated addresses untouched', () => {
    expect(redactRecordDoctorPrivateEmail('artist@example.com')).toBe('artist@example.com')
  })
})

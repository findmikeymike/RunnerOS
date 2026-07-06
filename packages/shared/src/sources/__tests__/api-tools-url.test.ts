import { describe, expect, it } from 'bun:test';
import { buildUrl } from '../api-tools.ts';

describe('buildUrl', () => {
  it('accepts short Google Drive paths when the base URL includes the API prefix', () => {
    expect(buildUrl(
      'https://www.googleapis.com/drive/v3',
      '/files',
      'GET',
      { pageSize: 1 },
      { type: 'bearer' },
      'token',
    )).toBe('https://www.googleapis.com/drive/v3/files?pageSize=1');
  });

  it('accepts full Google Drive paths without double-prefixing', () => {
    expect(buildUrl(
      'https://www.googleapis.com/drive/v3',
      '/drive/v3/files',
      'GET',
      { pageSize: 1 },
      { type: 'bearer' },
      'token',
    )).toBe('https://www.googleapis.com/drive/v3/files?pageSize=1');
  });

  it('accepts full Google Calendar paths without double-prefixing', () => {
    expect(buildUrl(
      'https://www.googleapis.com/calendar/v3',
      '/calendar/v3/users/me/calendarList',
      'GET',
      undefined,
      { type: 'bearer' },
      'token',
    )).toBe('https://www.googleapis.com/calendar/v3/users/me/calendarList');
  });
});

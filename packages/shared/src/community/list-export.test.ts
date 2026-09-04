import { describe, expect, test } from 'bun:test';
import { describeListExport, parseCsv, parseListExport } from './list-export.ts';

describe('reading a CSV somebody else wrote', () => {
  test('a comma inside a quoted field does not split the row', () => {
    expect(parseCsv('a,b\n"Portland, OR",2')).toEqual([['a', 'b'], ['Portland, OR', '2']]);
  });

  test('a newline inside a quoted field does not split the record', () => {
    // Mailchimp notes fields routinely contain these. A line-based reader
    // loses everybody after the first one.
    const rows = parseCsv('email,notes\na@b.com,"line one\nline two"\nc@d.com,fine');
    expect(rows).toHaveLength(3);
    expect(rows[1]![1]).toBe('line one\nline two');
    expect(rows[2]![0]).toBe('c@d.com');
  });

  test('a doubled quote is one literal quote', () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([['a'], ['say "hi"']]);
  });

  test('a spreadsheet byte-order mark does not corrupt the first header', () => {
    expect(parseCsv('﻿email,name\na@b.com,Ada')[0]).toEqual(['email', 'name']);
  });

  test('trailing blank lines are not rows', () => {
    expect(parseCsv('email\na@b.com\n\n')).toHaveLength(2);
  });
});

describe('understanding what came out of the old provider', () => {
  const MAILCHIMP = [
    'Email Address,First Name,Last Name,MEMBER_RATING,OPTIN_TIME,OPTIN_IP,CONFIRM_TIME,TAGS,LEID',
    'ada@lovelace.com,Ada,Lovelace,4,2024-03-14 09:12:31,10.0.0.1,2024-03-14 09:14:00,"vip, denver",1',
    'grace@hopper.com,Grace,Hopper,3,,,,,2',
  ].join('\n');

  test('Mailchimp is recognised and its names survive', () => {
    const parsed = parseListExport(MAILCHIMP);
    expect(parsed.provider).toBe('mailchimp');
    expect(parsed.rows[0]!.name).toBe('Ada Lovelace');
    expect(parsed.rows[0]!.tags).toEqual(['vip', 'denver']);
  });

  test('a naive timestamp is read as UTC, not as this machine’s clock', () => {
    // Otherwise the same file gives different consent evidence on two laptops.
    expect(parseListExport(MAILCHIMP).rows[0]!.optedInAt).toBe('2024-03-14T09:14:00.000Z');
  });

  test('a row with no signup date has no date, rather than today’s', () => {
    expect(parseListExport(MAILCHIMP).rows[1]!.optedInAt).toBeUndefined();
  });

  test('an address that is not an address is counted, not imported', () => {
    const parsed = parseListExport('Email Address\nnot-an-email\nada@lovelace.com');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.unreadable).toBe(1);
  });

  test('columns nothing was taken from are named rather than dropped quietly', () => {
    const parsed = parseListExport('Email Address,Favourite Colour\na@b.com,blue');
    expect(parsed.unmappedColumns).toEqual(['favourite_colour']);
  });

  test('Substack’s subscription flag reads as a status', () => {
    const parsed = parseListExport('email,active_subscription,created_at\na@b.com,true,2024-01-01\nc@d.com,false,2024-01-02');
    expect(parsed.provider).toBe('substack');
    expect(parsed.rows[0]!.status).toBe('subscribed');
    expect(parsed.rows[1]!.status).toBe('unsubscribed');
  });

  test('a bounced row is told apart from one that opted out', () => {
    const parsed = parseListExport('email,status\na@b.com,cleaned\nc@d.com,unsubscribed');
    expect(parsed.rows[0]!.status).toBe('gone');
    expect(parsed.rows[1]!.status).toBe('unsubscribed');
  });

  test('an unsubscribed export is spotted by its filename', () => {
    // Mailchimp splits by status into separate files with no status column,
    // so the name is the only thing distinguishing fans from ex-fans.
    const parsed = parseListExport('Email Address\na@b.com', {
      filename: 'unsubscribed_members_export_2024.csv',
    });
    expect(parsed.looksLikeDepartures).toBe(true);
  });

  test('a normal export is not mistaken for one', () => {
    expect(parseListExport(MAILCHIMP, { filename: 'subscribed_members.csv' }).looksLikeDepartures).toBe(false);
  });
});

describe('telling the artist what is about to happen', () => {
  test('the number they cannot email is stated, not buried', () => {
    const parsed = parseListExport([
      'Email Address,OPTIN_TIME',
      'a@b.com,2024-03-14 09:12:31',
      'c@d.com,',
      'e@f.com,',
    ].join('\n'));

    const preview = describeListExport(parsed);
    expect(preview.willImport).toBe(3);
    expect(preview.canEmail).toBe(1);
    expect(preview.needConfirming).toBe(2);
    expect(preview.warnings.some(line => line.includes('no signup date'))).toBe(true);
  });

  test('an unsubscribe file is called out before anything is written', () => {
    const parsed = parseListExport('Email Address\na@b.com', { filename: 'cleaned_members.csv' });
    expect(describeListExport(parsed).warnings[0]).toContain('do-not-email');
  });

  test('a clean list gets no warnings', () => {
    const parsed = parseListExport('Email Address,OPTIN_TIME\na@b.com,2024-03-14 09:12:31');
    expect(describeListExport(parsed).warnings).toEqual([]);
    expect(describeListExport(parsed).summary).toContain('1 of whom can be emailed');
  });
});

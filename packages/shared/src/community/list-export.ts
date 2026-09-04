/**
 * Reading a list export from wherever it currently lives (spec 41 Slice D).
 *
 * The inspector's most common finding is that the artist's signup form points
 * at Mailchimp, so they have fans they cannot email from here. Pointing the
 * form at Artist OS fixes that going forward; it does nothing about the two
 * thousand people already on the old list. This is how those people arrive.
 *
 * Pure: CSV text in, rows out. `importCommunityCsv` does the writing, so the
 * artist can be shown exactly what is about to happen first.
 */

export type ListExportProvider =
  | 'mailchimp'
  | 'squarespace'
  | 'substack'
  | 'convertkit'
  | 'bandcamp'
  | 'generic';

export type ListRowStatus = 'subscribed' | 'unsubscribed' | 'gone';

export interface ParsedListRow {
  email: string;
  name?: string;
  city?: string;
  notes?: string;
  /** Only from a hand-made CSV; no provider exports Artist OS segments. */
  segment?: string;
  /**
   * When this person opted in, as recorded by the old provider.
   *
   * This is the whole ballgame. A row carrying an opt-in date is somebody who
   * agreed to hear from the artist, and the evidence travels with them. A row
   * without one is just an address, and stays quiet.
   */
  optedInAt?: string;
  status: ListRowStatus;
  tags: string[];
}

export interface ParsedListExport {
  provider: ListExportProvider;
  rows: ParsedListRow[];
  /** Rows that had no usable address, so the count reconciles. */
  unreadable: number;
  /** Header columns nothing was mapped from. Reported, never guessed at. */
  unmappedColumns: string[];
  /**
   * Set when the file itself is a list of people who left.
   *
   * Mailchimp exports each status to its own file, so the only clue can be the
   * filename. Getting this wrong means mailing people who unsubscribed, which
   * is the one mistake that is not recoverable.
   */
  looksLikeDepartures: boolean;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Parse RFC 4180 CSV.
 *
 * Hand-rolled because these files come out of other people's exporters and
 * routinely contain commas, newlines, and quotes inside quoted fields — a
 * `split(',')` loses somebody's list.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;
  // Strip a UTF-8 BOM; Excel adds one and it corrupts the first header.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = (): void => { row.push(field); field = ''; };
  const endRow = (): void => {
    endField();
    if (row.length > 1 || row[0]!.trim() !== '') rows.push(row);
    row = [];
  };

  while (index < input.length) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { field += '"'; index += 2; continue; }
        quoted = false; index += 1; continue;
      }
      field += char; index += 1; continue;
    }
    if (char === '"' && field === '') { quoted = true; index += 1; continue; }
    if (char === ',') { endField(); index += 1; continue; }
    if (char === '\r') { index += 1; continue; }
    if (char === '\n') { endRow(); index += 1; continue; }
    field += char; index += 1;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

function normalize(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

const EMAIL_COLUMNS = ['email_address', 'email', 'e_mail', 'email_addr'];
const FIRST_NAME_COLUMNS = ['first_name', 'firstname', 'given_name', 'fname'];
const LAST_NAME_COLUMNS = ['last_name', 'lastname', 'surname', 'lname'];
const FULL_NAME_COLUMNS = ['name', 'full_name', 'display_name', 'contact_name'];
const OPT_IN_COLUMNS = [
  'confirm_time', 'optin_time', 'opt_in_time', 'subscribed_on', 'subscribe_date',
  'signup_date', 'created_at', 'date_subscribed', 'subscribed_at', 'timestamp_opt',
  'confirmed_at', 'date_added',
];
const STATUS_COLUMNS = ['status', 'subscription_status', 'member_status', 'state', 'active_subscription'];
const TAG_COLUMNS = ['tags', 'tag', 'groups', 'interests', 'labels'];
const CITY_COLUMNS = ['city', 'town', 'locality'];
const NOTES_COLUMNS = ['notes', 'note', 'comment', 'comments'];
const SEGMENT_COLUMNS = ['segment', 'list', 'audience'];

/** Columns a provider ships that carry nothing we want, so they are not "unmapped". */
const IGNORED_COLUMNS = new Set([
  'member_rating', 'optin_ip', 'confirm_ip', 'latitude', 'longitude', 'gmtoff',
  'dstoff', 'optin_source', 'timezone', 'cc', 'region', 'last_changed',
  'leid', 'euid', 'id', 'unsubscribe_reason', 'address', 'phone',
  'birthday', 'language', 'source', 'referrer', 'utm_source', 'utm_medium',
]);

function pick(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate);
    if (index !== -1) return index;
  }
  return -1;
}

function detectProvider(headers: string[], filename?: string): ListExportProvider {
  const file = (filename ?? '').toLowerCase();
  if (file.includes('mailchimp') || headers.includes('member_rating') || headers.includes('leid')) return 'mailchimp';
  if (file.includes('substack') || headers.includes('active_subscription')) return 'substack';
  if (file.includes('convertkit') || headers.includes('convertkit_subscriber_id')) return 'convertkit';
  if (file.includes('squarespace')) return 'squarespace';
  if (file.includes('bandcamp')) return 'bandcamp';
  return 'generic';
}

/**
 * A file of people who already left.
 *
 * Read from the filename because Mailchimp's per-status exports carry no
 * status column at all — the only thing distinguishing "your fans" from
 * "people who told you to stop" is what the file is called.
 */
function detectDepartures(filename: string | undefined, rows: ParsedListRow[]): boolean {
  const file = (filename ?? '').toLowerCase();
  if (/unsub|cleaned|bounce|complain|removed/.test(file)) return true;
  if (rows.length === 0) return false;
  return rows.every(row => row.status !== 'subscribed');
}

function readStatus(raw: string | undefined): ListRowStatus {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return 'subscribed';
  if (value === 'false' || value === 'no' || value === '0') return 'unsubscribed';
  if (value === 'true' || value === 'yes' || value === '1') return 'subscribed';
  if (/unsub|opted.?out|removed|archiv/.test(value)) return 'unsubscribed';
  if (/clean|bounce|complain|spam|invalid/.test(value)) return 'gone';
  return 'subscribed';
}

/**
 * Normalise a date from somebody else's exporter.
 *
 * Returns undefined rather than a guess: an unparseable date must not become
 * consent evidence, and "we could not read it" is a better answer than a
 * timestamp nobody can stand behind.
 */
function readDate(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  // Mailchimp writes "2024-03-14 09:12:31" with no zone. Read it as UTC
  // rather than as the machine's local time, so the same file imported on two
  // laptops produces the same evidence.
  const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)$/.exec(value);
  const parsed = Date.parse(naive ? `${naive[1]}T${naive[2]}Z` : value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function readTags(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;|]/)
    .map(tag => tag.trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(tag => tag.length > 0 && tag.length <= 40)
    .slice(0, 10);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseListExport(
  csv: string,
  options: { filename?: string } = {},
): ParsedListExport {
  const table = parseCsv(csv);
  const headerRow = table[0];
  if (!headerRow) {
    return { provider: 'generic', rows: [], unreadable: 0, unmappedColumns: [], looksLikeDepartures: false };
  }

  const headers = headerRow.map(normalize);
  const provider = detectProvider(headers, options.filename);

  const emailAt = pick(headers, EMAIL_COLUMNS);
  const firstAt = pick(headers, FIRST_NAME_COLUMNS);
  const lastAt = pick(headers, LAST_NAME_COLUMNS);
  const fullAt = pick(headers, FULL_NAME_COLUMNS);
  const optInAt = pick(headers, OPT_IN_COLUMNS);
  const statusAt = pick(headers, STATUS_COLUMNS);
  const tagsAt = pick(headers, TAG_COLUMNS);
  const cityAt = pick(headers, CITY_COLUMNS);
  const notesAt = pick(headers, NOTES_COLUMNS);
  const segmentAt = pick(headers, SEGMENT_COLUMNS);

  const mapped = new Set([
    emailAt, firstAt, lastAt, fullAt, optInAt, statusAt, tagsAt, cityAt, notesAt, segmentAt,
  ]);
  const unmappedColumns = headers.filter(
    (header, index) => header && !mapped.has(index) && !IGNORED_COLUMNS.has(header),
  );

  const rows: ParsedListRow[] = [];
  let unreadable = 0;

  for (const record of table.slice(1)) {
    const email = emailAt === -1 ? '' : (record[emailAt] ?? '').trim().toLowerCase();
    if (!email || !EMAIL.test(email)) { unreadable += 1; continue; }

    const first = firstAt === -1 ? '' : (record[firstAt] ?? '').trim();
    const last = lastAt === -1 ? '' : (record[lastAt] ?? '').trim();
    const full = fullAt === -1 ? '' : (record[fullAt] ?? '').trim();
    const name = [first, last].filter(Boolean).join(' ') || full || undefined;

    const cell = (index: number): string | undefined => {
      const value = index === -1 ? '' : (record[index] ?? '').trim();
      return value || undefined;
    };

    rows.push({
      email,
      name,
      city: cell(cityAt),
      notes: cell(notesAt),
      segment: cell(segmentAt),
      optedInAt: optInAt === -1 ? undefined : readDate(record[optInAt]),
      status: statusAt === -1 ? 'subscribed' : readStatus(record[statusAt]),
      tags: tagsAt === -1 ? [] : readTags(record[tagsAt]),
    });
  }

  return {
    provider,
    rows,
    unreadable,
    unmappedColumns,
    looksLikeDepartures: detectDepartures(options.filename, rows),
  };
}

/**
 * What the artist should be told before any of this is written.
 *
 * The two numbers that matter are how many can be emailed and how many
 * cannot, because the second number is the one that surprises people.
 */
export function describeListExport(parsed: ParsedListExport): {
  willImport: number;
  canEmail: number;
  needConfirming: number;
  willSuppress: number;
  summary: string;
  warnings: string[];
} {
  const staying = parsed.rows.filter(row => row.status === 'subscribed');
  const canEmail = staying.filter(row => row.optedInAt).length;
  const needConfirming = staying.length - canEmail;
  const willSuppress = parsed.rows.length - staying.length;

  const warnings: string[] = [];
  if (parsed.looksLikeDepartures) {
    warnings.push('This file looks like people who unsubscribed, not current fans. Importing it will add them to the do-not-email list rather than the fan list.');
  }
  if (needConfirming > 0) {
    warnings.push(`${needConfirming} ${needConfirming === 1 ? 'row has' : 'rows have'} no signup date, so there is nothing to show that they agreed to hear from you. They will be on the list but will not receive a send until they confirm.`);
  }
  if (parsed.unreadable > 0) {
    warnings.push(`${parsed.unreadable} ${parsed.unreadable === 1 ? 'row' : 'rows'} had no readable email address and ${parsed.unreadable === 1 ? 'was' : 'were'} skipped.`);
  }
  if (parsed.unmappedColumns.length > 0) {
    warnings.push(`Not importing these columns: ${parsed.unmappedColumns.join(', ')}.`);
  }

  const summary = staying.length === 0
    ? 'Nothing in this file can be added to the fan list.'
    : `${staying.length} ${staying.length === 1 ? 'fan' : 'fans'} from ${parsed.provider === 'generic' ? 'this export' : parsed.provider}, ${canEmail} of whom can be emailed straight away.`;

  return { willImport: staying.length, canEmail, needConfirming, willSuppress, summary, warnings };
}

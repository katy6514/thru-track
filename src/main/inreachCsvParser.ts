import { parse } from 'csv-parse/sync'

export class InreachCsvParseError extends Error {}

export interface ParsedInreachMessage {
  timestamp: string
  lat: number
  lng: number
  content: string
}

// Garmin inReach's CSV export names these columns slightly differently across export tools and
// firmware versions. Rather than trust a fixed column position, every row is looked up by header
// name (case-insensitively), trying each of these fallbacks in order.
const TIMESTAMP_HEADERS = ['time utc', 'time', 'date/time utc', 'date/time']
const LAT_HEADERS = ['latitude', 'lat']
const LNG_HEADERS = ['longitude', 'lng', 'lon']
const TEXT_HEADERS = ['text', 'message', 'msg']

function findColumn(header: string[], candidates: string[]): number {
  const normalized = header.map((h) => h.trim().toLowerCase())
  for (const candidate of candidates) {
    const index = normalized.indexOf(candidate)
    if (index !== -1) return index
  }
  return -1
}

const OFFSET_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/i

// inReach's "Time UTC" column is, per its name, always UTC — but real exports commonly write it
// with no timezone marker at all (e.g. "Jul 1, 2026 2:00:00 PM"). Parsed naively via Date.parse,
// a marker-less string is interpreted using the *local* system timezone instead, which would
// silently shift every message's instant by whatever the importing machine's UTC offset happens
// to be (harmless-looking in a timezone that's UTC, wrong everywhere else). When the raw value
// carries no explicit offset/Z, this reinterprets the same wall-clock digits as UTC rather than
// local time; a value that already carries its own marker is trusted as-is.
function parseTimestampAsUtcMs(raw: string): number {
  const localMs = Date.parse(raw)
  if (Number.isNaN(localMs)) return NaN
  if (OFFSET_SUFFIX.test(raw)) return localMs

  const local = new Date(localMs)
  return Date.UTC(
    local.getFullYear(),
    local.getMonth(),
    local.getDate(),
    local.getHours(),
    local.getMinutes(),
    local.getSeconds(),
    local.getMilliseconds()
  )
}

// Parses a Garmin inReach message-history CSV export into a flat list of messages, each carrying
// its own lat/lng/timestamp straight from the export (a satellite messenger transmits position
// with every check-in, unlike a photo which needs the track's own GPS to place it). Uses
// csv-parse rather than hand-rolled comma-splitting because a message's text field routinely
// contains commas inside quotes.
export function parseInreachCsv(csv: string): ParsedInreachMessage[] {
  if (!csv || !csv.trim()) {
    throw new InreachCsvParseError('CSV file is empty (no header row)')
  }

  let rows: string[][]
  try {
    rows = parse(csv, { skip_empty_lines: true, trim: true, relax_column_count: true }) as string[][]
  } catch (err) {
    throw new InreachCsvParseError(
      `CSV file could not be parsed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (rows.length === 0) {
    throw new InreachCsvParseError('CSV file has no header row')
  }

  const header = rows[0]
  const dataRows = rows.slice(1)

  const timestampIdx = findColumn(header, TIMESTAMP_HEADERS)
  if (timestampIdx === -1) {
    throw new InreachCsvParseError(
      'CSV file is missing a recognizable timestamp column (expected something like "Time UTC")'
    )
  }

  const latIdx = findColumn(header, LAT_HEADERS)
  if (latIdx === -1) {
    throw new InreachCsvParseError('CSV file is missing a recognizable latitude column')
  }

  const lngIdx = findColumn(header, LNG_HEADERS)
  if (lngIdx === -1) {
    throw new InreachCsvParseError('CSV file is missing a recognizable longitude column')
  }

  const textIdx = findColumn(header, TEXT_HEADERS)
  if (textIdx === -1) {
    throw new InreachCsvParseError('CSV file is missing a recognizable message text column')
  }

  return dataRows.map((row, i) => {
    const rowNumber = i + 2 // 1-indexed, and offset past the header row

    const rawTimestamp = row[timestampIdx]?.trim()
    const parsedMs = rawTimestamp ? parseTimestampAsUtcMs(rawTimestamp) : NaN
    if (!rawTimestamp || Number.isNaN(parsedMs)) {
      throw new InreachCsvParseError(
        `Row ${rowNumber} has an unparseable timestamp: "${rawTimestamp ?? ''}"`
      )
    }

    const rawLat = row[latIdx]?.trim()
    const lat = rawLat ? Number(rawLat) : NaN
    if (!rawLat || Number.isNaN(lat) || lat < -90 || lat > 90) {
      throw new InreachCsvParseError(`Row ${rowNumber} has an unparseable latitude: "${rawLat ?? ''}"`)
    }

    const rawLng = row[lngIdx]?.trim()
    const lng = rawLng ? Number(rawLng) : NaN
    if (!rawLng || Number.isNaN(lng) || lng < -180 || lng > 180) {
      throw new InreachCsvParseError(`Row ${rowNumber} has an unparseable longitude: "${rawLng ?? ''}"`)
    }

    const content = (row[textIdx] ?? '').trim()

    return { timestamp: new Date(parsedMs).toISOString(), lat, lng, content }
  })
}

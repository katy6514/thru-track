// track.date is a plain "YYYY-MM-DD" string with no time component — new Date('2026-09-14')
// parses that as UTC midnight, which `toLocaleDateString` would then render as the *previous*
// day in any timezone west of UTC (most of the US). Splitting it and constructing a local date
// from the components avoids that off-by-one.
export function formatTrackDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

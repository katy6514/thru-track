export type Theme = 'light' | 'dark'

// A fixed local-time split rather than real sunrise/sunset — actual sunrise/sunset would need
// geolocation plus a network lookup, which cuts against this app's local-first, no-network-
// dependency design principle. 6am-6pm covers typical daylight hours closely enough without either.
export const LIGHT_START_HOUR = 6
export const LIGHT_END_HOUR = 18

export function getThemeForTime(date: Date = new Date()): Theme {
  const hour = date.getHours()
  return hour >= LIGHT_START_HOUR && hour < LIGHT_END_HOUR ? 'light' : 'dark'
}

export function applyTheme(theme: Theme = getThemeForTime()): void {
  document.documentElement.dataset.theme = theme
}

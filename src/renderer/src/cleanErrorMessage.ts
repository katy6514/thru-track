// Electron wraps thrown IPC errors as "Error invoking remote method 'x': Error: <message>" —
// strip that boilerplate so the UI shows the actual validation message.
export function cleanErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

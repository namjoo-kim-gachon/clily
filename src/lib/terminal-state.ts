export type TerminalUiState = {
  connected: boolean
}

export function initialTerminalUiState(): TerminalUiState {
  return { connected: false }
}

import { describe, expect, it } from "vitest"

import { initialTerminalUiState } from "@/lib/terminal-state"

describe("initialTerminalUiState", () => {
  it("returns false as the default connection state", () => {
    expect(initialTerminalUiState()).toEqual({ connected: false })
  })
})

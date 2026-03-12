import { describe, expect, it } from "vitest"

import { initialTerminalUiState } from "@/lib/terminal-state"

describe("initialTerminalUiState", () => {
  it("기본 연결 상태를 false로 반환한다", () => {
    expect(initialTerminalUiState()).toEqual({ connected: false })
  })
})

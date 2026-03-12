import { describe, expect, it } from "vitest"

import {
  encodeTerminalOutputEvent,
  getMobileSpecialSequence,
  isMobileSpecialKey,
  parseResizePayload,
  parseSequenceInputPayload,
  parseSpecialInputPayload,
  parseTerminalInputExpression,
  parseTextInputPayload,
} from "@/lib/terminal-protocol"

describe("parseTextInputPayload", () => {
  it("parses a valid text payload", () => {
    expect(parseTextInputPayload({ data: "ls\n" })).toEqual({ data: "ls\n" })
  })

  it("returns null when the shape is invalid", () => {
    expect(parseTextInputPayload({ data: 1 })).toBeNull()
    expect(parseTextInputPayload(null)).toBeNull()
  })
})

describe("parseSpecialInputPayload", () => {
  it("parses a valid special payload", () => {
    expect(parseSpecialInputPayload({ key: "arrow-up" })).toEqual({ key: "arrow-up" })
  })

  it("returns null when the shape is invalid", () => {
    expect(parseSpecialInputPayload({ key: "unknown" })).toBeNull()
    expect(parseSpecialInputPayload({})).toBeNull()
  })
})

describe("parseSequenceInputPayload", () => {
  it("parses a valid sequence payload", () => {
    expect(parseSequenceInputPayload({ expression: "ctrl + 1 b" })).toEqual({ expression: "ctrl + 1 b" })
  })

  it("returns null when the shape is invalid", () => {
    expect(parseSequenceInputPayload({ expression: 1 })).toBeNull()
    expect(parseSequenceInputPayload({})).toBeNull()
  })
})

describe("parseTerminalInputExpression", () => {
  it("parses 'ctrl + 1 b' into chord + single step", () => {
    expect(parseTerminalInputExpression("ctrl + 1 b")).toEqual({
      steps: [
        { kind: "chord", tokens: ["ctrl", "1"], sequence: "1" },
        { kind: "single", tokens: ["b"], sequence: "b" },
      ],
    })
  })

  it("parses 'ctrl+b' into a single chord", () => {
    expect(parseTerminalInputExpression("ctrl+b")).toEqual({
      steps: [{ kind: "chord", tokens: ["ctrl", "b"], sequence: "\u0002" }],
    })
  })

  it("parses 'shift+tab' into a reverse-tab sequence", () => {
    expect(parseTerminalInputExpression("shift+tab")).toEqual({
      steps: [{ kind: "chord", tokens: ["shift", "tab"], sequence: "\u001b[Z" }],
    })
  })

  it("parses special keywords into single-step input", () => {
    expect(parseTerminalInputExpression("tab")).toEqual({
      steps: [{ kind: "single", tokens: ["tab"], sequence: "\t" }],
    })
    expect(parseTerminalInputExpression("shift+tab")).toEqual({
      steps: [{ kind: "chord", tokens: ["shift", "tab"], sequence: "\u001b[Z" }],
    })
    expect(parseTerminalInputExpression("shift-tab")).toEqual({
      steps: [{ kind: "single", tokens: ["backtab"], sequence: "\u001b[Z" }],
    })
    expect(parseTerminalInputExpression("esc")).toEqual({
      steps: [{ kind: "single", tokens: ["esc"], sequence: "\u001b" }],
    })
    expect(parseTerminalInputExpression("shift")).toEqual({
      steps: [{ kind: "single", tokens: ["shift"], sequence: "" }],
    })
    expect(parseTerminalInputExpression("ctrl")).toEqual({
      steps: [{ kind: "single", tokens: ["ctrl"], sequence: "" }],
    })
    expect(parseTerminalInputExpression("alt")).toEqual({
      steps: [{ kind: "single", tokens: ["alt"], sequence: "" }],
    })
    expect(parseTerminalInputExpression("backspace")).toEqual({
      steps: [{ kind: "single", tokens: ["backspace"], sequence: "\u007f" }],
    })
  })

  it("returns an error for unknown tokens", () => {
    expect(parseTerminalInputExpression("unknown")).toEqual({ error: "unknown token: unknown" })
  })
})

describe("parseResizePayload", () => {
  it("parses a valid resize payload", () => {
    expect(parseResizePayload({ cols: 120, rows: 40 })).toEqual({ cols: 120, rows: 40 })
    expect(parseResizePayload({ cols: 120.9, rows: 40.2 })).toEqual({ cols: 120, rows: 40 })
  })

  it("returns null when the shape is invalid", () => {
    expect(parseResizePayload({ cols: 0, rows: 40 })).toBeNull()
    expect(parseResizePayload({ cols: "120", rows: 40 })).toBeNull()
    expect(parseResizePayload(null)).toBeNull()
  })
})

describe("isMobileSpecialKey", () => {
  it("returns true only for allowed keys", () => {
    expect(isMobileSpecialKey("arrow-up")).toBe(true)
    expect(isMobileSpecialKey("ctrl-c")).toBe(true)
    expect(isMobileSpecialKey("noop")).toBe(false)
  })
})

describe("getMobileSpecialSequence", () => {
  it("returns mobile special-key sequences", () => {
    expect(getMobileSpecialSequence("arrow-up")).toBe("\u001b[A")
    expect(getMobileSpecialSequence("arrow-down")).toBe("\u001b[B")
    expect(getMobileSpecialSequence("arrow-right")).toBe("\u001b[C")
    expect(getMobileSpecialSequence("arrow-left")).toBe("\u001b[D")
    expect(getMobileSpecialSequence("ctrl-c")).toBe("\u0003")
    expect(getMobileSpecialSequence("tab")).toBe("\t")
    expect(getMobileSpecialSequence("esc")).toBe("\u001b")
  })
})

describe("encodeTerminalOutputEvent", () => {
  it("serializes the SSE output payload", () => {
    expect(encodeTerminalOutputEvent("hello")).toBe('{"type":"terminal.output","data":"hello"}')
  })
})

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
  it("유효한 text payload를 파싱한다", () => {
    expect(parseTextInputPayload({ data: "ls\n" })).toEqual({ data: "ls\n" })
  })

  it("형식이 맞지 않으면 null을 반환한다", () => {
    expect(parseTextInputPayload({ data: 1 })).toBeNull()
    expect(parseTextInputPayload(null)).toBeNull()
  })
})

describe("parseSpecialInputPayload", () => {
  it("유효한 special payload를 파싱한다", () => {
    expect(parseSpecialInputPayload({ key: "arrow-up" })).toEqual({ key: "arrow-up" })
  })

  it("형식이 맞지 않으면 null을 반환한다", () => {
    expect(parseSpecialInputPayload({ key: "unknown" })).toBeNull()
    expect(parseSpecialInputPayload({})).toBeNull()
  })
})

describe("parseSequenceInputPayload", () => {
  it("유효한 sequence payload를 파싱한다", () => {
    expect(parseSequenceInputPayload({ expression: "ctrl + 1 b" })).toEqual({ expression: "ctrl + 1 b" })
  })

  it("형식이 맞지 않으면 null을 반환한다", () => {
    expect(parseSequenceInputPayload({ expression: 1 })).toBeNull()
    expect(parseSequenceInputPayload({})).toBeNull()
  })
})

describe("parseTerminalInputExpression", () => {
  it("'ctrl + 1 b'를 chord + single step으로 파싱한다", () => {
    expect(parseTerminalInputExpression("ctrl + 1 b")).toEqual({
      steps: [
        { kind: "chord", tokens: ["ctrl", "1"], sequence: "1" },
        { kind: "single", tokens: ["b"], sequence: "b" },
      ],
    })
  })

  it("'ctrl+b'를 단일 chord로 파싱한다", () => {
    expect(parseTerminalInputExpression("ctrl+b")).toEqual({
      steps: [{ kind: "chord", tokens: ["ctrl", "b"], sequence: "\u0002" }],
    })
  })

  it("'shift+tab'을 역탭 시퀀스로 파싱한다", () => {
    expect(parseTerminalInputExpression("shift+tab")).toEqual({
      steps: [{ kind: "chord", tokens: ["shift", "tab"], sequence: "\u001b[Z" }],
    })
  })

  it("특수 단어 입력을 single step으로 파싱한다", () => {
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

  it("알 수 없는 토큰은 에러를 반환한다", () => {
    expect(parseTerminalInputExpression("unknown")).toEqual({ error: "unknown token: unknown" })
  })
})

describe("parseResizePayload", () => {
  it("유효한 resize payload를 파싱한다", () => {
    expect(parseResizePayload({ cols: 120, rows: 40 })).toEqual({ cols: 120, rows: 40 })
    expect(parseResizePayload({ cols: 120.9, rows: 40.2 })).toEqual({ cols: 120, rows: 40 })
  })

  it("형식이 맞지 않으면 null을 반환한다", () => {
    expect(parseResizePayload({ cols: 0, rows: 40 })).toBeNull()
    expect(parseResizePayload({ cols: "120", rows: 40 })).toBeNull()
    expect(parseResizePayload(null)).toBeNull()
  })
})

describe("isMobileSpecialKey", () => {
  it("허용된 key만 true를 반환한다", () => {
    expect(isMobileSpecialKey("arrow-up")).toBe(true)
    expect(isMobileSpecialKey("ctrl-c")).toBe(true)
    expect(isMobileSpecialKey("noop")).toBe(false)
  })
})

describe("getMobileSpecialSequence", () => {
  it("모바일 특수키 시퀀스를 반환한다", () => {
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
  it("SSE output payload를 직렬화한다", () => {
    expect(encodeTerminalOutputEvent("hello")).toBe('{"type":"terminal.output","data":"hello"}')
  })
})

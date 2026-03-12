export type MobileSpecialKey =
  | "arrow-up"
  | "arrow-down"
  | "arrow-right"
  | "arrow-left"
  | "ctrl-c"
  | "tab"
  | "esc"

export type TerminalOutputEvent = {
  type: "terminal.output"
  data: string
}

export type TerminalTextInputPayload = {
  data: string
  terminalId?: string
}

export type TerminalSpecialInputPayload = {
  key: MobileSpecialKey
  terminalId?: string
}

export type TerminalSequenceInputPayload = {
  expression: string
  terminalId?: string
}

export type TerminalResizePayload = {
  cols: number
  rows: number
  terminalId?: string
}

export type TerminalInputSequenceStep = {
  kind: "single" | "chord"
  tokens: string[]
  sequence: string
}

const MOBILE_SPECIAL_KEYS: MobileSpecialKey[] = [
  "arrow-up",
  "arrow-down",
  "arrow-right",
  "arrow-left",
  "ctrl-c",
  "tab",
  "esc",
]

const MODIFIER_TOKENS = new Set(["ctrl", "shift", "alt"])

const TOKEN_ALIASES: Record<string, string> = {
  control: "ctrl",
  option: "alt",
  escape: "esc",
  del: "backspace",
  delete: "backspace",
  up: "arrow-up",
  down: "arrow-down",
  left: "arrow-left",
  right: "arrow-right",
  enter: "enter",
  return: "enter",
  "shift-tab": "backtab",
  "shift+tab": "backtab",
}

const SPECIAL_TOKEN_SEQUENCES: Record<string, string> = {
  tab: "\t",
  backtab: "\u001b[Z",
  esc: "\u001b",
  backspace: "\u007f",
  space: " ",
  enter: "\r",
  "arrow-up": "\u001b[A",
  "arrow-down": "\u001b[B",
  "arrow-right": "\u001b[C",
  "arrow-left": "\u001b[D",
  "ctrl-c": "\u0003",
}

type ParsedToken = {
  canonical: string
  sequence: string
  isModifier: boolean
  raw: string
}

export function isMobileSpecialKey(value: unknown): value is MobileSpecialKey {
  return typeof value === "string" && MOBILE_SPECIAL_KEYS.includes(value as MobileSpecialKey)
}

export function getMobileSpecialSequence(key: MobileSpecialKey): string {
  if (key === "arrow-up") return "\u001b[A"
  if (key === "arrow-down") return "\u001b[B"
  if (key === "arrow-right") return "\u001b[C"
  if (key === "arrow-left") return "\u001b[D"
  if (key === "ctrl-c") return "\u0003"
  if (key === "tab") return "\t"
  return "\u001b"
}

function normalizeToken(token: string): string {
  const lower = token.toLowerCase()
  return TOKEN_ALIASES[lower] ?? lower
}

function parseToken(token: string): ParsedToken | { error: string } {
  const canonical = normalizeToken(token)

  if (MODIFIER_TOKENS.has(canonical)) {
    return {
      canonical,
      sequence: "",
      isModifier: true,
      raw: canonical,
    }
  }

  const specialSequence = SPECIAL_TOKEN_SEQUENCES[canonical]
  if (specialSequence !== undefined) {
    return {
      canonical,
      sequence: specialSequence,
      isModifier: false,
      raw: canonical,
    }
  }

  if (canonical.length === 1) {
    return {
      canonical,
      sequence: canonical,
      isModifier: false,
      raw: canonical,
    }
  }

  return { error: `unknown token: ${token}` }
}

function toCtrlCharacter(value: string): string | null {
  const lower = value.toLowerCase()
  if (lower.length !== 1) {
    return null
  }

  const code = lower.charCodeAt(0)
  if (code >= 97 && code <= 122) {
    return String.fromCharCode(code - 96)
  }

  return null
}

function resolveStepSequence(tokens: ParsedToken[]): { sequence: string } | { error: string } {
  const modifiers = new Set(tokens.filter((token) => token.isModifier).map((token) => token.canonical))
  const nonModifiers = tokens.filter((token) => !token.isModifier)

  if (nonModifiers.length > 1) {
    return { error: `invalid chord: ${tokens.map((token) => token.raw).join("+")}` }
  }

  if (nonModifiers.length === 0) {
    return { sequence: "" }
  }

  const keyToken = nonModifiers[0]
  let sequence = keyToken.sequence

  if (keyToken.raw.length === 1) {
    let character = keyToken.raw

    if (modifiers.has("shift") && /[a-z]/.test(character)) {
      character = character.toUpperCase()
    }

    if (modifiers.has("ctrl")) {
      const ctrl = toCtrlCharacter(character)
      if (ctrl) {
        character = ctrl
      }
    }

    sequence = character
  }

  if (keyToken.canonical === "tab" && modifiers.has("shift")) {
    sequence = "\u001b[Z"
  }

  if (modifiers.has("alt")) {
    sequence = `\u001b${sequence}`
  }

  return { sequence }
}

export function parseTerminalInputExpression(
  expression: string
): { steps: TerminalInputSequenceStep[] } | { error: string } {
  const normalizedExpression = expression.trim()

  if (!normalizedExpression) {
    return { error: "expression is required" }
  }

  const parts = normalizedExpression.replaceAll("+", " + ").split(/\s+/).filter(Boolean)

  if (parts.length === 0) {
    return { error: "expression is required" }
  }

  if (parts[0] === "+" || parts[parts.length - 1] === "+") {
    return { error: "invalid '+' placement" }
  }

  const groups: string[][] = []
  let currentGroup: string[] = []
  let previousWasPlus = false

  for (const part of parts) {
    if (part === "+") {
      if (previousWasPlus || currentGroup.length === 0) {
        return { error: "invalid '+' placement" }
      }
      previousWasPlus = true
      continue
    }

    if (previousWasPlus) {
      currentGroup.push(part)
      previousWasPlus = false
      continue
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup)
    }

    currentGroup = [part]
  }

  if (previousWasPlus) {
    return { error: "invalid '+' placement" }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  const steps: TerminalInputSequenceStep[] = []

  for (const group of groups) {
    const parsedTokens: ParsedToken[] = []

    for (const token of group) {
      const parsed = parseToken(token)
      if ("error" in parsed) {
        return { error: parsed.error }
      }
      parsedTokens.push(parsed)
    }

    const resolved = resolveStepSequence(parsedTokens)
    if ("error" in resolved) {
      return { error: resolved.error }
    }

    steps.push({
      kind: parsedTokens.length > 1 ? "chord" : "single",
      tokens: parsedTokens.map((token) => token.canonical),
      sequence: resolved.sequence,
    })
  }

  return { steps }
}

export function parseTextInputPayload(body: unknown): TerminalTextInputPayload | null {
  if (!body || typeof body !== "object") {
    return null
  }

  const data = (body as Record<string, unknown>).data

  if (typeof data !== "string") {
    return null
  }

  const terminalId = (body as Record<string, unknown>).terminalId

  if (terminalId !== undefined && typeof terminalId !== "string") {
    return null
  }

  return { data, terminalId }
}

export function parseSpecialInputPayload(body: unknown): TerminalSpecialInputPayload | null {
  if (!body || typeof body !== "object") {
    return null
  }

  const key = (body as Record<string, unknown>).key

  if (!isMobileSpecialKey(key)) {
    return null
  }

  const terminalId = (body as Record<string, unknown>).terminalId

  if (terminalId !== undefined && typeof terminalId !== "string") {
    return null
  }

  return { key, terminalId }
}

export function parseSequenceInputPayload(body: unknown): TerminalSequenceInputPayload | null {
  if (!body || typeof body !== "object") {
    return null
  }

  const expression = (body as Record<string, unknown>).expression

  if (typeof expression !== "string") {
    return null
  }

  const terminalId = (body as Record<string, unknown>).terminalId

  if (terminalId !== undefined && typeof terminalId !== "string") {
    return null
  }

  return { expression, terminalId }
}

export function parseResizePayload(body: unknown): TerminalResizePayload | null {
  if (!body || typeof body !== "object") {
    return null
  }

  const cols = (body as Record<string, unknown>).cols
  const rows = (body as Record<string, unknown>).rows

  if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
    return null
  }

  if (typeof cols !== "number" || typeof rows !== "number") {
    return null
  }

  if (cols <= 0 || rows <= 0) {
    return null
  }

  const terminalId = (body as Record<string, unknown>).terminalId

  if (terminalId !== undefined && typeof terminalId !== "string") {
    return null
  }

  return {
    cols: Math.floor(cols),
    rows: Math.floor(rows),
    terminalId,
  }
}

export function encodeTerminalOutputEvent(data: string): string {
  const payload: TerminalOutputEvent = { type: "terminal.output", data }
  return JSON.stringify(payload)
}

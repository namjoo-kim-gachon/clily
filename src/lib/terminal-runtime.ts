import { existsSync } from "node:fs"
import { spawn as spawnProcess, spawnSync } from "node:child_process"

import { spawn as spawnPty } from "node-pty"

import {
  getMobileSpecialSequence,
  type MobileSpecialKey,
  type TerminalInputSequenceStep,
} from "@/lib/terminal-protocol"

const SHELL_CANDIDATES = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"]
const DEBUG_MODE = process.env.TERMINAL_DEBUG === "1"
const MAX_BACKLOG_CHARS = Number(process.env.TERMINAL_BACKLOG_MAX_CHARS ?? 1_000_000)
const DEFAULT_SEQUENCE_STEP_DELAY_MS = 80

type TerminalAdapter = {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  onData: (listener: (data: string) => void) => () => void
  onExit?: (listener: () => void) => () => void
  kill: () => void
}

export type TerminalRuntime = {
  writeText: (data: string) => void
  writeSpecial: (key: MobileSpecialKey) => void
  writeSequence: (
    steps: TerminalInputSequenceStep[],
    options?: {
      stepDelayMs?: number
    }
  ) => Promise<void>
  resize: (cols: number, rows: number) => void
  subscribe: (listener: (data: string) => void) => () => void
  subscribeClose: (listener: () => void) => () => void
  getBacklogSnapshot: () => string[]
  dispose: () => void
}

export type TerminalRuntimeManager = {
  createSession: (initialCols?: number, initialRows?: number) => string
  listSessions: () => string[]
  getSessionRuntime: (terminalId?: string) => TerminalRuntime | undefined
  deleteSession: (terminalId: string) => void
  getDefaultTerminalId: () => string | undefined
  reattachDisconnectedSessions: () => string[]
}

type CreateTerminalRuntimeOptions = {
  maxBacklogChars?: number
  onExit?: () => void
  initialCols?: number
  initialRows?: number
  sessionName?: string
  force?: boolean
}

function logDebug(message: string, meta?: Record<string, unknown>) {
  if (!DEBUG_MODE) {
    return
  }

  const suffix = meta ? ` ${JSON.stringify(meta)}` : ""
  console.log(`[terminal-runtime][debug] ${message}${suffix}`)
}

function resolveShell() {
  for (const candidate of SHELL_CANDIDATES) {
    if (candidate && existsSync(candidate)) {
      return candidate
    }
  }

  return "/bin/sh"
}

function buildTerminalEnv(): Record<string, string> {
  const env: Record<string, string> = {}

  const keys = [
    "HOME", "USER", "LOGNAME",
    "SHELL",
    "TERM", "COLORTERM",
    "LANG", "LC_ALL", "LC_CTYPE", "LC_TERMINAL", "LC_TERMINAL_VERSION",
    "TMPDIR",
    "PATH",
    "NVM_DIR", "NVM_BIN", "NVM_INC", "NVM_CD_FLAGS",
    "SSH_AUTH_SOCK",
  ]

  for (const key of keys) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }

  if (!env.TERM) {
    env.TERM = "xterm-256color"
  }

  return env
}

let shpoolAvailable: boolean | null = null

function isShpoolAvailable(): boolean {
  return shpoolAvailable === true
}

// Starts shpool daemon if needed and returns existing clily-N session names.
// Sets shpoolAvailable as a side effect.
function initShpool(): string[] {
  try {
    let result = spawnSync("shpool", ["list"], { encoding: "utf8", timeout: 2000 })

    if (result.error) {
      shpoolAvailable = false
      return []
    }

    shpoolAvailable = true

    if (result.status !== 0) {
      const proc = spawnProcess("shpool", ["daemon"], { detached: true, stdio: "ignore" })
      proc.unref()
      spawnSync("sleep", ["0.5"])
      result = spawnSync("shpool", ["list"], { encoding: "utf8", timeout: 2000 })
      if (result.status !== 0 || !result.stdout) return []
    }

    return parseShpoolSessionNames(result.stdout ?? "")
  } catch {
    shpoolAvailable = false
    return []
  }
}

function generateShpoolSessionName(existing: string[]): string {
  const numbers = new Set(
    existing
      .map((name) => name.match(/^clily-(\d+)$/)?.[1])
      .filter((n): n is string => n !== undefined)
      .map((n) => parseInt(n, 10))
  )
  let n = 1
  while (numbers.has(n)) n++
  return `clily-${n}`
}

function parseShpoolSessionNames(stdout: string): string[] {
  return stdout
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name): name is string => !!name && /^clily-\d+$/.test(name))
}

function listShpoolSessions(): string[] {
  try {
    const result = spawnSync("shpool", ["list"], { encoding: "utf8", timeout: 2000 })
    if (result.error || result.status !== 0 || !result.stdout) return []
    return parseShpoolSessionNames(result.stdout)
  } catch {
    return []
  }
}

function spawnPtyAdapter(
  command: string,
  args: string[],
  cols: number,
  rows: number,
  debugMeta: Record<string, unknown>
): TerminalAdapter {
  const pty = spawnPty(command, args, {
    cols,
    rows,
    cwd: process.env.HOME ?? process.cwd(),
    env: buildTerminalEnv(),
  })

  logDebug("terminal adapter created", debugMeta)

  return {
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    onData: (listener) => {
      const disposable = pty.onData(listener)
      return () => disposable.dispose()
    },
    onExit: (listener) => {
      const disposable = pty.onExit(listener)
      return () => disposable.dispose()
    },
    kill: () => pty.kill(),
  }
}

function createShpoolTerminalAdapter(sessionName: string, cols = 120, rows = 40, force = false): TerminalAdapter {
  const args = force ? ["attach", "--force", sessionName] : ["attach", sessionName]
  return spawnPtyAdapter("shpool", args, cols, rows, { adapter: "shpool", sessionName })
}

function createTerminalAdapter(shell: string, cols = 120, rows = 40): TerminalAdapter {
  return spawnPtyAdapter(shell, ["-l"], cols, rows, { adapter: "node-pty", shell })
}

function createMockTerminalAdapter(): TerminalAdapter {
  const listeners = new Set<(data: string) => void>()
  const exitListeners = new Set<() => void>()

  const emit = (data: string) => {
    for (const listener of listeners) {
      listener(data)
    }
  }

  const emitExit = () => {
    for (const listener of exitListeners) {
      listener()
    }
    exitListeners.clear()
    listeners.clear()
  }

  return {
    write: (data) => {
      emit(data)
      if (data.includes("exit\r")) {
        queueMicrotask(() => {
          emitExit()
        })
      }
    },
    resize: () => {},
    onData: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onExit: (listener) => {
      exitListeners.add(listener)
      return () => exitListeners.delete(listener)
    },
    kill: () => {
      listeners.clear()
      exitListeners.clear()
    },
  }
}

function isE2EMockMode() {
  return process.env.TERMINAL_E2E_MODE === "mock"
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

const OSC_SEQUENCE_PATTERN = /(?:\u001b|\\)\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const DEVICE_ATTRIBUTES_REPLY_PATTERN = /(?:\u001b|\\)?\[[?>][0-9;]*c/g
const ZSH_PROMPT_WRAPPER_PATTERN = /%\{|%\}/g
// Strip \r\n immediately after clear-screen (home+erase): without this the cursor lands on
// line 2 before the first prompt, producing a blank line at the top of the terminal.
const CLEAR_SCREEN_NEWLINE_PATTERN = /(\u001b\[H\u001b\[J)\r?\n/g
const MAX_SANITIZE_CARRY_CHARS = 512

function sanitizeTerminalOutput(data: string) {
  const withoutControlReplies = data
    .replace(OSC_SEQUENCE_PATTERN, "")
    .replace(DEVICE_ATTRIBUTES_REPLY_PATTERN, "")
    .replace(ZSH_PROMPT_WRAPPER_PATTERN, "")
    .replace(CLEAR_SCREEN_NEWLINE_PATTERN, "$1")

  // JS \s matches \r\n, so use [^\r\n]* to avoid consuming the trailing \r of a PROMPT_CR sequence.
  return withoutControlReplies
    .replace(/(^|[\r\n])%[^\r\n]*(\r?\n|\r|$)/g, "$1")
    .replace(/^%[^\r\n]*$/g, "")
}

function extractSanitizeCarryTail(data: string) {
  const matches = [
    data.match(/(?:\u001b|\\)?\][^\u0007\u001b]*$/),
    data.match(/(?:\u001b|\\)?\[[?>][0-9;]*$/),
    data.match(/(^|[\r\n])%[^\r\n]*$/),
  ]

  let carryStart = -1
  for (const match of matches) {
    if (!match || typeof match.index !== "number") {
      continue
    }

    if (carryStart < 0 || match.index < carryStart) {
      carryStart = match.index
    }
  }

  if (carryStart < 0) {
    return { output: data, carry: "" }
  }

  const output = data.slice(0, carryStart)
  const carry = data.slice(carryStart).slice(-MAX_SANITIZE_CARRY_CHARS)
  return { output, carry }
}

function generateTerminalId() {
  return `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createTerminalRuntime(
  adapter?: TerminalAdapter,
  options?: CreateTerminalRuntimeOptions
): TerminalRuntime {
  const terminal =
    adapter ??
    (isE2EMockMode()
      ? createMockTerminalAdapter()
      : isShpoolAvailable()
        ? createShpoolTerminalAdapter(
            options?.sessionName ?? "clily-1",
            options?.initialCols,
            options?.initialRows,
            options?.force
          )
        : createTerminalAdapter(resolveShell(), options?.initialCols, options?.initialRows))
  const maxBacklogChars = options?.maxBacklogChars ?? MAX_BACKLOG_CHARS

  const backlog: string[] = []
  const subscribers = new Set<(data: string) => void>()
  const closeSubscribers = new Set<() => void>()
  let backlogChars = 0
  let lastCols = 120
  let lastRows = 40
  let sequenceQueue = Promise.resolve()
  let disposed = false
  let sanitizeCarry = ""

  const appendBacklog = (data: string) => {
    // Skip leading whitespace-only chunks (e.g. the bare \r\n a new zsh session emits)
    // so they don't appear as a blank line when the backlog is replayed.
    if (backlogChars === 0 && /^[\r\n\s]*$/.test(data)) {
      return
    }

    backlog.push(data)
    backlogChars += data.length

    while (backlogChars > maxBacklogChars && backlog.length > 0) {
      const removed = backlog.shift()
      if (!removed) {
        break
      }
      backlogChars -= removed.length
    }
  }

  const broadcast = (data: string) => {
    const chunk = `${sanitizeCarry}${data}`
    const sanitized = sanitizeTerminalOutput(chunk)
    const { output, carry } = extractSanitizeCarryTail(sanitized)
    sanitizeCarry = carry

    if (!output) {
      return
    }

    appendBacklog(output)

    for (const listener of subscribers) {
      listener(output)
    }
  }

  const unsubscribeData = terminal.onData((data) => {
    broadcast(data)
  })

  const notifyClosed = () => {
    for (const listener of closeSubscribers) {
      listener()
    }
    closeSubscribers.clear()
  }

  const unsubscribeExit = terminal.onExit?.(() => {
    if (!disposed) {
      notifyClosed()
      options?.onExit?.()
    }
  })

  return {
    writeText: (data) => {
      if (!disposed) {
        terminal.write(data)
      }
    },
    writeSpecial: (key) => {
      if (!disposed) {
        terminal.write(getMobileSpecialSequence(key))
      }
    },
    writeSequence: async (steps, options) => {
      if (disposed) {
        return
      }

      const stepDelayMs = options?.stepDelayMs ?? DEFAULT_SEQUENCE_STEP_DELAY_MS

      const run = async () => {
        for (let index = 0; index < steps.length; index += 1) {
          if (disposed) {
            return
          }

          const step = steps[index]
          if (step.sequence) {
            terminal.write(step.sequence)
          }

          if (index < steps.length - 1 && stepDelayMs > 0) {
            await sleep(stepDelayMs)
          }
        }
      }

      sequenceQueue = sequenceQueue.then(run)
      await sequenceQueue
    },
    resize: (cols, rows) => {
      if (disposed) {
        return
      }

      if (lastCols === cols && lastRows === rows) {
        return
      }

      lastCols = cols
      lastRows = rows
      terminal.resize(lastCols, lastRows)
    },
    subscribe: (listener) => {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
    subscribeClose: (listener) => {
      closeSubscribers.add(listener)
      return () => closeSubscribers.delete(listener)
    },
    getBacklogSnapshot: () => [...backlog],
    dispose: () => {
      if (disposed) {
        return
      }

      disposed = true
      notifyClosed()
      subscribers.clear()
      unsubscribeData()
      unsubscribeExit?.()
      terminal.kill()
    },
  }
}

export function createTerminalRuntimeManager(): TerminalRuntimeManager {
  const sessions = new Map<string, TerminalRuntime>()
  let defaultTerminalId: string | null = null

  const setDefaultFromExisting = () => {
    if (sessions.size === 0) {
      defaultTerminalId = null
      return
    }

    if (defaultTerminalId && sessions.has(defaultTerminalId)) {
      return
    }

    defaultTerminalId = sessions.keys().next().value ?? null
  }

  const handleSessionExit = (terminalId: string) => {
    if (!sessions.has(terminalId)) {
      return
    }

    sessions.delete(terminalId)
    setDefaultFromExisting()
  }

  const createSession = (initialCols?: number, initialRows?: number) => {
    const sessionName = isShpoolAvailable()
      ? generateShpoolSessionName([...sessions.keys()])
      : generateTerminalId()

    const runtime = createTerminalRuntime(undefined, {
      onExit: () => {
        handleSessionExit(sessionName)
      },
      initialCols,
      initialRows,
      sessionName,
    })

    sessions.set(sessionName, runtime)

    if (!defaultTerminalId) {
      defaultTerminalId = sessionName
    }

    return sessionName
  }

  if (!isE2EMockMode()) {
    for (const sessionName of initShpool()) {
      const runtime = createTerminalRuntime(undefined, {
        onExit: () => handleSessionExit(sessionName),
        sessionName,
      })
      sessions.set(sessionName, runtime)
    }
    if (sessions.size > 0) {
      defaultTerminalId = [...sessions.keys()].sort()[0]
    }
  }

  const ensureDefaultSession = () => {
    if (sessions.size > 0) {
      return
    }

    const terminalId = createSession()
    defaultTerminalId = terminalId
  }

  const listSessions = () => {
    ensureDefaultSession()
    return [...sessions.keys()].sort()
  }

  const getSessionRuntime = (terminalId?: string) => {
    if (terminalId) {
      return sessions.get(terminalId)
    }

    ensureDefaultSession()

    if (!defaultTerminalId) {
      return undefined
    }

    return sessions.get(defaultTerminalId)
  }

  const deleteSession = (terminalId: string) => {
    const runtime = sessions.get(terminalId)
    if (!runtime) {
      return
    }

    sessions.delete(terminalId)
    runtime.dispose()

    setDefaultFromExisting()
  }

  const reattachDisconnectedSessions = (): string[] => {
    if (!isShpoolAvailable()) return []

    const shpoolSessions = new Set(listShpoolSessions())
    const result: string[] = []

    for (const sessionName of [...sessions.keys()]) {
      if (!shpoolSessions.has(sessionName)) {
        sessions.get(sessionName)?.dispose()
        sessions.delete(sessionName)
      }
    }

    for (const sessionName of shpoolSessions) {
      if (sessions.has(sessionName)) continue
      const runtime = createTerminalRuntime(undefined, {
        onExit: () => handleSessionExit(sessionName),
        sessionName,
        force: true,
      })
      sessions.set(sessionName, runtime)
      result.push(sessionName)
    }

    setDefaultFromExisting()
    return result
  }

  ensureDefaultSession()

  return {
    createSession,
    listSessions,
    getSessionRuntime,
    deleteSession,
    getDefaultTerminalId: () => {
      ensureDefaultSession()
      return defaultTerminalId ?? undefined
    },
    reattachDisconnectedSessions,
  }
}

// Bump this whenever TerminalRuntimeManager's interface changes.
// getTerminalRuntime() compares against the cached version and recreates the
// singleton on mismatch — preventing stale hot-reload objects from being returned.
const RUNTIME_VERSION = "3"

declare global {
  var __clilyTerminalRuntimeManager: TerminalRuntimeManager | undefined
  var __clilyTerminalRuntimeManagerVersion: string | undefined
}

export function getTerminalRuntime(): TerminalRuntimeManager {
  if (
    !globalThis.__clilyTerminalRuntimeManager ||
    globalThis.__clilyTerminalRuntimeManagerVersion !== RUNTIME_VERSION
  ) {
    globalThis.__clilyTerminalRuntimeManager = createTerminalRuntimeManager()
    globalThis.__clilyTerminalRuntimeManagerVersion = RUNTIME_VERSION
  }

  return globalThis.__clilyTerminalRuntimeManager
}

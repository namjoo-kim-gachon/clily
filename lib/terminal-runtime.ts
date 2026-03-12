import { existsSync } from "node:fs"

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
  createSession: () => string
  listSessions: () => string[]
  getSessionRuntime: (terminalId?: string) => TerminalRuntime
  deleteSession: (terminalId: string) => void
  getDefaultTerminalId: () => string
}

type CreateTerminalRuntimeOptions = {
  maxBacklogChars?: number
  onExit?: () => void
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

function createTerminalAdapter(shell: string): TerminalAdapter {
  const pty = spawnPty(shell, [], {
    cols: 120,
    rows: 40,
    cwd: process.cwd(),
    env: process.env,
  })

  logDebug("terminal adapter created", { adapter: "node-pty", shell })

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

const OSC_COLOR_REPLY_PATTERN = /(?:\u001b|\\)?\](?:10|11|12);rgb:[0-9a-fA-F/]+(?:\u0007|\u001b\\)?/g
const DEVICE_ATTRIBUTES_REPLY_PATTERN = /(?:\u001b|\\)?\[[?>][0-9;]*c/g
const ZSH_PROMPT_WRAPPER_PATTERN = /%\{|%\}/g
const STRAY_PROMPT_PERCENT_LINE_PATTERN = /(^|\n)%\s*(\r?\n)/g

function sanitizeTerminalOutput(data: string) {
  return data
    .replace(OSC_COLOR_REPLY_PATTERN, "")
    .replace(DEVICE_ATTRIBUTES_REPLY_PATTERN, "")
    .replace(ZSH_PROMPT_WRAPPER_PATTERN, "")
    .replace(STRAY_PROMPT_PERCENT_LINE_PATTERN, "$1")
}

function generateTerminalId() {
  return `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createTerminalRuntime(
  adapter?: TerminalAdapter,
  options?: CreateTerminalRuntimeOptions
): TerminalRuntime {
  const terminal = adapter ?? (isE2EMockMode() ? createMockTerminalAdapter() : createTerminalAdapter(resolveShell()))
  const maxBacklogChars = options?.maxBacklogChars ?? MAX_BACKLOG_CHARS

  const backlog: string[] = []
  const subscribers = new Set<(data: string) => void>()
  const closeSubscribers = new Set<() => void>()
  let backlogChars = 0
  let lastCols = 120
  let lastRows = 40
  let sequenceQueue = Promise.resolve()
  let disposed = false

  const appendBacklog = (data: string) => {
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
    const sanitized = sanitizeTerminalOutput(data)
    if (!sanitized) {
      return
    }

    appendBacklog(sanitized)

    for (const listener of subscribers) {
      listener(sanitized)
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

  const ensureDefaultSession = () => {
    if (sessions.size > 0) {
      return
    }

    const terminalId = createSession()
    defaultTerminalId = terminalId
  }

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
    ensureDefaultSession()
  }

  const createSession = () => {
    const terminalId = generateTerminalId()
    const runtime = createTerminalRuntime(undefined, {
      onExit: () => {
        handleSessionExit(terminalId)
      },
    })

    sessions.set(terminalId, runtime)

    if (!defaultTerminalId) {
      defaultTerminalId = terminalId
    }

    return terminalId
  }

  const listSessions = () => {
    ensureDefaultSession()
    return [...sessions.keys()]
  }

  const getSessionRuntime = (terminalId?: string) => {
    ensureDefaultSession()

    if (terminalId && sessions.has(terminalId)) {
      return sessions.get(terminalId) as TerminalRuntime
    }

    const fallbackId = defaultTerminalId ?? sessions.keys().next().value
    return sessions.get(fallbackId as string) as TerminalRuntime
  }

  const deleteSession = (terminalId: string) => {
    const runtime = sessions.get(terminalId)
    if (!runtime) {
      return
    }

    sessions.delete(terminalId)
    runtime.dispose()

    setDefaultFromExisting()
    ensureDefaultSession()
  }

  ensureDefaultSession()

  return {
    createSession,
    listSessions,
    getSessionRuntime,
    deleteSession,
    getDefaultTerminalId: () => {
      ensureDefaultSession()
      return defaultTerminalId as string
    },
  }
}

declare global {
  var __clilyTerminalRuntimeManager: TerminalRuntimeManager | undefined
}

export function getTerminalRuntime(): TerminalRuntimeManager {
  if (!globalThis.__clilyTerminalRuntimeManager) {
    globalThis.__clilyTerminalRuntimeManager = createTerminalRuntimeManager()
  }

  return globalThis.__clilyTerminalRuntimeManager
}

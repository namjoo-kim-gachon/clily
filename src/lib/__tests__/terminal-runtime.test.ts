// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

import { createTerminalRuntime, createTerminalRuntimeManager } from "@/lib/terminal-runtime"

type TestAdapter = {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  onData: (listener: (data: string) => void) => () => void
  onExit: (listener: () => void) => () => void
  kill: () => void
}

function createTestAdapter() {
  const listeners = new Set<(data: string) => void>()
  const exitListeners = new Set<() => void>()
  const writes: string[] = []
  const resizes: Array<{ cols: number; rows: number }> = []

  const adapter: TestAdapter = {
    write: (data) => {
      writes.push(data)
    },
    resize: (cols, rows) => {
      resizes.push({ cols, rows })
    },
    onData: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onExit: (listener) => {
      exitListeners.add(listener)
      return () => exitListeners.delete(listener)
    },
    kill: () => {},
  }

  const emit = (data: string) => {
    for (const listener of listeners) {
      listener(data)
    }
  }

  const emitExit = () => {
    for (const listener of exitListeners) {
      listener()
    }
  }

  return { adapter, writes, resizes, emit, emitExit }
}

describe("createTerminalRuntime", () => {
  it("forwards text/special input and resize to the adapter", () => {
    const { adapter, writes, resizes } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)

    runtime.writeText("ls\n")
    runtime.writeSpecial("arrow-up")
    runtime.resize(121, 40)

    expect(writes).toEqual(["ls\n", "\u001b[A"])
    expect(resizes).toEqual([{ cols: 121, rows: 40 }])
  })

  it("ensures writeSequence step order and 80ms delay", async () => {
    vi.useFakeTimers()

    try {
      const { adapter, writes } = createTestAdapter()
      const runtime = createTerminalRuntime(adapter)

      const pending = runtime.writeSequence(
        [
          { kind: "chord", tokens: ["ctrl", "1"], sequence: "1" },
          { kind: "single", tokens: ["b"], sequence: "b" },
        ],
        { stepDelayMs: 80 }
      )

      await Promise.resolve()
      expect(writes).toEqual(["1"])

      await vi.advanceTimersByTimeAsync(79)
      expect(writes).toEqual(["1"])

      await vi.advanceTimersByTimeAsync(1)
      expect(writes).toEqual(["1", "b"])

      await pending
    } finally {
      vi.useRealTimers()
    }
  })

  it("serializes writeSequence through the internal queue", async () => {
    vi.useFakeTimers()

    try {
      const { adapter, writes } = createTestAdapter()
      const runtime = createTerminalRuntime(adapter)

      const first = runtime.writeSequence(
        [
          { kind: "single", tokens: ["a"], sequence: "a" },
          { kind: "single", tokens: ["b"], sequence: "b" },
        ],
        { stepDelayMs: 80 }
      )
      const second = runtime.writeSequence([{ kind: "single", tokens: ["c"], sequence: "c" }], { stepDelayMs: 80 })

      await Promise.resolve()
      expect(writes).toEqual(["a"])

      await vi.advanceTimersByTimeAsync(80)
      expect(writes).toEqual(["a", "b", "c"])

      await Promise.all([first, second])
    } finally {
      vi.useRealTimers()
    }
  })

  it("fans out output through subscribe", () => {
    const { adapter, emit } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)

    const a: string[] = []
    const b: string[] = []

    const unsubA = runtime.subscribe((chunk) => a.push(chunk))
    runtime.subscribe((chunk) => b.push(chunk))

    emit("hello")
    unsubA()
    emit("world")

    expect(a).toEqual(["hello"])
    expect(b).toEqual(["hello", "world"])
  })

  it("accumulates backlog snapshots", () => {
    const { adapter, emit } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)

    emit("chunk-1")
    emit("chunk-2")

    expect(runtime.getBacklogSnapshot()).toEqual(["chunk-1", "chunk-2"])
  })

  it("strips stray % prompt noise across newline variants", () => {
    const { adapter, emit } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)

    const chunks: string[] = []
    runtime.subscribe((chunk) => chunks.push(chunk))

    emit("first\n%\nsecond")
    emit("third\r%\r\nfourth")
    emit("%")

    expect(chunks).toEqual(["first\nsecond", "third\rfourth"])
    expect(runtime.getBacklogSnapshot()).toEqual(["first\nsecond", "third\rfourth"])
  })

  it("strips split OSC color replies across multiple chunks", () => {
    const { adapter, emit } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)

    const chunks: string[] = []
    runtime.subscribe((chunk) => chunks.push(chunk))

    emit("before\u001b]10;rgb:aa")
    emit("/bb")
    emit("/cc\u0007after")

    expect(chunks).toEqual(["before", "after"])
    expect(runtime.getBacklogSnapshot()).toEqual(["before", "after"])
  })

  it("strips split generic OSC sequences across multiple chunks", () => {
    const { adapter, emit } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)

    const chunks: string[] = []
    runtime.subscribe((chunk) => chunks.push(chunk))

    emit("before\u001b]633;P;IsWindows=False")
    emit("\u0007after")

    expect(chunks).toEqual(["before", "after"])
    expect(runtime.getBacklogSnapshot()).toEqual(["before", "after"])
  })

  it("preserves ANSI CSI color/style sequences", () => {
    const { adapter, emit } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)

    const chunks: string[] = []
    runtime.subscribe((chunk) => chunks.push(chunk))

    emit("\u001b[31mred\u001b[0m")
    emit("\u001b[1mbold\u001b[22m")

    expect(chunks).toEqual(["\u001b[31mred\u001b[0m", "\u001b[1mbold\u001b[22m"])
    expect(runtime.getBacklogSnapshot()).toEqual(["\u001b[31mred\u001b[0m", "\u001b[1mbold\u001b[22m"])
  })

  it("strips stray percent lines when percent and newline are split", () => {
    const { adapter, emit } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)

    const chunks: string[] = []
    runtime.subscribe((chunk) => chunks.push(chunk))

    emit("alpha\n%")
    emit("\nbeta")

    expect(chunks).toEqual(["alpha\n", "\nbeta"])
    expect(runtime.getBacklogSnapshot()).toEqual(["alpha\n", "\nbeta"])
  })

  it("does not over-strip normal percent content", () => {
    const { adapter, emit } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)

    const chunks: string[] = []
    runtime.subscribe((chunk) => chunks.push(chunk))

    emit("progress 100% complete")
    emit("\npath%value")

    expect(chunks).toEqual(["progress 100% complete", "\npath%value"])
    expect(runtime.getBacklogSnapshot()).toEqual(["progress 100% complete", "\npath%value"])
  })

  it("calls close subscribers when onExit occurs", () => {
    const { adapter, emitExit } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)
    const onClose = vi.fn()

    runtime.subscribeClose(onClose)
    emitExit()

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("createTerminalRuntimeManager", () => {
  it("guarantees at least one session in the initial state", () => {
    const manager = createTerminalRuntimeManager()

    const sessions = manager.listSessions()
    expect(sessions.length).toBe(1)
    expect(manager.getDefaultTerminalId()).toBe(sessions[0])
  })

  it("adds a session with createSession", () => {
    const manager = createTerminalRuntimeManager()
    const first = manager.listSessions()

    const created = manager.createSession()
    const sessions = manager.listSessions()

    expect(sessions).toContain(created)
    expect(sessions.length).toBe(first.length + 1)
  })

  it("keeps at least one session after deleting the last one", () => {
    const manager = createTerminalRuntimeManager()
    const [only] = manager.listSessions()

    manager.deleteSession(only)

    const sessions = manager.listSessions()
    expect(sessions.length).toBe(1)
  })
})

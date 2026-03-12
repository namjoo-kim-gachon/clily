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
  it("text/special 입력과 resize를 어댑터로 전달한다", () => {
    const { adapter, writes, resizes } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)

    runtime.writeText("ls\n")
    runtime.writeSpecial("arrow-up")
    runtime.resize(121, 40)

    expect(writes).toEqual(["ls\n", "\u001b[A"])
    expect(resizes).toEqual([{ cols: 121, rows: 40 }])
  })

  it("writeSequence가 step 순서와 80ms 지연을 보장한다", async () => {
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

  it("writeSequence는 내부 큐로 직렬 실행된다", async () => {
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

  it("subscribe로 output fan-out을 수행한다", () => {
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

  it("backlog snapshot을 누적한다", () => {
    const { adapter, emit } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)

    emit("chunk-1")
    emit("chunk-2")

    expect(runtime.getBacklogSnapshot()).toEqual(["chunk-1", "chunk-2"])
  })

  it("onExit이 발생하면 close 구독자가 호출된다", () => {
    const { adapter, emitExit } = createTestAdapter()
    const runtime = createTerminalRuntime(adapter)
    const onClose = vi.fn()

    runtime.subscribeClose(onClose)
    emitExit()

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("createTerminalRuntimeManager", () => {
  it("초기 상태에 최소 1개 세션을 보장한다", () => {
    const manager = createTerminalRuntimeManager()

    const sessions = manager.listSessions()
    expect(sessions.length).toBe(1)
    expect(manager.getDefaultTerminalId()).toBe(sessions[0])
  })

  it("createSession은 세션을 추가한다", () => {
    const manager = createTerminalRuntimeManager()
    const first = manager.listSessions()

    const created = manager.createSession()
    const sessions = manager.listSessions()

    expect(sessions).toContain(created)
    expect(sessions.length).toBe(first.length + 1)
  })

  it("deleteSession으로 마지막 세션을 삭제해도 최소 1개를 유지한다", () => {
    const manager = createTerminalRuntimeManager()
    const [only] = manager.listSessions()

    manager.deleteSession(only)

    const sessions = manager.listSessions()
    expect(sessions.length).toBe(1)
  })
})

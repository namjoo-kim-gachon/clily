"use client"

import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react"

import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"

import { MobileSpecialKeys } from "@/components/terminal/mobile-special-keys"
import { Button } from "@/components/ui/button"
import { type MobileSpecialKey } from "@/lib/terminal-protocol"

type ClientServerMessage = { type: "terminal.output"; data: string } | { type: "terminal.closed" }

type SessionsResponse = {
  terminalIds: string[]
  defaultTerminalId?: string
}

type CreateSessionResponse = {
  terminalId: string
}

const DEBUG_MODE = process.env.NEXT_PUBLIC_TERMINAL_DEBUG === "1"
const SPECIAL_INPUT_PRESETS = ["tab", "shift+tab", "esc", "shift", "ctrl", "alt", "backspace", "ctrl+b"] as const
const SWIPE_THRESHOLD_PX = 40

function logDebug(message: string, meta?: Record<string, unknown>) {
  if (!DEBUG_MODE) {
    return
  }

  const suffix = meta ? ` ${JSON.stringify(meta)}` : ""
  console.log(`[terminal-viewer][debug] ${message}${suffix}`)
}

function pickNextActive(
  ids: string[],
  previousActive: string | null,
  preferredActive?: string | null,
  defaultTerminalId?: string
) {
  if (preferredActive && ids.includes(preferredActive)) {
    return preferredActive
  }

  if (previousActive && ids.includes(previousActive)) {
    return previousActive
  }

  if (defaultTerminalId && ids.includes(defaultTerminalId)) {
    return defaultTerminalId
  }

  return ids[0] ?? null
}

export function TerminalViewer() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const specialExpressionRef = useRef<HTMLInputElement | null>(null)
  const specialPresetRef = useRef<HTMLSelectElement | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [specialExpression, setSpecialExpression] = useState("")
  const [terminalIds, setTerminalIds] = useState<string[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [isTouchDevice] = useState(() => {
    if (typeof window === "undefined") {
      return false
    }

    const coarseMatch = window.matchMedia("(pointer: coarse)").matches
    return coarseMatch || navigator.maxTouchPoints > 0
  })
  const [isSessionReady, setIsSessionReady] = useState(false)

  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const postJson = useCallback(async (url: string, payload: unknown) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      logDebug("post failed", { url, status: response.status })
    }
  }, [])

  const fetchSessions = useCallback(async (preferredActive?: string | null) => {
    const response = await fetch("/api/terminal/sessions", { cache: "no-store" })
    if (!response.ok) {
      logDebug("sessions fetch failed", { status: response.status })
      setIsSessionReady(true)
      return
    }

    const payload = (await response.json()) as SessionsResponse
    setTerminalIds(payload.terminalIds)
    setActiveTerminalId((previousActive) =>
      pickNextActive(payload.terminalIds, previousActive, preferredActive, payload.defaultTerminalId)
    )
    setIsSessionReady(true)
  }, [])

  const sendInput = useCallback(
    async (data: string) => {
      await postJson("/api/terminal/input/text", { data, terminalId: activeTerminalId ?? undefined })
    },
    [activeTerminalId, postJson]
  )

  const sendSpecial = useCallback(
    async (key: MobileSpecialKey) => {
      await postJson("/api/terminal/input/special", { key, terminalId: activeTerminalId ?? undefined })
    },
    [activeTerminalId, postJson]
  )

  const sendSequence = useCallback(
    async (expression: string) => {
      await postJson("/api/terminal/input/sequence", { expression, terminalId: activeTerminalId ?? undefined })
    },
    [activeTerminalId, postJson]
  )

  const sendResize = useCallback(
    async (cols: number, rows: number) => {
      await postJson("/api/terminal/resize", { cols, rows, terminalId: activeTerminalId ?? undefined })
    },
    [activeTerminalId, postJson]
  )

  const switchTerminalByOffset = useCallback(
    (offset: number) => {
      if (terminalIds.length < 2 || !activeTerminalId) {
        return
      }

      const currentIndex = terminalIds.indexOf(activeTerminalId)
      if (currentIndex < 0) {
        return
      }

      const nextIndex = (currentIndex + offset + terminalIds.length) % terminalIds.length
      setActiveTerminalId(terminalIds[nextIndex])
    },
    [activeTerminalId, terminalIds]
  )

  const createTerminal = useCallback(async () => {
    const response = await fetch("/api/terminal/create", { method: "POST" })
    if (!response.ok) {
      logDebug("create session failed", { status: response.status })
      return
    }

    const payload = (await response.json()) as CreateSessionResponse

    setTerminalIds((previous) => {
      if (previous.includes(payload.terminalId)) {
        return previous
      }
      return [...previous, payload.terminalId]
    })
    setActiveTerminalId(payload.terminalId)
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchSessions()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [fetchSessions])

  useEffect(() => {
    if (!containerRef.current || !activeTerminalId || !isSessionReady) {
      return
    }

    const terminal = new Terminal({
      cursorBlink: true,
      scrollback: 200000,
      convertEol: true,
      fontSize: 14,
      theme: {
        background: "#000000",
      },
    })

    const fitAddon = new FitAddon()

    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)
    fitAddon.fit()

    const eventSource = new EventSource(`/api/terminal/stream?terminalId=${encodeURIComponent(activeTerminalId)}`)
    eventSourceRef.current = eventSource

    logDebug("connect eventsource", { url: "/api/terminal/stream", terminalId: activeTerminalId })

    eventSource.addEventListener("open", async () => {
      logDebug("eventsource opened", { terminalId: activeTerminalId })
      await sendResize(terminal.cols, terminal.rows)
    })

    eventSource.addEventListener("output", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as ClientServerMessage

        if (parsed.type === "terminal.output") {
          terminal.write(parsed.data)
        }
      } catch {
        logDebug("ignore invalid output event")
      }
    })

    eventSource.addEventListener("closed", () => {
      setTerminalIds((previous) => {
        const currentIndex = previous.indexOf(activeTerminalId)
        if (currentIndex < 0) {
          return previous
        }

        const next = previous.filter((id) => id !== activeTerminalId)
        const nextActive = next[currentIndex] ?? next[currentIndex - 1] ?? null
        setActiveTerminalId(nextActive)
        return next
      })

      void fetchSessions()
    })

    eventSource.addEventListener("error", () => {
      logDebug("eventsource error", { terminalId: activeTerminalId })
    })

    const terminalInputDisposable = terminal.onData((data) => {
      void sendInput(data)
    })

    const onResize = () => {
      fitAddon.fit()
      void sendResize(terminal.cols, terminal.rows)
    }

    window.addEventListener("resize", onResize)

    onResize()

    return () => {
      window.removeEventListener("resize", onResize)
      terminalInputDisposable.dispose()
      eventSource.close()
      terminal.dispose()
      eventSourceRef.current = null
      logDebug("eventsource closed", { terminalId: activeTerminalId })
    }
  }, [activeTerminalId, fetchSessions, isSessionReady, sendInput, sendResize])

  const onSubmit = useCallback<NonNullable<ComponentProps<"form">["onSubmit"]>>(
    (event) => {
      event.preventDefault()
      if (!inputValue) {
        return
      }
      void sendInput(`${inputValue}\r`)
      setInputValue("")
    },
    [inputValue, sendInput]
  )

  const onSpecialSubmit = useCallback<NonNullable<ComponentProps<"form">["onSubmit"]>>(
    (event) => {
      event.preventDefault()
      const expressionFromInput = specialExpressionRef.current?.value.trim() ?? ""
      const selectedPreset = specialPresetRef.current?.value.trim() ?? ""
      const expression = expressionFromInput || selectedPreset
      if (!expression) {
        return
      }
      void sendSequence(expression)
      setSpecialExpression("")
      if (specialPresetRef.current) {
        specialPresetRef.current.value = ""
      }
      if (specialExpressionRef.current) {
        specialExpressionRef.current.value = ""
      }
    },
    [sendSequence]
  )

  const currentIndex = activeTerminalId ? terminalIds.indexOf(activeTerminalId) : -1

  return (
    <div
      data-testid="terminal-page"
      className="grid h-svh w-full grid-rows-[auto_minmax(0,1fr)_auto_auto_auto] gap-2 px-[max(0.5rem,env(safe-area-inset-left))] pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="terminal-active-label">
          {currentIndex >= 0 ? `Terminal ${currentIndex + 1} / ${terminalIds.length}` : "Terminal"}
        </p>
        <div className="flex items-center gap-2">
          {!isTouchDevice && terminalIds.length > 1 ? (
            <>
              <button
                type="button"
                data-testid="terminal-nav-prev"
                aria-label="이전 터미널"
                className="h-9 w-9 rounded-md border border-border/80 bg-background/80 text-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                onClick={() => switchTerminalByOffset(-1)}
              >
                ←
              </button>
              <button
                type="button"
                data-testid="terminal-nav-next"
                aria-label="다음 터미널"
                className="h-9 w-9 rounded-md border border-border/80 bg-background/80 text-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                onClick={() => switchTerminalByOffset(1)}
              >
                →
              </button>
            </>
          ) : null}
          <Button
            type="button"
            data-testid="terminal-add"
            aria-label="terminal-add"
            onClick={() => void createTerminal()}
            className="h-9 min-w-9 px-3"
          >
            +
          </Button>
        </div>
      </div>

      <div
        data-testid="terminal-viewport-shell"
        className="relative min-h-0 overflow-hidden rounded-xl border border-border/80 bg-black shadow-[0_0_0_1px_var(--color-border)]"
        onTouchStart={(event) => {
          const touch = event.touches[0]
          touchStartRef.current = { x: touch.clientX, y: touch.clientY }
        }}
        onTouchEnd={(event) => {
          if (!touchStartRef.current) {
            return
          }

          const touch = event.changedTouches[0]
          const deltaX = touch.clientX - touchStartRef.current.x
          const deltaY = touch.clientY - touchStartRef.current.y

          touchStartRef.current = null

          if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) {
            return
          }

          if (Math.abs(deltaX) <= Math.abs(deltaY)) {
            return
          }

          if (deltaX < 0) {
            switchTerminalByOffset(1)
            return
          }

          switchTerminalByOffset(-1)
        }}
      >
        <div data-testid="terminal-viewport" ref={containerRef} className="h-full w-full" />
      </div>

      <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <input
          data-testid="terminal-input"
          aria-label="terminal-input"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="명령 입력 후 Enter"
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <Button
          data-testid="terminal-submit"
          aria-label="terminal-submit"
          type="submit"
          className="h-11 w-full px-4 sm:w-auto sm:min-w-20"
        >
          Enter
        </Button>
      </form>

      <form onSubmit={onSpecialSubmit} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-center">
        <input
          data-testid="terminal-special-expression"
          aria-label="terminal-special-expression"
          ref={specialExpressionRef}
          value={specialExpression}
          onChange={(event) => setSpecialExpression(event.target.value)}
          placeholder="예: ctrl + 1 b"
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <select
          data-testid="terminal-special-preset"
          aria-label="terminal-special-preset"
          ref={specialPresetRef}
          className="h-11 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          defaultValue=""
          onChange={(event) => {
            const value = event.target.value
            setSpecialExpression(value)
          }}
        >
          <option value="">특수 입력 선택</option>
          {SPECIAL_INPUT_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
        <Button
          data-testid="terminal-special-submit"
          aria-label="terminal-special-submit"
          type="submit"
          className="h-11 w-full px-4 sm:w-auto sm:min-w-24"
        >
          특수 실행
        </Button>
      </form>

      <MobileSpecialKeys onSendKeyAction={(key) => void sendSpecial(key)} />
    </div>
  )
}

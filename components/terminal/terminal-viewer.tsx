"use client"

import {
  type ComponentProps,
  type RefObject,
  startTransition,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react"

import "@xterm/xterm/css/xterm.css"

import { Button } from "@/components/ui/button"

type ClientServerMessage = { type: "terminal.output"; data: string } | { type: "terminal.closed" }

type SessionsResponse = {
  terminalIds: string[]
  defaultTerminalId?: string
}

type CreateSessionResponse = {
  terminalId: string
}

const DEBUG_MODE = process.env.NEXT_PUBLIC_TERMINAL_DEBUG === "1"
const SPECIAL_INPUT_PRESETS = [
  "ESC",
  "TAB",
  "SHIFT+TAB",
  "ENTER",
  "CTRL+C",  
  "ARROW-UP",
  "ARROW-DOWN",
  "ARROW-LEFT",
  "ARROW-RIGHT",
  "BACKSPACE",
  "CTRL+B",  
  "SHIFT",
  "CTRL",
  "ALT",
] as const
const SWIPE_THRESHOLD_PX = 40
const LAST_MANUAL_SHORTCUT_STORAGE_KEY = "terminal:last-manual-shortcut"

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

type TerminalSessionsState = {
  terminalIds: string[]
  activeTerminalId: string | null
  isSessionReady: boolean
}

type ShortcutInputState = {
  expression: string
  isDropdownOpen: boolean
  isExpressionManual: boolean
}

type ShortcutInputAction =
  | { type: "expressionChanged"; payload: { expression: string } }
  | { type: "presetSelected"; payload: { expression: string } }
  | { type: "dropdownOpened" }
  | { type: "dropdownClosed" }
  | { type: "dropdownToggled" }
  | { type: "expressionCleared" }

function shortcutInputReducer(state: ShortcutInputState, action: ShortcutInputAction): ShortcutInputState {
  switch (action.type) {
    case "expressionChanged":
      return {
        ...state,
        expression: action.payload.expression,
        isExpressionManual: true,
      }
    case "presetSelected":
      return {
        ...state,
        expression: action.payload.expression,
        isExpressionManual: false,
      }
    case "dropdownOpened":
      return {
        ...state,
        isDropdownOpen: true,
      }
    case "dropdownClosed":
      return {
        ...state,
        isDropdownOpen: false,
      }
    case "dropdownToggled":
      return {
        ...state,
        isDropdownOpen: !state.isDropdownOpen,
      }
    case "expressionCleared":
      return {
        expression: "",
        isDropdownOpen: false,
        isExpressionManual: false,
      }
    default:
      return state
  }
}

type TerminalSessionsAction =
  | {
      type: "sessionsSynced"
      payload: {
        terminalIds: string[]
        preferredActive?: string | null
        defaultTerminalId?: string
      }
    }
  | { type: "sessionsFailed" }
  | { type: "terminalCreated"; payload: { terminalId: string } }
  | { type: "activeTerminalChanged"; payload: { terminalId: string | null } }
  | { type: "activeTerminalRemoved"; payload: { terminalId: string } }

function terminalSessionsReducer(state: TerminalSessionsState, action: TerminalSessionsAction): TerminalSessionsState {
  switch (action.type) {
    case "sessionsSynced": {
      const nextActive = pickNextActive(
        action.payload.terminalIds,
        state.activeTerminalId,
        action.payload.preferredActive,
        action.payload.defaultTerminalId
      )

      return {
        terminalIds: action.payload.terminalIds,
        activeTerminalId: nextActive,
        isSessionReady: true,
      }
    }
    case "sessionsFailed":
      return {
        ...state,
        isSessionReady: true,
      }
    case "terminalCreated": {
      const nextIds = state.terminalIds.includes(action.payload.terminalId)
        ? state.terminalIds
        : [...state.terminalIds, action.payload.terminalId]

      return {
        ...state,
        terminalIds: nextIds,
        activeTerminalId: action.payload.terminalId,
      }
    }
    case "activeTerminalChanged":
      return {
        ...state,
        activeTerminalId: action.payload.terminalId,
      }
    case "activeTerminalRemoved": {
      const currentIndex = state.terminalIds.indexOf(action.payload.terminalId)
      if (currentIndex < 0) {
        return state
      }

      const nextIds = state.terminalIds.filter((id) => id !== action.payload.terminalId)
      const nextActive = nextIds[currentIndex] ?? nextIds[currentIndex - 1] ?? null

      return {
        ...state,
        terminalIds: nextIds,
        activeTerminalId: nextActive,
      }
    }
    default:
      return state
  }
}

type TerminalHeaderProps = {
  terminalIds: string[]
  activeTerminalId: string | null
  isCreatingTerminal: boolean
  onSwitchOffset: (offset: number) => void
  onCreateTerminal: () => void
}

function TerminalHeader({
  terminalIds,
  activeTerminalId,
  isCreatingTerminal,
  onSwitchOffset,
  onCreateTerminal,
}: TerminalHeaderProps) {
  const currentIndex = activeTerminalId ? terminalIds.indexOf(activeTerminalId) : -1

  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground" data-testid="terminal-active-label">
        {currentIndex >= 0 ? `Terminal ${currentIndex + 1} / ${terminalIds.length}` : "Terminal"}
      </p>
      <div className="flex items-center gap-2">
        {terminalIds.length > 1 ? (
          <>
            <Button
              type="button"
              variant="outline"
              data-testid="terminal-nav-prev"
              aria-label="Previous terminal"
              className="h-9 w-9 px-0 text-base font-semibold"
              onClick={() => onSwitchOffset(-1)}
            >
              ‹
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="terminal-nav-next"
              aria-label="Next terminal"
              className="h-9 w-9 px-0 text-base font-semibold"
              onClick={() => onSwitchOffset(1)}
            >
              ›
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="outline"
          data-testid="terminal-add"
          aria-label="terminal-add"
          onClick={onCreateTerminal}
          disabled={isCreatingTerminal}
          className="h-9 min-w-9 px-3"
        >
          {isCreatingTerminal ? "…" : "+"}
        </Button>
      </div>
    </div>
  )
}

type TerminalViewportProps = {
  terminalShellRef: RefObject<HTMLDivElement | null>
  containerRef: RefObject<HTMLDivElement | null>
}

function TerminalViewport({ terminalShellRef, containerRef }: TerminalViewportProps) {
  return (
    <div
      ref={terminalShellRef}
      data-testid="terminal-viewport-shell"
      className="relative min-h-0 overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_0_0_1px_var(--color-border)]"
    >
      <div className="h-full p-2">
        <div data-testid="terminal-viewport" ref={containerRef} className="h-full w-full overflow-hidden bg-black" />
      </div>
    </div>
  )
}

type TerminalCommandInputFormProps = {
  inputValue: string
  onInputValueChange: (value: string) => void
  onSubmit: NonNullable<ComponentProps<"form">["onSubmit"]>
}

function TerminalCommandInputForm({ inputValue, onInputValueChange, onSubmit }: TerminalCommandInputFormProps) {
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <input
        data-testid="terminal-input"
        aria-label="terminal-input"
        value={inputValue}
        onChange={(event) => onInputValueChange(event.target.value)}
        placeholder="Type a command and press Enter"
        className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <Button
        variant="outline"
        data-testid="terminal-submit"
        aria-label="terminal-submit"
        type="submit"
        className="h-11 w-11 px-0 text-base"
      >
        ↵
      </Button>
    </form>
  )
}

type TerminalShortcutFormProps = {
  expression: string
  isDropdownOpen: boolean
  onExpressionChange: (expression: string) => void
  onToggleDropdown: () => void
  onSubmit: NonNullable<ComponentProps<"form">["onSubmit"]>
  onSelectPreset: (preset: string) => void
  manualShortcutPreset: string | null
}

function TerminalShortcutForm({
  expression,
  isDropdownOpen,
  onExpressionChange,
  onToggleDropdown,
  onSubmit,
  onSelectPreset,
  manualShortcutPreset,
}: TerminalShortcutFormProps) {
  const filteredBuiltInPresets = SPECIAL_INPUT_PRESETS.filter((preset) =>
    preset.toLowerCase().includes(expression.trim().toLowerCase())
  )
  const filteredPresets =
    manualShortcutPreset && manualShortcutPreset.toLowerCase().includes(expression.trim().toLowerCase())
      ? [
          manualShortcutPreset,
          ...filteredBuiltInPresets.filter((preset) => preset.toLowerCase() !== manualShortcutPreset.toLowerCase()),
        ]
      : filteredBuiltInPresets

  const blurActiveElement = () => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) {
      activeElement.blur()
    }
  }

  const handleTogglePress = () => {
    blurActiveElement()
    onToggleDropdown()
  }

  const handlePresetPress = (preset: string) => {
    blurActiveElement()
    onSelectPreset(preset)
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2">
      <div className="relative col-span-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
        <Button
          type="button"
          variant="outline"
          data-testid="terminal-special-toggle"
          aria-label="Toggle shortcut list"
          className="h-11 min-w-11 px-0 text-base"
          onClick={handleTogglePress}
        >
          {isDropdownOpen ? "▴" : "▾"}
        </Button>
        <input
          data-testid="terminal-special-preset"
          aria-label="terminal-special-preset"
          value={expression}
          onChange={(event) => onExpressionChange(event.target.value)}
          placeholder="Select or type a shortcut (e.g., Ctrl+B D)"
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        {isDropdownOpen ? (
          <div
            data-testid="terminal-special-dropdown"
            className="absolute bottom-[calc(100%+0.25rem)] left-0 z-20 max-h-52 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
          >
            {filteredPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                className="w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() => handlePresetPress(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Button
        variant="outline"
        data-testid="terminal-special-submit"
        aria-label="terminal-special-submit"
        type="submit"
        className="h-11 w-11 px-0 text-base"
      >
        ⚡
      </Button>
    </form>
  )
}

type UseShortcutHandlersParams = {
  dispatchShortcut: (action: ShortcutInputAction) => void
  expression: string
  isExpressionManual: boolean
  sendSequence: (expression: string) => Promise<void>
  onManualExpressionSubmitted: (expression: string) => void
}

function useShortcutHandlers({
  dispatchShortcut,
  expression,
  isExpressionManual,
  sendSequence,
  onManualExpressionSubmitted,
}: UseShortcutHandlersParams) {
  const resetShortcutInput = useCallback(() => {
    dispatchShortcut({ type: "expressionCleared" })
  }, [dispatchShortcut])

  const onSelectPreset = useCallback(
    (preset: string) => {
      dispatchShortcut({ type: "presetSelected", payload: { expression: preset } })
      dispatchShortcut({ type: "dropdownClosed" })
    },
    [dispatchShortcut]
  )

  const onSpecialSubmit = useCallback<NonNullable<ComponentProps<"form">["onSubmit"]>>(
    (event) => {
      event.preventDefault()
      const trimmedExpression = expression.trim()
      if (!trimmedExpression) {
        return
      }
      if (isExpressionManual) {
        onManualExpressionSubmitted(trimmedExpression)
      }
      void sendSequence(trimmedExpression)
      resetShortcutInput()
    },
    [expression, isExpressionManual, onManualExpressionSubmitted, resetShortcutInput, sendSequence]
  )

  const onExpressionChange = useCallback(
    (nextExpression: string) => {
      dispatchShortcut({ type: "expressionChanged", payload: { expression: nextExpression } })
    },
    [dispatchShortcut]
  )

  const onToggleDropdown = useCallback(() => {
    dispatchShortcut({ type: "dropdownToggled" })
  }, [dispatchShortcut])

  return { onSelectPreset, onSpecialSubmit, onExpressionChange, onToggleDropdown }
}

type UseTouchSwipeNavigationParams = {
  terminalShellRef: RefObject<HTMLDivElement | null>
  switchTerminalByOffset: (offset: number) => void
}

function useTouchSwipeNavigation({ terminalShellRef, switchTerminalByOffset }: UseTouchSwipeNavigationParams) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const terminalShell = terminalShellRef.current
    if (!terminalShell) {
      return
    }

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) {
        return
      }

      touchStartRef.current = { x: touch.clientX, y: touch.clientY }
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (!touchStartRef.current) {
        return
      }

      const touch = event.changedTouches[0]
      if (!touch) {
        touchStartRef.current = null
        return
      }

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
    }

    terminalShell.addEventListener("touchstart", handleTouchStart, { passive: true })
    terminalShell.addEventListener("touchend", handleTouchEnd, { passive: true })

    return () => {
      terminalShell.removeEventListener("touchstart", handleTouchStart)
      terminalShell.removeEventListener("touchend", handleTouchEnd)
    }
  }, [terminalShellRef, switchTerminalByOffset])
}

function useInitialSessionsLoad(fetchSessions: (preferredActive?: string | null) => Promise<void>) {
  useEffect(() => {
    void fetchSessions()
  }, [fetchSessions])
}

type UseTerminalRuntimeConnectionParams = {
  containerRef: RefObject<HTMLDivElement | null>
  activeTerminalId: string | null
  isSessionReady: boolean
  sendInput: (data: string) => Promise<void>
  sendResize: (cols: number, rows: number) => Promise<void>
  fetchSessions: (preferredActive?: string | null) => Promise<void>
  dispatchSessions: (action: TerminalSessionsAction) => void
  eventSourceRef: RefObject<EventSource | null>
}

function useTerminalRuntimeConnection({
  containerRef,
  activeTerminalId,
  isSessionReady,
  sendInput,
  sendResize,
  fetchSessions,
  dispatchSessions,
  eventSourceRef,
}: UseTerminalRuntimeConnectionParams) {
  const lastResizeRef = useRef<{ cols: number; rows: number } | null>(null)

  useEffect(() => {
    if (!containerRef.current || !activeTerminalId || !isSessionReady) {
      return
    }

    let disposed = false
    let cleanupRuntime = () => {}

    const setup = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")])
      if (disposed || !containerRef.current) {
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

      eventSource.addEventListener("open", () => {
        logDebug("eventsource opened", { terminalId: activeTerminalId })
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
        startTransition(() => {
          dispatchSessions({ type: "activeTerminalRemoved", payload: { terminalId: activeTerminalId } })
        })

        void fetchSessions()
      })

      eventSource.addEventListener("error", () => {
        logDebug("eventsource error", { terminalId: activeTerminalId })
        console.warn("[terminal-viewer] eventsource error", { terminalId: activeTerminalId })
      })

      const terminalInputDisposable = terminal.onData((data: string) => {
        void sendInput(data)
      })

      lastResizeRef.current = null

      const onResize = () => {
        fitAddon.fit()

        const next = { cols: terminal.cols, rows: terminal.rows }
        if (lastResizeRef.current && lastResizeRef.current.cols === next.cols && lastResizeRef.current.rows === next.rows) {
          return
        }

        lastResizeRef.current = next
        void sendResize(next.cols, next.rows)
      }

      window.addEventListener("resize", onResize)
      onResize()

      cleanupRuntime = () => {
        window.removeEventListener("resize", onResize)
        terminalInputDisposable.dispose()
        eventSource.close()
        terminal.dispose()
      }
    }

    void setup()

    return () => {
      disposed = true
      cleanupRuntime()
      eventSourceRef.current = null
      logDebug("eventsource closed", { terminalId: activeTerminalId })
    }
  }, [activeTerminalId, containerRef, dispatchSessions, eventSourceRef, fetchSessions, isSessionReady, sendInput, sendResize])
}

export function TerminalViewer() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalShellRef = useRef<HTMLDivElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const createTerminalLockRef = useRef(false)
  const [inputValue, setInputValue] = useState("")
  const [isCreatingTerminal, setIsCreatingTerminal] = useState(false)
  const [manualShortcutPreset, setManualShortcutPreset] = useState<string | null>(null)
  const [shortcutState, dispatchShortcut] = useReducer(shortcutInputReducer, {
    expression: "",
    isDropdownOpen: false,
    isExpressionManual: false,
  })
  const [sessionsState, dispatchSessions] = useReducer(terminalSessionsReducer, {
    terminalIds: [],
    activeTerminalId: null,
    isSessionReady: false,
  })

  const { terminalIds, activeTerminalId, isSessionReady } = sessionsState
  const {
    expression: specialExpression,
    isDropdownOpen: isSpecialDropdownOpen,
    isExpressionManual: isSpecialExpressionManual,
  } = shortcutState

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
      startTransition(() => {
        dispatchSessions({ type: "sessionsFailed" })
      })
      return
    }

    const payload = (await response.json()) as SessionsResponse
    startTransition(() => {
      dispatchSessions({
        type: "sessionsSynced",
        payload: {
          terminalIds: payload.terminalIds,
          preferredActive,
          defaultTerminalId: payload.defaultTerminalId,
        },
      })
    })
  }, [])

  const sendInput = useCallback(
    async (data: string) => {
      await postJson("/api/terminal/input/text", { data, terminalId: activeTerminalId ?? undefined })
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

  const saveLastManualShortcut = useCallback((nextExpression: string) => {
    setManualShortcutPreset(nextExpression)
    if (typeof window === "undefined") {
      return
    }

    try {
      window.localStorage.setItem(LAST_MANUAL_SHORTCUT_STORAGE_KEY, nextExpression)
    } catch {
      logDebug("failed to save manual shortcut")
    }
  }, [])

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
      dispatchSessions({ type: "activeTerminalChanged", payload: { terminalId: terminalIds[nextIndex] } })
    },
    [activeTerminalId, terminalIds]
  )

  const createTerminal = useCallback(async () => {
    if (createTerminalLockRef.current) {
      return
    }

    createTerminalLockRef.current = true
    setIsCreatingTerminal(true)

    try {
      const response = await fetch("/api/terminal/create", { method: "POST" })
      if (!response.ok) {
        logDebug("create session failed", { status: response.status })
        return
      }

      const payload = (await response.json()) as CreateSessionResponse
      dispatchSessions({ type: "terminalCreated", payload: { terminalId: payload.terminalId } })
    } finally {
      createTerminalLockRef.current = false
      setIsCreatingTerminal(false)
    }
  }, [])

  useTouchSwipeNavigation({ terminalShellRef, switchTerminalByOffset })
  useInitialSessionsLoad(fetchSessions)
  useTerminalRuntimeConnection({
    containerRef,
    activeTerminalId,
    isSessionReady,
    sendInput,
    sendResize,
    fetchSessions,
    dispatchSessions,
    eventSourceRef,
  })

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    try {
      const storedExpression = window.localStorage.getItem(LAST_MANUAL_SHORTCUT_STORAGE_KEY)
      if (!storedExpression) {
        return
      }
      setManualShortcutPreset(storedExpression)
    } catch {
      logDebug("failed to load manual shortcut")
    }
  }, [])

  const { onSelectPreset, onSpecialSubmit, onExpressionChange, onToggleDropdown } = useShortcutHandlers({
    dispatchShortcut,
    expression: specialExpression,
    isExpressionManual: isSpecialExpressionManual,
    sendSequence,
    onManualExpressionSubmitted: saveLastManualShortcut,
  })

  return (
    <div
      data-testid="terminal-page"
      className="grid h-svh w-full grid-rows-[auto_minmax(0,1fr)_auto_auto_auto] gap-2 px-[max(0.5rem,env(safe-area-inset-left))] pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-3"
    >
      <TerminalHeader
        terminalIds={terminalIds}
        activeTerminalId={activeTerminalId}
        isCreatingTerminal={isCreatingTerminal}
        onSwitchOffset={switchTerminalByOffset}
        onCreateTerminal={() => void createTerminal()}
      />

      <TerminalViewport terminalShellRef={terminalShellRef} containerRef={containerRef} />

      <TerminalCommandInputForm
        inputValue={inputValue}
        onInputValueChange={setInputValue}
        onSubmit={onSubmit}
      />

      <TerminalShortcutForm
        expression={specialExpression}
        isDropdownOpen={isSpecialDropdownOpen}
        onExpressionChange={onExpressionChange}
        onToggleDropdown={onToggleDropdown}
        onSubmit={onSpecialSubmit}
        onSelectPreset={onSelectPreset}
        manualShortcutPreset={manualShortcutPreset}
      />
    </div>
  )
}

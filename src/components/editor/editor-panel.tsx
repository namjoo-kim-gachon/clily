"use client"

import { useCallback, useEffect, useReducer, useRef, useState } from "react"

import type { Extension } from "@codemirror/state"

import { Button } from "@/components/ui/button"
import { getLanguageExtension } from "@/lib/file-language"

import { CodeEditor } from "./code-editor"

// Cache language Extension objects by file extension so that switching between
// same-language files reuses the same Extension instance — this avoids unnecessary
// CodeMirror editor recreations.
const LANGUAGE_CACHE = new Map<string, Extension | null>()

function cachedLanguage(filename: string): Extension | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  if (LANGUAGE_CACHE.has(ext)) return LANGUAGE_CACHE.get(ext) as Extension | null
  const lang = getLanguageExtension(filename)
  LANGUAGE_CACHE.set(ext, lang)
  return lang
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

type FileType = "text" | "image" | "binary"

type OpenFile = {
  path: string
  name: string
  content: string
  fileType: FileType
  language: Extension | null
  modified: boolean
  savedContent: string
  size: number
  truncated?: boolean
}

type EditorState = {
  files: OpenFile[]
  activeIndex: number
}

type EditorAction =
  | { type: "opened"; file: OpenFile }
  | { type: "closed"; index: number }
  | { type: "changed"; index: number; content: string }
  | { type: "saved"; index: number }
  | { type: "activated"; index: number }

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "opened": {
      const existing = state.files.findIndex((f) => f.path === action.file.path)
      if (existing >= 0) return { ...state, activeIndex: existing }
      const files = [...state.files, action.file]
      return { files, activeIndex: files.length - 1 }
    }
    case "closed": {
      const files = state.files.filter((_, i) => i !== action.index)
      if (files.length === 0) return { files, activeIndex: -1 }
      return { files, activeIndex: Math.min(action.index, files.length - 1) }
    }
    case "changed": {
      const files = state.files.map((f, i) =>
        i === action.index
          ? { ...f, content: action.content, modified: action.content !== f.savedContent }
          : f
      )
      return { ...state, files }
    }
    case "saved": {
      const files = state.files.map((f, i) =>
        i === action.index ? { ...f, savedContent: f.content, modified: false } : f
      )
      return { ...state, files }
    }
    case "activated":
      return { ...state, activeIndex: action.index }
  }
}

type FileResponse =
  | { type: "text"; content: string; size: number; truncated?: boolean }
  | { type: "image"; size: number }
  | { type: "binary"; size: number }
  | { error: string }

type CompletionEntry = { name: string; isDir: boolean }

export function EditorPanel({ externalOpen }: { externalOpen?: string | null }) {
  const [{ files, activeIndex }, dispatch] = useReducer(editorReducer, {
    files: [],
    activeIndex: -1,
  })
  const [pathInput, setPathInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Tab completion state
  const [completions, setCompletions] = useState<CompletionEntry[]>([])
  const [completionIndex, setCompletionIndex] = useState(-1)
  const [completionBase, setCompletionBase] = useState("")
  const completionActiveRef = useRef(false)

  const openFile = useCallback(async (rawPath: string) => {
    const path = rawPath.trim()
    if (!path) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`)
      const data = (await res.json()) as FileResponse

      if ("error" in data) {
        setError(data.error)
        return
      }

      const name = path.split("/").pop() ?? path

      dispatch({
        type: "opened",
        file: {
          path,
          name,
          content: data.type === "text" ? data.content : "",
          fileType: data.type,
          language: data.type === "text" ? cachedLanguage(name) : null,
          modified: false,
          savedContent: data.type === "text" ? data.content : "",
          size: data.size,
          truncated: data.type === "text" ? data.truncated : undefined,
        },
      })
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      setCompletions([])
      completionActiveRef.current = false
      void openFile(pathInput)
    },
    [openFile, pathInput]
  )

  const saveActiveFile = useCallback(async () => {
    const file = activeIndex >= 0 ? files[activeIndex] : null
    if (!file || file.fileType !== "text") return

    try {
      const res = await fetch("/api/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, content: file.content }),
      })

      if (res.ok) {
        dispatch({ type: "saved", index: activeIndex })
      } else {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? "Save failed")
      }
    } catch {
      setError("Network error")
    }
  }, [activeIndex, files])

  const fetchCompletions = useCallback(async (partial: string) => {
    try {
      const res = await fetch(`/api/file/complete?path=${encodeURIComponent(partial)}`)
      if (!res.ok) return []
      return (await res.json()) as CompletionEntry[]
    } catch {
      return []
    }
  }, [])

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setCompletions([])
        completionActiveRef.current = false
        return
      }

      if (e.key !== "Tab") return
      e.preventDefault()

      if (!completionActiveRef.current) {
        // First Tab press: fetch completions
        const results = await fetchCompletions(pathInput)
        if (results.length === 0) return

        const inputDir = pathInput.includes("/")
          ? pathInput.slice(0, pathInput.lastIndexOf("/") + 1)
          : ""

        if (results.length === 1) {
          // Single match — apply directly
          const entry = results[0]
          setPathInput(inputDir + entry.name + (entry.isDir ? "/" : ""))
          setCompletions([])
          return
        }
        completionActiveRef.current = true
        setCompletionBase(inputDir)
        setCompletions(results)
        setCompletionIndex(0)
        const entry = results[0]
        setPathInput(inputDir + entry.name + (entry.isDir ? "/" : ""))
        return
      }

      // Subsequent Tab presses: cycle through completions
      const next = e.shiftKey
        ? (completionIndex - 1 + completions.length) % completions.length
        : (completionIndex + 1) % completions.length
      setCompletionIndex(next)
      const entry = completions[next]
      const dir = completionBase.includes("/")
        ? completionBase.slice(0, completionBase.lastIndexOf("/") + 1)
        : ""
      setPathInput(dir + entry.name + (entry.isDir ? "/" : ""))
    },
    [pathInput, completions, completionIndex, completionBase, fetchCompletions]
  )

  // Reset completion state when user types manually
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPathInput(e.target.value)
    setCompletions([])
    completionActiveRef.current = false
  }, [])

  // Open file when triggered externally (e.g. from terminal via `clily` command)
  useEffect(() => {
    if (externalOpen) void openFile(externalOpen)
  }, [externalOpen, openFile])

  // Close completions when clicking outside
  useEffect(() => {
    if (completions.length === 0) return
    const handler = () => {
      setCompletions([])
      completionActiveRef.current = false
    }
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [completions.length])

  const activeFile = activeIndex >= 0 ? files[activeIndex] : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Path input bar */}
      <div className="shrink-0 border-b border-border">
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-1 px-2 py-1.5"
        >
          <div className="relative min-w-0 flex-1">
            <input
              type="text"
              value={pathInput}
              onChange={handleChange}
              onKeyDown={(e) => void handleKeyDown(e)}
              placeholder="path/to/file  (Tab to complete)"
              className="w-full rounded border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
            />
            {completions.length > 1 ? (
              <div className="absolute top-full left-0 z-50 mt-0.5 max-h-48 w-full overflow-y-auto rounded border border-border bg-popover shadow-md">
                {completions.map((entry, i) => (
                  <button
                    key={entry.name}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      const dir = completionBase.includes("/")
                        ? completionBase.slice(0, completionBase.lastIndexOf("/") + 1)
                        : ""
                      setPathInput(dir + entry.name + (entry.isDir ? "/" : ""))
                      setCompletions([])
                      completionActiveRef.current = false
                    }}
                    className={`flex w-full items-center gap-1.5 px-2 py-1 text-left font-mono text-xs ${
                      i === completionIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    <span className="text-muted-foreground">{entry.isDir ? "📁" : "📄"}</span>
                    {entry.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Button
            type="submit"
            variant="outline"
            className="h-7 shrink-0 px-2 text-xs"
            disabled={loading}
          >
            {loading ? "…" : "Open"}
          </Button>
        </form>
      </div>

      {/* Error banner */}
      {error ? (
        <p className="shrink-0 border-b border-border bg-destructive/10 px-3 py-1 text-xs text-destructive">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline"
          >
            dismiss
          </button>
        </p>
      ) : null}

      {/* Tab bar */}
      {files.length > 0 ? (
        <div className="flex shrink-0 items-stretch overflow-x-auto border-b border-border">
          {files.map((f, i) => (
            <div
              key={f.path}
              role="tab"
              aria-selected={i === activeIndex}
              tabIndex={0}
              onClick={() => dispatch({ type: "activated", index: i })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") dispatch({ type: "activated", index: i })
              }}
              title={f.path}
              className={`flex shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-border px-3 py-1 text-xs transition-colors ${
                i === activeIndex
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {f.modified ? (
                <span className="text-[10px] leading-none text-blue-500">●</span>
              ) : null}
              <span className="max-w-32 truncate">{f.name}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: "closed", index: i })
                }}
                className="ml-0.5 rounded px-0.5 hover:bg-muted-foreground/30"
                aria-label={`Close ${f.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Content area */}
      <div className="min-h-0 flex-1">
        {!activeFile ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Enter a file path above to open
          </div>
        ) : activeFile.fileType === "binary" ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <span className="text-base">⊘</span>
            <span>Binary file</span>
            <span>{formatBytes(activeFile.size)}</span>
          </div>
        ) : activeFile.fileType === "image" ? (
          <div className="flex h-full items-center justify-center overflow-auto p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/file/raw?path=${encodeURIComponent(activeFile.path)}`}
              alt={activeFile.name}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {activeFile.truncated ? (
              <p className="shrink-0 border-b border-border bg-yellow-500/10 px-3 py-1 text-xs text-yellow-600 dark:text-yellow-400">
                ⚠ Showing first 1 MB of {formatBytes(activeFile.size)} — file truncated
              </p>
            ) : null}
            <div className="min-h-0 flex-1">
              <CodeEditor
                content={activeFile.content}
                language={activeFile.language}
                onChange={(content) =>
                  dispatch({ type: "changed", index: activeIndex, content })
                }
                onSave={() => void saveActiveFile()}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

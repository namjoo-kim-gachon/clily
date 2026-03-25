"use client"

import { useCallback, useEffect, useReducer, useState } from "react"

import type { Extension } from "@codemirror/state"

import { formatBytes } from "@/lib/file-utils"
import { getLanguageExtension } from "@/lib/file-language"

import { CodeEditor } from "./code-editor"

const LANGUAGE_CACHE = new Map<string, Extension | null>()

function cachedLanguage(filename: string): Extension | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  if (LANGUAGE_CACHE.has(ext)) return LANGUAGE_CACHE.get(ext) as Extension | null
  const lang = getLanguageExtension(filename)
  LANGUAGE_CACHE.set(ext, lang)
  return lang
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

export function EditorPanel({ externalOpen }: { externalOpen?: string | null }) {
  const [{ files, activeIndex }, dispatch] = useReducer(editorReducer, {
    files: [],
    activeIndex: -1,
  })
  const [error, setError] = useState<string | null>(null)

  const openFile = useCallback(async (rawPath: string) => {
    const path = rawPath.trim()
    if (!path) return

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
    }
  }, [])

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

  useEffect(() => {
    if (externalOpen) void openFile(externalOpen)
  }, [externalOpen, openFile])

  const activeFile = activeIndex >= 0 ? files[activeIndex] : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
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
            Run <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono">clily &lt;file&gt;</code> in the terminal to open a file
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

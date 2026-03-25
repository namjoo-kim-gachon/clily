"use client"

import { useEffect, useRef } from "react"

import { defaultKeymap, indentWithTab } from "@codemirror/commands"
import type { Extension } from "@codemirror/state"
import { EditorState } from "@codemirror/state"
import { keymap } from "@codemirror/view"
import { oneDark } from "@codemirror/theme-one-dark"
import { basicSetup, EditorView } from "codemirror"
import { useTheme } from "next-themes"

import { getLanguageExtension } from "@/lib/file-language"

const FILL_HEIGHT = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
})

// Cache Extension objects by file extension to avoid recreating the editor
// when switching between files of the same language.
const LANGUAGE_CACHE = new Map<string, Extension | null>()

function cachedLanguage(filename: string): Extension | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  if (LANGUAGE_CACHE.has(ext)) return LANGUAGE_CACHE.get(ext) as Extension | null
  const lang = getLanguageExtension(filename)
  LANGUAGE_CACHE.set(ext, lang)
  return lang
}

type CodeEditorProps = {
  filename: string
  content: string
  onChange?: (content: string) => void
  onSave?: () => void
}

export function CodeEditor({ filename, content, onChange, onSave }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Refs keep callbacks fresh without causing the editor to be recreated
  const contentRef = useRef(content)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  contentRef.current = content
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  const { resolvedTheme } = useTheme()
  const language = cachedLanguage(filename)

  // (Re)create editor when theme or language changes
  useEffect(() => {
    if (!containerRef.current) return

    const extensions: Extension[] = [
      basicSetup,
      FILL_HEIGHT,
      keymap.of([
        ...defaultKeymap,
        indentWithTab,
        { key: "Mod-s", run: () => { onSaveRef.current?.(); return true } },
      ]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current?.(update.state.doc.toString())
        }
      }),
      ...(resolvedTheme === "dark" ? [oneDark] : []),
      ...(language ? [language] : []),
    ]

    const view = new EditorView({
      state: EditorState.create({ doc: contentRef.current, extensions }),
      parent: containerRef.current,
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme, language])

  // Sync content when it changes externally (e.g. switching to same-language file)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() === content) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    })
  }, [content])

  return <div ref={containerRef} className="h-full" />
}

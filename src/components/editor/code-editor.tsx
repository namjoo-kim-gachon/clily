"use client"

import { useEffect, useRef } from "react"

import { defaultKeymap, indentWithTab } from "@codemirror/commands"
import type { Extension } from "@codemirror/state"
import { EditorState } from "@codemirror/state"
import { keymap } from "@codemirror/view"
import { oneDark } from "@codemirror/theme-one-dark"
import { basicSetup, EditorView } from "codemirror"
import { useTheme } from "next-themes"

const FILL_HEIGHT = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
})

type CodeEditorProps = {
  content: string
  language: Extension | null
  onChange?: (content: string) => void
  onSave?: () => void
}

export function CodeEditor({ content, language, onChange, onSave }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Use refs for callbacks so they're always fresh without triggering effect deps
  const contentRef = useRef(content)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  contentRef.current = content
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  const { resolvedTheme } = useTheme()

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

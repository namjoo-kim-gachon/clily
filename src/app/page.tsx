"use client"

import { useState } from "react"

import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels"

import { EditorPanel } from "@/components/editor/editor-panel"
import { TerminalViewer } from "@/components/terminal/terminal-viewer"
import { useMobileEnvironment } from "@/hooks/use-mobile-environment"

export default function Page() {
  const isMobile = useMobileEnvironment()
  const [fileToOpen, setFileToOpen] = useState<string | null>(null)

  if (isMobile) {
    return <TerminalViewer />
  }

  return (
    <div className="fixed inset-0 h-dvh">
      <PanelGroup orientation="horizontal">
        <Panel defaultSize={50} minSize={20}>
          <TerminalViewer embedded onOpenFile={setFileToOpen} />
        </Panel>
        <PanelResizeHandle className="w-px bg-border transition-colors hover:w-1 hover:bg-ring data-[resize-handle-active]:w-1 data-[resize-handle-active]:bg-ring" />
        <Panel defaultSize={50} minSize={15}>
          <EditorPanel externalOpen={fileToOpen} />
        </Panel>
      </PanelGroup>
    </div>
  )
}

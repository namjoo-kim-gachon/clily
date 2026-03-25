import { NextResponse } from "next/server"

import { getTerminalRuntime } from "@/lib/terminal-runtime"

export async function POST() {
  const terminalIds = getTerminalRuntime().reattachDisconnectedSessions()
  return NextResponse.json({ terminalIds })
}

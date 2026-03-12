import { NextResponse } from "next/server"

import { getTerminalRuntime } from "@/lib/terminal-runtime"

export async function GET() {
  const runtime = getTerminalRuntime()
  return NextResponse.json({
    terminalIds: runtime.listSessions(),
    defaultTerminalId: runtime.getDefaultTerminalId(),
  })
}

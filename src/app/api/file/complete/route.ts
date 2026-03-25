import { readdirSync, statSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"

import { NextResponse } from "next/server"

const HOME = process.env.HOME ?? process.cwd()

function resolvePath(input: string): string {
  if (input.startsWith("~/")) return resolve(HOME, input.slice(2))
  if (input.startsWith("/")) return input
  return resolve(HOME, input)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const partial = searchParams.get("path") ?? ""

  // Determine the directory to list and the prefix to filter by
  const trailingSlash = partial.endsWith("/")
  const dir = trailingSlash ? partial : dirname(partial) || "."
  const prefix = trailingSlash ? "" : basename(partial)

  const resolvedDir = resolvePath(dir)

  try {
    const entries = readdirSync(resolvedDir)
    const results = entries
      .filter((name) => name.startsWith(prefix) && !name.startsWith("."))
      .map((name) => {
        let isDir = false
        try {
          isDir = statSync(resolve(resolvedDir, name)).isDirectory()
        } catch {
          // ignore stat errors
        }
        return { name, isDir }
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .slice(0, 50)

    return NextResponse.json(results)
  } catch {
    return NextResponse.json([])
  }
}

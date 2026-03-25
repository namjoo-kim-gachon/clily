import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const HOME = process.env.HOME ?? process.cwd()

const MIME: Record<string, string> = {
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  png:  "image/png",
  gif:  "image/gif",
  webp: "image/webp",
  svg:  "image/svg+xml",
  bmp:  "image/bmp",
  ico:  "image/x-icon",
}

function resolvePath(input: string): string {
  if (input.startsWith("~/")) return resolve(HOME, input.slice(2))
  if (input.startsWith("/")) return input
  return resolve(HOME, input)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawPath = searchParams.get("path")

  if (!rawPath) {
    return new Response("path required", { status: 400 })
  }

  const filePath = resolvePath(rawPath)

  if (!existsSync(filePath)) {
    return new Response("not found", { status: 404 })
  }

  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  const contentType = MIME[ext] ?? "application/octet-stream"
  const buf = readFileSync(filePath)

  return new Response(buf, {
    headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
  })
}

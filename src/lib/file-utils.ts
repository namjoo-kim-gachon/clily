import { resolve } from "node:path"

const HOME = process.env.HOME ?? process.cwd()

export function resolvePath(input: string): string {
  if (input.startsWith("~/")) return resolve(HOME, input.slice(2))
  if (input.startsWith("/")) return input
  return resolve(HOME, input)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const IMAGE_MIME: Record<string, string> = {
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  png:  "image/png",
  gif:  "image/gif",
  webp: "image/webp",
  svg:  "image/svg+xml",
  bmp:  "image/bmp",
  ico:  "image/x-icon",
}

export const IMAGE_EXTS = new Set(Object.keys(IMAGE_MIME))

import { javascript } from "@codemirror/lang-javascript"
import { python } from "@codemirror/lang-python"
import { rust } from "@codemirror/lang-rust"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { StreamLanguage } from "@codemirror/language"
import { go } from "@codemirror/legacy-modes/mode/go"
import { shell } from "@codemirror/legacy-modes/mode/shell"
import { yaml } from "@codemirror/legacy-modes/mode/yaml"
import type { Extension } from "@codemirror/state"

const EXT_LANGUAGE: Record<string, () => Extension> = {
  js:       () => javascript(),
  jsx:      () => javascript({ jsx: true }),
  mjs:      () => javascript(),
  cjs:      () => javascript(),
  ts:       () => javascript({ typescript: true }),
  tsx:      () => javascript({ jsx: true, typescript: true }),
  mts:      () => javascript({ typescript: true }),
  py:       () => python(),
  rs:       () => rust(),
  json:     () => json(),
  jsonc:    () => json(),
  md:       () => markdown(),
  markdown: () => markdown(),
  css:      () => css(),
  scss:     () => css(),
  html:     () => html(),
  htm:      () => html(),
  go:       () => StreamLanguage.define(go),
  sh:       () => StreamLanguage.define(shell),
  bash:     () => StreamLanguage.define(shell),
  zsh:      () => StreamLanguage.define(shell),
  yaml:     () => StreamLanguage.define(yaml),
  yml:      () => StreamLanguage.define(yaml),
}

export function getLanguageExtension(filename: string): Extension | null {
  const ext = filename.split(".").pop()?.toLowerCase()
  if (!ext) return null
  return EXT_LANGUAGE[ext]?.() ?? null
}

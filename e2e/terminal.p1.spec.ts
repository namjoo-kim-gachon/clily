import { expect, test } from "@playwright/test"

function parseActiveLabel(text: string) {
  const match = text.match(/Terminal\s+(\d+)\s*\/\s*(\d+)/)
  return {
    active: Number(match?.[1] ?? 0),
    total: Number(match?.[2] ?? 0),
  }
}

test.describe("P1 terminal UI simplification", () => {
  test("tmux 전용 UI가 렌더링되지 않는다", async ({ page }) => {
    await page.goto("/")

    await expect(page.getByTestId("terminal-page")).toBeVisible()
    await expect(page.getByTestId("session-picker")).toHaveCount(0)
    await expect(page.getByTestId("window-tabs")).toHaveCount(0)
  })

  test("모바일 viewport에서 스와이프로 터미널 전환이 동작한다", async ({ page, isMobile }) => {
    test.skip(!isMobile, "모바일 프로젝트에서만 스와이프 전환 검증")

    await page.goto("/")

    const label = page.getByTestId("terminal-active-label")
    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").total).toBeGreaterThan(0)

    const before = parseActiveLabel((await label.textContent()) ?? "")

    await page.getByTestId("terminal-add").click()

    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "")).toEqual({
      active: before.total + 1,
      total: before.total + 1,
    })

    const shell = page.getByTestId("terminal-viewport-shell")
    const box = await shell.boundingBox()
    expect(box).toBeTruthy()

    await page.dispatchEvent("[data-testid='terminal-viewport-shell']", "touchstart", {
      touches: [{ identifier: 1, clientX: (box?.x ?? 0) + (box?.width ?? 0) * 0.8, clientY: (box?.y ?? 0) + (box?.height ?? 0) * 0.5 }],
    })
    await page.dispatchEvent("[data-testid='terminal-viewport-shell']", "touchend", {
      changedTouches: [{ identifier: 1, clientX: (box?.x ?? 0) + (box?.width ?? 0) * 0.2, clientY: (box?.y ?? 0) + (box?.height ?? 0) * 0.5 }],
    })

    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").active).toBe(1)
  })

  test("데스크톱에서 좌우 버튼으로 터미널 전환이 동작한다", async ({ page, isMobile }) => {
    test.skip(isMobile, "데스크톱 프로젝트에서만 화살표 전환 검증")

    await page.goto("/")

    const label = page.getByTestId("terminal-active-label")
    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").total).toBeGreaterThan(0)

    const before = parseActiveLabel((await label.textContent()) ?? "")

    await page.getByTestId("terminal-add").click()

    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "")).toEqual({
      active: before.total + 1,
      total: before.total + 1,
    })

    await expect(page.getByTestId("terminal-nav-prev")).toBeVisible()
    await expect(page.getByTestId("terminal-nav-next")).toBeVisible()

    await page.getByTestId("terminal-nav-prev").click()
    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").active).toBe(before.total)

    await page.getByTestId("terminal-nav-next").click()
    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").active).toBe(before.total + 1)
  })
})

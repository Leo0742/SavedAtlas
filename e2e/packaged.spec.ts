import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('packaged app completes mocked real-mode first run and searches all imported messages', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'savedatlas-e2e-'))
  const executablePath = resolve('release/mac-arm64/SavedAtlas.app/Contents/MacOS/SavedAtlas')
  const app = await electron.launch({ executablePath, env: { ...process.env, SAVEDATLAS_E2E: '1', SAVEDATLAS_E2E_DATA_DIR: dataDir } })
  try {
    const errors: string[] = []; const page = await app.firstWindow(); page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) }); await page.waitForLoadState('domcontentloaded'); await expect(page).toHaveTitle('SavedAtlas'); const diagnostics = await page.evaluate(() => ({ hasApi: Boolean(window.savedAtlas), body: document.body.innerText.slice(0, 500) })); expect(diagnostics.hasApi, diagnostics.body).toBe(true)
    await expect(page.getByRole('heading', { name: 'Соберите Избранное в понятную библиотеку' })).toBeVisible()
    await page.getByRole('button', { name: 'Начать настройку' }).click()
    await page.getByLabel('api_id').fill('12345678'); await page.getByLabel('api_hash').fill('a'.repeat(32)); await page.getByRole('button', { name: 'Продолжить' }).click()
    await page.getByLabel('Номер телефона').fill('+79990000000'); await page.getByRole('button', { name: 'Получить код' }).click(); await page.getByLabel('Код из Telegram').fill('12345'); await page.getByRole('button', { name: 'Подтвердить' }).click()
    await page.getByLabel('RouterAI API key').fill('mock-key-for-packaged-e2e'); await page.getByRole('button', { name: 'Продолжить' }).click(); await page.getByRole('button', { name: 'Завершить и синхронизировать' }).click()
    await expect(page.getByText('Ваша библиотека сохранённых материалов')).toBeVisible({ timeout: 60_000 })
    await expect.poll(async () => { const value = await page.evaluate(() => window.savedAtlas.getJobProgress()); return value.pending + value.running }, { timeout: 60_000 }).toBe(0)
    const directSearch = await page.evaluate(() => window.savedAtlas.searchMessages({ query: 'пределами первых пятидесяти', limit: 10, offset: 0 })); expect(directSearch.total).toBe(1)
    await page.getByRole('button', { name: /Всё избранное/ }).click(); await page.getByPlaceholder('Поиск по всем сообщениям, темам и тегам…').fill('пределами первых пятидесяти')
    await expect(page.getByText(directSearch.items[0].summary).first()).toBeVisible()
    const state = await page.evaluate(() => window.savedAtlas.getState()); expect(state.dashboard.total).toBe(260)
    const jobs = await page.evaluate(() => window.savedAtlas.getJobProgress()); expect(jobs.pending + jobs.running).toBe(0)
    await page.screenshot({ path: '/private/tmp/savedatlas-packaged-e2e.png' }); expect(errors).toEqual([])
  } finally { await app.close(); rmSync(dataDir, { recursive: true, force: true }) }
})

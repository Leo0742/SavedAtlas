import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const executablePath = resolve('release/mac-arm64/SavedAtlas.app/Contents/MacOS/SavedAtlas')

test('packaged release candidate covers data, controls, profiles, and responsive windows', async () => {
  test.setTimeout(180_000)
  const dataDir = mkdtempSync(join(tmpdir(), 'savedatlas-e2e-'))
  const screenshotDir = resolve('test-results/responsive'); mkdirSync(screenshotDir, { recursive: true })
  const app = await electron.launch({ executablePath, env: { ...process.env, SAVEDATLAS_E2E: '1', SAVEDATLAS_E2E_DATA_DIR: dataDir } })
  const consoleErrors: string[] = []; const pageErrors: string[] = []; const crashes: string[] = []; let stderr = ''
  app.process().stderr?.on('data', (value) => { stderr += String(value) })
  try {
    const page = await app.firstWindow(); page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) }); page.on('pageerror', (error) => pageErrors.push(error.message)); page.on('crash', () => crashes.push('renderer crash'))
    await page.waitForLoadState('domcontentloaded'); await expect(page).toHaveTitle('SavedAtlas')
    const boot = await page.evaluate(() => ({ hasApi: Boolean(window.savedAtlas), fallback: document.body.innerText.includes('integration error') })); expect(boot).toEqual({ hasApi: true, fallback: false })
    await page.getByRole('button', { name: 'Начать настройку' }).click(); await page.getByRole('button', { name: 'Назад' }).click(); await page.getByRole('button', { name: 'Начать настройку' }).click()
    await page.getByLabel('api_id').fill('12345678'); await page.getByLabel('api_hash').fill('a'.repeat(32)); await page.getByRole('button', { name: /Где получить данные/ }).click(); await page.getByRole('button', { name: 'Продолжить' }).click()
    await page.getByLabel('Номер телефона').fill('+79990000000'); await page.getByRole('button', { name: 'Получить код' }).click(); await page.getByRole('button', { name: 'Отправить код ещё раз' }).click(); await page.getByRole('button', { name: 'Отменить вход' }).click(); await page.getByRole('button', { name: 'Продолжить' }).click(); await page.getByRole('button', { name: 'Получить код' }).click(); await page.getByLabel('Код из Telegram').fill('22222'); await page.getByRole('button', { name: 'Подтвердить' }).click(); await page.getByLabel('Пароль двухэтапной проверки').fill('mock-password'); await page.getByRole('button', { name: 'Продолжить' }).click()
    await page.getByLabel('RouterAI API key').fill('mock-key-for-packaged-e2e'); await page.getByRole('button', { name: 'Проверить подключение' }).click(); await expect(page.getByText('Mock RouterAI connected.')).toBeVisible(); await page.getByRole('button', { name: 'Продолжить' }).click(); await page.getByRole('button', { name: 'Завершить и синхронизировать' }).click(); await expect(page.getByRole('heading', { name: 'Импортируем Избранное' })).toBeVisible(); await page.getByRole('button', { name: 'Пауза' }).click(); await expect.poll(() => page.evaluate(() => window.savedAtlas!.getSyncProgress().then((value) => value.state))).toBe('paused'); await page.getByRole('button', { name: 'Продолжить' }).click(); await expect.poll(() => page.evaluate(() => window.savedAtlas!.getSyncProgress().then((value) => value.state))).toBe('running'); await page.getByRole('button', { name: 'Отменить' }).click(); await expect.poll(() => page.evaluate(() => window.savedAtlas!.getSyncProgress().then((value) => value.state))).toBe('cancelled'); await page.getByRole('button', { name: 'Повторить' }).click()
    await expect(page.getByText('Ваша библиотека сохранённых материалов')).toBeVisible({ timeout: 60_000 })
    await expect.poll(async () => { const value = await page.evaluate(() => window.savedAtlas!.getJobProgress()); return value.pending + value.running }, { timeout: 60_000 }).toBe(0)
    const state = await page.evaluate(() => window.savedAtlas!.getState()); expect(state.dashboard.total).toBe(260)
    const jobs = await page.evaluate(() => window.savedAtlas!.getJobProgress()); expect(jobs.pending + jobs.running).toBe(0); expect(jobs.failed).toBeGreaterThanOrEqual(1)
    const directSearch = await page.evaluate(() => window.savedAtlas!.searchMessages({ query: 'пределами первых пятидесяти', limit: 10, offset: 0 })); expect(directSearch.total).toBe(1)
    await page.getByRole('button', { name: /Всё избранное/ }).click(); const search = page.getByPlaceholder('Поиск по всем сообщениям, темам и тегам…'); await search.fill('пределами первых пятидесяти'); await expect(page.getByText(directSearch.items[0].summary).first()).toBeVisible(); await page.getByRole('button', { name: 'Очистить поиск' }).click()
    await page.getByRole('button', { name: 'Фильтры' }).click(); await page.getByLabel('Источник').fill('Личная заметка'); await page.getByRole('button', { name: 'Сбросить' }).click(); await page.getByRole('button', { name: 'Фильтры' }).click()
    for (const label of ['Главная', 'Новые и необработанные', 'Темы', 'Актуально', 'Устарело', 'Есть альтернативы', 'Требует проверки', 'Без темы', 'Локальный архив', 'Настройки']) await page.getByRole('button', { name: new RegExp(label) }).first().click()
    const proposal = await page.evaluate(() => window.savedAtlas!.getTopicProposals()); expect(proposal).toHaveLength(1); await page.evaluate((id) => window.savedAtlas!.resolveTopicProposal({ proposalId: id, action: 'accept', name: 'Accepted E2E Topic' }), proposal[0].id)
    const categoryId = await page.evaluate(() => window.savedAtlas!.createCategory({ name: 'E2E Category Manual', description: 'Fixture' })); const topicA = await page.evaluate((id) => window.savedAtlas!.createTopic({ categoryId: id, name: 'E2E Topic A', description: 'A' }), categoryId); const topicB = await page.evaluate((id) => window.savedAtlas!.createTopic({ categoryId: id, name: 'E2E Topic B', description: 'B' }), categoryId)
    await page.evaluate(({ topicA, categoryId }) => window.savedAtlas!.updateTopic({ topicId: topicA, categoryId, name: 'E2E Topic Renamed', description: 'Updated' }), { topicA, categoryId }); await page.evaluate(({ topicA, topicB }) => window.savedAtlas!.mergeTopics({ sourceTopicId: topicA, targetTopicId: topicB }), { topicA, topicB }); await page.evaluate((id) => window.savedAtlas!.archiveTopic({ topicId: id, archived: true }), topicB); await page.evaluate((id) => window.savedAtlas!.archiveTopic({ topicId: id, archived: false }), topicB)
    const messageId = directSearch.items[0].id; await page.evaluate(({ messageId, topicB }) => window.savedAtlas!.changeTopic({ messageId, topicId: topicB }), { messageId, topicB }); await page.evaluate((id) => window.savedAtlas!.changeTags({ messageId: id, tags: ['manual', 'e2e'] }), messageId)
    await page.evaluate((id) => window.savedAtlas!.hideMessage({ messageId: id }), messageId); expect((await page.evaluate(() => window.savedAtlas!.searchMessages({ query: 'пределами', limit: 10, offset: 0 }))).total).toBe(0); await page.evaluate((id) => window.savedAtlas!.restoreMessage({ messageId: id }), messageId)
    const fresh = await page.evaluate(() => window.savedAtlas!.searchMessages({ status: 'current', limit: 10, offset: 0 })); expect(fresh.items.some((item) => item.citations.some((citation) => citation.verified))).toBe(true); await page.evaluate((id) => window.savedAtlas!.recheckFreshness({ messageId: id }), fresh.items[0].id)
    const jsonPath = await page.evaluate(() => window.savedAtlas!.exportJson()); expect(jsonPath).toBe(join(dataDir, 'savedatlas-export.json')); const exported = JSON.parse(readFileSync(jsonPath!, 'utf8')) as { messages: Array<{ id: number }> }; expect(exported.messages).toHaveLength(260); expect(new Set(exported.messages.map((item) => item.id)).size).toBe(260)
    const markdownPath = await page.evaluate((id) => window.savedAtlas!.exportTopicMarkdown(id), topicB); expect(readFileSync(markdownPath!, 'utf8')).toContain('E2E Topic B')
    await page.evaluate(() => window.savedAtlas!.enterDemo()); expect((await page.evaluate(() => window.savedAtlas!.getState())).dashboard.demoMode).toBe(true); await page.evaluate(() => window.savedAtlas!.resetDemo()); await page.evaluate(() => window.savedAtlas!.exitDemo()); expect((await page.evaluate(() => window.savedAtlas!.getState())).dashboard.total).toBe(260)
    await page.evaluate(() => window.savedAtlas!.deleteSecrets('router')); expect((await page.evaluate(() => window.savedAtlas!.getState())).dashboard.routerConfigured).toBe(false); await page.evaluate(() => window.savedAtlas!.deleteSecrets('telegram')); expect((await page.evaluate(() => window.savedAtlas!.getState())).dashboard.telegramAuthorized).toBe(false)

    const sizes = [[900,650],[1024,768],[1280,800],[1440,900],[1512,982],[1728,1117]] as const
    for (const [width,height] of sizes) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height), { width, height }); await page.waitForTimeout(150)
      const layout = await page.evaluate(() => { const root = document.getElementById('root')!.getBoundingClientRect(); const clipped = [...document.querySelectorAll('button,input,select,textarea')].filter((element) => { const node = element as HTMLElement; if (node.offsetParent === null) return false; const rect = node.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1 }).length; return { rootWidth: Math.round(root.width), rootHeight: Math.round(root.height), innerWidth, innerHeight, overflow: document.body.scrollWidth > innerWidth || document.documentElement.scrollWidth > innerWidth, clipped } }); expect(layout.rootWidth).toBe(layout.innerWidth); expect(layout.rootHeight).toBe(layout.innerHeight); expect(layout.overflow).toBe(false); expect(layout.clipped).toBe(0)
      await page.screenshot({ path: join(screenshotDir, `${width}x${height}.png`) })
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize()); await page.waitForTimeout(200); await page.screenshot({ path: join(screenshotDir, 'maximized.png') }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true)); await page.waitForTimeout(300); await page.screenshot({ path: join(screenshotDir, 'fullscreen.png') }); await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setFullScreen(false); window.unmaximize(); window.setSize(1280,800) })
    expect(consoleErrors).toEqual([]); expect(pageErrors).toEqual([]); expect(crashes).toEqual([]); expect(stderr).not.toMatch(/Uncaught Exception|ERR_UNSUPPORTED_DIR_IMPORT|FATAL/)
  } finally { await app.close(); rmSync(dataDir, { recursive: true, force: true }) }
})

test('packaged full sync resumes from a durable checkpoint after process restart', async () => {
  test.setTimeout(120_000)
  const dataDir = mkdtempSync(join(tmpdir(), 'savedatlas-e2e-restart-'))
  const env = { ...process.env, SAVEDATLAS_E2E: '1', SAVEDATLAS_E2E_DATA_DIR: dataDir, SAVEDATLAS_E2E_FAIL_SYNC_ONCE: '1' }
  let app = await electron.launch({ executablePath, env })
  try {
    let page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: 'Начать настройку' }).click(); await page.getByLabel('api_id').fill('12345678'); await page.getByLabel('api_hash').fill('b'.repeat(32)); await page.getByRole('button', { name: 'Продолжить' }).click(); await page.getByLabel('Номер телефона').fill('+79990000001'); await page.getByRole('button', { name: 'Получить код' }).click(); await page.getByLabel('Код из Telegram').fill('12345'); await page.getByRole('button', { name: 'Подтвердить' }).click(); await page.getByLabel('RouterAI API key').fill('mock-key-for-restart-e2e'); await page.getByRole('button', { name: 'Продолжить' }).click(); await page.getByRole('button', { name: 'Завершить и синхронизировать' }).click()
    await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible({ timeout: 30_000 })
    const interrupted = await page.evaluate(async () => ({ setup: await window.savedAtlas!.getSetupState(), sync: await window.savedAtlas!.getSyncProgress(), total: (await window.savedAtlas!.getState()).dashboard.total }))
    expect(interrupted.setup.initialFullSyncComplete).toBe(false); expect(interrupted.sync.checkpointOffset).toBeGreaterThan(0); expect(interrupted.total).toBe(100)
    await app.close()
    app = await electron.launch({ executablePath, env }); page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await expect(page.getByText('Ваша библиотека сохранённых материалов')).toBeVisible({ timeout: 60_000 })
    const resumed = await page.evaluate(async () => { const first = await window.savedAtlas!.searchMessages({ limit: 200, offset: 0 }); const second = await window.savedAtlas!.searchMessages({ limit: 200, offset: first.nextOffset ?? 200 }); return { setup: await window.savedAtlas!.getSetupState(), state: await window.savedAtlas!.getState(), items: [...first.items, ...second.items] } })
    expect(resumed.setup.initialFullSyncComplete).toBe(true); expect(resumed.state.dashboard.total).toBe(260); expect(resumed.items).toHaveLength(260); expect(new Set(resumed.items.map((item) => item.telegramMessageId)).size).toBe(260)
  } finally { await app.close(); rmSync(dataDir, { recursive: true, force: true }) }
})

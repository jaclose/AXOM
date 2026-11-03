import { browser, expect, $ } from '@wdio/globals'
import fs from 'node:fs'
import path from 'node:path'

type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

type Finding = {
    severity: FindingSeverity
    category: string
    message: string
    url?: string
    details?: unknown
}

type RouteResult = {
    url: string
    finalUrl: string
    title: string
    bodyLength: number
    status: 'passed' | 'failed'
    error?: string
    consoleErrors: string[]
    networkFailures: string[]
    screenshot?: string
}

type AuditReport = {
    startedAt: string
    completedAt?: string
    baseUrl: string
    browser?: string
    routesDiscovered: string[]
    routes: RouteResult[]
    findings: Finding[]
    interactionResults: Array<{
        label: string
        type: string
        result: 'passed' | 'failed' | 'skipped'
        beforeUrl?: string
        afterUrl?: string
        error?: string
    }>
    responsiveResults: Array<{
        viewport: string
        width: number
        height: number
        horizontalOverflow: number
        bodyLength: number
        screenshot: string
    }>
    summary?: Record<string, number>
}

const AUDIT_ROOT = path.resolve(process.cwd(), 'artifacts/site-audit')
const SCREENSHOT_ROOT = path.join(AUDIT_ROOT, 'screenshots')
const REPORT_JSON = path.join(AUDIT_ROOT, 'report.json')
const REPORT_MD = path.join(AUDIT_ROOT, 'report.md')

const BASE_URL = 'https://www.axom.info'
const MAX_ROUTES = 80
const ROUTE_SETTLE_MS = 800

const destructivePattern =
    /\b(delete|remove|reset|clear|erase|destroy|logout|log out|sign out|send|submit|purchase|buy|pay|sync|import|export|disconnect|revoke|archive)\b/i

const safeInteractionPattern =
    /\b(continue|next|back|previous|open|close|cancel|skip|start|begin|customize|settings|dashboard|home|question bank|courses|calendar|analytics|reports|daily games|pomodoro|study|practice)\b/i

const report: AuditReport = {
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    routesDiscovered: [],
    routes: [],
    findings: [],
    interactionResults: [],
    responsiveResults: [],
}

function ensureDirectories(): void {
    fs.mkdirSync(AUDIT_ROOT, { recursive: true })
    fs.mkdirSync(SCREENSHOT_ROOT, { recursive: true })
}

function addFinding(
    severity: FindingSeverity,
    category: string,
    message: string,
    url?: string,
    details?: unknown,
): void {
    report.findings.push({
        severity,
        category,
        message,
        url,
        details,
    })
}

function safeFileName(value: string): string {
    const cleaned = value
        .replace(/^https?:\/\//, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120)

    return cleaned || 'home'
}

function normalizeInternalUrl(raw: string, currentUrl: string): string | null {
    try {
        const url = new URL(raw, currentUrl)

        if (!['http:', 'https:'].includes(url.protocol)) {
            return null
        }

        if (!['axom.info', 'www.axom.info'].includes(url.hostname)) {
            return null
        }

        url.hostname = 'www.axom.info'
        url.hash = ''

        const ignoredExtensions =
            /\.(pdf|png|jpe?g|gif|webp|svg|ico|zip|gz|mp4|mp3|wav|docx?|xlsx?|pptx?)$/i

        if (ignoredExtensions.test(url.pathname)) {
            return null
        }

        return url.toString()
    } catch {
        return null
    }
}

async function settlePage(): Promise<void> {
    await browser.pause(ROUTE_SETTLE_MS)

    await browser
        .waitUntil(
            async () => {
                const state = await browser.execute(() => document.readyState)
                return state === 'complete' || state === 'interactive'
            },
            {
                timeout: 10_000,
                interval: 200,
                timeoutMsg: 'Document never reached an interactive state',
            },
        )
        .catch(() => undefined)
}

async function installRuntimeCollectors(): Promise<void> {
    await browser.execute(() => {
        type AuditWindow = Window & {
            __AXOM_AUDIT__?: {
                consoleErrors: string[]
                runtimeErrors: string[]
                promiseRejections: string[]
            }
        }

        const auditWindow = window as AuditWindow

        auditWindow.__AXOM_AUDIT__ = {
            consoleErrors: [],
            runtimeErrors: [],
            promiseRejections: [],
        }

        const originalConsoleError = console.error.bind(console)

        console.error = (...args: unknown[]) => {
            try {
                auditWindow.__AXOM_AUDIT__?.consoleErrors.push(
                    args
                        .map((value) => {
                            if (typeof value === 'string') return value

                            try {
                                return JSON.stringify(value)
                            } catch {
                                return String(value)
                            }
                        })
                        .join(' '),
                )
            } finally {
                originalConsoleError(...args)
            }
        }

        window.addEventListener('error', (event) => {
            auditWindow.__AXOM_AUDIT__?.runtimeErrors.push(
                `${event.message || 'Unknown runtime error'} at ${event.filename || 'unknown'}:${event.lineno || 0}`,
            )
        })

        window.addEventListener('unhandledrejection', (event) => {
            let message = 'Unhandled promise rejection'

            try {
                message =
                    typeof event.reason === 'string'
                        ? event.reason
                        : JSON.stringify(event.reason)
            } catch {
                message = String(event.reason)
            }

            auditWindow.__AXOM_AUDIT__?.promiseRejections.push(message)
        })
    })
}

async function collectRuntimeErrors(): Promise<string[]> {
    return browser.execute(() => {
        type AuditWindow = Window & {
            __AXOM_AUDIT__?: {
                consoleErrors: string[]
                runtimeErrors: string[]
                promiseRejections: string[]
            }
        }

        const data = (window as AuditWindow).__AXOM_AUDIT__

        if (!data) return []

        return [
            ...data.consoleErrors.map((value) => `console.error: ${value}`),
            ...data.runtimeErrors.map((value) => `runtime: ${value}`),
            ...data.promiseRejections.map(
                (value) => `unhandled rejection: ${value}`,
            ),
        ]
    })
}

async function collectNetworkFailures(): Promise<string[]> {
    return browser.execute(() => {
        return performance
            .getEntriesByType('resource')
            .filter((entry) => {
                const resource = entry as PerformanceResourceTiming

                return (
                    resource.duration === 0 ||
                    resource.transferSize === 0 &&
                        !resource.name.startsWith('data:') &&
                        !resource.name.startsWith('blob:')
                )
            })
            .map((entry) => entry.name)
            .filter((value, index, values) => values.indexOf(value) === index)
            .slice(0, 100)
    })
}

async function discoverLinks(currentUrl: string): Promise<string[]> {
    const hrefs = await browser.execute(() => {
        return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
            .map((anchor) => anchor.href)
            .filter(Boolean)
    })

    return hrefs
        .map((href) => normalizeInternalUrl(href, currentUrl))
        .filter((href): href is string => Boolean(href))
}

async function inspectPageStructure(url: string): Promise<void> {
    const structure = await browser.execute(() => {
        const visible = (element: Element): boolean => {
            const htmlElement = element as HTMLElement
            const style = window.getComputedStyle(htmlElement)
            const rect = htmlElement.getBoundingClientRect()

            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || 1) > 0 &&
                rect.width > 0 &&
                rect.height > 0
            )
        }

        const textOf = (element: Element): string =>
            (
                element.getAttribute('aria-label') ||
                element.getAttribute('title') ||
                element.textContent ||
                ''
            )
                .replace(/\s+/g, ' ')
                .trim()

        const duplicateIds = Array.from(document.querySelectorAll<HTMLElement>('[id]'))
            .map((element) => element.id)
            .filter((id, index, values) => id && values.indexOf(id) !== index)
            .filter((id, index, values) => values.indexOf(id) === index)

        const visibleImages = Array.from(
            document.querySelectorAll<HTMLImageElement>('img'),
        ).filter(visible)

        const missingAltImages = visibleImages
            .filter((image) => !image.hasAttribute('alt'))
            .map((image) => image.src)

        const brokenImages = visibleImages
            .filter((image) => image.complete && image.naturalWidth === 0)
            .map((image) => image.src)

        const visibleButtons = Array.from(
            document.querySelectorAll<HTMLElement>(
                'button, [role="button"], input[type="button"], input[type="submit"]',
            ),
        ).filter(visible)

        const unnamedButtons = visibleButtons
            .filter((button) => !textOf(button))
            .map((button) => button.outerHTML.slice(0, 300))

        const visibleLinks = Array.from(
            document.querySelectorAll<HTMLAnchorElement>('a[href]'),
        ).filter(visible)

        const unnamedLinks = visibleLinks
            .filter((link) => !textOf(link) && !link.querySelector('img[alt]'))
            .map((link) => link.outerHTML.slice(0, 300))

        const formFields = Array.from(
            document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
                'input:not([type="hidden"]), textarea, select',
            ),
        ).filter(visible)

        const unlabeledFields = formFields
            .filter((field) => {
                const id = field.id
                const hasExplicitLabel =
                    id &&
                    Boolean(
                        document.querySelector(
                            `label[for="${CSS.escape(id)}"]`,
                        ),
                    )

                const hasWrappingLabel = Boolean(field.closest('label'))
                const hasAccessibleName = Boolean(
                    field.getAttribute('aria-label') ||
                        field.getAttribute('aria-labelledby') ||
                        field.getAttribute('title') ||
                        field.getAttribute('placeholder'),
                )

                return !hasExplicitLabel && !hasWrappingLabel && !hasAccessibleName
            })
            .map((field) => field.outerHTML.slice(0, 300))

        const dialogs = Array.from(
            document.querySelectorAll<HTMLElement>(
                '[role="dialog"], dialog, [aria-modal="true"]',
            ),
        ).filter(visible)

        const unnamedDialogs = dialogs
            .filter(
                (dialog) =>
                    !dialog.getAttribute('aria-label') &&
                    !dialog.getAttribute('aria-labelledby'),
            )
            .map((dialog) => dialog.outerHTML.slice(0, 300))

        const headings = Array.from(
            document.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6'),
        )
            .filter(visible)
            .map((heading) => ({
                level: Number(heading.tagName.slice(1)),
                text: textOf(heading),
            }))

        const headingJumps: string[] = []

        for (let index = 1; index < headings.length; index += 1) {
            const previous = headings[index - 1]
            const current = headings[index]

            if (current.level - previous.level > 1) {
                headingJumps.push(
                    `Heading jumps from H${previous.level} "${previous.text}" to H${current.level} "${current.text}"`,
                )
            }
        }

        const root = document.documentElement
        const horizontalOverflow = Math.max(
            0,
            root.scrollWidth - root.clientWidth,
        )

        const tinyTargets = Array.from(
            document.querySelectorAll<HTMLElement>(
                'button, a[href], input, select, textarea, [role="button"]',
            ),
        )
            .filter(visible)
            .map((element) => {
                const rect = element.getBoundingClientRect()

                return {
                    text: textOf(element).slice(0, 80),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    html: element.outerHTML.slice(0, 200),
                }
            })
            .filter(
                (target) =>
                    target.width > 0 &&
                    target.height > 0 &&
                    (target.width < 24 || target.height < 24),
            )
            .slice(0, 50)

        const mainCount = document.querySelectorAll('main, [role="main"]').length
        const h1Count = Array.from(document.querySelectorAll('h1')).filter(visible).length
        const title = document.title
        const bodyText = document.body?.innerText?.trim() || ''

        return {
            title,
            bodyLength: bodyText.length,
            duplicateIds,
            missingAltImages,
            brokenImages,
            unnamedButtons,
            unnamedLinks,
            unlabeledFields,
            unnamedDialogs,
            headingJumps,
            horizontalOverflow,
            tinyTargets,
            mainCount,
            h1Count,
            buttonCount: visibleButtons.length,
            linkCount: visibleLinks.length,
            fieldCount: formFields.length,
        }
    })

    if (!structure.title.trim()) {
        addFinding('medium', 'SEO/document', 'Page has no document title', url)
    }

    if (structure.bodyLength < 20) {
        addFinding(
            'critical',
            'Rendering',
            `Page has almost no visible content (${structure.bodyLength} characters)`,
            url,
        )
    }

    if (structure.mainCount === 0) {
        addFinding('medium', 'Accessibility', 'No main landmark found', url)
    }

    if (structure.h1Count === 0) {
        addFinding('low', 'Accessibility', 'No visible H1 found', url)
    }

    if (structure.h1Count > 1) {
        addFinding(
            'low',
            'Accessibility',
            `Multiple visible H1 elements found (${structure.h1Count})`,
            url,
        )
    }

    if (structure.duplicateIds.length > 0) {
        addFinding(
            'high',
            'DOM integrity',
            `${structure.duplicateIds.length} duplicate element IDs found`,
            url,
            structure.duplicateIds,
        )
    }

    if (structure.missingAltImages.length > 0) {
        addFinding(
            'medium',
            'Accessibility',
            `${structure.missingAltImages.length} visible images lack alt attributes`,
            url,
            structure.missingAltImages,
        )
    }

    if (structure.brokenImages.length > 0) {
        addFinding(
            'high',
            'Assets',
            `${structure.brokenImages.length} broken images found`,
            url,
            structure.brokenImages,
        )
    }

    if (structure.unnamedButtons.length > 0) {
        addFinding(
            'high',
            'Accessibility',
            `${structure.unnamedButtons.length} visible buttons have no accessible name`,
            url,
            structure.unnamedButtons,
        )
    }

    if (structure.unnamedLinks.length > 0) {
        addFinding(
            'medium',
            'Accessibility',
            `${structure.unnamedLinks.length} visible links have no accessible name`,
            url,
            structure.unnamedLinks,
        )
    }

    if (structure.unlabeledFields.length > 0) {
        addFinding(
            'high',
            'Accessibility',
            `${structure.unlabeledFields.length} visible form fields appear unlabeled`,
            url,
            structure.unlabeledFields,
        )
    }

    if (structure.unnamedDialogs.length > 0) {
        addFinding(
            'high',
            'Accessibility',
            `${structure.unnamedDialogs.length} visible dialogs have no accessible label`,
            url,
            structure.unnamedDialogs,
        )
    }

    if (structure.headingJumps.length > 0) {
        addFinding(
            'low',
            'Accessibility',
            `${structure.headingJumps.length} heading hierarchy jumps found`,
            url,
            structure.headingJumps,
        )
    }

    if (structure.horizontalOverflow > 4) {
        addFinding(
            'high',
            'Responsive layout',
            `Page overflows horizontally by ${structure.horizontalOverflow}px`,
            url,
        )
    }

    if (structure.tinyTargets.length > 0) {
        addFinding(
            'low',
            'Usability',
            `${structure.tinyTargets.length} interactive targets are smaller than 24px`,
            url,
            structure.tinyTargets,
        )
    }
}

async function auditRoute(url: string, index: number): Promise<string[]> {
    const screenshotName = `${String(index + 1).padStart(3, '0')}-${safeFileName(url)}.png`
    const screenshotPath = path.join(SCREENSHOT_ROOT, screenshotName)

    const result: RouteResult = {
        url,
        finalUrl: url,
        title: '',
        bodyLength: 0,
        status: 'passed',
        consoleErrors: [],
        networkFailures: [],
        screenshot: screenshotPath,
    }

    try {
        await browser.url(url)
        await settlePage()
        await installRuntimeCollectors()
        await browser.pause(300)

        result.finalUrl = await browser.getUrl()
        result.title = await browser.getTitle()

        const body = await $('body')
        await expect(body).toBeDisplayed()

        const text = await body.getText()
        result.bodyLength = text.trim().length

        const browserErrorPattern =
            /(this site can.?t be reached|page isn.?t working|404 not found|application error|internal server error|unexpected error|failed to load|chunkloaderror)/i

        if (browserErrorPattern.test(text)) {
            addFinding(
                'critical',
                'Rendering',
                'Browser or application error text detected',
                result.finalUrl,
                text.slice(0, 1000),
            )
            result.status = 'failed'
        }

        await inspectPageStructure(result.finalUrl)

        result.consoleErrors = await collectRuntimeErrors()
        result.networkFailures = await collectNetworkFailures()

        for (const error of result.consoleErrors) {
            addFinding(
                'high',
                'Runtime error',
                error.slice(0, 500),
                result.finalUrl,
            )
        }

        for (const resource of result.networkFailures) {
            addFinding(
                'medium',
                'Network/resource',
                `Resource may have failed or returned no transferred bytes: ${resource}`,
                result.finalUrl,
            )
        }

        await browser.saveScreenshot(screenshotPath)

        const links = await discoverLinks(result.finalUrl)
        report.routes.push(result)

        return links
    } catch (error) {
        result.status = 'failed'
        result.error = error instanceof Error ? error.message : String(error)
        report.routes.push(result)

        addFinding(
            'critical',
            'Route failure',
            result.error,
            url,
        )

        try {
            await browser.saveScreenshot(screenshotPath)
        } catch {
            // The session may already be unavailable.
        }

        return []
    }
}

async function runRouteCrawler(): Promise<void> {
    const queue: string[] = [`${BASE_URL}/`]
    const visited = new Set<string>()

    while (queue.length > 0 && visited.size < MAX_ROUTES) {
        const next = queue.shift()
        if (!next) break

        const normalized = normalizeInternalUrl(next, BASE_URL)
        if (!normalized || visited.has(normalized)) continue

        visited.add(normalized)
        console.log(`[AUDIT] Route ${visited.size}/${MAX_ROUTES}: ${normalized}`)

        const discovered = await auditRoute(normalized, visited.size - 1)

        for (const link of discovered) {
            if (!visited.has(link) && !queue.includes(link)) {
                queue.push(link)
            }
        }
    }

    report.routesDiscovered = Array.from(visited)

    if (queue.length > 0) {
        addFinding(
            'info',
            'Coverage',
            `Route crawl stopped at the safety cap of ${MAX_ROUTES} routes`,
            undefined,
            { remainingQueuedRoutes: queue.length },
        )
    }
}

async function testPersistence(): Promise<void> {
    await browser.url(`${BASE_URL}/`)
    await settlePage()

    const key = `axom-e2e-audit-${Date.now()}`
    const value = `persisted-${Math.random().toString(36).slice(2)}`

    await browser.execute(
        (storageKey, storageValue) => {
            localStorage.setItem(storageKey, storageValue)
        },
        key,
        value,
    )

    await browser.refresh()
    await settlePage()

    const recovered = await browser.execute(
        (storageKey) => localStorage.getItem(storageKey),
        key,
    )

    await browser.execute(
        (storageKey) => localStorage.removeItem(storageKey),
        key,
    )

    if (recovered !== value) {
        addFinding(
            'critical',
            'Persistence',
            'localStorage value did not survive refresh',
            await browser.getUrl(),
            { expected: value, received: recovered },
        )
    }
}

async function auditSafeInteractions(): Promise<void> {
    await browser.url(`${BASE_URL}/`)
    await settlePage()

    const controls = await browser.execute(
        (destructiveSource, safeSource) => {
            const destructive = new RegExp(destructiveSource, 'i')
            const safe = new RegExp(safeSource, 'i')

            const visible = (element: HTMLElement): boolean => {
                const style = getComputedStyle(element)
                const rect = element.getBoundingClientRect()

                return (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    rect.width > 0 &&
                    rect.height > 0
                )
            }

            return Array.from(
                document.querySelectorAll<HTMLElement>(
                    'button, [role="button"], a[href]',
                ),
            )
                .filter(visible)
                .map((element, index) => {
                    const label = (
                        element.getAttribute('aria-label') ||
                        element.getAttribute('title') ||
                        element.textContent ||
                        ''
                    )
                        .replace(/\s+/g, ' ')
                        .trim()

                    const href =
                        element instanceof HTMLAnchorElement
                            ? element.href
                            : null

                    return {
                        index,
                        label,
                        href,
                        tag: element.tagName.toLowerCase(),
                        destructive: destructive.test(label),
                        safe: safe.test(label),
                    }
                })
                .filter(
                    (control) =>
                        control.label &&
                        !control.destructive &&
                        (control.safe ||
                            control.label === "AXOM term-based MD" ||
                            control.label === 'Pre-clinical'),
                )
                .slice(0, 30)
        },
        destructivePattern.source,
        safeInteractionPattern.source,
    )

    for (const control of controls) {
        const beforeUrl = await browser.getUrl()

        try {
            await browser.url(`${BASE_URL}/`)
            await settlePage()

            const candidate = await browser.execute(
                (targetLabel) => {
                    const elements = Array.from(
                        document.querySelectorAll<HTMLElement>(
                            'button, [role="button"], a[href]',
                        ),
                    )

                    const match = elements.find((element) => {
                        const label = (
                            element.getAttribute('aria-label') ||
                            element.getAttribute('title') ||
                            element.textContent ||
                            ''
                        )
                            .replace(/\s+/g, ' ')
                            .trim()

                        return label === targetLabel
                    })

                    if (!match) return { found: false, clicked: false }

                    const rect = match.getBoundingClientRect()
                    const style = getComputedStyle(match)
                    const visible =
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        rect.width > 0 &&
                        rect.height > 0

                    if (!visible) return { found: true, clicked: false }

                    match.click()
                    return { found: true, clicked: true }
                },
                control.label,
            )

            if (!candidate.found || !candidate.clicked) {
                report.interactionResults.push({
                    label: control.label,
                    type: control.tag,
                    result: 'skipped',
                    beforeUrl,
                    afterUrl: await browser.getUrl(),
                })
                continue
            }

            await browser.pause(500)

            const afterUrl = await browser.getUrl()
            const bodyText = await $('body').getText()

            if (
                /(application error|internal server error|unexpected error|chunkloaderror)/i.test(
                    bodyText,
                )
            ) {
                throw new Error('Application error appeared after interaction')
            }

            report.interactionResults.push({
                label: control.label,
                type: control.tag,
                result: 'passed',
                beforeUrl,
                afterUrl,
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            report.interactionResults.push({
                label: control.label,
                type: control.tag,
                result: 'failed',
                beforeUrl,
                afterUrl: await browser.getUrl().catch(() => beforeUrl),
                error: message,
            })

            addFinding(
                'high',
                'Interaction',
                `Safe interaction failed: "${control.label}"`,
                beforeUrl,
                message,
            )
        }
    }
}

async function auditResponsiveLayouts(): Promise<void> {
    const viewports = [
        { name: 'desktop-1440', width: 1440, height: 1000 },
        { name: 'laptop-1280', width: 1280, height: 800 },
        { name: 'tablet-768', width: 768, height: 1024 },
        { name: 'mobile-430', width: 430, height: 932 },
        { name: 'mobile-390', width: 390, height: 844 },
    ]

    for (const viewport of viewports) {
        await browser.setWindowSize(viewport.width, viewport.height)
        await browser.url(`${BASE_URL}/`)
        await settlePage()

        const metrics = await browser.execute(() => {
            const root = document.documentElement
            const bodyText = document.body?.innerText?.trim() || ''

            return {
                horizontalOverflow: Math.max(
                    0,
                    root.scrollWidth - root.clientWidth,
                ),
                bodyLength: bodyText.length,
            }
        })

        const screenshotPath = path.join(
            SCREENSHOT_ROOT,
            `responsive-${viewport.name}.png`,
        )

        await browser.saveScreenshot(screenshotPath)

        report.responsiveResults.push({
            viewport: viewport.name,
            width: viewport.width,
            height: viewport.height,
            horizontalOverflow: metrics.horizontalOverflow,
            bodyLength: metrics.bodyLength,
            screenshot: screenshotPath,
        })

        if (metrics.horizontalOverflow > 4) {
            addFinding(
                'high',
                'Responsive layout',
                `${viewport.name} has ${metrics.horizontalOverflow}px horizontal overflow`,
                await browser.getUrl(),
            )
        }

        if (metrics.bodyLength < 20) {
            addFinding(
                'critical',
                'Responsive layout',
                `${viewport.name} rendered almost no visible content`,
                await browser.getUrl(),
            )
        }
    }
}

function writeReports(): void {
    const severityOrder: FindingSeverity[] = [
        'critical',
        'high',
        'medium',
        'low',
        'info',
    ]

    const summary = Object.fromEntries(
        severityOrder.map((severity) => [
            severity,
            report.findings.filter(
                (finding) => finding.severity === severity,
            ).length,
        ]),
    )

    report.completedAt = new Date().toISOString()
    report.summary = {
        ...summary,
        routesTested: report.routes.length,
        routesPassed: report.routes.filter(
            (route) => route.status === 'passed',
        ).length,
        routesFailed: report.routes.filter(
            (route) => route.status === 'failed',
        ).length,
        interactionsTested: report.interactionResults.length,
        interactionsPassed: report.interactionResults.filter(
            (item) => item.result === 'passed',
        ).length,
        interactionsFailed: report.interactionResults.filter(
            (item) => item.result === 'failed',
        ).length,
        responsiveViewports: report.responsiveResults.length,
    }

    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2))

    const markdown: string[] = [
        '# AXOM Automated Site Audit',
        '',
        `- Started: ${report.startedAt}`,
        `- Completed: ${report.completedAt}`,
        `- Base URL: ${report.baseUrl}`,
        `- Routes tested: ${report.summary.routesTested}`,
        `- Routes passed: ${report.summary.routesPassed}`,
        `- Routes failed: ${report.summary.routesFailed}`,
        `- Safe interactions tested: ${report.summary.interactionsTested}`,
        `- Responsive viewports: ${report.summary.responsiveViewports}`,
        '',
        '## Finding Summary',
        '',
        `- Critical: ${report.summary.critical}`,
        `- High: ${report.summary.high}`,
        `- Medium: ${report.summary.medium}`,
        `- Low: ${report.summary.low}`,
        `- Info: ${report.summary.info}`,
        '',
        '## Findings',
        '',
    ]

    if (report.findings.length === 0) {
        markdown.push('No automated findings were recorded.')
    } else {
        for (const severity of severityOrder) {
            const findings = report.findings.filter(
                (finding) => finding.severity === severity,
            )

            if (findings.length === 0) continue

            markdown.push(`### ${severity.toUpperCase()}`, '')

            for (const finding of findings) {
                markdown.push(
                    `- **${finding.category}:** ${finding.message}`,
                )

                if (finding.url) {
                    markdown.push(`  - URL: ${finding.url}`)
                }

                if (finding.details !== undefined) {
                    const details = JSON.stringify(
                        finding.details,
                        null,
                        2,
                    ).slice(0, 3000)

                    markdown.push(
                        '',
                        '  ```json',
                        ...details.split('\n').map((line) => `  ${line}`),
                        '  ```',
                    )
                }
            }

            markdown.push('')
        }
    }

    markdown.push(
        '## Routes',
        '',
        '| Status | URL | Final URL | Visible characters |',
        '|---|---|---|---:|',
    )

    for (const route of report.routes) {
        markdown.push(
            `| ${route.status} | ${route.url} | ${route.finalUrl} | ${route.bodyLength} |`,
        )
    }

    markdown.push(
        '',
        '## Safe Interactions',
        '',
        '| Result | Control | Type | Before | After |',
        '|---|---|---|---|---|',
    )

    for (const item of report.interactionResults) {
        markdown.push(
            `| ${item.result} | ${item.label.replace(/\|/g, '\\|')} | ${item.type} | ${item.beforeUrl || ''} | ${item.afterUrl || ''} |`,
        )
    }

    markdown.push(
        '',
        '## Responsive Checks',
        '',
        '| Viewport | Size | Horizontal overflow | Visible characters | Screenshot |',
        '|---|---:|---:|---:|---|',
    )

    for (const item of report.responsiveResults) {
        markdown.push(
            `| ${item.viewport} | ${item.width}×${item.height} | ${item.horizontalOverflow}px | ${item.bodyLength} | ${item.screenshot} |`,
        )
    }

    fs.writeFileSync(REPORT_MD, markdown.join('\n'))

    console.log('')
    console.log('========================================')
    console.log('AXOM AUDIT COMPLETE')
    console.log('========================================')
    console.log(`Routes tested: ${report.summary.routesTested}`)
    console.log(`Critical findings: ${report.summary.critical}`)
    console.log(`High findings: ${report.summary.high}`)
    console.log(`Medium findings: ${report.summary.medium}`)
    console.log(`Markdown report: ${REPORT_MD}`)
    console.log(`JSON report: ${REPORT_JSON}`)
    console.log(`Screenshots: ${SCREENSHOT_ROOT}`)
    console.log('========================================')
}

describe('AXOM comprehensive production audit', () => {
    before(() => {
        ensureDirectories()
        report.browser = browser.capabilities.browserName
    })

    it('crawls and audits internal routes', async function () {
        this.timeout(180_000)
        await runRouteCrawler()

        expect(report.routes.length).toBeGreaterThan(0)
    })

    it('checks isolated browser persistence across refresh', async () => {
        await testPersistence()
    })

    it('exercises safe onboarding and navigation controls', async function () {
        this.timeout(90_000)
        await auditSafeInteractions()
    })

    it('checks desktop, tablet, and mobile rendering', async function () {
        this.timeout(60_000)
        await auditResponsiveLayouts()
    })

    after(() => {
        writeReports()
    })
})

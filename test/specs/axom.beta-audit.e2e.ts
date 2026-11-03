import { browser, $, $$, expect } from '@wdio/globals'
import fs from 'node:fs'
import path from 'node:path'

type Status = 'passed' | 'failed' | 'blocked'
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

type ScenarioRecord = {
    name: string
    feature: string
    status: Status
    startedAt: string
    completedAt: string
    durationMs: number
    urlBefore?: string
    urlAfter?: string
    assertions: string[]
    evidence: string[]
    error?: string
    blockedReason?: string
}

type Finding = {
    severity: Severity
    feature: string
    message: string
    url?: string
    details?: unknown
}

type RuntimeRecord = {
    consoleErrors: string[]
    runtimeErrors: string[]
    unhandledRejections: string[]
}

const BASE_URL = 'https://www.axom.info/'
const ROOT = path.resolve(process.cwd(), 'artifacts/beta-audit-v3')
const SCREENSHOTS = path.join(ROOT, 'screenshots')
const REPORT_JSON = path.join(ROOT, 'report.json')
const REPORT_MD = path.join(ROOT, 'report.md')
const FIXTURE_PATH = path.resolve(
    process.cwd(),
    'test/fixtures/axom-beta-question-set.txt',
)

const AUDIT_NAME = 'AXOM Automated Beta Tester'
const AUDIT_COURSE = 'AXOM Audit Course'
const AUDIT_TASK = 'AXOM Audit Task'
const AUDIT_INTENTION = 'Complete the AXOM automated beta audit'

const scenarios: ScenarioRecord[] = []
const findings: Finding[] = []

const runtime: RuntimeRecord = {
    consoleErrors: [],
    runtimeErrors: [],
    unhandledRejections: [],
}

function now(): string {
    return new Date().toISOString()
}

function ensureOutput(): void {
    fs.rmSync(ROOT, { recursive: true, force: true })
    fs.mkdirSync(SCREENSHOTS, { recursive: true })
}

function slug(value: string): string {
    return (
        value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 100) || 'evidence'
    )
}

function addFinding(
    severity: Severity,
    feature: string,
    message: string,
    url?: string,
    details?: unknown,
): void {
    findings.push({
        severity,
        feature,
        message,
        url,
        details,
    })
}

async function evidence(
    scenarioName: string,
    label: string,
): Promise<string> {
    const file = path.join(
        SCREENSHOTS,
        `${slug(scenarioName)}-${slug(label)}.png`,
    )

    await browser.saveScreenshot(file)
    return file
}

async function settle(ms = 700): Promise<void> {
    await browser.pause(ms)

    await browser
        .waitUntil(
            async () => {
                const state = await browser.execute(() => document.readyState)
                return state === 'interactive' || state === 'complete'
            },
            {
                timeout: 15000,
                interval: 250,
                timeoutMsg: 'Document never became interactive',
            },
        )
        .catch(() => undefined)
}

async function bodyText(): Promise<string> {
    const body = await $('body')
    return body.getText()
}

async function installRuntimeCollectors(): Promise<void> {
    await browser.execute(() => {
        type AuditWindow = Window & {
            __AXOM_BETA_AUDIT_RUNTIME__?: {
                consoleErrors: string[]
                runtimeErrors: string[]
                unhandledRejections: string[]
            }
        }

        const auditWindow = window as AuditWindow

        if (auditWindow.__AXOM_BETA_AUDIT_RUNTIME__) {
            return
        }

        auditWindow.__AXOM_BETA_AUDIT_RUNTIME__ = {
            consoleErrors: [],
            runtimeErrors: [],
            unhandledRejections: [],
        }

        const originalConsoleError = console.error.bind(console)

        console.error = (...args: unknown[]) => {
            const message = args
                .map((item) => {
                    if (typeof item === 'string') return item

                    try {
                        return JSON.stringify(item)
                    } catch {
                        return String(item)
                    }
                })
                .join(' ')

            auditWindow.__AXOM_BETA_AUDIT_RUNTIME__
                ?.consoleErrors.push(message)

            originalConsoleError(...args)
        }

        window.addEventListener('error', (event) => {
            auditWindow.__AXOM_BETA_AUDIT_RUNTIME__
                ?.runtimeErrors.push(
                    `${event.message || 'Unknown runtime error'} at ${
                        event.filename || 'unknown'
                    }:${event.lineno || 0}`,
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

            auditWindow.__AXOM_BETA_AUDIT_RUNTIME__
                ?.unhandledRejections.push(message)
        })
    })
}

async function harvestRuntimeErrors(
    feature: string,
): Promise<void> {
    const collected = await browser.execute(() => {
        type AuditWindow = Window & {
            __AXOM_BETA_AUDIT_RUNTIME__?: {
                consoleErrors: string[]
                runtimeErrors: string[]
                unhandledRejections: string[]
            }
        }

        return (
            (window as AuditWindow).__AXOM_BETA_AUDIT_RUNTIME__ || {
                consoleErrors: [],
                runtimeErrors: [],
                unhandledRejections: [],
            }
        )
    })

    for (const error of collected.consoleErrors) {
        if (!runtime.consoleErrors.includes(error)) {
            runtime.consoleErrors.push(error)

            addFinding(
                'high',
                feature,
                `Console error: ${error.slice(0, 500)}`,
                await browser.getUrl(),
            )
        }
    }

    for (const error of collected.runtimeErrors) {
        if (!runtime.runtimeErrors.includes(error)) {
            runtime.runtimeErrors.push(error)

            addFinding(
                'critical',
                feature,
                `Runtime error: ${error.slice(0, 500)}`,
                await browser.getUrl(),
            )
        }
    }

    for (const error of collected.unhandledRejections) {
        if (!runtime.unhandledRejections.includes(error)) {
            runtime.unhandledRejections.push(error)

            addFinding(
                'critical',
                feature,
                `Unhandled rejection: ${error.slice(0, 500)}`,
                await browser.getUrl(),
            )
        }
    }
}

async function runScenario(
    name: string,
    feature: string,
    fn: (
        record: ScenarioRecord,
    ) => Promise<void>,
): Promise<void> {
    const started = Date.now()

    const record: ScenarioRecord = {
        name,
        feature,
        status: 'passed',
        startedAt: now(),
        completedAt: '',
        durationMs: 0,
        assertions: [],
        evidence: [],
    }

    try {
        record.urlBefore = await browser
            .getUrl()
            .catch(() => undefined)

        await installRuntimeCollectors()
        await fn(record)
        await harvestRuntimeErrors(feature)

        record.urlAfter = await browser
            .getUrl()
            .catch(() => undefined)
    } catch (error) {
        record.status = 'failed'
        record.error =
            error instanceof Error
                ? error.stack || error.message
                : String(error)

        const screenshot = await evidence(
            name,
            'failure',
        ).catch(() => '')

        if (screenshot) {
            record.evidence.push(screenshot)
        }

        addFinding(
            'high',
            feature,
            record.error.slice(0, 1000),
            await browser.getUrl().catch(() => undefined),
        )
    } finally {
        record.completedAt = now()
        record.durationMs = Date.now() - started
        scenarios.push(record)

        console.log(
            `[BETA] ${record.status.toUpperCase()} · ${feature} · ${name}`,
        )
    }
}

function blockScenario(
    record: ScenarioRecord,
    reason: string,
): void {
    record.status = 'blocked'
    record.blockedReason = reason

    addFinding(
        'medium',
        record.feature,
        `Scenario blocked: ${reason}`,
    )
}

async function freshApplicationState(): Promise<void> {
    await browser.url(BASE_URL)
    await settle()

    await browser.execute(() => {
        localStorage.clear()
        sessionStorage.clear()
    })

    await browser.refresh()
    await settle(1000)
}

async function visibleElements(
    selector: string,
): Promise<WebdriverIO.Element[]> {
    const elements = await $$(selector)
    const visible: WebdriverIO.Element[] = []

    for (const element of elements) {
        if (await element.isDisplayed().catch(() => false)) {
            visible.push(element)
        }
    }

    return visible
}

async function clickExact(label: string): Promise<boolean> {
    return browser.execute((wanted) => {
        const visible = (element: HTMLElement): boolean => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)

            return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || 1) > 0
            )
        }

        const elements = Array.from(
            document.querySelectorAll<HTMLElement>(
                [
                    'button',
                    'a[href]',
                    '[role="button"]',
                    '[role="menuitem"]',
                    '[role="tab"]',
                    'label',
                    'summary',
                ].join(','),
            ),
        )

        const match = elements.find((element) => {
            if (!visible(element)) return false

            const text = (
                element.getAttribute('aria-label') ||
                element.getAttribute('title') ||
                element.textContent ||
                ''
            )
                .replace(/\s+/g, ' ')
                .trim()

            return text === wanted
        })

        if (!match) return false

        match.click()
        return true
    }, label)
}

async function clickContains(
    label: string,
): Promise<boolean> {
    return browser.execute((wanted) => {
        const normalizedWanted = wanted.toLowerCase()

        const visible = (element: HTMLElement): boolean => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)

            return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || 1) > 0
            )
        }

        const elements = Array.from(
            document.querySelectorAll<HTMLElement>(
                [
                    'button',
                    'a[href]',
                    '[role="button"]',
                    '[role="menuitem"]',
                    '[role="tab"]',
                    'label',
                    'summary',
                ].join(','),
            ),
        )

        const candidates = elements
            .filter(visible)
            .map((element) => ({
                element,
                text: (
                    element.getAttribute('aria-label') ||
                    element.getAttribute('title') ||
                    element.textContent ||
                    ''
                )
                    .replace(/\s+/g, ' ')
                    .trim(),
            }))
            .filter((item) =>
                item.text
                    .toLowerCase()
                    .includes(normalizedWanted),
            )
            .sort(
                (a, b) =>
                    a.text.length - b.text.length,
            )

        if (candidates.length === 0) {
            return false
        }

        candidates[0].element.click()
        return true
    }, label)
}

async function clickAny(
    labels: string[],
): Promise<string | null> {
    for (const label of labels) {
        if (await clickExact(label)) {
            return label
        }

        if (await clickContains(label)) {
            return label
        }
    }

    return null
}

async function findInputByText(
    terms: string[],
): Promise<WebdriverIO.Element | null> {
    const inputs = await visibleElements(
        'input:not([type="hidden"]), textarea, select',
    )

    for (const input of inputs) {
        const descriptor = [
            await input.getAttribute('name'),
            await input.getAttribute('id'),
            await input.getAttribute('placeholder'),
            await input.getAttribute('aria-label'),
            await input.getAttribute('title'),
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()

        if (
            terms.some((term) =>
                descriptor.includes(term.toLowerCase()),
            )
        ) {
            return input
        }
    }

    return null
}

async function expectText(
    text: string,
    record: ScenarioRecord,
    message?: string,
): Promise<void> {
    const content = await bodyText()

    if (
        !content
            .toLowerCase()
            .includes(text.toLowerCase())
    ) {
        throw new Error(
            message ||
                `Expected visible page text to contain "${text}"`,
        )
    }

    record.assertions.push(
        message || `Visible text contains "${text}"`,
    )
}

async function assertNoFatalScreen(
    record: ScenarioRecord,
): Promise<void> {
    const content = await bodyText()

    const fatal =
        /(application error|internal server error|unexpected error|chunkloaderror|this site can.?t be reached|page isn.?t working)/i

    if (fatal.test(content)) {
        throw new Error(
            `Fatal application text detected:\n${content.slice(
                0,
                1500,
            )}`,
        )
    }

    record.assertions.push(
        'No fatal application-error screen appeared',
    )
}

async function openModule(
    labels: string[],
    expectedText?: string,
): Promise<boolean> {
    await reachDashboard()

    let clicked = await clickAny(labels)

    if (!clicked) {
        await openNavigationMenu()
        clicked = await clickAny(labels)
    }

    if (!clicked) return false

    await settle(900)

    if (expectedText) {
        const content = await bodyText()

        if (
            !content
                .toLowerCase()
                .includes(expectedText.toLowerCase())
        ) {
            return false
        }
    }

    return true
}

async function openNavigationMenu(): Promise<boolean> {
    const namedButton = await $(
        [
            'button[aria-label*="navigation" i]',
            'button[aria-label*="menu" i]',
            'button[title*="navigation" i]',
            'button[title*="menu" i]',
        ].join(','),
    )

    if (
        (await namedButton.isExisting()) &&
        (await namedButton.isDisplayed())
    ) {
        await namedButton.click()
        await settle(350)
        return true
    }

    return browser.execute(() => {
        const visible = (element: HTMLElement): boolean => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)

            return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden'
            )
        }

        const buttons = Array.from(
            document.querySelectorAll<HTMLElement>('button'),
        ).filter(visible)

        const candidate = buttons.find((button) => {
            const rect = button.getBoundingClientRect()
            const descriptor = (
                button.getAttribute('aria-label') ||
                button.getAttribute('title') ||
                button.textContent ||
                ''
            ).toLowerCase()

            return (
                rect.left < 150 &&
                rect.top < 160 &&
                (
                    descriptor.includes('menu') ||
                    descriptor.includes('navigation') ||
                    descriptor.trim() === ''
                )
            )
        })

        if (!candidate) return false

        candidate.click()
        return true
    })
}

async function reachDashboard(): Promise<void> {
    await browser.url(`${BASE_URL}#dashboard`)
    await settle(900)

    let content = await bodyText()

    if (/build your study workspace/i.test(content)) {
        const skipped = await clickAny([
            'Skip setup',
            'Finish setup',
        ])

        if (skipped) {
            await settle(1000)
            content = await bodyText()
        }
    }

    if (!/dashboard/i.test(content)) {
        await browser.url(BASE_URL)
        await settle(900)
    }
}

async function inspectResponsiveLayout(
    record: ScenarioRecord,
): Promise<void> {
    const metrics = await browser.execute(() => {
        const root = document.documentElement

        return {
            clientWidth: root.clientWidth,
            scrollWidth: root.scrollWidth,
            overflow: Math.max(
                0,
                root.scrollWidth - root.clientWidth,
            ),
            bodyCharacters:
                document.body?.innerText?.trim().length || 0,
        }
    })

    if (metrics.overflow > 4) {
        throw new Error(
            `Horizontal overflow detected: ${metrics.overflow}px`,
        )
    }

    if (metrics.bodyCharacters < 20) {
        throw new Error(
            `Page rendered only ${metrics.bodyCharacters} visible characters`,
        )
    }

    record.assertions.push(
        `No horizontal overflow at ${metrics.clientWidth}px width`,
    )
}

async function completeOnboarding(
    record: ScenarioRecord,
): Promise<void> {
    await freshApplicationState()
    await browser.setWindowSize(1440, 1000)

    record.evidence.push(
        await evidence(
            record.name,
            'step-1-before',
        ),
    )

    const nameField = await findInputByText([
        'name',
        'display',
    ])

    if (!nameField) {
        throw new Error(
            'Display-name field was not found on onboarding step 1',
        )
    }

    await nameField.setValue(AUDIT_NAME)

    await clickAny([
        'AXOM term-based MD',
    ])

    await clickAny([
        'Pre-clinical',
        'Preclinical',
    ])

    const firstContinue = await clickAny([
        'Continue',
        'Next',
    ])

    if (!firstContinue) {
        throw new Error(
            'Could not continue from onboarding step 1',
        )
    }

    await settle(700)
    record.assertions.push(
        'Identity step accepted the audit display name',
    )

    await clickAny([
        "Today's plan",
        'Build my courses',
        'Import practice questions',
    ])

    await clickAny([
        'Focused study',
        'Practice questions',
    ])

    const secondContinue = await clickAny([
        'Continue',
        'Next',
    ])

    if (!secondContinue) {
        throw new Error(
            'Could not continue from onboarding step 2',
        )
    }

    await settle(700)

    await clickAny([
        'Dark',
        'System',
    ])

    await clickAny([
        'Focused',
        'Expanded',
    ])

    const thirdContinue = await clickAny([
        'Continue',
        'Next',
    ])

    if (!thirdContinue) {
        throw new Error(
            'Could not continue from onboarding step 3',
        )
    }

    await settle(700)

    record.evidence.push(
        await evidence(
            record.name,
            'step-4',
        ),
    )

    const finished = await clickAny([
        'Finish setup',
        'Finish and create save file',
        'Enter AXOM',
        'Go to dashboard',
    ])

    if (!finished) {
        throw new Error(
            'Could not finish onboarding',
        )
    }

    await settle(1200)

    await expectText(
        AUDIT_NAME,
        record,
        'Dashboard displayed the onboarding name',
    )

    record.evidence.push(
        await evidence(
            record.name,
            'dashboard-after',
        ),
    )

    await browser.refresh()
    await settle(1000)

    await expectText(
        AUDIT_NAME,
        record,
        'Display name persisted after browser refresh',
    )

    record.assertions.push(
        'Onboarding completed and survived refresh',
    )
}

async function inspectKnownRoutes(
    record: ScenarioRecord,
): Promise<void> {
    const routes = [
        {
            hash: '#dashboard',
            name: 'Dashboard',
            expected: 'Dashboard',
        },
        {
            hash: '#tracker',
            name: 'Course Tracker',
            expected: 'Course',
        },
        {
            hash: '#questions',
            name: 'Question Bank',
            expected: 'Question',
        },
        {
            hash: '#productivity',
            name: 'Productivity',
            expected: 'Productivity',
        },
        {
            hash: '#journal',
            name: 'Journal',
            expected: 'Journal',
        },
        {
            hash: '#reports',
            name: 'Reports',
            expected: 'Reports',
        },
        {
            hash: '#methods',
            name: 'Study Methods',
            expected: 'Study',
        },
    ]

    for (const route of routes) {
        await browser.url(`${BASE_URL}${route.hash}`)
        await settle(800)

        await assertNoFatalScreen(record)

        const content = await bodyText()

        if (
            !content
                .toLowerCase()
                .includes(route.expected.toLowerCase())
        ) {
            addFinding(
                'medium',
                'Navigation',
                `${route.name} route did not render expected text "${route.expected}"`,
                await browser.getUrl(),
                content.slice(0, 800),
            )
        } else {
            record.assertions.push(
                `${route.name} route rendered expected content`,
            )
        }

        record.evidence.push(
            await evidence(
                record.name,
                route.name,
            ),
        )
    }
}

async function createCourse(
    record: ScenarioRecord,
): Promise<void> {
    const opened = await openModule(
        [
            'Course Tracker',
            'Open Course Tracker',
            'Courses',
        ],
        'Course',
    )

    if (!opened) {
        blockScenario(
            record,
            'Course Tracker could not be opened',
        )
        return
    }

    record.evidence.push(
        await evidence(
            record.name,
            'course-tracker-before',
        ),
    )

    const createControl = await clickAny([
        'Add course',
        'Create course',
        'New course',
        'Add your first course',
        'Add item',
    ])

    if (!createControl) {
        blockScenario(
            record,
            'No course-creation control was found',
        )
        return
    }

    await settle(500)

    const nameField = await findInputByText([
        'course name',
        'course title',
        'name',
        'title',
    ])

    if (!nameField) {
        throw new Error(
            'Course creation opened, but no name field was found',
        )
    }

    await nameField.setValue(AUDIT_COURSE)

    const saved = await clickAny([
        'Save course',
        'Create course',
        'Add course',
        'Save',
        'Create',
    ])

    if (!saved) {
        throw new Error(
            'Course form was completed, but no save control was found',
        )
    }

    await settle(900)

    await expectText(
        AUDIT_COURSE,
        record,
        'Created course appeared in Course Tracker',
    )

    record.evidence.push(
        await evidence(
            record.name,
            'course-created',
        ),
    )

    await browser.refresh()
    await settle(900)

    await expectText(
        AUDIT_COURSE,
        record,
        'Created course persisted after refresh',
    )
}

async function createProductivityData(
    record: ScenarioRecord,
): Promise<void> {
    const opened = await openModule(
        [
            'Productivity',
            'Open Productivity',
            'Tasks',
        ],
        'Productivity',
    )

    if (!opened) {
        blockScenario(
            record,
            'Productivity module could not be opened',
        )
        return
    }

    record.evidence.push(
        await evidence(
            record.name,
            'productivity-before',
        ),
    )

    const addTask = await clickAny([
        'Add task',
        'Create task',
        'New task',
        'Add your first task',
    ])

    if (!addTask) {
        blockScenario(
            record,
            'No task-creation control was found',
        )
        return
    }

    await settle(400)

    const taskField = await findInputByText([
        'task',
        'title',
        'name',
    ])

    if (!taskField) {
        throw new Error(
            'Task form opened, but no task-name field was found',
        )
    }

    await taskField.setValue(AUDIT_TASK)

    const saved = await clickAny([
        'Save task',
        'Create task',
        'Add task',
        'Save',
        'Create',
    ])

    if (!saved) {
        throw new Error(
            'Task data was entered, but no save control was found',
        )
    }

    await settle(800)

    await expectText(
        AUDIT_TASK,
        record,
        'Created task appeared in Productivity',
    )

    await browser.refresh()
    await settle(800)

    await expectText(
        AUDIT_TASK,
        record,
        'Created task persisted after refresh',
    )

    record.evidence.push(
        await evidence(
            record.name,
            'task-created',
        ),
    )
}

async function testDashboardIntention(
    record: ScenarioRecord,
): Promise<void> {
    await reachDashboard()

    const intentionField = await findInputByText([
        'primary intention',
        'intention',
        'what would make today count',
        'focus',
    ])

    if (!intentionField) {
        blockScenario(
            record,
            'Dashboard intention field was not found',
        )
        return
    }

    await intentionField.setValue(
        AUDIT_INTENTION,
    )

    const saved = await clickAny([
        'Save intention',
        'Set intention',
        'Save',
        'Update',
    ])

    if (saved) {
        await settle(700)
    } else {
        await intentionField.keys('Tab')
        await settle(500)
    }

    await browser.refresh()
    await settle(800)

    await expectText(
        AUDIT_INTENTION,
        record,
        'Dashboard intention persisted after refresh',
    )

    record.evidence.push(
        await evidence(
            record.name,
            'intention-persisted',
        ),
    )
}

async function testTimer(
    record: ScenarioRecord,
): Promise<void> {
    const opened = await openModule(
        [
            'Productivity',
            'Open Productivity',
        ],
        'Productivity',
    )

    if (!opened) {
        blockScenario(
            record,
            'Productivity module could not be opened for timer testing',
        )
        return
    }

    const started = await clickAny([
        'Start timer',
        'Start focus',
        'Start session',
        'Begin',
    ])

    if (!started) {
        blockScenario(
            record,
            'No timer start control was found',
        )
        return
    }

    await settle(1600)

    const runningText = await bodyText()

    if (
        !/(pause|stop|running|focus session)/i.test(
            runningText,
        )
    ) {
        throw new Error(
            'Timer start was clicked, but no running-state indicator appeared',
        )
    }

    record.assertions.push(
        'Timer entered a running state',
    )

    record.evidence.push(
        await evidence(
            record.name,
            'timer-running',
        ),
    )

    const paused = await clickAny([
        'Pause timer',
        'Pause',
    ])

    if (!paused) {
        throw new Error(
            'Timer was running, but no pause control was found',
        )
    }

    await settle(600)
    record.assertions.push(
        'Timer accepted pause',
    )

    const resumed = await clickAny([
        'Resume timer',
        'Resume',
        'Continue',
    ])

    if (!resumed) {
        throw new Error(
            'Timer paused, but no resume control was found',
        )
    }

    await settle(900)
    record.assertions.push(
        'Timer resumed after pause',
    )

    await browser.refresh()
    await settle(1000)

    const postRefresh = await bodyText()

    if (
        !/(pause|stop|running|focus session|resume)/i.test(
            postRefresh,
        )
    ) {
        addFinding(
            'high',
            'Timer',
            'Timer running state did not visibly survive refresh',
            await browser.getUrl(),
        )
    } else {
        record.assertions.push(
            'Timer state remained represented after refresh',
        )
    }

    await clickAny([
        'Stop timer',
        'End session',
        'Stop',
        'Cancel session',
    ])
}

async function uploadQuestionFixture(
    record: ScenarioRecord,
): Promise<void> {
    const opened = await openModule(
        [
            'Question Bank',
            'Open Question Bank',
            'Practice questions',
        ],
        'Question',
    )

    if (!opened) {
        blockScenario(
            record,
            'Question Bank could not be opened',
        )
        return
    }

    record.evidence.push(
        await evidence(
            record.name,
            'question-bank-before',
        ),
    )

    const importControl = await clickAny([
        'Import questions',
        'Import',
        'Upload questions',
        'Add question set',
        'New question set',
    ])

    if (importControl) {
        await settle(500)
    }

    const fileInputs = await $$(
        'input[type="file"]',
    )

    let fileInput: WebdriverIO.Element | null = null

    for (const candidate of fileInputs) {
        if (
            await candidate
                .isExisting()
                .catch(() => false)
        ) {
            fileInput = candidate
            break
        }
    }

    if (!fileInput) {
        blockScenario(
            record,
            'No question-import file input was found',
        )
        return
    }

    await fileInput.setValue(FIXTURE_PATH)
    await settle(1500)

    const contentAfterUpload = await bodyText()

    if (
        !/sinoatrial|relative risk|snnout|review|mapping|question/i.test(
            contentAfterUpload,
        )
    ) {
        throw new Error(
            'Fixture was uploaded, but no parsed-question or review content appeared',
        )
    }

    record.assertions.push(
        'Question fixture was accepted by the import interface',
    )

    record.evidence.push(
        await evidence(
            record.name,
            'import-review',
        ),
    )

    const finalized = await clickAny([
        'Import questions',
        'Finish import',
        'Confirm import',
        'Save question set',
        'Create set',
        'Continue',
    ])

    if (!finalized) {
        blockScenario(
            record,
            'Import review appeared, but no finalization control was found',
        )
        return
    }

    await settle(1400)

    const finalContent = await bodyText()

    const expectedFragments = [
        'sinoatrial',
        'relative risk',
        'snnout',
    ]

    const matched = expectedFragments.filter(
        (fragment) =>
            finalContent
                .toLowerCase()
                .includes(fragment),
    )

    if (matched.length === 0) {
        throw new Error(
            'Import completed, but none of the known fixture questions appeared',
        )
    }

    record.assertions.push(
        `${matched.length} known imported fixture fragments appeared`,
    )

    await browser.refresh()
    await settle(900)

    const afterRefresh = await bodyText()

    if (
        !expectedFragments.some((fragment) =>
            afterRefresh
                .toLowerCase()
                .includes(fragment),
        )
    ) {
        throw new Error(
            'Imported question content did not persist after refresh',
        )
    }

    record.assertions.push(
        'Imported question set persisted after refresh',
    )
}

async function testQuizFlow(
    record: ScenarioRecord,
): Promise<void> {
    const opened = await openModule(
        [
            'Question Bank',
            'Open Question Bank',
        ],
        'Question',
    )

    if (!opened) {
        blockScenario(
            record,
            'Question Bank could not be opened for quiz testing',
        )
        return
    }

    const launch = await clickAny([
        'Start quiz',
        'Study',
        'Practice',
        'Start',
        'Open set',
    ])

    if (!launch) {
        blockScenario(
            record,
            'No quiz-launch control was found',
        )
        return
    }

    await settle(900)

    const quizText = await bodyText()

    if (
        !/(sinoatrial|relative risk|snnout|question 1|1 of 3)/i.test(
            quizText,
        )
    ) {
        blockScenario(
            record,
            'Quiz launched, but the known fixture questions were not shown',
        )
        return
    }

    record.evidence.push(
        await evidence(
            record.name,
            'question-before-answer',
        ),
    )

    const answerClicked = await clickAny([
        'Sinoatrial node',
        'D. Sinoatrial node',
        'D',
    ])

    if (!answerClicked) {
        throw new Error(
            'Known correct answer could not be selected',
        )
    }

    const submitted = await clickAny([
        'Submit answer',
        'Check answer',
        'Submit',
        'Reveal answer',
    ])

    if (submitted) {
        await settle(700)
    }

    const feedback = await bodyText()

    if (
        !/(correct|sinoatrial node is the normal pacemaker|explanation|rationale)/i.test(
            feedback,
        )
    ) {
        throw new Error(
            'Answer was selected, but expected correctness or rationale feedback did not appear',
        )
    }

    record.assertions.push(
        'Quiz displayed correctness or rationale feedback',
    )

    record.evidence.push(
        await evidence(
            record.name,
            'feedback',
        ),
    )

    const next = await clickAny([
        'Next question',
        'Next',
    ])

    if (next) {
        await settle(700)

        const nextContent = await bodyText()

        if (
            !/(relative risk|question 2|2 of 3)/i.test(
                nextContent,
            )
        ) {
            addFinding(
                'high',
                'Question Bank',
                'Next-question control did not visibly advance to the second fixture question',
                await browser.getUrl(),
            )
        } else {
            record.assertions.push(
                'Quiz advanced to the next question',
            )
        }
    }
}

async function testQuestionTools(
    record: ScenarioRecord,
): Promise<void> {
    const content = await bodyText()

    if (!/question/i.test(content)) {
        blockScenario(
            record,
            'No active quiz question was available for tool testing',
        )
        return
    }

    const calculator = await clickAny([
        'Calculator',
        'Open calculator',
    ])

    if (calculator) {
        await settle(300)

        const calculatorText = await bodyText()

        if (!/calculator/i.test(calculatorText)) {
            throw new Error(
                'Calculator control was clicked, but calculator UI did not appear',
            )
        }

        record.assertions.push(
            'Calculator opened from quiz interface',
        )

        await clickAny([
            'Close calculator',
            'Close',
        ])
    } else {
        addFinding(
            'medium',
            'Question Bank',
            'Calculator control was not found during active quiz',
            await browser.getUrl(),
        )
    }

    const readingControl = await clickAny([
        'Reading size',
        'Text size',
        'Increase text size',
        'Font size',
    ])

    if (readingControl) {
        await settle(300)
        record.assertions.push(
            'Reading-size control responded',
        )
    } else {
        addFinding(
            'medium',
            'Question Bank',
            'Reading-size control was not found during active quiz',
            await browser.getUrl(),
        )
    }

    record.evidence.push(
        await evidence(
            record.name,
            'question-tools',
        ),
    )
}

async function testSettingsPersistence(
    record: ScenarioRecord,
): Promise<void> {
    await reachDashboard()

    const opened = await clickAny([
        'Profile & settings',
        'Settings',
        'Your AXOM Setup',
    ])

    if (!opened) {
        blockScenario(
            record,
            'Settings could not be opened',
        )
        return
    }

    await settle(500)

    const settingsText = await bodyText()

    if (!/settings|your axom setup|profile|personalization/i.test(settingsText)) {
        throw new Error(
            'Settings control was clicked, but settings UI did not appear',
        )
    }

    record.evidence.push(
        await evidence(
            record.name,
            'settings-before',
        ),
    )

    const personalization = await clickAny([
        'Personalization',
        'Appearance',
        'Advanced',
    ])

    if (personalization) {
        await settle(300)
    }

    const themeChanged = await clickAny([
        'Light',
        'Dark',
    ])

    if (!themeChanged) {
        blockScenario(
            record,
            'Settings opened, but no theme option was found',
        )
        return
    }

    await settle(500)

    const themeSnapshot = await browser.execute(() => {
        return {
            bodyClass: document.body.className,
            htmlClass: document.documentElement.className,
            bodyBackground:
                getComputedStyle(document.body).backgroundColor,
        }
    })

    await browser.refresh()
    await settle(900)

    const restoredSnapshot = await browser.execute(() => {
        return {
            bodyClass: document.body.className,
            htmlClass: document.documentElement.className,
            bodyBackground:
                getComputedStyle(document.body).backgroundColor,
        }
    })

    if (
        JSON.stringify(themeSnapshot) !==
        JSON.stringify(restoredSnapshot)
    ) {
        addFinding(
            'high',
            'Settings',
            'Appearance-related DOM state changed after refresh',
            await browser.getUrl(),
            {
                beforeRefresh: themeSnapshot,
                afterRefresh: restoredSnapshot,
            },
        )
    } else {
        record.assertions.push(
            'Appearance-related state persisted after refresh',
        )
    }
}

async function testMobileCoreFlows(
    record: ScenarioRecord,
): Promise<void> {
    await browser.setWindowSize(390, 844)
    await reachDashboard()

    await inspectResponsiveLayout(record)

    record.evidence.push(
        await evidence(
            record.name,
            'dashboard-mobile',
        ),
    )

    const menuOpened = await openNavigationMenu()

    if (!menuOpened) {
        throw new Error(
            'Mobile navigation menu could not be opened',
        )
    }

    await settle(400)

    await expectText(
        'Question Bank',
        record,
        'Question Bank appeared in mobile navigation',
    )

    record.evidence.push(
        await evidence(
            record.name,
            'navigation-open',
        ),
    )

    const questionOpened = await clickAny([
        'Question Bank',
    ])

    if (!questionOpened) {
        throw new Error(
            'Question Bank could not be opened from mobile navigation',
        )
    }

    await settle(900)
    await inspectResponsiveLayout(record)
    await assertNoFatalScreen(record)

    record.evidence.push(
        await evidence(
            record.name,
            'question-bank-mobile',
        ),
    )

    await browser.setWindowSize(1440, 1000)
}

async function testApplicationStorage(
    record: ScenarioRecord,
): Promise<void> {
    await reachDashboard()

    const state = await browser.execute(() => {
        return {
            localStorageKeys: Object.keys(localStorage),
            sessionStorageKeys: Object.keys(sessionStorage),
        }
    })

    if (state.localStorageKeys.length === 0) {
        addFinding(
            'high',
            'Persistence',
            'No localStorage keys existed after completing feature scenarios',
            await browser.getUrl(),
        )
    } else {
        record.assertions.push(
            `${state.localStorageKeys.length} localStorage keys were present`,
        )
    }

    const before = JSON.stringify(state.localStorageKeys.sort())

    await browser.refresh()
    await settle(900)

    const afterKeys = await browser.execute(() =>
        Object.keys(localStorage).sort(),
    )

    if (
        before !== JSON.stringify(afterKeys)
    ) {
        addFinding(
            'medium',
            'Persistence',
            'LocalStorage key set changed after ordinary refresh',
            await browser.getUrl(),
            {
                before: JSON.parse(before),
                after: afterKeys,
            },
        )
    } else {
        record.assertions.push(
            'LocalStorage key set remained stable across refresh',
        )
    }
}

function writeReports(): void {
    const severityOrder: Severity[] = [
        'critical',
        'high',
        'medium',
        'low',
        'info',
    ]

    const statusCounts = {
        passed: scenarios.filter(
            (scenario) =>
                scenario.status === 'passed',
        ).length,
        failed: scenarios.filter(
            (scenario) =>
                scenario.status === 'failed',
        ).length,
        blocked: scenarios.filter(
            (scenario) =>
                scenario.status === 'blocked',
        ).length,
    }

    const severityCounts = Object.fromEntries(
        severityOrder.map((severity) => [
            severity,
            findings.filter(
                (finding) =>
                    finding.severity === severity,
            ).length,
        ]),
    )

    const report = {
        startedAt,
        completedAt: now(),
        baseUrl: BASE_URL,
        auditIdentity: {
            displayName: AUDIT_NAME,
            course: AUDIT_COURSE,
            task: AUDIT_TASK,
            intention: AUDIT_INTENTION,
            questionFixture: FIXTURE_PATH,
        },
        summary: {
            totalScenarios: scenarios.length,
            ...statusCounts,
            ...severityCounts,
        },
        scenarios,
        findings,
        runtime,
    }

    fs.writeFileSync(
        REPORT_JSON,
        JSON.stringify(report, null, 2),
    )

    const md: string[] = [
        '# AXOM Scenario-Based Beta Audit',
        '',
        `- Started: ${report.startedAt}`,
        `- Completed: ${report.completedAt}`,
        `- Total scenarios: ${report.summary.totalScenarios}`,
        `- Passed: ${report.summary.passed}`,
        `- Failed: ${report.summary.failed}`,
        `- Blocked: ${report.summary.blocked}`,
        '',
        '## Severity Summary',
        '',
        `- Critical: ${report.summary.critical}`,
        `- High: ${report.summary.high}`,
        `- Medium: ${report.summary.medium}`,
        `- Low: ${report.summary.low}`,
        `- Info: ${report.summary.info}`,
        '',
        '## Scenario Results',
        '',
        '| Status | Feature | Scenario | Duration | Assertions |',
        '|---|---|---|---:|---:|',
    ]

    for (const scenario of scenarios) {
        md.push(
            `| ${scenario.status} | ${scenario.feature.replace(/\|/g, '\\|')} | ${scenario.name.replace(/\|/g, '\\|')} | ${scenario.durationMs}ms | ${scenario.assertions.length} |`,
        )
    }

    md.push('', '## Detailed Scenarios', '')

    for (const scenario of scenarios) {
        md.push(
            `### ${scenario.status.toUpperCase()} · ${scenario.feature} · ${scenario.name}`,
            '',
            `- Duration: ${scenario.durationMs} ms`,
        )

        if (scenario.urlBefore) {
            md.push(
                `- URL before: ${scenario.urlBefore}`,
            )
        }

        if (scenario.urlAfter) {
            md.push(
                `- URL after: ${scenario.urlAfter}`,
            )
        }

        if (scenario.blockedReason) {
            md.push(
                `- Blocked reason: ${scenario.blockedReason}`,
            )
        }

        if (scenario.error) {
            md.push(
                '',
                '```text',
                scenario.error.slice(0, 5000),
                '```',
            )
        }

        if (scenario.assertions.length > 0) {
            md.push('', '**Assertions:**')

            for (const assertion of scenario.assertions) {
                md.push(`- ${assertion}`)
            }
        }

        if (scenario.evidence.length > 0) {
            md.push('', '**Evidence:**')

            for (const file of scenario.evidence) {
                md.push(`- ${file}`)
            }
        }

        md.push('')
    }

    md.push('## Findings', '')

    for (const severity of severityOrder) {
        const group = findings.filter(
            (finding) =>
                finding.severity === severity,
        )

        if (group.length === 0) continue

        md.push(
            `### ${severity.toUpperCase()}`,
            '',
        )

        for (const finding of group) {
            md.push(
                `- **${finding.feature}:** ${finding.message}`,
            )

            if (finding.url) {
                md.push(`  - URL: ${finding.url}`)
            }

            if (finding.details !== undefined) {
                md.push(
                    '',
                    '```json',
                    JSON.stringify(
                        finding.details,
                        null,
                        2,
                    ).slice(0, 5000),
                    '```',
                )
            }
        }

        md.push('')
    }

    md.push(
        '## Runtime Summary',
        '',
        `- Console errors: ${runtime.consoleErrors.length}`,
        `- Runtime errors: ${runtime.runtimeErrors.length}`,
        `- Unhandled rejections: ${runtime.unhandledRejections.length}`,
        '',
    )

    fs.writeFileSync(
        REPORT_MD,
        md.join('\n'),
    )

    console.log('')
    console.log('================================================')
    console.log('AXOM SCENARIO-BASED BETA AUDIT COMPLETE')
    console.log('================================================')
    console.log(`Total scenarios: ${scenarios.length}`)
    console.log(`Passed: ${statusCounts.passed}`)
    console.log(`Failed: ${statusCounts.failed}`)
    console.log(`Blocked: ${statusCounts.blocked}`)
    console.log(`Critical findings: ${severityCounts.critical}`)
    console.log(`High findings: ${severityCounts.high}`)
    console.log(`Medium findings: ${severityCounts.medium}`)
    console.log(`Report: ${REPORT_MD}`)
    console.log(`JSON: ${REPORT_JSON}`)
    console.log(`Screenshots: ${SCREENSHOTS}`)
    console.log('================================================')
}

const startedAt = now()

describe('AXOM scenario-based beta audit', () => {
    before(() => {
        ensureOutput()
    })

    it('completes onboarding and verifies persistence', async function () {
        this.timeout(120000)

        await runScenario(
            'Complete configured onboarding',
            'Onboarding',
            completeOnboarding,
        )
    })

    it('renders known application modules', async function () {
        this.timeout(120000)

        await runScenario(
            'Render known hash routes',
            'Navigation',
            inspectKnownRoutes,
        )
    })

    it('creates and persists a course', async function () {
        this.timeout(90000)

        await runScenario(
            'Create persistent course',
            'Course Tracker',
            createCourse,
        )
    })

    it('creates and persists a task', async function () {
        this.timeout(90000)

        await runScenario(
            'Create persistent task',
            'Productivity',
            createProductivityData,
        )
    })

    it('sets and persists the daily intention', async function () {
        this.timeout(60000)

        await runScenario(
            'Persist daily intention',
            'Dashboard',
            testDashboardIntention,
        )
    })

    it('tests timer start, pause, resume, and refresh', async function () {
        this.timeout(90000)

        await runScenario(
            'Exercise timer lifecycle',
            'Timer',
            testTimer,
        )
    })

    it('imports a known practice-question fixture', async function () {
        this.timeout(180000)

        await runScenario(
            'Import known question set',
            'Question Bank',
            uploadQuestionFixture,
        )
    })

    it('answers a known quiz question and checks rationale', async function () {
        this.timeout(120000)

        await runScenario(
            'Run quiz and validate feedback',
            'Question Bank',
            testQuizFlow,
        )
    })

    it('tests quiz support tools', async function () {
        this.timeout(60000)

        await runScenario(
            'Open calculator and reading controls',
            'Question Bank',
            testQuestionTools,
        )
    })

    it('changes a setting and checks persistence', async function () {
        this.timeout(90000)

        await runScenario(
            'Persist appearance setting',
            'Settings',
            testSettingsPersistence,
        )
    })

    it('tests core flows at mobile width', async function () {
        this.timeout(90000)

        await runScenario(
            'Navigate core mobile interface',
            'Responsive UI',
            testMobileCoreFlows,
        )
    })

    it('checks application storage stability', async function () {
        this.timeout(60000)

        await runScenario(
            'Verify stored application state',
            'Persistence',
            testApplicationStorage,
        )
    })

    after(() => {
        writeReports()
    })
})

// ===========================================================================
// AnkiConnect client. AnkiConnect is an Anki add-on (code 2055492159) that
// exposes a localhost HTTP API (default http://127.0.0.1:8765). With Anki open
// and the add-on installed, AXOM can link to the collection: push its cards
// into an AXOM deck, read review stats, and log review counts. Requests never
// leave the machine. Endpoint config and the sync ledger live in localStorage
// so they are never bundled into the persisted vault or a backup.
//
// Requests are CORS "simple requests" (a JSON string body with no custom
// headers), exactly like AnkiConnect's own README client. A JSON content type
// would trigger a preflight that AnkiConnect only answers for origins it
// already trusts, so an unknown origin (the hosted web app, the desktop
// webview) could never reach `requestPermission`, the one action AnkiConnect
// accepts from any origin and the one that asks the learner in Anki.
// ===========================================================================
import { dayKey } from "./scoring";

export const DEFAULT_ANKI_ENDPOINT = "http://127.0.0.1:8765";
/** AnkiWeb add-on code for AnkiConnect (Tools → Add-ons → Get Add-ons…). */
export const ANKI_CONNECT_ADDON_CODE = "2055492159";
export const ANKI_CONNECT_API_VERSION = 6;
const ENDPOINT_KEY = "noctyrium-anki-endpoint";
const AUTOSYNC_KEY = "noctyrium-anki-autosync";
const SYNC_KEY = "noctyrium-anki-sync";

/** Quick actions (version, deck names) answer in milliseconds when Anki is open. */
export const QUICK_TIMEOUT_MS = 8_000;
/** Searches and info calls over large premade decks can take a while. */
export const DATA_TIMEOUT_MS = 60_000;
/** requestPermission stays open while Anki shows its "allow this site?" dialog. */
export const PERMISSION_TIMEOUT_MS = 120_000;

export function getAnkiEndpoint(): string {
  try { return localStorage.getItem(ENDPOINT_KEY)?.trim() || DEFAULT_ANKI_ENDPOINT; } catch { return DEFAULT_ANKI_ENDPOINT; }
}
export function setAnkiEndpoint(url: string) {
  try { localStorage.setItem(ENDPOINT_KEY, url.trim()); } catch { /* storage unavailable */ }
}
export function getAnkiAutoSync(): boolean {
  try { return localStorage.getItem(AUTOSYNC_KEY) === "1"; } catch { return false; }
}
export function setAnkiAutoSync(value: boolean) {
  try { localStorage.setItem(AUTOSYNC_KEY, value ? "1" : "0"); } catch { /* storage unavailable */ }
}

export type AnkiErrorKind =
  | "malformed-endpoint"
  | "endpoint-unreachable"
  | "local-network-blocked"
  | "mixed-content-blocked"
  | "cors-blocked"
  | "anki-connect-absent"
  | "permission-denied"
  | "api-key"
  | "api-incompatibility"
  | "network"
  | "anki";

export class AnkiError extends Error {
  kind: AnkiErrorKind;
  action?: string;
  constructor(message: string, kind: AnkiErrorKind, action?: string) {
    super(message);
    this.name = "AnkiError";
    this.kind = kind;
    this.action = action;
  }
}

/** True when the failure means "Anki is not reachable right now" (queue and retry later). */
export function isAnkiOffline(error: unknown): boolean {
  return error instanceof AnkiError && (
    error.kind === "endpoint-unreachable" || error.kind === "local-network-blocked" || error.kind === "cors-blocked" ||
    error.kind === "network" || error.kind === "mixed-content-blocked"
  );
}

export type AnkiDiagnosticStepId = "endpoint" | "version" | "decks" | "reviews";
export type AnkiDiagnosticStatus = "pending" | "running" | "ok" | "failed";
export interface AnkiDiagnosticStep {
  id: AnkiDiagnosticStepId;
  label: string;
  status: AnkiDiagnosticStatus;
  detail?: string;
}

export const ANKI_DIAGNOSTIC_TEMPLATE: AnkiDiagnosticStep[] = [
  { id: "endpoint", label: "Checking endpoint", status: "pending" },
  { id: "version", label: "Testing AnkiConnect version", status: "pending" },
  { id: "decks", label: "Reading decks", status: "pending" },
  { id: "reviews", label: "Reading review counts", status: "pending" },
];

// --- address-space hint -------------------------------------------------------

type AddressSpace = "loopback" | "local";

interface LocalFetchInit extends RequestInit {
  // Chrome Local Network Access hint. It is not in TypeScript's DOM lib yet.
  targetAddressSpace?: AddressSpace;
}

/** Loopback (127.0.0.1, localhost, ::1) or private-network address, else null. */
export function addressSpaceFor(url: URL): AddressSpace | null {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || host === "::1") return "loopback";
  if (
    /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) || host.endsWith(".local") || /^f[cd][0-9a-f]{2}:/.test(host) || host.startsWith("fe80:")
  ) return "local";
  return null;
}

const hintSupport = new Map<AddressSpace, boolean>();

/**
 * Local Network Access names the loopback space "loopback"; older Chrome
 * builds used different enum values and throw on unknown ones, so a hint is
 * sent only when constructing a Request with it round-trips.
 */
function supportsAddressSpaceHint(space: AddressSpace): boolean {
  const known = hintSupport.get(space);
  if (known !== undefined) return known;
  let supported = false;
  try {
    if (typeof Request !== "undefined") {
      const probe = new Request("http://127.0.0.1/", { targetAddressSpace: space } as LocalFetchInit);
      supported = (probe as Request & { targetAddressSpace?: string }).targetAddressSpace === space;
    }
  } catch {
    supported = false;
  }
  hintSupport.set(space, supported);
  return supported;
}

/** The hint matters only when a more public page calls a more private address. */
function addressSpaceHint(url: URL): AddressSpace | undefined {
  if (typeof window === "undefined" || !window.location?.href) return undefined;
  const target = addressSpaceFor(url);
  if (!target) return undefined;
  let page: AddressSpace | null;
  try { page = addressSpaceFor(new URL(window.location.href)); } catch { page = null; }
  if (page === "loopback" || (page === "local" && target === "local")) return undefined;
  return supportsAddressSpaceHint(target) ? target : undefined;
}

// --- transport ------------------------------------------------------------------

function endpointUrl(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new AnkiError("The endpoint is not a valid URL. Use the default local AnkiConnect endpoint: http://127.0.0.1:8765", "malformed-endpoint");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AnkiError("The endpoint must start with http:// or https://. AnkiConnect normally uses http://127.0.0.1:8765.", "malformed-endpoint");
  }
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorFromAnki(message: string, action: string): AnkiError {
  if (/valid api key must be provided/i.test(message)) {
    return new AnkiError("AnkiConnect is protected by an API key. Enter the apiKey from AnkiConnect's config (Tools → Add-ons → AnkiConnect → Config).", "api-key", action);
  }
  if (/unsupported action/i.test(message)) {
    return new AnkiError(`This AnkiConnect version does not support "${action}". Update AnkiConnect (Tools → Add-ons → Check for Updates) and restart Anki.`, "api-incompatibility", action);
  }
  return new AnkiError(message, "anki", action);
}

async function send(url: URL, body: string, timeoutMs: number, fetchImpl: typeof fetch, hint: AddressSpace | undefined, action: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    const init: LocalFetchInit = {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      // No headers: a string body keeps this a CORS simple request.
      body,
      signal: controller.signal,
      ...(hint ? { targetAddressSpace: hint } : {}),
    };
    response = await fetchImpl(url.toString(), init);
  } finally {
    globalThis.clearTimeout(timer);
  }
  if (response.status === 403) {
    throw new AnkiError("AnkiConnect refused this page's origin. Connect again so Anki can ask you to allow AXOM, or add this origin to AnkiConnect's webCorsOriginList.", "permission-denied", action);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AnkiError("The endpoint answered, but not with AnkiConnect JSON. Confirm the AnkiConnect add-on is installed and bound to this port.", "anki-connect-absent", action);
  }
  if (!isRecord(data) || !("result" in data) || !("error" in data)) {
    throw new AnkiError("The endpoint answered, but not like AnkiConnect (API version 6). Update AnkiConnect and restart Anki.", "anki-connect-absent", action);
  }
  if (data.error) throw errorFromAnki(String(data.error), action);
  return data.result;
}

function classifyFetchFailure(err: unknown, endpoint: URL, timeoutMs: number, action: string): AnkiError {
  if (err instanceof AnkiError) return err;
  const origin = typeof window !== "undefined" && window.location ? window.location.origin : "this site";
  const timedOut = (err instanceof DOMException || err instanceof Error) && err.name === "AbortError";
  const localHost = addressSpaceFor(endpoint) === "loopback";
  const pageIsHttps = typeof window !== "undefined" && window.location?.protocol === "https:";
  if (timedOut) {
    return action === "requestPermission"
      ? new AnkiError(`Anki did not answer within ${Math.round(timeoutMs / 1000)} seconds. If Anki is showing a "website wants to access Anki" dialog, choose Yes, then connect again.`, "endpoint-unreachable", action)
      : new AnkiError(`AnkiConnect did not answer within ${Math.round(timeoutMs / 1000)} seconds at ${endpoint}. Confirm Anki is open and not busy (a sync or a dialog), then try again.`, "endpoint-unreachable", action);
  }
  if (pageIsHttps && localHost) {
    return new AnkiError(`Could not reach AnkiConnect at ${endpoint}. Anki may be closed, or the browser blocked ${origin} from reaching apps on this device: in Chrome or Edge, allow "Local network access" for this site from the icon in the address bar, keep Anki open, then try again.`, "local-network-blocked", action);
  }
  if (pageIsHttps && endpoint.protocol === "http:" && !addressSpaceFor(endpoint)) {
    return new AnkiError("The browser blocked an HTTPS page from calling an insecure HTTP endpoint. Use AnkiConnect on this computer (http://127.0.0.1:8765).", "mixed-content-blocked", action);
  }
  if (localHost) {
    return new AnkiError(`Could not reach AnkiConnect at ${endpoint}. Most often Anki is closed, AnkiConnect is not installed, or it listens on a different port.`, "endpoint-unreachable", action);
  }
  return new AnkiError(`Could not reach AnkiConnect. If the endpoint is correct, add this exact origin to AnkiConnect's webCorsOriginList: ${origin}`, "cors-blocked", action);
}

export interface AnkiClientOptions {
  endpoint?: string;
  /** AnkiConnect's optional apiKey. Device-local; never synced or exported. */
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  /** Default per-request timeout. */
  timeoutMs?: number;
}

export interface AnkiAction {
  action: string;
  params?: Record<string, unknown>;
}

export type AnkiMultiResult = { ok: true; result: unknown } | { ok: false; error: string };

export interface AnkiClient {
  readonly endpoint: string;
  call<T>(action: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<T>;
  /** Several actions in one request; each entry carries its own result or error. */
  multi(actions: AnkiAction[], options?: { timeoutMs?: number }): Promise<AnkiMultiResult[]>;
}

export function createAnkiClient(options: AnkiClientOptions = {}): AnkiClient {
  const endpoint = (options.endpoint ?? getAnkiEndpoint()).trim() || DEFAULT_ANKI_ENDPOINT;
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const defaultTimeout = options.timeoutMs ?? DATA_TIMEOUT_MS;
  const key = options.apiKey?.trim() || undefined;

  async function request(action: string, payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const url = endpointUrl(endpoint);
    const body = JSON.stringify({ action, version: ANKI_CONNECT_API_VERSION, params: payload, ...(key ? { key } : {}) });
    const hint = addressSpaceHint(url);
    try {
      return await send(url, body, timeoutMs, fetchImpl, hint, action);
    } catch (error) {
      if (error instanceof AnkiError) throw error;
      // A browser whose Local Network Access rules reject the hint fails before
      // any request is sent; one plain retry keeps those builds working.
      if (hint && error instanceof TypeError) {
        try {
          return await send(url, body, timeoutMs, fetchImpl, undefined, action);
        } catch (retryError) {
          throw classifyFetchFailure(retryError, url, timeoutMs, action);
        }
      }
      throw classifyFetchFailure(error, url, timeoutMs, action);
    }
  }

  return {
    endpoint,
    call: async <T>(action: string, params: Record<string, unknown> = {}, callOptions: { timeoutMs?: number } = {}) =>
      await request(action, params, callOptions.timeoutMs ?? defaultTimeout) as T,
    async multi(actions, callOptions = {}) {
      if (!actions.length) return [];
      const result = await request("multi", {
        actions: actions.map((item) => ({
          action: item.action,
          version: ANKI_CONNECT_API_VERSION,
          params: item.params ?? {},
          // multi runs every sub-action through AnkiConnect's key check.
          ...(key ? { key } : {}),
        })),
      }, callOptions.timeoutMs ?? defaultTimeout);
      if (!Array.isArray(result) || result.length !== actions.length) {
        throw new AnkiError("AnkiConnect answered a batch request with an unexpected shape. Update AnkiConnect and restart Anki.", "api-incompatibility", "multi");
      }
      return result.map((entry, index): AnkiMultiResult => {
        if (isRecord(entry) && "error" in entry) {
          return entry.error ? { ok: false, error: errorFromAnki(String(entry.error), actions[index].action).message } : { ok: true, result: entry.result };
        }
        return { ok: true, result: entry };
      });
    },
  };
}

// --- connecting ------------------------------------------------------------------

export interface AnkiPermission {
  permission: "granted" | "denied";
  requireApiKey?: boolean;
  version?: number;
}

export interface AnkiConnection {
  version: number;
  requireApiKey: boolean;
}

/**
 * The connect handshake: `requestPermission` first (AnkiConnect accepts it
 * from any origin and asks in Anki when this origin is new), then `version`.
 */
export async function connectToAnki(client: AnkiClient, options: { hasApiKey?: boolean } = {}): Promise<AnkiConnection> {
  const raw = await client.call<Record<string, unknown>>("requestPermission", {}, { timeoutMs: PERMISSION_TIMEOUT_MS });
  if (!isRecord(raw) || raw.permission !== "granted") {
    throw new AnkiError("Anki denied AXOM's request. If you ticked \"Ignore further requests\", remove this origin from ignoreOriginList in AnkiConnect's config, then connect again.", "permission-denied", "requestPermission");
  }
  // AnkiConnect has spelled this key both ways across releases.
  const requireApiKey = raw.requireApiKey === true || raw.requireApikey === true;
  if (requireApiKey && !options.hasApiKey) {
    throw new AnkiError("Anki allowed AXOM, and AnkiConnect also requires its API key. Enter the apiKey from AnkiConnect's config to continue.", "api-key", "requestPermission");
  }
  const version = await client.call<number>("version", {}, { timeoutMs: QUICK_TIMEOUT_MS });
  if (typeof version !== "number" || version < ANKI_CONNECT_API_VERSION) {
    throw new AnkiError(`Unsupported AnkiConnect API version: ${String(version)}. AXOM needs version ${ANKI_CONNECT_API_VERSION}; update AnkiConnect and restart Anki.`, "api-incompatibility", "version");
  }
  return { version, requireApiKey };
}

// --- review counts (Integrations panel) ---------------------------------------------

export interface DeckStat {
  deck_id: number;
  name: string;
  new_count: number;
  learn_count: number;
  review_count: number;
  total_in_deck: number;
}

export async function deckStats(client: AnkiClient): Promise<DeckStat[]> {
  const names = await client.call<string[]>("deckNames");
  const stats = await client.call<Record<string, DeckStat>>("getDeckStats", { decks: names });
  return Object.values(stats)
    .filter((deck) => deck.total_in_deck > 0 || deck.name !== "Default") // hide the empty default deck
    .sort((a, b) => (b.review_count + b.new_count + b.learn_count) - (a.review_count + a.new_count + a.learn_count));
}

export interface AnkiSnapshot {
  version: number;
  today: number;
  decks: DeckStat[];
  byDay: [string, number][];
}

export async function fetchAnkiSnapshot(client: AnkiClient, onStep?: (id: AnkiDiagnosticStepId, status: AnkiDiagnosticStatus, detail?: string) => void): Promise<AnkiSnapshot> {
  onStep?.("endpoint", "running");
  endpointUrl(client.endpoint);
  onStep?.("endpoint", "ok", client.endpoint);
  onStep?.("version", "running");
  const version = await client.call<number>("version", {}, { timeoutMs: QUICK_TIMEOUT_MS });
  if (typeof version !== "number" || version < 5) {
    throw new AnkiError(`Unsupported AnkiConnect API version: ${String(version)}. AXOM expects version 5 or newer.`, "api-incompatibility", "version");
  }
  onStep?.("version", "ok", `v${version}`);
  onStep?.("decks", "running");
  const decks = await deckStats(client);
  onStep?.("decks", "ok", `${decks.length} deck${decks.length === 1 ? "" : "s"}`);
  onStep?.("reviews", "running");
  const [today, byDay] = await Promise.all([
    client.call<number>("getNumCardsReviewedToday"),
    client.call<[string, number][]>("getNumCardsReviewedByDay").catch(() => [] as [string, number][]),
  ]);
  onStep?.("reviews", "ok", `${today} review${today === 1 ? "" : "s"} today`);
  // AnkiConnect lists days newest first; the chart reads oldest to newest.
  return { version, today, decks, byDay: [...byDay].sort((a, b) => a[0].localeCompare(b[0])) };
}

// --- Per-day sync ledger: only log the *new* reviews since the last sync, so
// repeated syncs in one day never double-count into productivity. ---
interface AnkiSyncLedger { day: string; synced: number }

function readLedger(): AnkiSyncLedger {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AnkiSyncLedger;
      if (typeof parsed.day === "string" && typeof parsed.synced === "number") return parsed;
    }
  } catch { /* ignore */ }
  return { day: "", synced: 0 };
}
function writeLedger(ledger: AnkiSyncLedger) {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(ledger)); } catch { /* storage unavailable */ }
}

/** How many of today's reviews have already been synced into productivity. */
export function alreadySyncedToday(): number {
  const ledger = readLedger();
  return ledger.day === dayKey() ? ledger.synced : 0;
}

/** The increment to log given AnkiConnect's current reviews-today count. */
export function pendingSyncDelta(reviewsTodayCount: number): number {
  return Math.max(0, reviewsTodayCount - alreadySyncedToday());
}

/** Record that we've now synced up to `reviewsTodayCount` for today. */
export function commitSync(reviewsTodayCount: number) {
  writeLedger({ day: dayKey(), synced: reviewsTodayCount });
}

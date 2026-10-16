import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Download, Mail, ShieldCheck } from "lucide-react";
import { CommunicationsBrand } from "../components/communications/CommunicationsBrand";
import { GButton } from "../components/ui/primitives";
import { communicationsRequest, useCommunications } from "../lib/communications/client";
import { renderAxomEmail } from "../lib/communications/email";
import { CATEGORIES, TEMPLATE_CATEGORY, preferences, type EmailType, type Preference } from "../lib/communications/model";
import { currentPresentation, downloadBlob, localEmailContext } from "../lib/communications/presentation";
import { useOpticalMotion } from "../lib/communications/useOpticalMotion";
import { useStore } from "../lib/store";
import "../styles/communications.css";

type AppTransitionGuard = (transition: () => void) => Promise<boolean>;
type RegisterAppTransitionGuard = (guard: AppTransitionGuard) => () => void;
type PendingNavigation = {
  href?: string;
  label: string;
  commit?: () => void;
  settle?: (completed: boolean) => void;
};

const ROUTE_LABELS: Record<string, string> = {
  communications: "Communications",
  "communications-admin": "Communications studio",
  dashboard: "Dashboard",
  privacy: "Privacy & Data",
  pulse: "AXOM Pulse",
};

function requestedRouteLabel() {
  const route = window.location.hash.slice(1).split("?")[0];
  return ROUTE_LABELS[route] ?? (route ? route.replaceAll("-", " ") : "the selected page");
}

export function CommunicationsPage({ registerAppTransitionGuard }: {
  registerAppTransitionGuard?: RegisterAppTransitionGuard;
} = {}) {
  const opticalRoot = useOpticalMotion<HTMLElement>();
  const state = useStore();
  const remote = useCommunications();
  const [draft, setDraft] = useState<Preference[]>(preferences(Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [type, setType] = useState<EmailType>("weekly_report");
  const [theme, setTheme] = useState<"dark" | "light">(currentPresentation().theme);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageRole, setMessageRole] = useState<"status" | "alert">("status");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const navigationNoticeRef = useRef<HTMLElement>(null);
  const navigationTriggerRef = useRef<HTMLElement | null>(null);
  const pageTitleRef = useRef<HTMLHeadingElement>(null);

  const guardAppTransition = useCallback<AppTransitionGuard>((transition) => {
    if (!dirtyRef.current) {
      transition();
      return Promise.resolve(true);
    }

    const active = document.activeElement;
    navigationTriggerRef.current = active instanceof HTMLElement && active !== document.body
      ? active
      : null;
    return new Promise<boolean>((settle) => {
      setPendingNavigation({
        label: requestedRouteLabel(),
        commit: transition,
        settle,
      });
    });
  }, []);

  useEffect(() => registerAppTransitionGuard?.(guardAppTransition), [guardAppTransition, registerAppTransitionGuard]);

  useEffect(() => {
    if (remote.data) {
      setDraft(remote.data.preferences);
      setDirty(false);
    }
  }, [remote.data]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  useEffect(() => {
    if (!pendingNavigation) return;
    const frame = window.requestAnimationFrame(() => navigationNoticeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [pendingNavigation]);
  useEffect(() => {
    if (!dirty) return;
    const interceptNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const origin = event.target instanceof Element ? event.target : null;
      if (!origin) return;

      const anchor = origin.closest<HTMLAnchorElement>("a[href]");
      let navigation: { trigger: HTMLElement; href: string; label: string };
      if (anchor) {
        if (anchor.hasAttribute("download") || (anchor.target && anchor.target.toLowerCase() !== "_self")) return;
        const current = new URL(window.location.href);
        const destination = new URL(anchor.href, current);
        if (destination.origin !== current.origin || destination.pathname !== current.pathname || destination.search !== current.search || !destination.hash || destination.hash === current.hash) return;
        navigation = {
          trigger: anchor,
          href: destination.hash,
          label: anchor.getAttribute("aria-label") || anchor.textContent?.trim() || "the selected page",
        };
      } else {
        const navButton = origin.closest<HTMLButtonElement>("#app-sidebar button.nav-item[data-tour^='nav-']");
        const route = navButton?.dataset.tour?.replace(/^nav-/, "");
        if (!navButton || !route) return;
        navigation = {
          trigger: navButton,
          href: `#${route}`,
          label: navButton.getAttribute("aria-label") || navButton.textContent?.trim() || "the selected page",
        };
      }

      event.preventDefault();
      event.stopPropagation();
      navigationTriggerRef.current = navigation.trigger;
      setPendingNavigation({ href: navigation.href, label: navigation.label });
    };
    document.addEventListener("click", interceptNavigation, true);
    return () => document.removeEventListener("click", interceptNavigation, true);
  }, [dirty]);

  const context = useMemo(() => localEmailContext(state, type, theme), [state, type, theme]);
  const email = useMemo(() => renderAxomEmail({
    type,
    context,
    baseUrl: location.origin,
    ...(type === "essay" ? {
      editorial: {
        title: "The work between the answers",
        excerpt: "A preview of the essay format. Your published writing will appear here, with a quiet introduction and a direct path to the full piece.",
        url: `${location.origin}/#communications`,
        readingMinutes: 6,
      },
    } : {}),
  }), [type, context]);

  const change = (category: string, patch: Partial<Preference>) => {
    setDraft(rows => rows.map(preference => preference.category === category ? { ...preference, ...patch } : preference));
    setDirty(true);
    setMessage("");
    setMessageRole("status");
  };
  const save = async (allOff = false) => {
    const acceptedDraft = draft.map(preference => allOff ? { ...preference, enabled: false } : { ...preference });
    setBusy(true);
    setMessage("");
    setMessageRole("status");
    try {
      await communicationsRequest(allOff ? "unsubscribe-all" : "preferences", allOff ? {} : { preferences: acceptedDraft, identity: currentPresentation() });
      setDraft(acceptedDraft);
      setDirty(false);
      setMessage(allOff ? "Optional emails are off. Essential account emails remain enabled." : "Email preferences saved.");
    } catch (error) {
      setMessageRole("alert");
      setMessage(error instanceof Error ? error.message : "Could not save. Your choices are still here.");
    } finally {
      setBusy(false);
    }
  };
  const stayOnPage = () => {
    const pending = pendingNavigation;
    setPendingNavigation(null);
    pending?.settle?.(false);
    window.requestAnimationFrame(() => (navigationTriggerRef.current ?? pageTitleRef.current)?.focus());
  };
  const discardAndNavigate = () => {
    if (!pendingNavigation) return;
    const { commit, href, settle } = pendingNavigation;
    navigationTriggerRef.current = null;
    setPendingNavigation(null);
    dirtyRef.current = false;
    setDirty(false);
    if (commit) {
      try {
        commit();
        settle?.(true);
      } catch {
        settle?.(false);
      }
      return;
    }
    if (href) window.location.hash = href.slice(1);
  };

  const history = remote.loading
    ? <p role="status">Loading email history…</p>
    : remote.error || !remote.data
      ? <p>Email history is unavailable until communications connect.</p>
      : remote.data.history.length === 0
        ? <div className="comms-history-empty"><Mail size={18} aria-hidden="true" /><p>No messages yet. AXOM adds an item only after an email is queued.</p></div>
        : <ul>{remote.data.history.map(item => <li key={item.id}><strong>{item.type.replaceAll("_", " ")}</strong><span>{new Date(item.sent_at ?? item.created_at).toLocaleDateString()}</span><span className="comms-state">{item.status}</span></li>)}</ul>;

  return <main ref={opticalRoot} className="comms-page" aria-labelledby="comms-title" aria-busy={remote.loading || undefined}>
    <header className="comms-heading comms-glass" data-optical="">
      <div>
        <CommunicationsBrand label="Communications" />
        <h1 ref={pageTitleRef} id="comms-title" tabIndex={-1}>An inbox with intention.</h1>
        <p>Your learning, at the right distance. Choose what reaches you.</p>
      </div>
      <a className="comms-pulse-link" href={`#pulse?year=${new Date().getFullYear()}`} aria-label="AXOM Pulse">
        <img src="/icons/axom-orb-512.png" width="42" height="42" alt="" />
        <span>AXOM Pulse<small>Your year, measured.</small></span>
        <ArrowUpRight size={18} />
      </a>
    </header>

    <nav className="comms-nav" aria-label="Communications">
      <a href="#communications" aria-current="page">Email preferences</a>
      <a href="#privacy">Privacy & Data</a>
      {remote.data?.admin && <a href="#communications-admin">Communications studio</a>}
    </nav>

    {pendingNavigation && <section
      ref={navigationNoticeRef}
      className="comms-navigation-guard"
      role="alertdialog"
      aria-labelledby="comms-navigation-title"
      aria-describedby="comms-navigation-description"
      tabIndex={-1}
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        stayOnPage();
      }}
    >
      <div>
        <h2 id="comms-navigation-title">Leave without saving?</h2>
        <p id="comms-navigation-description">Your email changes are still on this page. Stay to review them or discard them and continue to {pendingNavigation.label}.</p>
      </div>
      <div className="comms-navigation-actions">
        <GButton type="button" variant="primary" onClick={stayOnPage}>Stay and review</GButton>
        <GButton type="button" variant="danger" onClick={discardAndNavigate}>Discard changes and continue</GButton>
      </div>
    </section>}

    {remote.loading && <p role="status" className="comms-load-state">Loading your preferences…</p>}
    {remote.error && <div className="comms-notice" role="alert"><p>{remote.error}</p><GButton size="sm" onClick={() => void remote.reload()}>Try again</GButton></div>}
    {remote.data && remote.data.deliveryMode !== "live" && <p className="comms-notice">Email delivery is {remote.data.deliveryMode === "test" ? "in test mode" : "not activated yet"}. Your preferences can still be saved.</p>}
    {remote.data && !remote.data.hasProtectedCopy && <p className="comms-notice">Email reports need a protected account copy. Your local preview includes this device’s data.</p>}

    <div className="comms-layout">
      <section aria-label="Email preferences" className="comms-preferences">
        <div className="comms-section-intro"><Mail size={20} /><div><h2>What reaches you</h2><p>All optional emails start off. Choose only what helps.</p></div></div>
        {["Study", "Editorial", "AXOM"].map(group => <fieldset className="comms-group" key={group} disabled={busy || !remote.data}>
          <legend>{group}</legend>
          {draft.filter(preference => CATEGORIES[preference.category].group === group).map(preference => <div className="comms-preference" key={preference.category}>
            <label className="comms-toggle-row">
              <span><strong>{CATEGORIES[preference.category].label}</strong><small>{CATEGORIES[preference.category].description}</small></span>
              <input type="checkbox" role="switch" checked={preference.enabled} name={preference.category} onChange={event => change(preference.category, { enabled: event.target.checked })} />
              <span className="comms-switch" aria-hidden="true" />
            </label>
            {preference.enabled && ["daily_learning", "daily_games", "weekly_report", "monthly_report", "exam_reminders", "annual_pulse"].includes(preference.category) && <div className="comms-timing">
              <label>Send time<input name={`${preference.category}-time`} type="time" value={preference.time} onChange={event => change(preference.category, { time: event.target.value })} /></label>
              {["weekly_report", "monthly_report"].includes(preference.category) && <label>{preference.category === "monthly_report" ? "First week of month" : "Day"}<select name={`${preference.category}-weekday`} value={preference.weekday} onChange={event => change(preference.category, { weekday: Number(event.target.value) })}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>}
              {preference.category === "annual_pulse" && <span>January 1, for the previous year</span>}
            </div>}
          </div>)}
        </fieldset>)}
        <label className="comms-timezone">Email timezone<input disabled={busy || !remote.data} name="email-timezone" value={draft[0]?.timezone ?? "UTC"} list="comms-timezones" onChange={event => { setDraft(rows => rows.map(preference => ({ ...preference, timezone: event.target.value }))); setDirty(true); setMessage(""); }} /><datalist id="comms-timezones">{["America/Grenada", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Asia/Dubai", "UTC"].map(zone => <option key={zone} value={zone} />)}</datalist><small>Send times follow this timezone, including daylight-saving changes.</small></label>
        <div className="comms-actions"><GButton variant="primary" disabled={busy || !remote.data} onClick={() => void save()}><Check size={16} />{busy ? "Saving…" : "Save preferences"}</GButton>{dirty && <span>Unsaved changes</span>}</div>
        <p role={message ? messageRole : "status"} className={`comms-status${messageRole === "alert" ? " is-error" : ""}`}>{message}</p>
        <div className="comms-essential"><ShieldCheck size={20} /><div><h3>Account essentials stay on.</h3><p>Sign-in, security, export and deletion messages are separate from optional emails.</p><button type="button" disabled={busy || !remote.data} onClick={() => void save(true)}>Unsubscribe from all optional emails</button></div></div>
      </section>

      <aside className="comms-preview comms-glass" aria-label="Personalized email preview">
        <div className="comms-preview-head"><span className="comms-kicker">YOUR INBOX, PREVIEWED</span><span className="comms-live-dot">Local data</span></div>
        <div className="comms-preview-controls">
          <label>Template<select value={type} onChange={event => setType(event.target.value as EmailType)}>{(Object.keys(TEMPLATE_CATEGORY) as EmailType[]).map(template => <option value={template} key={template}>{template.replaceAll("_", " ")}</option>)}</select></label>
          <label>Appearance<select value={theme} onChange={event => setTheme(event.target.value as "dark" | "light")}><option value="dark">Dark</option><option value="light">Light</option></select></label>
        </div>
        <div className="comms-envelope"><span>FROM &nbsp; AXOM</span><strong>{email.subject}</strong><span>Preview only. No email is sent. Scroll inside to read the full message.</span></div>
        <iframe title="AXOM email preview" srcDoc={email.html} sandbox="" className="comms-email-frame" />
        <button type="button" className="comms-download" onClick={() => downloadBlob(new Blob([email.html], { type: "text/html" }), `axom-${type}.html`)}><Download size={15} />Download this email preview</button>
      </aside>
    </div>

    <section className="comms-history" aria-labelledby="comms-history-title">
      <p className="comms-kicker">YOUR COMMUNICATIONS</p>
      <h2 id="comms-history-title">A quiet record.</h2>
      {history}
    </section>
  </main>;
}

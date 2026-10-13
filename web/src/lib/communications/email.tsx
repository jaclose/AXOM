import type { CSSProperties, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CATEGORIES, TEMPLATE_CATEGORY, firstName, optional, resolveVariables, safeAccent, safeUrl, type EmailInput, type EmailType, type RenderedEmail } from "./model";

const font = "Arial, Helvetica, sans-serif";
const mono = "'Courier New', monospace";
export const TEMPLATE_DEPENDENCIES: Record<EmailType, readonly string[]> = {
  welcome: [], auth: ["actionUrl"], security: [], daily_learning: ["course"], daily_games: ["games"], weekly_report: ["snapshot"], monthly_report: ["snapshot"],
  exam_reminder: ["exam"], inactivity: ["course"], essay: ["editorial"], product_update: ["editorial"], research: ["editorial"], marketing: ["editorial"],
  pulse: ["snapshot"], export_requested: [], export_ready: ["actionUrl"], deletion_requested: [], deletion_scheduled: ["date"], deletion_cancelled: [], deletion_completed: [],
};
export function templateReady(input: EmailInput): boolean {
  return TEMPLATE_DEPENDENCIES[input.type].every(key => {
    if (key === "snapshot") return Boolean(input.context.snapshot);
    if (key === "games") return Boolean(input.context.games?.length);
    if (key === "exam") return Boolean(input.context.exam);
    if (key === "course") return Boolean(input.context.course);
    return Boolean(input[key as "actionUrl" | "date" | "editorial"]);
  });
}
export function MetricRow({ value, label, color, border }: { value: string; label: string; color: string; border: string }) {
  return <tr><td style={{ padding: "22px 14px", borderBottom: `1px solid ${border}`, fontSize: 36, lineHeight: "44px", letterSpacing: "-1.5px", color }}>{value}</td><td align="right" style={{ padding: "22px 14px", borderBottom: `1px solid ${border}`, fontFamily: mono, fontSize: 11, letterSpacing: "1px" }}>{label.toUpperCase()}</td></tr>;
}
export function CTAButton({ href, children, background, foreground }: { href: string; children: ReactNode; background: string; foreground: string }) {
  return <table className="email-cta" role="presentation" cellPadding={0} cellSpacing={0} style={{ margin: "32px 0" }}><tbody><tr><td style={{ borderRadius: 28, msoPaddingAlt: "16px 24px" } as CSSProperties}><a href={safeUrl(href)} style={{ display: "inline-block", padding: "17px 24px", color: foreground, background, boxShadow: "inset 0 1px 0 rgba(255,255,255,.28)", border: `1px solid ${background}`, borderRadius: 28, fontFamily: font, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>{children} &nbsp; ↗</a></td></tr></tbody></table>;
}
export function AxomOrb({ src, large = false }: { src: string; large?: boolean }) {
  const size = large ? 184 : 48;
  return <img src={safeUrl(src)} width={size} height={size} alt="AXOM Orb" style={{ display: "block", border: 0, margin: large ? "24px auto 30px" : 0 }} />;
}
export function emailContent(input: EmailInput) {
  const { type, context: c, baseUrl } = input; const name = firstName(c.displayName); const snap = c.snapshot;
  const question = snap?.metrics.find(m => m.id === "questions");
  const titleMap: Record<EmailType, string> = {
    welcome: `Welcome to AXOM${name === "there" ? "" : `, ${name}`}.`, auth: "Your secure way in.", security: "Your account, protected.", daily_learning: "A small place to begin.",
    daily_games: "Today’s cases are ready.", weekly_report: `Your week, ${name === "there" ? "measured" : name}.`, monthly_report: "A month in perspective.",
    exam_reminder: c.exam ? `${c.exam.days} days until ${c.exam.name}.` : "Your exam plan.", inactivity: "Your course is still here.",
    essay: input.editorial?.title ?? "A note from Jafar.", product_update: input.editorial?.title ?? "A little more possible.", research: input.editorial?.title ?? "Worth your attention.", marketing: input.editorial?.title ?? "An AXOM announcement.",
    pulse: `${name === "there" ? "This" : `${name}, this`} was your year.`, export_requested: "Your export is being prepared.", export_ready: "Your AXOM data is ready.",
    deletion_requested: "Your deletion request is recorded.", deletion_scheduled: "Your account deletion is scheduled.", deletion_cancelled: "Your account stays with you.", deletion_completed: "Your account has been deleted.",
  };
  const bodyMap: Record<EmailType, string> = {
    welcome: "A private workspace for the work of learning. Bring your courses, questions and attention together, one study day at a time.",
    auth: "Use this secure link to continue to your account. If you did not request it, you can ignore this email.", security: "Review your account and its connected devices if an activity looks unfamiliar.",
    daily_learning: `Continue with ${c.course ?? "your course"}. A short, deliberate review is a useful place to begin.`, daily_games: "A few minutes of diagnostic thinking. Choose a case when you have room for one.",
    weekly_report: "A record of your effort. A clearer view of what comes next.", monthly_report: "Patterns emerge with a little distance. Here is what your recorded activity shows.",
    exam_reminder: "Based on your recent AXOM activity, your exam plan can help you choose the next review. These records do not establish exam readiness.",
    inactivity: `When you are ready, return to ${c.course ?? "your course"}. Your place is waiting.`, essay: input.editorial?.excerpt ?? "", product_update: input.editorial?.excerpt ?? "", research: input.editorial?.excerpt ?? "", marketing: input.editorial?.excerpt ?? "",
    pulse: "Your year in medicine, measured.", export_requested: "We will email you when your account export is ready. Device-only source files remain on your device; download a local backup to preserve them separately.",
    export_ready: "Your export is available for seven days. Sign in to Privacy & Data to open a fresh, private download link. No data is attached to this email.",
    deletion_requested: "You can still download your account data. Check Privacy & Data for the scheduled date and cancellation options.",
    deletion_scheduled: `Deletion is scheduled for ${input.date ?? "the date shown in Privacy & Data"}. You can cancel before processing begins. Backup and security retention may follow separate policies; device-local files are not remotely erased.`,
    deletion_cancelled: "Your scheduled deletion has been cancelled. Your account and data remain available.", deletion_completed: "Your AXOM account and eligible linked records have been removed. Device-local copies remain under your control. Backup and required security retention follow the published policy.",
  };
  let cta = "Open AXOM"; let href = `${baseUrl}/#dashboard`;
  if (type === "welcome") cta = "Enter AXOM";
  if (type === "auth") { cta = "Continue securely"; href = input.actionUrl ?? href; }
  if (type === "weekly_report" || type === "monthly_report") { cta = type === "weekly_report" ? "View full report" : "View monthly analysis"; href = `${baseUrl}/#reports`; }
  if (type === "pulse") { cta = "Open My Pulse"; href = `${baseUrl}/pulse/${snap?.periodStart.slice(0, 4) ?? new Date().getUTCFullYear()}`; }
  if (["daily_learning", "inactivity", "exam_reminder"].includes(type)) { cta = type === "exam_reminder" ? "Open Exam Plan" : "Continue your course"; href = `${baseUrl}/#${type === "exam_reminder" ? c.exam?.route ?? "step" : "tracker"}`; }
  if (input.editorial) { cta = input.editorial.cta || "Read essay"; href = input.editorial.url; }
  if (type.startsWith("deletion") || type.startsWith("export")) { cta = type === "export_ready" ? "Get my private download" : "Open Privacy & Data"; href = input.actionUrl ?? `${baseUrl}/#privacy`; }
  const subject = input.editorial?.subject || (type === "weekly_report" && question ? `${name === "there" ? "You" : name}, ${question.value.toLocaleString("en")} questions this week.` : type === "pulse" ? `${name === "there" ? "Your" : `${name}, your`} AXOM Pulse is ready.` : titleMap[type]);
  return { title: titleMap[type], body: bodyMap[type], cta, href, subject };
}
/** React-rendered, inline table email components. The same renderer powers preview and transport. */
export function renderAxomEmail(input: EmailInput): RenderedEmail {
  if (!["essay", "product_update", "research", "marketing"].includes(input.type)) input = { ...input, editorial: undefined };
  if (input.editorial) {
    const editorial = { ...input.editorial };
    for (const key of ["title", "excerpt", "subject", "preview", "cta"] as const) if (editorial[key]) editorial[key] = resolveVariables(editorial[key]!, input.context);
    input = { ...input, editorial };
  }
  const { context: c, type } = input; const category = TEMPLATE_CATEGORY[type]; const content = emailContent(input);
  const dark = c.theme === "dark"; const bg = dark ? "#0d0d0e" : "#f4f1eb"; const panel = dark ? "#161618" : "#fffdf9";
  const ink = dark ? "#e6e2d6" : "#242322"; const muted = dark ? "#b2afa8" : "#65605a"; const line = dark ? "#353438" : "#d9d4ca";
  const accent = safeAccent(c.accent); const snapshot = c.snapshot; const pulse = type === "pulse";
  const metrics = snapshot?.metrics.filter(m => ["questions", "accuracy", "minutes", "days", "reviews"].includes(m.id)) ?? [];
  const improved = snapshot?.systems.filter(s => (s.delta ?? 0) > 0).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0];
  const showReport = ["weekly_report", "monthly_report", "pulse"].includes(type);
  const editorial = ["essay", "product_update", "research", "marketing"].includes(type);
  const family = pulse ? "pulse" : showReport ? "report" : editorial ? "editorial" : "account";
  const glass = dark ? "#1b1e24" : "#ffffff";
  const rim = dark ? "#55565a" : "#ffffff";
  const label = pulse ? `PULSE // ${snapshot?.periodStart.slice(0, 4) ?? "YEAR"}` : optional(category) ? CATEGORIES[category].label.toUpperCase() : "YOUR AXOM ACCOUNT";
  const plainMetrics = metrics.map(m => `${m.value.toLocaleString("en")} ${m.unit} ${m.label}`);
  // Inbox readers cannot pause CSS: one short sweep, then the complete static design.
  // This static CSS has no user input. Raw style text preserves pseudo-element quotes in SSR.
  const html = "<!doctype html>" + renderToStaticMarkup(<html lang="en"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light dark" /><title>{content.subject}</title><style dangerouslySetInnerHTML={{ __html: `
.email-masthead{position:relative;overflow:hidden}
@media(prefers-reduced-motion:no-preference){.email-masthead:after{content:"";position:absolute;pointer-events:none;inset:-50% auto -50% -55%;width:40%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.16),transparent);opacity:0;animation:email-luster 2.4s cubic-bezier(.22,1,.36,1) .6s 1}@keyframes email-luster{0%{transform:translateX(-100%) rotate(17deg);opacity:0}15%{opacity:.8}100%{transform:translateX(460%) rotate(17deg);opacity:0}}}
@media(max-width:600px){.email-pad{padding:28px 22px!important}.email-title{font-size:34px!important;line-height:39px!important}.email-masthead{padding:22px!important}.email-shell{border-radius:24px!important}}
` }} /></head>
    <body className={`email-family-${family}`} style={{ margin: 0, padding: 0, backgroundColor: bg, color: ink, fontFamily: font }}>
      <div style={{ display: "none", maxHeight: 0, overflow: "hidden", opacity: 0 }}>{input.editorial?.preview || content.body}</div>
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} bgcolor={bg}><tbody><tr><td align="center" style={{ padding: "28px 12px" }}>
        <table className="email-shell" role="presentation" width="600" cellPadding={0} cellSpacing={0} style={{ width: "100%", maxWidth: 600, backgroundColor: panel, backgroundImage: `linear-gradient(145deg,${glass},${panel} 48%)`, border: `1px solid ${line}`, borderTopColor: rim, borderRadius: 32, boxShadow: `inset 0 1px 0 ${rim}, 0 24px 70px rgba(0,0,0,.12)` }}><tbody><tr><td className="email-pad" style={{ padding: "12px 12px 0" }}>
          <div className="email-masthead" style={{ padding: "28px 32px", backgroundColor: glass, backgroundImage: `linear-gradient(125deg,${accent}24,${glass} 48%,${accent}0a)`, border: `1px solid ${line}`, borderTopColor: rim, borderRadius: 22, boxShadow: `inset 0 1px 0 ${rim}` }}>
            <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}><tbody><tr><td width="64"><AxomOrb src={c.orbUrl} /></td><td style={{ fontSize: 13, letterSpacing: "4px", fontWeight: 700, color: ink }}>AXOM<br /><span style={{ font: `9px ${mono}`, letterSpacing: "1px", color: muted }}>{editorial ? "ESSAYS & IDEAS" : pulse ? "YOUR PRIVATE RECORD" : showReport ? "THE WORK, RECORDED" : "A SPACE OF YOUR OWN"}</span></td><td align="right" style={{ color: muted, font: `10px ${mono}` }}>{pulse ? snapshot?.periodStart.slice(0, 4) ?? "PULSE" : "//"}</td></tr></tbody></table>
            {pulse && <AxomOrb src={c.orbUrl} large />}
          </div>
        </td></tr><tr><td className="email-pad" style={{ padding: "36px 44px 40px" }}>
          <p style={{ color: muted, font: `11px ${mono}`, letterSpacing: "2px", margin: "0 0 22px", borderLeft: `2px solid ${accent}`, paddingLeft: 12 }}>{label}</p>
          <h1 className="email-title" style={{ fontFamily: editorial ? "Georgia, Times, serif" : font, fontSize: pulse ? 46 : editorial ? 42 : 38, fontWeight: 400, letterSpacing: editorial ? "-1.2px" : "-1.7px", lineHeight: pulse ? "50px" : "46px", margin: "0 0 24px", color: ink }}>{content.title}</h1>
          <p style={{ color: muted, fontSize: editorial ? 16 : 15, lineHeight: "27px", margin: "0 0 28px" }}>{content.body}</p>
          {type === "auth" && <div id="axom-auth-code" />}
          {showReport && <><p style={{ font: `11px ${mono}`, color: muted }}>{snapshot?.periodStart} · {snapshot?.periodEnd}</p><table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ backgroundColor: glass, border: `1px solid ${line}`, borderRadius: 16, boxShadow: `inset 0 1px 0 ${rim}` }}><tbody>{metrics.map(m => <MetricRow key={m.id} color={ink} border={line} label={m.label} value={m.id === "minutes" ? `${Math.round(m.value / 60 * 10) / 10}h` : `${m.value.toLocaleString("en")}${m.unit}`} />)}</tbody></table>{!metrics.length && <p style={{ color: muted, fontSize: 15, lineHeight: "24px" }}>Your record is beginning. There is not enough recorded activity for a report yet.</p>}
            {snapshot?.comparison?.accuracyDelta !== undefined && <p style={{ fontSize: 13, lineHeight: "22px", color: muted }}>Recorded accuracy {snapshot.comparison.accuracyDelta >= 0 ? "increased" : "decreased"} {Math.abs(snapshot.comparison.accuracyDelta)} percentage points versus the previous equal-length period.</p>}
            {snapshot && snapshot.systems.length > 1 && <p style={{ fontSize: 13, lineHeight: "22px", color: muted }}>Strongest recorded system: {snapshot.systems[0].name}. A direction for review: {snapshot.systems.at(-1)?.name}.</p>}
            {improved && <div style={{ borderLeft: `3px solid ${accent}`, padding: "4px 0 4px 18px", marginTop: 28 }}><p style={{ color: muted, font: `10px ${mono}`, letterSpacing: "1px" }}>MOST IMPROVED SYSTEM</p><h2 style={{ fontSize: 24, fontWeight: 400 }}>{improved.name} +{improved.delta} points</h2><p style={{ color: muted, fontSize: 13, lineHeight: "22px" }}>First-answer accuracy improved between the two halves of this period.</p></div>}
            {type === "monthly_report" && snapshot?.trend.length ? <table role="presentation" width="100%" style={{ marginTop: 26 }}><tbody>{snapshot.trend.slice(-8).map(point => <tr key={point.label}><td style={{ color: muted, fontSize: 11 }}>{point.label}</td><td style={{ padding: "6px 0" }}><table role="presentation" width={`${point.accuracy ?? 0}%`} bgcolor={accent}><tbody><tr><td height="5" /></tr></tbody></table></td><td align="right" style={{ fontSize: 12 }}>{point.accuracy === null ? "No score" : `${point.accuracy}%`}</td></tr>)}</tbody></table> : null}
          </>}
          {type === "daily_games" && c.games?.map(game => <div key={game.name} style={{ borderTop: `1px solid ${line}`, padding: "20px 0" }}><h2 style={{ fontSize: 20, fontWeight: 400 }}>{game.name}</h2><p style={{ color: muted, fontSize: 13 }}>{game.detail}</p><a href={safeUrl(game.url)} style={{ color: ink, fontSize: 13 }}>Open {game.name} ↗</a></div>)}
          {input.editorial?.imageUrl && <img src={safeUrl(input.editorial.imageUrl)} alt="Essay illustration" width="504" height="252" style={{ width: "100%", height: "auto", display: "block" }} />}
          {input.editorial?.readingMinutes && <p style={{ font: `11px ${mono}`, color: muted }}>{input.editorial.readingMinutes} MIN READ · JAFAR FROM AXOM</p>}
          {type !== "deletion_completed" && <CTAButton href={content.href} background={ink} foreground={panel}>{content.cta}</CTAButton>}
          {showReport && <p style={{ fontSize: 11, lineHeight: "18px", color: muted }}>{snapshot?.source === "protected-copy" ? `Protected copy: ${snapshot.sourceUpdatedAt ?? "date unavailable"}. Device-only changes are not included. ` : ""}Statistics describe recorded activity, including repeat answers. Open the report for sources and denominators.</p>}
          <div style={{ borderTop: `1px solid ${line}`, marginTop: 40, paddingTop: 22 }}><p style={{ color: muted, fontSize: 11, lineHeight: "19px" }}>{optional(category) ? `You chose ${CATEGORIES[category].label}.` : "An essential AXOM account communication."}</p><p style={{ color: muted, fontSize: 11, lineHeight: "22px" }}>{optional(category) && <><a href={safeUrl(`${input.baseUrl}/#communications`)} style={{ color: muted }}>Manage preferences</a>{" · "}<a href={safeUrl(input.unsubscribeUrl ?? `${input.baseUrl}/#communications`)} style={{ color: muted }}>Unsubscribe</a>{" · "}</>}<a href={safeUrl(`${input.baseUrl}/#privacy`)} style={{ color: muted }}>Privacy & Data</a></p></div>
        </td></tr></tbody></table>
      </td></tr></tbody></table>
    </body></html>);
  return { subject: content.subject, category, html, text: ["AXOM", label, content.title, content.body, ...(showReport ? plainMetrics : []), ...(type === "daily_games" ? c.games?.map(g => `${g.name}: ${g.detail}\n${safeUrl(g.url)}`) ?? [] : []), `${content.cta}: ${safeUrl(content.href)}`, ...(optional(category) ? [`Manage preferences: ${safeUrl(`${input.baseUrl}/#communications`)}`, `Unsubscribe: ${safeUrl(input.unsubscribeUrl ?? `${input.baseUrl}/#communications`)}`] : [])].join("\n\n") };
}

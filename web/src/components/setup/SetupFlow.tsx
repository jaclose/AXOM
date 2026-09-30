// First-run setup, rebuilt (JD, Wave 2): the intro fades into one calm stage
// with three short screens (You, How you study, Make it yours). Every choice
// changes something real (lib/setupPlan.ts); nothing asks the student to
// design their productivity model before they have seen AXOM. The Promise
// and the optional guide follow in App.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, Bell, BookMarked, BookOpen, Compass, FlaskConical, Globe2, GraduationCap,
  HeartHandshake, Layers, ListChecks, Monitor, Moon, Plus, ShieldCheck, Sparkles, SquareStack, Stethoscope, Sun, Target,
  type LucideIcon,
} from "lucide-react";
import { AxomWordmark } from "../ui/BrandMark";
import { PaletteOrbs } from "./PaletteOrbs";
import { ChoiceChips, ChoiceSegment, ChoiceSummary, ChoiceTiles, type ChoiceSummaryRows } from "../ui/Choice";
import { ICON_SIZE } from "../../lib/iconSize";
import { useStore } from "../../lib/store";
import { setThemePreference, type ThemePreference } from "../../lib/theme";
import { useThemePreference } from "../../lib/useThemePreference";
import { notificationPermission, requestNotificationPermission, type NotifyPermission } from "../../lib/notify";
import type { OnboardingDestination, OnboardingMode } from "../../lib/onboardingProgress";
import {
  applySetup, cardSystemFromTools, clearSetupDraft, defaultChoices, focusChoices, PATH_OPTIONS, QUESTION_TIMINGS,
  readSetupDraft, TOOL_OPTIONS, usesLectures, usesQuestions, writeSetupDraft,
  type SetupChoices, type SetupPath, type SetupTool,
} from "../../lib/setupPlan";
import { SGU_CURRICULUM } from "../../lib/curricula";
import "../../styles/setup.css";

const PATH_ICONS: Record<SetupPath, LucideIcon> = {
  sgu: GraduationCap, usmd: Stethoscope, do: HeartHandshake, img: Globe2, premed: FlaskConical, other: Compass,
};
const TOOL_ICONS: Record<SetupTool, LucideIcon> = {
  lectures: BookOpen, questions: ListChecks, uworld: Target, amboss: BookMarked, anki: Layers, noji: Sparkles, quizlet: SquareStack, other: Plus,
};
const STEPS = ["You", "How you study", "Make it yours"] as const;
const SGU_MODULE_COUNT = SGU_CURRICULUM.terms.reduce((sum, term) => sum + term.courses.reduce((count, course) => count + course.modules.length, 0), 0);

export function SetupFlow({ mode, onComplete, onCancel }: {
  mode?: OnboardingMode;
  onComplete?: (destination: OnboardingDestination) => void;
  onCancel?: () => void;
}) {
  const profile = useStore((state) => state.profile);
  const effectiveMode: OnboardingMode = mode ?? (profile.onboarded ? "rerun" : "first-run");
  const [choices, setChoices] = useState<SetupChoices>(() => readSetupDraft(defaultChoices(useStore.getState().profile), effectiveMode));
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStepRender = useRef(true);
  const titleId = useId();

  useEffect(() => writeSetupDraft(choices, effectiveMode), [choices, effectiveMode]);
  useEffect(() => {
    // The first screen puts the caret in the name field; later screens move
    // focus to their heading so screen readers hear where they are.
    if (firstStepRender.current) { firstStepRender.current = false; return; }
    headingRef.current?.focus({ preventScroll: true });
  }, [choices.step]);

  const update = (patch: Partial<SetupChoices>) => setChoices((current) => ({ ...current, ...patch }));
  const go = (step: number) => {
    setDirection(step > choices.step ? "forward" : "back");
    update({ step: Math.max(0, Math.min(STEPS.length - 1, step)) });
  };

  function finish() {
    applySetup(choices, effectiveMode);
    clearSetupDraft();
    onComplete?.("dashboard");
  }

  function leave() {
    if (effectiveMode === "rerun") {
      clearSetupDraft();
      onCancel?.();
      return;
    }
    finish(); // "Skip for now" still leaves a working AXOM, from the defaults shown.
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (choices.step < STEPS.length - 1) go(choices.step + 1);
    else finish();
  }

  const last = choices.step === STEPS.length - 1;
  return (
    <>
    {/* Outside the animated root: a transformed ancestor would trap this fixed layer. */}
    <div className="setup-aura" aria-hidden="true" />
    <div className="setup-root">
      <form className="setup-stage" aria-labelledby={titleId} onSubmit={submit}>
        <header className="setup-top">
          <AxomWordmark size="sm" />
          <ol className="setup-progress" aria-label="Setup progress">
            {STEPS.map((label, index) => (
              <li key={label} className={index === choices.step ? "on" : index < choices.step ? "done" : ""} aria-current={index === choices.step ? "step" : undefined}>
                <span className="sr-only">{label}{index < choices.step ? ", done" : ""}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="setup-skip" onClick={leave}>{effectiveMode === "rerun" ? "Cancel" : "Skip for now"}</button>
        </header>

        <div className="setup-shell">
          <div className="setup-core">
            <section key={choices.step} className="setup-screen" data-dir={direction}>
              {choices.step === 0 && <YouStep choices={choices} update={update} titleId={titleId} headingRef={headingRef} rerun={effectiveMode === "rerun"} />}
              {choices.step === 1 && <StudyStep choices={choices} update={update} titleId={titleId} headingRef={headingRef} />}
              {choices.step === 2 && <YoursStep titleId={titleId} headingRef={headingRef} />}
            </section>
          </div>
        </div>

        <footer className="setup-nav">
          {choices.step > 0
            ? <button type="button" className="setup-back" onClick={() => go(choices.step - 1)}><ArrowLeft size={ICON_SIZE.body} aria-hidden="true" /> Back</button>
            : <span className="setup-reassure"><ShieldCheck size={ICON_SIZE.body} aria-hidden="true" /> Saved on this device as you go</span>}
          <button type="submit" className="setup-next">
            <span>{last ? (effectiveMode === "rerun" ? "Save changes" : "Enter AXOM") : "Continue"}</span>
            <span className="setup-next-icon" aria-hidden="true"><ArrowRight size={ICON_SIZE.body} /></span>
          </button>
        </footer>
      </form>
    </div>
    </>
  );
}

type StepProps = {
  choices: SetupChoices;
  update: (patch: Partial<SetupChoices>) => void;
  titleId: string;
  headingRef: React.RefObject<HTMLHeadingElement>;
};

function StepCopy({ eyebrow, title, lede, titleId, headingRef, children }: {
  eyebrow: string; title: string; lede: string; titleId: string; headingRef: React.RefObject<HTMLHeadingElement>; children?: ReactNode;
}) {
  return (
    <div className="setup-copy">
      <span className="setup-eyebrow">{eyebrow}</span>
      <h1 id={titleId} ref={headingRef} tabIndex={-1}>{title}</h1>
      <p>{lede}</p>
      {children}
    </div>
  );
}

function YouStep({ choices, update, titleId, headingRef, rerun }: Omit<StepProps, "headingRef"> & { headingRef: StepProps["headingRef"]; rerun: boolean }) {
  const nameId = useId();
  const focusOptions = focusChoices(choices.path);
  const summary: SummaryRows = [
    ["Course Tracker", choices.path === "sgu"
      ? `SGU Terms 1 to 5 and Boards, ${SGU_MODULE_COUNT} modules ready`
      : rerun ? "Your courses stay as they are" : "A clean slate you shape with your own courses"],
    ["Focus", focusOptions.find((option) => option.id === choices.focus)?.label ?? ""],
  ];
  return (
    <>
      <StepCopy
        eyebrow={rerun ? "Update your setup" : "Welcome to AXOM"}
        title="Who are you studying as?"
        lede="Three quick choices. AXOM builds your tracker, targets and dashboard around them, and every one can change later."
        titleId={titleId}
        headingRef={headingRef}
      >
        <SetupSummary rows={summary} placement="side" />
      </StepCopy>
      <div className="setup-controls">
        <label className="setup-name" htmlFor={nameId}>
          <span>What should we call you?</span>
          <input id={nameId} value={choices.name} autoFocus={!rerun} autoComplete="given-name" placeholder="Your first name"
            onChange={(event) => update({ name: event.target.value })} maxLength={80} />
        </label>
        <div className="setup-field">
          <span className="setup-label" id={`${titleId}-path`}>Your path</span>
          <ChoiceTiles
            columns="six"
            labelledBy={`${titleId}-path`}
            options={PATH_OPTIONS.map((option) => ({ ...option, icon: PATH_ICONS[option.id] }))}
            value={choices.path}
            onChange={(path) => update({ path, focus: focusChoices(path)[0].id })}
          />
        </div>
        <div className="setup-field setup-reveal" key={choices.path}>
          <span className="setup-label" id={`${titleId}-focus`}>{choices.path === "sgu" ? "Where are you now?" : choices.path === "other" ? "Which program?" : "What are you focused on?"}</span>
          <ChoiceChips labelledBy={`${titleId}-focus`} options={focusOptions} value={choices.focus} onChange={(focus) => update({ focus })} />
        </div>
        <SetupSummary rows={summary} placement="end" />
      </div>
    </>
  );
}

function StudyStep({ choices, update, titleId, headingRef }: StepProps) {
  const toggle = (tool: SetupTool) => update({ tools: choices.tools.includes(tool) ? choices.tools.filter((item) => item !== tool) : [...choices.tools, tool] });
  const cards = cardSystemFromTools(choices.tools);
  const tracker = [
    usesLectures(choices.tools) ? `${choices.lecturePasses} ${choices.lecturePasses === 1 ? "pass" : "passes"} per lecture` : "",
    cards ? `${cards.label} rounds` : "No flashcard rounds",
    usesQuestions(choices.tools) ? "question sets" : "",
  ].filter(Boolean);
  const targets = ["Study", usesQuestions(choices.tools) ? "Questions" : "", usesLectures(choices.tools) ? "Lectures" : "", cards ? `${cards.label} cards` : ""].filter(Boolean);
  const summary: SummaryRows = [["Course Tracker", tracker.join(" · ")], ["Daily targets", targets.join(" · ")]];
  return (
    <>
      <StepCopy
        eyebrow="How you study"
        title="What do you use?"
        lede="Pick everything that is part of your routine. Your tracker and daily targets follow from it; nothing here is decoration."
        titleId={titleId}
        headingRef={headingRef}
      >
        <SetupSummary live rows={summary} placement="side" />
      </StepCopy>
      <div className="setup-controls">
        <ChoiceTiles
          multiple
          compact
          label="What you use"
          options={TOOL_OPTIONS.map((option) => ({ ...option, icon: TOOL_ICONS[option.id] }))}
          selected={choices.tools}
          onToggle={toggle}
        />
        {choices.tools.includes("other") && (
          <label className="setup-inline-field setup-reveal">
            <span>What else do you use?</span>
            <input value={choices.otherTool} maxLength={80} placeholder="e.g. Sketchy, Boards and Beyond" onChange={(event) => update({ otherTool: event.target.value })} />
          </label>
        )}
        {usesLectures(choices.tools) && (
          <div className="setup-followup setup-reveal">
            <span className="setup-label" id={`${titleId}-passes`}>Passes per lecture</span>
            <ChoiceSegment labelledBy={`${titleId}-passes`} options={[1, 2, 3, 4].map((count) => ({ value: count, label: count }))}
              value={choices.lecturePasses} onChange={(lecturePasses) => update({ lecturePasses })} />
          </div>
        )}
        {usesQuestions(choices.tools) && (
          <div className="setup-followup setup-reveal">
            <span className="setup-label" id={`${titleId}-timing`}>When do you do questions?</span>
            <ChoiceSegment wide labelledBy={`${titleId}-timing`} options={QUESTION_TIMINGS.map((timing) => ({ value: timing.id, label: timing.label }))}
              value={choices.questionTiming} onChange={(questionTiming) => update({ questionTiming })} />
          </div>
        )}
        <details className="setup-more">
          <summary>More options</summary>
          <label className="setup-inline-field">
            <span>Bring material back after</span>
            <span className="setup-stepper">
              <input type="number" min={1} max={14} value={choices.reviewAfterDays} onChange={(event) => update({ reviewAfterDays: Number(event.target.value) || 3 })} />
              <em>days</em>
            </span>
          </label>
        </details>
        <SetupSummary live rows={summary} placement="end" />
      </div>
    </>
  );
}

const THEMES: Array<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function YoursStep({ titleId, headingRef }: { titleId: string; headingRef: StepProps["headingRef"] }) {
  const theme = useThemePreference();
  const [permission, setPermission] = useState<NotifyPermission>("default");
  useEffect(() => { void notificationPermission().then(setPermission); }, []);
  const notifyOn = permission === "granted";
  return (
    <>
      <StepCopy
        eyebrow="Your AXOM"
        title="Make it yours."
        lede="Your accent follows you across AXOM. It changes here as you choose, and anytime later in Settings."
        titleId={titleId}
        headingRef={headingRef}
      >
        <LivePreview />
      </StepCopy>
      <div className="setup-controls">
        <PaletteOrbs />
        <div className="setup-row">
          <span className="setup-label" id={`${titleId}-theme`}>Mode</span>
          <ChoiceSegment
            labelledBy={`${titleId}-theme`}
            options={THEMES.map(({ value, label, icon: Icon }) => ({ value, label: <><Icon size={ICON_SIZE.body} strokeWidth={1.75} aria-hidden="true" /> {label}</> }))}
            value={theme}
            onChange={setThemePreference}
          />
        </div>
        <div className="setup-notify">
          <Bell size={ICON_SIZE.emphasis} strokeWidth={1.5} aria-hidden="true" />
          <span>
            <b>Tell me when a focus block ends</b>
            <small>
              {permission === "denied" ? "Blocked in this browser's settings. You can allow it there anytime."
                : permission === "unavailable" ? "This browser cannot show notifications."
                  : "A quiet notice when your timer finishes, so you can look away while you study."}
            </small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={notifyOn}
            aria-label="Focus block notifications"
            className={`setup-switch ${notifyOn ? "on" : ""}`}
            disabled={permission === "denied" || permission === "unavailable" || notifyOn}
            onClick={() => { void requestNotificationPermission().then(setPermission); }}
          >
            <span />
          </button>
        </div>
      </div>
    </>
  );
}

type SummaryRows = ChoiceSummaryRows;

/** What these choices will build. Rendered beside the controls on wide screens and after them on narrow ones (CSS shows one). */
function SetupSummary({ rows, live = false, placement }: { rows: SummaryRows; live?: boolean; placement: "side" | "end" }) {
  return <ChoiceSummary rows={rows} live={live} className={`at-${placement}`} />;
}

/** A small piece of the real dashboard, painted in the palette being chosen. */
function LivePreview() {
  return (
    <div className="setup-preview" aria-hidden="true">
      <span className="setup-preview-ring"><b>64%</b></span>
      <span className="setup-preview-copy">
        <small>Today</small>
        <b>Study 2h 15m of 3h 30m</b>
        <span className="setup-preview-chips"><i>Focus 25:00</i><i>Soundscape</i></span>
      </span>
    </div>
  );
}

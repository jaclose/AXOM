import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ClipboardList, Eraser, UserRound } from "lucide-react";
import { GButton, GlassCard, PanelHeader } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";
import { useStore } from "../../lib/store";
import {
  APPLICATION_REGIONS,
  applicationCycleLabel,
  CITIZENSHIP_OPTIONS,
  COURSE_CATEGORIES,
  ESTIMATE_ACTIVITIES,
  experienceLogHours,
  isApplicationProfileEmpty,
  normalizeApplicationProfile,
  type ApplicationProfile,
  type CourseCategory,
  type CourseStatus,
} from "../../lib/applicationProfile";
import type { EstimateActivity } from "../../lib/applicationSchools";
import { formatYearMonth } from "./applicationDisplay";

/** Chosen in the form only: the profile stores U.S. and Canadian regions, so this reads as "no region". */
const OUTSIDE_REGION = "outside-us-canada";
const COURSE_FLAGS = [
  { id: "passFail", label: "Pass/fail" },
  { id: "online", label: "Online" },
  { id: "communityCollege", label: "Community college" },
  { id: "apCredit", label: "AP/IB" },
] as const;
type CourseFlag = (typeof COURSE_FLAGS)[number]["id"];
const COURSE_STATUS_OPTIONS: readonly { id: CourseStatus; label: string }[] = [
  { id: "completed", label: "Completed" },
  { id: "in-progress", label: "In progress" },
  { id: "planned", label: "Planned" },
  { id: "not-planned", label: "Not planned" },
];
const DEGREE_OPTIONS = [
  { id: "completed", label: "Completed" },
  { id: "in-progress", label: "In progress" },
  { id: "not-started", label: "Not started" },
] as const;

type CourseDraft = { status: CourseStatus | ""; semesterHours: string } & Record<CourseFlag, boolean>;

interface ProfileDraft {
  plannedMatriculationYear: string;
  cumulativeGpa: string;
  scienceGpa: string;
  mcatTotal: string;
  mcatTestDate: string;
  mcatLowestSection: string;
  mcatAttempts: string;
  citizenship: string;
  stateOfResidence: string;
  degreeStatus: string;
  degreeExpectedDate: string;
  semesterHoursCompleted: string;
  coursework: Record<CourseCategory, CourseDraft>;
  activityHours: Record<EstimateActivity, string>;
}

type NumericField = "cumulativeGpa" | "scienceGpa" | "mcatTotal" | "mcatLowestSection" | "mcatAttempts" | "semesterHoursCompleted";

const NUMERIC_RULES: Record<NumericField, { min: number; max: number; step: string; message: string }> = {
  cumulativeGpa: { min: 0, max: 4, step: "0.01", message: "Enter a GPA from 0 to 4.0. This value is not saved." },
  scienceGpa: { min: 0, max: 4, step: "0.01", message: "Enter a GPA from 0 to 4.0. This value is not saved." },
  mcatTotal: { min: 472, max: 528, step: "1", message: "Enter a whole-number MCAT total from 472 to 528. This value is not saved." },
  mcatLowestSection: { min: 118, max: 132, step: "1", message: "Enter a whole-number section score from 118 to 132. This value is not saved." },
  mcatAttempts: { min: 1, max: 10, step: "1", message: "Enter 1 to 10 attempts. This value is not saved." },
  semesterHoursCompleted: { min: 0, max: 400, step: "0.5", message: "Enter 0 to 400 semester hours. This value is not saved." },
};

const text = (value: number | string | undefined) => value === undefined ? "" : String(value);
const numberOrUndefined = (value: string) => value.trim() === "" ? undefined : Number(value);

function draftFromProfile(profile: ApplicationProfile | undefined): ProfileDraft {
  const coursework = Object.fromEntries(COURSE_CATEGORIES.map(({ id }) => {
    const entry = profile?.coursework?.[id];
    return [id, {
      status: entry?.status ?? "", semesterHours: text(entry?.semesterHours),
      passFail: entry?.passFail === true, online: entry?.online === true,
      communityCollege: entry?.communityCollege === true, apCredit: entry?.apCredit === true,
    }];
  })) as Record<CourseCategory, CourseDraft>;
  const activityHours = Object.fromEntries(ESTIMATE_ACTIVITIES.map(({ id }) => [id, text(profile?.activityHours?.[id])])) as Record<EstimateActivity, string>;
  return {
    plannedMatriculationYear: text(profile?.plannedMatriculationYear),
    cumulativeGpa: text(profile?.cumulativeGpa),
    scienceGpa: text(profile?.scienceGpa),
    mcatTotal: text(profile?.mcatTotal),
    mcatTestDate: profile?.mcatTestDate ?? "",
    mcatLowestSection: text(profile?.mcatLowestSection),
    mcatAttempts: text(profile?.mcatAttempts),
    citizenship: profile?.citizenship ?? "",
    stateOfResidence: profile?.stateOfResidence ?? "",
    degreeStatus: profile?.degreeStatus ?? "",
    degreeExpectedDate: profile?.degreeExpectedDate ?? "",
    semesterHoursCompleted: text(profile?.semesterHoursCompleted),
    coursework,
    activityHours,
  };
}

/** Raw profile input; normalizeApplicationProfile drops anything out of range or empty. */
function inputFromDraft(draft: ProfileDraft): Record<string, unknown> {
  const coursework: Record<string, unknown> = {};
  for (const { id } of COURSE_CATEGORIES) {
    const entry = draft.coursework[id];
    if (!entry.status) continue;
    coursework[id] = {
      status: entry.status,
      semesterHours: numberOrUndefined(entry.semesterHours),
      ...Object.fromEntries(COURSE_FLAGS.filter(flag => entry[flag.id]).map(flag => [flag.id, true])),
    };
  }
  const activityHours = Object.fromEntries(ESTIMATE_ACTIVITIES.map(({ id }) => [id, numberOrUndefined(draft.activityHours[id])]));
  return {
    plannedMatriculationYear: numberOrUndefined(draft.plannedMatriculationYear),
    cumulativeGpa: numberOrUndefined(draft.cumulativeGpa),
    scienceGpa: numberOrUndefined(draft.scienceGpa),
    mcatTotal: numberOrUndefined(draft.mcatTotal),
    mcatTestDate: draft.mcatTestDate || undefined,
    mcatLowestSection: numberOrUndefined(draft.mcatLowestSection),
    mcatAttempts: numberOrUndefined(draft.mcatAttempts),
    citizenship: draft.citizenship || undefined,
    stateOfResidence: draft.stateOfResidence && draft.stateOfResidence !== OUTSIDE_REGION ? draft.stateOfResidence : undefined,
    degreeStatus: draft.degreeStatus || undefined,
    degreeExpectedDate: draft.degreeExpectedDate || undefined,
    semesterHoursCompleted: numberOrUndefined(draft.semesterHoursCompleted),
    coursework,
    activityHours,
  };
}

function summaryItems(profile: ApplicationProfile | undefined): { label: string; value?: string }[] {
  const gpa = (value: number | undefined) => value === undefined ? undefined : value.toFixed(2);
  const month = formatYearMonth(profile?.mcatTestDate);
  const mcat = profile?.mcatTotal !== undefined ? `${profile.mcatTotal}${month ? ` · ${month}` : ""}` : month ? `Test month ${month}` : undefined;
  const degreeLabel = DEGREE_OPTIONS.find(option => option.id === profile?.degreeStatus)?.label;
  const degreeMonth = formatYearMonth(profile?.degreeExpectedDate);
  const degree = degreeLabel ? `${degreeLabel}${degreeMonth ? ` · ${degreeMonth}` : ""}` : degreeMonth ? `Expected ${degreeMonth}` : undefined;
  return [
    { label: "Cycle", value: profile?.plannedMatriculationYear ? applicationCycleLabel(profile.plannedMatriculationYear) : undefined },
    { label: "GPA", value: gpa(profile?.cumulativeGpa) },
    { label: "Science GPA", value: gpa(profile?.scienceGpa) },
    { label: "MCAT", value: mcat },
    { label: "Citizenship", value: CITIZENSHIP_OPTIONS.find(option => option.id === profile?.citizenship)?.label },
    { label: "Residence", value: profile?.stateOfResidence },
    { label: "Degree", value: degree },
  ];
}

export function ApplicationProfilePanel() {
  const profile = useStore(s => s.profile.applicationProfile);
  const premedExperiences = useStore(s => s.premedExperiences);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFromProfile(profile));
  const [copyNote, setCopyNote] = useState("");
  const lastWritten = useRef(profile?.updatedAt);
  const formId = useId();
  const field = (name: string) => `${formId}-${name}`;

  // Another tab, an import or a restore replaced the profile: show what is stored now.
  useEffect(() => {
    if (profile?.updatedAt === lastWritten.current) return;
    lastWritten.current = profile?.updatedAt;
    setDraft(draftFromProfile(profile));
  }, [profile]);

  const validated = useMemo(() => normalizeApplicationProfile(inputFromDraft(draft)), [draft]);
  const hasProfile = !isApplicationProfileEmpty(profile);
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    const options = Array.from({ length: 6 }, (_, index) => currentYear + index);
    const stored = Number(draft.plannedMatriculationYear);
    if (Number.isInteger(stored) && stored > 0 && !options.includes(stored)) options.unshift(stored);
    return options;
  }, [currentYear, draft.plannedMatriculationYear]);

  function commit(next: ProfileDraft) {
    setDraft(next);
    const saved = normalizeApplicationProfile({ ...inputFromDraft(next), updatedAt: new Date().toISOString() });
    lastWritten.current = saved?.updatedAt;
    useStore.getState().updateProfile({ applicationProfile: saved });
  }
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => commit({ ...draft, [key]: value });
  const setCourse = (category: CourseCategory, patch: Partial<CourseDraft>) =>
    commit({ ...draft, coursework: { ...draft.coursework, [category]: { ...draft.coursework[category], ...patch } } });
  const setHours = (activity: EstimateActivity, value: string) =>
    commit({ ...draft, activityHours: { ...draft.activityHours, [activity]: value } });

  function invalid(name: NumericField): string | undefined {
    return draft[name].trim() !== "" && validated?.[name] === undefined ? NUMERIC_RULES[name].message : undefined;
  }
  const monthInvalid = (name: "mcatTestDate" | "degreeExpectedDate") =>
    draft[name] !== "" && validated?.[name] === undefined ? "Use a month such as 2026-04. This value is not saved." : undefined;
  const hoursInvalid = (value: string, max: number, unit: string) => {
    if (value.trim() === "") return undefined;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= max ? undefined : `Enter 0 to ${max.toLocaleString("en-US")} ${unit}. This value is not saved.`;
  };
  const draftHasInput = JSON.stringify(draft) !== JSON.stringify(draftFromProfile(undefined));

  function copyFromLog() {
    const { mapped, clinicalUnsplit } = experienceLogHours(premedExperiences ?? []);
    const copied = ESTIMATE_ACTIVITIES.filter(({ id }) => mapped[id] !== undefined);
    if (copied.length) {
      const activityHours = { ...draft.activityHours };
      for (const { id } of copied) activityHours[id] = String(mapped[id]);
      commit({ ...draft, activityHours });
    }
    const copiedText = copied.length
      ? `Copied ${copied.map(({ id, label }) => `${label} (${mapped[id]} h)`).join(", ")} from your Experience Log.`
      : "Your Experience Log has no research, shadowing, leadership or service hours to copy.";
    const clinicalText = clinicalUnsplit > 0
      ? ` The log also has ${clinicalUnsplit} clinical hours. The log does not record which were paid, so split them between Clinical volunteering and Paid clinical work yourself.`
      : "";
    setCopyNote(copiedText + clinicalText);
  }

  function clearProfile() {
    if (!window.confirm("Clear your application profile? The automatic checks will stop using these values.")) return;
    lastWritten.current = undefined;
    setDraft(draftFromProfile(undefined));
    setCopyNote("");
    useStore.getState().updateProfile({ applicationProfile: undefined });
  }

  const numberField = (name: NumericField, label: string) => {
    const rule = NUMERIC_RULES[name];
    const error = invalid(name);
    return (
      <div className="application-field">
        <label htmlFor={field(name)}>{label}</label>
        <input id={field(name)} className="field" type="number" inputMode="decimal" min={rule.min} max={rule.max} step={rule.step}
          value={draft[name]} onChange={event => set(name, event.target.value)}
          aria-invalid={error ? true : undefined} aria-describedby={error ? field(`${name}-error`) : undefined} />
        {error && <p className="field-error" id={field(`${name}-error`)}>{error}</p>}
      </div>
    );
  };
  const monthField = (name: "mcatTestDate" | "degreeExpectedDate", label: string) => {
    const error = monthInvalid(name);
    return (
      <div className="application-field">
        <label htmlFor={field(name)}>{label}</label>
        <input id={field(name)} className="field" type="month" value={draft[name]} onChange={event => set(name, event.target.value)}
          aria-invalid={error ? true : undefined} aria-describedby={error ? field(`${name}-error`) : undefined} />
        {error && <p className="field-error" id={field(`${name}-error`)}>{error}</p>}
      </div>
    );
  };

  return (
    <GlassCard pad className="application-profile">
      <PanelHeader title="Your application profile" headingLevel={2}
        sub="Your profile stays in your workspace and backups and is only used for these local checks."
        action={<GButton size="sm" aria-expanded={editing} aria-controls={field("form")} onClick={() => setEditing(open => !open)}>
          <UserRound size={ICON_SIZE.body} /> Edit profile
        </GButton>} />
      <dl className="application-profile-summary" aria-label="Application profile summary">
        {summaryItems(profile).map(item => (
          <div key={item.label} className={item.value ? "" : "empty"}>
            <dt>{item.label}</dt>
            <dd>{item.value ?? "Not entered"}</dd>
          </div>
        ))}
      </dl>
      {!hasProfile && !editing && <p className="sub application-profile-empty">Every field is optional. Add what you know to compare it with the requirements AXOM captured for each school — anything you leave blank is reported as unknown, never as met.</p>}
      <form id={field("form")} className="application-profile-form" hidden={!editing} onSubmit={event => { event.preventDefault(); setEditing(false); }}>
        <p className="sub">Changes save as you type. Leave anything blank that you do not know yet.</p>
        <div className="application-field-grid">
          <div className="application-field">
            <label htmlFor={field("year")}>Planned start year</label>
            <select id={field("year")} className="field" value={draft.plannedMatriculationYear} onChange={event => set("plannedMatriculationYear", event.target.value)}>
              <option value="">Not entered</option>
              {years.map(year => <option key={year} value={String(year)}>{applicationCycleLabel(year)}</option>)}
            </select>
          </div>
          {numberField("cumulativeGpa", "Cumulative GPA")}
          {numberField("scienceGpa", "Science (BCPM) GPA")}
          {numberField("mcatTotal", "MCAT total")}
          {monthField("mcatTestDate", "MCAT test month")}
          {numberField("mcatLowestSection", "Lowest MCAT section score")}
          {numberField("mcatAttempts", "MCAT attempts")}
          <div className="application-field">
            <label htmlFor={field("citizenship")}>Citizenship status</label>
            <select id={field("citizenship")} className="field" value={draft.citizenship} onChange={event => set("citizenship", event.target.value)}>
              <option value="">Not entered</option>
              {CITIZENSHIP_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </div>
          <div className="application-field">
            <label htmlFor={field("region")}>State or province of residence</label>
            <select id={field("region")} className="field" value={draft.stateOfResidence} onChange={event => set("stateOfResidence", event.target.value)}
              aria-describedby={draft.stateOfResidence === OUTSIDE_REGION ? field("region-note") : undefined}>
              <option value="">Not entered</option>
              <optgroup label="United States">
                {APPLICATION_REGIONS.filter(region => region.country === "US").map(region => <option key={region.code} value={region.name}>{region.name}</option>)}
              </optgroup>
              <optgroup label="Canada">
                {APPLICATION_REGIONS.filter(region => region.country === "CA").map(region => <option key={region.code} value={region.name}>{region.name}</option>)}
              </optgroup>
              <option value={OUTSIDE_REGION}>Outside the U.S. and Canada</option>
            </select>
            {draft.stateOfResidence === OUTSIDE_REGION && <p className="sub" id={field("region-note")}>No state or province is stored, so state-residency checks will ask you to confirm each school's policy.</p>}
          </div>
          <div className="application-field">
            <label htmlFor={field("degree")}>Degree status</label>
            <select id={field("degree")} className="field" value={draft.degreeStatus} onChange={event => set("degreeStatus", event.target.value)}>
              <option value="">Not entered</option>
              {DEGREE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </div>
          {monthField("degreeExpectedDate", "Degree completion month (actual or expected)")}
          {numberField("semesterHoursCompleted", "Semester hours completed")}
        </div>

        <fieldset className="application-profile-group">
          <legend>Coursework</legend>
          <p className="sub">Choose a status to record a course area. Semester hours and the checkboxes cover any part of that area.</p>
          <div className="application-course-grid">
            {COURSE_CATEGORIES.map(({ id, label }) => {
              const entry = draft.coursework[id];
              const hoursError = entry.status ? hoursInvalid(entry.semesterHours, 400, "semester hours") : undefined;
              return (
                <fieldset className="application-course" key={id}>
                  <legend>{label}</legend>
                  <div className="application-course-fields">
                    <div className="application-field">
                      <label htmlFor={field(`${id}-status`)}><span className="sr-only">{label} </span>Status</label>
                      <select id={field(`${id}-status`)} className="field" value={entry.status}
                        onChange={event => setCourse(id, { status: event.target.value as CourseStatus | "" })}>
                        <option value="">Not entered</option>
                        {COURSE_STATUS_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                      </select>
                    </div>
                    <div className="application-field">
                      <label htmlFor={field(`${id}-hours`)}><span className="sr-only">{label} </span>Semester hours</label>
                      <input id={field(`${id}-hours`)} className="field" type="number" inputMode="decimal" min={0} max={400} step="0.5"
                        disabled={!entry.status} value={entry.semesterHours} onChange={event => setCourse(id, { semesterHours: event.target.value })}
                        aria-invalid={hoursError ? true : undefined} aria-describedby={hoursError ? field(`${id}-hours-error`) : undefined} />
                    </div>
                  </div>
                  {hoursError && <p className="field-error" id={field(`${id}-hours-error`)}>{hoursError}</p>}
                  <div className="application-course-flags">
                    {COURSE_FLAGS.map(flag => (
                      <label key={flag.id} className={entry.status ? "" : "disabled"}>
                        <input type="checkbox" disabled={!entry.status} checked={entry[flag.id]} onChange={event => setCourse(id, { [flag.id]: event.target.checked })} />
                        <span className="sr-only">{label} </span>{flag.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="application-profile-group">
          <legend>Activity hours</legend>
          <p className="sub">Totals you have checked yourself. They are only compared with research-team estimate ranges, never with requirements.</p>
          <div className="application-activity-grid">
            {ESTIMATE_ACTIVITIES.map(({ id, label }) => {
              const error = hoursInvalid(draft.activityHours[id], 20000, "hours");
              return (
                <div className="application-field" key={id}>
                  <label htmlFor={field(`activity-${id}`)}>{label} hours</label>
                  <input id={field(`activity-${id}`)} className="field" type="number" inputMode="decimal" min={0} max={20000} step="1"
                    value={draft.activityHours[id]} onChange={event => setHours(id, event.target.value)}
                    aria-invalid={error ? true : undefined} aria-describedby={error ? field(`activity-${id}-error`) : undefined} />
                  {error && <p className="field-error" id={field(`activity-${id}-error`)}>{error}</p>}
                </div>
              );
            })}
          </div>
          <div className="application-profile-copy">
            <GButton size="sm" type="button" onClick={copyFromLog}><ClipboardList size={ICON_SIZE.body} /> Copy totals from Experience Log</GButton>
            <p className="sub" role="status">{copyNote}</p>
          </div>
        </fieldset>

        <div className="application-profile-actions">
          <GButton size="sm" variant="danger" type="button" onClick={clearProfile} disabled={!hasProfile && !draftHasInput}><Eraser size={ICON_SIZE.body} /> Clear profile</GButton>
          <GButton size="sm" variant="primary" type="submit">Done</GButton>
        </div>
      </form>
    </GlassCard>
  );
}

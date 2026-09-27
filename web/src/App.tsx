import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { Sidebar } from "./components/shell/Sidebar";
import { TopBar } from "./components/shell/TopBar";
import { SettingsModal, type SettingsTab } from "./components/shell/SettingsModal";
import { OnboardingWizard } from "./components/shell/OnboardingWizard";
import { GuidedTour, type TourExitReason } from "./components/shell/GuidedTour";
import { PromisePrompt } from "./components/shell/PromisePrompt";
import { PromiseCutscene } from "./components/shell/PromiseCutscene";
import { Toaster } from "./components/shell/Toaster";
import { StandupWatcher } from "./components/shell/StandupWatcher";
import { DailyLoopReminderWatcher } from "./components/shell/DailyLoopReminderWatcher";
import { DailyRolloverWatcher } from "./components/shell/DailyRolloverWatcher";
import { UpdateAvailableWatcher } from "./components/shell/UpdateAvailableWatcher";
import { WhatsNewWatcher } from "./components/shell/WhatsNewWatcher";
import { PomodoroFx } from "./components/productivity/PomodoroFx";
import { MenuBarTimerBridge } from "./components/productivity/MenuBarTimerBridge";
import { SessionOverlay } from "./components/session/SessionOverlay";
import { FocusDock } from "./components/dock/FocusDock";
import { RestOverlay } from "./components/rest/RestOverlay";
import { SoundscapeTimerSync } from "./components/soundscapes/SoundscapeTimerSync";
import { FocusCheckIn } from "./components/shell/FocusCheckIn";
import { AccountSyncWatcher } from "./components/shell/AccountSyncWatcher";
import { NAV } from "./components/shell/nav";
import { useStore } from "./lib/store";
import { useUi } from "./lib/uiStore";
import { pushToast } from "./lib/toast";
import { markAppReady, usePageEntrance } from "./lib/presentation";
import type { StorageMigrationResult } from "./lib/storageMigrations";
import { readOnboardingDraftMode, type OnboardingDestination, type OnboardingMode } from "./lib/onboardingProgress";
import { promisePromptStatus, shouldOfferPromiseAfterGlobalTour, shouldOfferPromisePrompt } from "./lib/promisePrompt";

import { DashboardPage } from "./pages/DashboardPage";
import { ResourcesPage } from "./pages/ResourcesPage";
import { StepPage } from "./pages/StepPage";
import { ProductivityPage } from "./pages/ProductivityPage";
import { TasksPage } from "./pages/TasksPage";
import { JournalPage } from "./pages/JournalPage";

const DevDesignPreview = import.meta.env.DEV
  ? lazy(() => import("./pages/DesignPreviewPage"))
  : null;

// The optional game route stays out of the shell bundle. The word-list module
// is dynamically imported again inside DailyWordPage, so a disabled direct
// route cannot fetch the engine or list.
const LazyDailyWordPage = lazy(() => import("./pages/DailyWordPage").then((module) => ({ default: module.DailyWordPage })));
const LazyDoctordlePage = lazy(() => import("./pages/DoctordlePage").then((module) => ({ default: module.DoctordlePage })));
const LazyDailyGamesPage = lazy(() => import("./pages/OptionalDailyGamesPage").then((module) => ({ default: module.OptionalDailyGamesPage })));
const LazyBuildingPage = lazy(() => import("./pages/BuildingPage").then((module) => ({ default: module.BuildingPage })));
const LazySharedQuestionSetPage = lazy(() => import("./pages/SharedQuestionSetPage").then((module) => ({ default: module.SharedQuestionSetPage })));
const LazyCoursesPage = lazy(() => import("./pages/CoursesPage").then((module) => ({ default: module.CoursesPage })));
const LazyCourseTrackerPage = lazy(() => import("./pages/CourseTrackerPage").then((module) => ({ default: module.CourseTrackerPage })));
const LazyQuestionWorkspacePage = lazy(() => import("./pages/QuestionWorkspacePage").then((module) => ({ default: module.QuestionWorkspacePage })));
const LazyApplicationCheckerPage = lazy(() => import("./pages/ApplicationCheckerPage").then((module) => ({ default: module.ApplicationCheckerPage })));
// Less frequent routes load on demand to keep the always-loaded shell small.
const LazyAnkiLabPage = lazy(() => import("./pages/AnkiLabPage").then((module) => ({ default: module.AnkiLabPage })));
const LazyReportsPage = lazy(() => import("./pages/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const LazyHabitTrackerPage = lazy(() => import("./pages/HabitTrackerPage").then((module) => ({ default: module.HabitTrackerPage })));
const LazyIntegrationsPage = lazy(() => import("./pages/IntegrationsPage").then((module) => ({ default: module.IntegrationsPage })));
const LazyPromptLibraryPage = lazy(() => import("./pages/PromptLibraryPage").then((module) => ({ default: module.PromptLibraryPage })));
const LazyHubFoldersPage = lazy(() => import("./pages/HubFoldersPage").then((module) => ({ default: module.HubFoldersPage })));
const LazyHelpPage = lazy(() => import("./pages/HelpPage").then((module) => ({ default: module.HelpPage })));
const LazyAboutPage = lazy(() => import("./pages/AboutPage").then((module) => ({ default: module.AboutPage })));
const LazyLeaderboardsPage = lazy(() => import("./pages/LeaderboardsPage").then((module) => ({ default: module.LeaderboardsPage })));
const LazyPremedExperienceLogPage = lazy(() => import("./pages/PremedExperienceLogPage").then((module) => ({ default: module.PremedExperienceLogPage })));
const LazyActivityHistoryPage = lazy(() => import("./pages/ActivityHistoryPage").then((module) => ({ default: module.ActivityHistoryPage })));
const LazyStudyMethodsPage = lazy(() => import("./pages/StudyMethodsPage").then((module) => ({ default: module.StudyMethodsPage })));
const LazySoundscapesPage = lazy(() => import("./pages/SoundscapesPage").then((module) => ({ default: module.SoundscapesPage })));

const PAGES: Record<string, () => JSX.Element> = {
  dashboard: DashboardPage,
  courses: () => <LazyCoursesPage />,
  tracker: () => <LazyCourseTrackerPage />,
  questions: () => <LazyQuestionWorkspacePage />,
  methods: () => <LazyStudyMethodsPage />,
  soundscapes: () => <LazySoundscapesPage />,
  anki: () => <LazyAnkiLabPage />,
  resources: ResourcesPage,
  step: () => <StepPage initialLane="step1" />,
  step2: () => <StepPage initialLane="step2" />,
  dedicated: () => <StepPage initialLane="dedicated" />,
  shelf: () => <StepPage initialLane="shelf" />,
  step3: () => <StepPage initialLane="step3" />,
  premed: () => <StepPage initialLane="premed" />,
  mcat: () => <StepPage initialLane="mcat" />,
  dat: () => <StepPage initialLane="dat" />,
  casper: () => <StepPage initialLane="casper" />,
  "premed-log": () => <LazyPremedExperienceLogPage />,
  activity: () => <LazyActivityHistoryPage />,
  reports: () => <LazyReportsPage />,
  productivity: ProductivityPage,
  tasks: TasksPage,
  habits: () => <LazyHabitTrackerPage />,
  journal: JournalPage,
  integrations: () => <LazyIntegrationsPage />,
  prompts: () => <LazyPromptLibraryPage />,
  folders: () => <LazyHubFoldersPage />,
  about: () => <LazyAboutPage />,
  help: () => <LazyHelpPage />,
  appchecker: () => <LazyApplicationCheckerPage />,
  leaderboards: () => <LazyLeaderboardsPage />,
  "daily-games": () => <LazyDailyGamesPage />,
  "daily-word": () => <LazyDailyWordPage />,
  doctordle: () => <LazyDoctordlePage />,
  building: () => <LazyBuildingPage />,
  "shared-set": () => <LazySharedQuestionSetPage />,
};

export default function App({ startupStatus }: { startupStatus?: StorageMigrationResult }) {
  // route via the URL hash so deep-links + the standalone page work
  const [route, setRoute] = useState<string>(() => location.hash.replace("#", "") || "dashboard");
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const [refreshing, setRefreshing] = useState(false);
  // Existing users who finished or opted out of onboarding before the Promise
  // was wired receive it at the next safe application start. This initializer
  // deliberately runs once: route changes, module tours, and unrelated dialog
  // exits can never become Promise triggers.
  const [promisePromptOpen, setPromisePromptOpen] = useState(() => {
    const profile = useStore.getState().profile;
    return profile.onboarded === true
      && profile.tourDone === true
      && shouldOfferPromisePrompt(profile);
  });
  const [promiseCutsceneOpen, setPromiseCutsceneOpen] = useState(false);
  const [setupMode, setSetupMode] = useState<OnboardingMode | null>(() =>
    readOnboardingDraftMode() === "rerun" ? "rerun" : null,
  );
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const restoreMenuFocusRef = useRef(false);
  const onboarded = useStore((s) => s.profile.onboarded);
  const tourDone = useStore((s) => s.profile.tourDone);
  const updateProfile = useStore((s) => s.updateProfile);
  // Show the tour once after onboarding; "Replay tour" simply clears tourDone.
  const showTour = onboarded && !tourDone;

  const closeDrawer = useCallback(() => {
    if (!drawer) return;
    restoreMenuFocusRef.current = true;
    setDrawer(false);
  }, [drawer]);

  // Restore focus only after the drawer has become inert. Scheduling from the
  // close handler can race React's render and leave focus stranded inside the
  // now-hidden navigation surface on fast or synchronous animation frames.
  useLayoutEffect(() => {
    if (drawer || !restoreMenuFocusRef.current) return;
    restoreMenuFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [drawer]);

  useEffect(() => {
    if (!drawer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeDrawer();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, drawer]);

  useEffect(() => {
    if (!startupStatus) return;
    if (startupStatus.ok && startupStatus.buildChanged) {
      pushToast({
        title: "Updated to latest build",
        body: "Your local data was preserved.",
        tone: "success",
        dedupe: `build-applied-${startupStatus.currentBuild.commitSha}-${startupStatus.currentBuild.version}`,
      });
      return;
    }
    if (!startupStatus.ok) {
      pushToast({
        title: "Local data needs attention",
        body: startupStatus.recoveryMessage,
        tone: "warn",
        duration: 0,
        dedupe: `storage-migration-failed-${startupStatus.fromVersion}-${startupStatus.toVersion}`,
        actionLabel: "Open backups",
        onAction: () => { setSettingsTab("backup"); setSettings(true); },
      });
    }
  }, [startupStatus]);

  function endTour(reason: TourExitReason) {
    const profile = useStore.getState().profile;
    updateProfile({ tourDone: true });
    if (shouldOfferPromiseAfterGlobalTour(reason, profile)) {
      setPromisePromptOpen(true);
    }
    location.hash = "dashboard";
  }

  function deferPromisePrompt() {
    updateProfile({ promisePromptStatus: promisePromptStatus("deferred") });
    setPromisePromptOpen(false);
  }

  function skipPromisePrompt() {
    updateProfile({ promisePromptStatus: promisePromptStatus("skipped") });
    setPromisePromptOpen(false);
  }

  function finishPromiseCutscene() {
    if (!useStore.getState().profile.promise?.signedName) {
      updateProfile({ promisePromptStatus: promisePromptStatus("deferred") });
    }
    setPromiseCutsceneOpen(false);
  }

  useEffect(() => {
    const onHash = () => setRoute(location.hash.replace("#", "") || "dashboard");
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);

  // Pages can request a Settings section; legacy names such as "ai" remain aliases.
  const settingsRequest = useUi((u) => u.settingsRequest);
  useEffect(() => {
    if (!settingsRequest) return;
    setSettingsTab(settingsRequest as SettingsTab);
    setSettings(true);
    useUi.getState().clearSettingsRequest();
  }, [settingsRequest]);

  const onboardingRequested = useUi((u) => u.onboardingRequested);
  useEffect(() => {
    if (!onboardingRequested) return;
    setSettings(false);
    setSetupMode("rerun");
    useUi.getState().clearOnboardingRequest();
  }, [onboardingRequested]);

  // First visit to a tab this session: its sections settle in (lib/presentation).
  const pageEnter = usePageEntrance(route.split("?")[0]);

  if (route === "design-preview" && DevDesignPreview) {
    return (
      <Suspense fallback={<div className="design-preview-boot">Preparing AXOM component preview…</div>}>
        <DevDesignPreview />
        <PresentationReady />
      </Suspense>
    );
  }

  function go(id: string) {
    try {
      window.history.pushState(null, "", `#${id}`);
    } catch {
      location.hash = id;
    }
    setRoute(id);
  }

  function completeOnboarding(destination: OnboardingDestination) {
    setSetupMode(null);
    go(destination);
    const profile = useStore.getState().profile;
    // Finishing without the optional guide and skipping setup are both explicit
    // guide decisions. Present the Promise only after onboarding has closed so
    // it never competes with setup or traps the user's emergency exit.
    if (profile.tourDone === true && shouldOfferPromisePrompt(profile)) {
      setPromisePromptOpen(true);
    }
  }

  // The guided tour navigates through React state directly (deterministic, same
  // render cycle) and updates the URL with replaceState so it never creates
  // Back-button history traps or depends on the async hashchange event.
  function navigateTour(id: string) {
    setRoute(id);
    try { window.history.replaceState(null, "", `#${id}`); } catch { location.hash = id; }
  }

  function refresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 650);
  }

  const routeKey = route.split("?")[0];
  const nav = NAV.find((n) => n.id === routeKey) ?? NAV[0];
  const Page: ComponentType = PAGES[routeKey] ?? DashboardPage;

  if (!onboarded || setupMode) {
    return (
      <div className="app-root">
        <div className="backdrop">
          <div className="orb cyan" />
          <div className="orb purple" />
          <div className="orb blue" />
        </div>
        {/* Same child slot as in the main shell below, so re-running setup
            keeps one bridge mounted and a running sprint stays in the menu bar. */}
        {onboarded && <MenuBarTimerBridge />}
        <DailyRolloverWatcher />
        <UpdateAvailableWatcher />
        <OnboardingWizard
          mode={setupMode ?? "first-run"}
          onComplete={completeOnboarding}
          onCancel={() => setSetupMode(null)}
        />
        <PresentationReady />
        <Toaster />
      </div>
    );
  }

  return (
    <div className="app-root">
      <div className="backdrop">
        <div className="orb cyan" />
        <div className="orb purple" />
        <div className="orb blue" />
      </div>
      {/* Keep in the slot right after the backdrop (see the setup branch). */}
      <MenuBarTimerBridge />

      <div className="shell">
        <Sidebar
          active={route}
          onSelect={go}
          onOpenSettings={(tab) => { setSettingsTab(tab ?? "profile"); setSettings(true); }}
          collapsed={drawer}
          onClose={closeDrawer}
        />

        <div className="surface">
          <TopBar
            route={routeKey}
            title={nav.label}
            subtitle={nav.subtitle}
            onMenu={() => setDrawer(true)}
            menuButtonRef={menuButtonRef}
            drawerOpen={drawer}
            onRefresh={refresh}
            refreshing={refreshing}
          />
          <div className="surface-scroll">
            <div className={route === "tracker" ? "page page-tracker" : "page"} data-enter={pageEnter ? "" : undefined}>
              <Suspense fallback={<div className="route-loading" role="status" aria-live="polite">Opening your workspace…</div>}>
                <Page />
                {/* Commits with the page itself, so the film only hands over to real content. */}
                <PresentationReady />
              </Suspense>
            </div>
          </div>
        </div>
      </div>

      {settings && <SettingsModal onClose={() => setSettings(false)} initialTab={settingsTab} />}
      {showTour && <GuidedTour onExit={endTour} onNavigate={navigateTour} currentRoute={route} />}
      {promisePromptOpen && !showTour && (
        <PromisePrompt
          onSign={() => { setPromisePromptOpen(false); setPromiseCutsceneOpen(true); }}
          onReviewLater={deferPromisePrompt}
          onSkip={skipPromisePrompt}
        />
      )}
      {promiseCutsceneOpen && !showTour && <PromiseCutscene onDone={finishPromiseCutscene} />}
      <DailyRolloverWatcher />
      <UpdateAvailableWatcher />
      <PomodoroFx />
      <WhatsNewWatcher startupStatus={startupStatus} suspended={Boolean(showTour || settings || promisePromptOpen || promiseCutsceneOpen)} />
      <StandupWatcher />
      <DailyLoopReminderWatcher />
      <SessionOverlay />
      <FocusDock />
      <RestOverlay />
      <SoundscapeTimerSync />
      <FocusCheckIn />
      <AccountSyncWatcher />
      <Toaster />
    </div>
  );
}

/** Signals that real content has rendered (the opening film waits for this). */
function PresentationReady() {
  useEffect(() => markAppReady(), []);
  return null;
}

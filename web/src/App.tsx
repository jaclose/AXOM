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
import { SessionOverlay } from "./components/session/SessionOverlay";
import { isDailyGamesRoute, NAV } from "./components/shell/nav";
import { useStore } from "./lib/store";
import { useUi } from "./lib/uiStore";
import { pushToast } from "./lib/toast";
import type { StorageMigrationResult } from "./lib/storageMigrations";
import { readOnboardingDraftMode, type OnboardingDestination, type OnboardingMode } from "./lib/onboardingProgress";
import { promisePromptStatus, shouldOfferPromiseAfterGlobalTour, shouldOfferPromisePrompt } from "./lib/promisePrompt";

import { DashboardPage } from "./pages/DashboardPage";
import { CoursesPage } from "./pages/CoursesPage";
import { CourseTrackerPage } from "./pages/CourseTrackerPage";
import { AnkiLabPage } from "./pages/AnkiLabPage";
import { ResourcesPage } from "./pages/ResourcesPage";
import { StepPage } from "./pages/StepPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ProductivityPage } from "./pages/ProductivityPage";
import { TasksPage } from "./pages/TasksPage";
import { HabitTrackerPage } from "./pages/HabitTrackerPage";
import { JournalPage } from "./pages/JournalPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { PromptLibraryPage } from "./pages/PromptLibraryPage";
import { HubFoldersPage } from "./pages/HubFoldersPage";
import { HelpPage } from "./pages/HelpPage";
import { AboutPage } from "./pages/AboutPage";
import { ApplicationCheckerPage } from "./pages/ApplicationCheckerPage";
import { LeaderboardsPage } from "./pages/LeaderboardsPage";
import { PremedExperienceLogPage } from "./pages/PremedExperienceLogPage";
import { ActivityHistoryPage } from "./pages/ActivityHistoryPage";
import { QuestionWorkspacePage } from "./pages/QuestionWorkspacePage";
import { StudyMethodsPage } from "./pages/StudyMethodsPage";
import { OptionalDailyGamesPage } from "./pages/OptionalDailyGamesPage";

const DevDesignPreview = import.meta.env.DEV
  ? lazy(() => import("./pages/DesignPreviewPage"))
  : null;

// The optional game route stays out of the shell bundle. The word-list module
// is dynamically imported again inside DailyWordPage, so a disabled direct
// route cannot fetch the engine or list.
const LazyDailyWordPage = lazy(() => import("./pages/DailyWordPage").then((module) => ({ default: module.DailyWordPage })));
const LazyDoctordlePage = lazy(() => import("./pages/DoctordlePage").then((module) => ({ default: module.DoctordlePage })));

const PAGES: Record<string, () => JSX.Element> = {
  dashboard: DashboardPage,
  courses: CoursesPage,
  tracker: CourseTrackerPage,
  questions: QuestionWorkspacePage,
  methods: StudyMethodsPage,
  anki: AnkiLabPage,
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
  "premed-log": PremedExperienceLogPage,
  activity: ActivityHistoryPage,
  reports: ReportsPage,
  productivity: ProductivityPage,
  tasks: TasksPage,
  habits: HabitTrackerPage,
  journal: JournalPage,
  integrations: IntegrationsPage,
  prompts: PromptLibraryPage,
  folders: HubFoldersPage,
  about: AboutPage,
  help: HelpPage,
  appchecker: ApplicationCheckerPage,
  leaderboards: LeaderboardsPage,
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
  const dailyGamesEnabled = useStore((s) => s.profile.experimentalFlags?.dailyGames === true);
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

  if (route === "design-preview" && DevDesignPreview) {
    return (
      <Suspense fallback={<div className="design-preview-boot">Preparing AXOM component preview…</div>}>
        <DevDesignPreview />
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

  const nav = NAV.find((n) => n.id === route) ?? NAV[0];
  let Page: ComponentType = PAGES[route] ?? DashboardPage;
  if (isDailyGamesRoute(route)) {
    Page = !dailyGamesEnabled
      ? OptionalDailyGamesPage
      : route === "daily-word" ? LazyDailyWordPage : LazyDoctordlePage;
  }

  if (!onboarded || setupMode) {
    return (
      <div className="app-root">
        <div className="backdrop">
          <div className="orb cyan" />
          <div className="orb purple" />
          <div className="orb blue" />
        </div>
        <DailyRolloverWatcher />
        <UpdateAvailableWatcher />
        <OnboardingWizard
          mode={setupMode ?? "first-run"}
          onComplete={completeOnboarding}
          onCancel={() => setSetupMode(null)}
        />
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
            title={nav.label}
            subtitle={nav.subtitle}
            onMenu={() => setDrawer(true)}
            menuButtonRef={menuButtonRef}
            drawerOpen={drawer}
            onRefresh={refresh}
            refreshing={refreshing}
          />
          <div className="surface-scroll">
            <div className={route === "tracker" ? "page page-tracker" : "page"}>
              <Suspense fallback={<div className="route-loading" role="status">Opening optional module…</div>}>
                <Page />
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
      <Toaster />
    </div>
  );
}

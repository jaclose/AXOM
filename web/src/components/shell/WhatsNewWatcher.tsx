import { useEffect } from "react";
import { dismissAnnouncement, readDismissedAnnouncements } from "../../lib/announcements";
import type { StorageMigrationResult } from "../../lib/storageMigrations";
import { pushToast } from "../../lib/toast";
import { useUi } from "../../lib/uiStore";

export function WhatsNewWatcher({ startupStatus, suspended }: { startupStatus?: StorageMigrationResult; suspended: boolean }) {
  useEffect(() => {
    // Only a changed build can have news; the release notes (the whole
    // CHANGELOG) load on demand instead of shipping in the startup bundle.
    if (suspended || !startupStatus?.ok || !startupStatus.buildChanged) return;
    let cancelled = false;
    void import("../../lib/releaseNotes").then(({ CURRENT_RELEASE, releaseAnnouncementId, shouldAnnounceRelease }) => {
      if (cancelled || !CURRENT_RELEASE || !shouldAnnounceRelease(startupStatus, readDismissedAnnouncements())) return;
      const id = releaseAnnouncementId(CURRENT_RELEASE.version);
      dismissAnnouncement(id);
      pushToast({
        title: `AXOM ${CURRENT_RELEASE.version} is ready`, body: CURRENT_RELEASE.title,
        tone: "success", duration: 0, dedupe: id, actionLabel: "Read what’s new",
        onAction: () => useUi.getState().requestSettings("advanced"),
      });
    }).catch(() => { /* Release notes are optional; a failed chunk load must not break startup. */ });
    return () => { cancelled = true; };
  }, [startupStatus, suspended]);
  return null;
}

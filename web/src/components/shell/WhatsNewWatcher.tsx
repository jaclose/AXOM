import { useEffect } from "react";
import { dismissAnnouncement, readDismissedAnnouncements } from "../../lib/announcements";
import { CURRENT_RELEASE, releaseAnnouncementId, shouldAnnounceRelease } from "../../lib/releaseNotes";
import type { StorageMigrationResult } from "../../lib/storageMigrations";
import { pushToast } from "../../lib/toast";
import { useUi } from "../../lib/uiStore";

export function WhatsNewWatcher({ startupStatus, suspended }: { startupStatus?: StorageMigrationResult; suspended: boolean }) {
  useEffect(() => {
    if (suspended || !CURRENT_RELEASE || !shouldAnnounceRelease(startupStatus, readDismissedAnnouncements())) return;
    const id = releaseAnnouncementId(CURRENT_RELEASE.version);
    dismissAnnouncement(id);
    pushToast({
      title: `AXOM ${CURRENT_RELEASE.version} is ready`, body: CURRENT_RELEASE.title,
      tone: "success", duration: 0, dedupe: id, actionLabel: "Read what’s new",
      onAction: () => useUi.getState().requestSettings("advanced"),
    });
  }, [startupStatus, suspended]);
  return null;
}

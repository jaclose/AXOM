import { AlertTriangle } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import "../../styles/community-uploads.css";

/** Shown wherever locally saved community questions can be opened or scored. */
export function CommunityPracticeNotice({ count, pending, possible = false, simulator = false }: {
  count: number; pending: boolean; possible?: boolean; simulator?: boolean;
}) {
  if (count === 0 && !pending) return null;
  return <div className={simulator ? "community-sim-warning" : "community-practice-warning"} role="status">
    <AlertTriangle size={ICON_SIZE.body} aria-hidden="true" />
    <span><b>Unreviewed community material.</b> {count > 0
      ? `${count} ${count === 1 ? "question" : "questions"} ${possible ? "may be included" : "included"} in this practice. Answers and sources have not been approved by AXOM. Verify them before relying on them.`
      : "A community download is incomplete. Some local questions may be unreviewed; retry the download before relying on practice."}</span>
  </div>;
}

import { useEffect, useState } from "react";
import { MessageSquareText, RefreshCw } from "lucide-react";
import { listJournalFeedback, type JournalExperienceFeedback } from "../../lib/journalFeedback";
import { GButton, GlassCard, PanelHeader } from "../ui/primitives";

export function JournalFeedbackReview({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<JournalExperienceFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let alive = true;
    setRows([]);
    setLoading(true);
    setError("");
    void listJournalFeedback(accountId)
      .then((items) => { if (alive) setRows(items); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "Feedback could not be loaded."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [accountId, refresh]);

  function download() {
    const blob = new Blob([JSON.stringify({ format: "axom-journal-feedback", version: 1, exportedAt: new Date().toISOString(), rows }, null, 2)],
      { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `axom-journal-feedback-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return <GlassCard pad className="host-journal-feedback">
    <PanelHeader title="Journal experience feedback" headingLevel={2}
      sub="Only answers learners chose to send. Their journal pages and attachments are never included." />
    <div className="row wrap gap8">
      <GButton size="sm" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} aria-hidden="true" /> Refresh</GButton>
      <GButton size="sm" disabled={loading || !!error || rows.length === 0} onClick={download}>Export visible JSON</GButton>
    </div>
    {loading && <p role="status">Loading journal feedback…</p>}
    {error && <p role="alert" className="host-warning">{error}</p>}
    {!loading && !error && rows.length === 0 && <p className="sub">No journal feedback has been submitted.</p>}
    {!loading && !error && rows.length > 0 && <div className="host-journal-feedback__list">
      {rows.map((row) => <article key={row.id} className="host-journal-feedback__entry">
        <div><MessageSquareText size={17} aria-hidden="true" /><b>{row.rating} / 5</b><small>{new Date(row.createdAt).toLocaleDateString()}</small></div>
        {([
          ["Liked", row.liked], ["Want more", row.wantMore], ["Missing", row.missing],
          ["Pain points", row.painPoints], ["Other", row.comment],
        ] as const).filter(([, value]) => value).map(([label, value]) => <p key={label}><strong>{label}</strong> {value}</p>)}
      </article>)}
    </div>}
    {!loading && !error && rows.length === 100 && <p className="sub">Showing the 100 most recent submissions.</p>}
  </GlassCard>;
}

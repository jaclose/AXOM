import {
  ClipboardCheck, GraduationCap, Stethoscope, Syringe, BookOpen,
  CheckCircle2, Clock,
} from "lucide-react";
import { useState } from "react";
import { GlassCard, PanelHeader, Tag } from "../components/ui/primitives";
import { ICON_SIZE } from "../lib/iconSize";
import { loadTrackData, type ApplicationTrack } from "../lib/application-checker/engine";

const TRACK_CONFIG = [
  { id: "med_schools", icon: GraduationCap, title: "Medical School", tone: "cyan" as const },
  { id: "residencies", icon: Stethoscope, title: "Residency / Match", tone: "purple" as const },
  { id: "undergrad", icon: BookOpen, title: "Undergraduate", tone: "neutral" as const },
  { id: "health_professions", icon: Syringe, title: "Health Professions", tone: "neutral" as const },
];

export function ApplicationCheckerPage() {
  const [activeTrack, setActiveTrack] = useState<string | null>(null);
  const [trackData, setTrackData] = useState<ApplicationTrack | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleTrackSelect(id: string) {
    setIsLoading(true);
    setActiveTrack(id);
    try {
      const data = await loadTrackData(id);
      setTrackData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <GlassCard pad>
        <div className="row gap12" style={{ alignItems: "center" }}>
          <span className="folder-icon" style={{ color: "var(--cyan)" }}><ClipboardCheck size={ICON_SIZE.control} /></span>
          <div className="grow">
            <div style={{ fontSize: 18, fontWeight: 800 }}>Application Checker</div>
            <div className="sub">Track applications end to end — powered by AXOM Intelligence.</div>
          </div>
          <Tag tone="cyan">Active Engine</Tag>
        </div>
      </GlassCard>

      <div className="grid grid-2 gap16">
        {/* Track Selector */}
        <GlassCard pad>
          <PanelHeader title="Select Your Path" sub="Load the intelligence manifest for your current application cycle" />
          <div className="grid grid-2 gap12" style={{ marginTop: 16 }}>
            {TRACK_CONFIG.map((t) => {
              const Icon = t.icon;
              const isActive = activeTrack === t.id;
              return (
                <div
                  key={t.id}
                  className={`int-row ${isActive ? "active" : ""}`}
                  style={{
                    cursor: "pointer",
                    border: `1px solid ${isActive ? `var(--${t.tone})` : "var(--graphite)"}`,
                    backgroundColor: isActive ? `var(--${t.tone})11` : "transparent",
                    padding: "12px",
                    borderRadius: "8px",
                    transition: "all 0.2s"
                  }}
                  onClick={() => handleTrackSelect(t.id)}
                >
                  <span className="folder-icon" style={{ color: `var(--${t.tone})` }}><Icon size={ICON_SIZE.emphasis} /></span>
                  <div className="grow"><div style={{ fontWeight: 700 }}>{t.title}</div></div>
                  {isActive && <CheckCircle2 size={16} style={{ color: `var(--${t.tone})` }} />}
                </div>
              );
            })}
          </div>
        </GlassCard>

        {/* Benchmarks / Gap Analysis */}
        <GlassCard pad>
          <PanelHeader title="Competitive Benchmarks" sub="Your current stats vs. the gold standard" />
          <div style={{ marginTop: 16 }}>
            {isLoading ? (
              <div className="sub" style={{ textAlign: "center", opacity: 0.5 }}>Loading intelligence...</div>
            ) : trackData ? (
              <div className="grid grid-1 gap8">
                {trackData.benchmarks.map((b, i) => (
                  <div key={i} className="int-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--graphite)" }}>
                    <div className="grow" style={{ fontSize: 14 }}>{b.metric}</div>
                    <div className="sub" style={{ marginRight: 12 }}>Your: {b.userValue}</div>
                    <div style={{ fontWeight: 700, color: "var(--gold)" }}>Goal: {b.goldStandard}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sub" style={{ textAlign: "center", opacity: 0.5, padding: "20px" }}>Select a path to see your competitive gap analysis.</div>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Live Timeline & Checklist */}
      {trackData && (
        <div className="grid grid-2 gap16" style={{ marginTop: 16 }}>
          <GlassCard pad>
            <PanelHeader title="2026-2027 Cycle Timeline" sub="Critical milestones and deadlines" />
            <div className="timeline-container" style={{ marginTop: 16, position: "relative" }}>
              {trackData.timeline.map((event, i) => (
                <div key={i} className="timeline-item" style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-start" }}>
                  <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    backgroundColor: event.isCritical ? "var(--gold)" : "var(--graphite)",
                    marginTop: 5,
                    flexShrink: 0,
                    boxShadow: event.isCritical ? "0 0 8px var(--gold)" : "none"
                  }} />
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.6, fontWeight: 700 }}>{event.date}</div>
                    <div style={{ fontSize: 14 }}>{event.event}</div>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard pad>
            <PanelHeader title="Application Checklist" sub="Required components and status" />
            <div className="grid grid-1 gap8" style={{ marginTop: 16 }}>
              {trackData.requirements.map((req, i) => (
                <div key={i} className="int-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--graphite)" }}>
                  <span className="folder-icon">
                    {req.status === "completed" ? <CheckCircle2 size={ICON_SIZE.body} style={{ color: "var(--gold)" }} /> : <Clock size={ICON_SIZE.body} style={{ color: "var(--graphite)" }} />}
                  </span>
                  <div className="grow">
                    <div style={{ fontSize: 14 }}>{req.label}</div>
                    <div className="sub" style={{ fontSize: 11 }}>Deadline: {req.deadline}</div>
                  </div>
                  <Tag tone={req.status === "completed" ? "gold" : "neutral"}>{req.status}</Tag>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      )}
    </>
  );
}

// ===========================================================================
// Application Intelligence Bridge (directive §14A)
// Maps raw JSON intelligence data from the la-vault to the Application Checker UI.
// ===========================================================================

export interface ApplicationTrack {
  id: string;
  label: string;
  description: string;
  timeline: TimelineEvent[];
  benchmarks: Benchmark[];
  requirements: Requirement[];
}

export interface TimelineEvent {
  date: string;
  event: string;
  isCritical: boolean;
}

export interface Benchmark {
  metric: string;
  userValue: string | number;
  goldStandard: string | number;
  description: string;
  status: "below" | "met" | "exceeded";
}

export interface Requirement {
  id: string;
  label: string;
  deadline: string;
  status: "planned" | "in-progress" | "completed";
}

export async function loadTrackData(trackId: string): Promise<ApplicationTrack> {
  try {
    // In a production build, these are fetched from /data/application_checker/
    // For local dev, we simulate the fetch from the generated intelligence files.
    const response = await fetch(`/data/application_checker/${trackId}.json`);
    if (!response.ok) throw new Error(`Could not load intelligence for track: ${trackId}`);
    const data = await response.json();

    return normalizeTrackData(trackId, data);
  } catch (e) {
    console.error(`[AXOM] Intelligence load failed for ${trackId}:`, e);
    throw e;
  }
}

function normalizeTrackData(trackId: string, data: any): ApplicationTrack {
  // Normalizes various agent-generated JSON formats into a consistent UI shape.
  const tracks: Record<string, { label: string; description: string }> = {
    med_schools: { label: "Medical School", description: "AMCAS/AACOMAS timeline and requirements." },
    residencies: { label: "Residency / Match", description: "ERAS timeline and Match milestones." },
    undergrad: { label: "Undergraduate / Pre-Med", description: "College apps and pre-req mapping." },
    health_professions: { label: "Health Professions", description: "CASPA/NursingCAS tracking." },
  };

  const track = tracks[trackId] || { label: "Unknown Track", description: "" };

  return {
    id: trackId,
    label: track.label,
    description: track.description,
    timeline: (data.timelines || []).map((t: any) => ({
      date: t.date || t.event_date,
      event: t.event || t.description,
      isCritical: t.is_critical || t.critical || false,
    })),
    benchmarks: (data.benchmarks || []).map((b: any) => ({
      metric: b.metric || b.label,
      userValue: b.user_value || "0",
      goldStandard: b.gold_standard || "N/A",
      description: b.description || "",
      status: "met", // Calculated in the UI based on values
    })),
    requirements: (data.requirements || []).map((r: any) => ({
      id: r.id || `req-${Math.random().toString(36).substr(2, 9)}`,
      label: r.label || r.requirement,
      deadline: r.deadline || "TBD",
      status: r.status || "planned",
    })),
  };
}

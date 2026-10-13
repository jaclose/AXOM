import { TEMPLATE_CATEGORY, resolveVariables, type Editorial, type EmailType } from "../model";
import { checked, type CommunicationsService } from "./service";
export interface Audience { kind: "subscribers" | "selected" | "course"; userIds?: string[]; courseId?: string }
export function validateEditorial(value: Editorial): Editorial {
  if (!value || typeof value.title !== "string" || !value.title.trim() || value.title.length > 180 || typeof value.excerpt !== "string" || value.excerpt.length > 2000 || (value.body?.length ?? 0) > 80000 || (value.subject?.length ?? 0) > 180 || (value.preview?.length ?? 0) > 250) throw new Error("Provide a title and a concise excerpt.");
  for (const link of [value.url, value.imageUrl].filter(Boolean)) { if (new URL(link!).protocol !== "https:") throw new Error("Use HTTPS links."); }
  if (value.readingMinutes !== undefined && (!Number.isInteger(value.readingMinutes) || value.readingMinutes < 1 || value.readingMinutes > 120)) throw new Error("Choose a reading time from 1 to 120 minutes.");
  for (const text of [value.title, value.excerpt, value.subject, value.preview, value.cta]) if (text) resolveVariables(text, { displayName: "", accent: "#c8a96a", theme: "dark", locale: "en", timezone: "UTC", orbUrl: "https://axom.info/icons/axom-orb-512.png" });
  return value;
}
export function validateAudience(audience: Audience): void {
  if (!audience || !["subscribers", "selected", "course"].includes(audience.kind)) throw new Error("Choose an audience.");
  if (audience.kind === "selected" && (!audience.userIds?.length || audience.userIds.length > 100 || audience.userIds.some(id => !/^[0-9a-f-]{36}$/i.test(id)))) throw new Error("Choose 1 to 100 account IDs.");
  if (audience.kind === "course" && (!audience.courseId || audience.courseId.length > 100)) throw new Error("Choose a canonical course ID.");
}
export async function recipients(service: CommunicationsService, type: EmailType, audience: Audience, cursor?: string): Promise<{ scanned: string[]; eligible: string[] }> {
  validateAudience(audience);
  let query = service.db.from("communication_preferences").select("user_id").eq("category", TEMPLATE_CATEGORY[type]).eq("enabled", true).order("user_id").limit(200);
  if (cursor) query = query.gt("user_id", cursor);
  if (audience.kind === "selected") query = query.in("user_id", audience.userIds!);
  const scanned = (checked(await query) ?? []).map(row => row.user_id as string); const eligible: string[] = [];
  for (const id of scanned) {
    if (audience.kind === "course" && !(await service.workspace(id))?.state.courses.some(c => c.id === audience.courseId)) continue;
    const user = await service.user(id); if (!user.email_confirmed_at || !user.email) continue;
    if (checked(await service.db.from("email_suppressions").select("email").eq("email", user.email.toLowerCase()).maybeSingle())) continue;
    if (checked(await service.db.from("privacy_requests").select("id").eq("user_id", id).eq("kind", "deletion").in("status", ["scheduled", "processing", "failed"]).limit(1))?.length) continue;
    eligible.push(id);
  }
  return { scanned, eligible };
}
export async function expandCampaigns(service: CommunicationsService): Promise<number> {
  const campaigns = checked(await service.db.from("email_campaigns").select("*").eq("status", "scheduled").lte("scheduled_for", new Date().toISOString()).order("created_at").limit(2));
  let count = 0;
  for (const campaign of campaigns ?? []) {
    const batch = await recipients(service, campaign.type, campaign.audience, campaign.cursor ?? undefined);
    for (const userId of batch.eligible) await service.enqueue({ userId, type: campaign.type, key: `${campaign.id}:${userId}`, campaignId: campaign.id, variables: { editorial: campaign.content } });
    checked(await service.db.from("email_campaigns").update({ cursor: batch.scanned.at(-1) ?? campaign.cursor, recipient_count: campaign.recipient_count + batch.eligible.length, status: batch.scanned.length < 200 ? "queued" : "scheduled" }).eq("id", campaign.id).eq("status", "scheduled"));
    count += batch.eligible.length;
  }
  return count;
}

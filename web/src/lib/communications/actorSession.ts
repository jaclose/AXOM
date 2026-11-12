/**
 * Identity claims for a single Supabase Auth session.
 *
 * This parser does NOT verify the JWT. Browser callers use it only to pin a
 * deliberate action to the stored session; the Edge handler must first verify
 * the bearer with Supabase Auth before comparing these claims with user.id.
 */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ActorSession {
  userId: string;
  sessionId: string;
}

export function parseActorSession(accessToken: string): ActorSession | null {
  try {
    const encoded = accessToken.split(".")[1];
    if (!encoded || encoded.length > 8192) return null;
    const claims = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
    if (typeof claims.sub !== "string" || typeof claims.session_id !== "string") return null;
    if (!uuid.test(claims.sub) || !uuid.test(claims.session_id)) return null;
    return { userId: claims.sub.toLowerCase(), sessionId: claims.session_id.toLowerCase() };
  } catch {
    return null;
  }
}

import { useEffect, useMemo, useState } from "react";
import { Check, Search, UserPlus, Users } from "lucide-react";
import {
  acceptFriend, removeFriend, requestFriend, searchCommunityProfiles,
  type CommunityConnection, type CommunityProfile, type CommunitySnapshot,
} from "../../lib/community/community";
import { GButton, GhostButton, GlassCard, PanelHeader } from "../ui/primitives";
import { CommunityPersonButton } from "./CommunityIdentity";

export function communityOtherPerson(friendship: CommunityConnection, me: string) {
  return friendship.requester_id === me ? friendship.addressee_id : friendship.requester_id;
}

export function CommunityFriendAction({ accountId, otherId, connection, disabled, onChanged }: {
  accountId: string; otherId: string; connection?: CommunityConnection; disabled?: boolean; onChanged: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  async function mutate(effect: () => Promise<void>, success: string) {
    if (busy || disabled) return;
    setBusy(true); setError("");
    try { await effect(); setRemoving(false); onChanged(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The friend request could not be confirmed."); }
    finally { setBusy(false); }
  }
  if (otherId === accountId) return null;
  const blocked = disabled || busy;
  return <div className="community-friend-action">
    {!connection ? <GButton size="sm" disabled={blocked} onClick={() => void mutate(() => requestFriend(accountId, otherId), "Friend request sent.")}><UserPlus size={14} aria-hidden="true" /> Add</GButton>
      : connection.status === "accepted" ? <GhostButton disabled={blocked} onClick={() => setRemoving(value => !value)} aria-expanded={removing}><Check size={14} aria-hidden="true" /> Friends</GhostButton>
      : connection.requester_id === accountId ? <GhostButton disabled={blocked} onClick={() => void mutate(() => removeFriend(accountId, connection.id), "Friend request cancelled.")}>Cancel request</GhostButton>
      : <div className="community-request-actions"><GButton size="sm" disabled={blocked} onClick={() => void mutate(() => acceptFriend(accountId, connection.id), "You are now friends.")}>Accept</GButton>
        <GhostButton disabled={blocked} onClick={() => void mutate(() => removeFriend(accountId, connection.id), "Friend request declined.")}>Decline</GhostButton></div>}
    {removing && connection && <div className="community-confirm"><p>Remove this friend? Friends-only sharing between you will stop.</p>
      <GButton size="sm" variant="danger" disabled={blocked} onClick={() => void mutate(() => removeFriend(accountId, connection.id), "Friend removed.")}>Remove friend</GButton>
      <GhostButton disabled={blocked} onClick={() => setRemoving(false)}>Keep friend</GhostButton></div>}
    {error && <p role="alert" className="community-error">{error}</p>}
  </div>;
}

type SearchResult = { query: string; status: "loading" | "ready" | "error"; profiles: CommunityProfile[]; message?: string };

export function CommunityPeople({ accountId, data, canConnect, refreshKey, onChanged, onOpenProfile }: {
  accountId: string; data: CommunitySnapshot; canConnect: boolean; refreshKey: number;
  onChanged: (message: string) => void; onOpenProfile: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult>();
  const [retry, setRetry] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const normalized = query.trim();
  const profiles = useMemo(() => new Map(data.profiles.map(profile => [profile.user_id, profile])), [data.profiles]);
  const related = useMemo(() => new Map(data.connections.map(item => [communityOtherPerson(item, accountId), item])), [data.connections, accountId]);
  const incoming = data.connections.filter(item => item.status === "pending" && item.addressee_id === accountId);
  const outgoing = data.connections.filter(item => item.status === "pending" && item.requester_id === accountId);

  useEffect(() => {
    if (normalized.length < 2) { setResult(undefined); return; }
    let active = true;
    setResult({ query: normalized, status: "loading", profiles: [] });
    const timer = window.setTimeout(() => {
      void searchCommunityProfiles(accountId, normalized)
        .then(found => { if (active) setResult({ query: normalized, status: "ready", profiles: found }); })
        .catch(cause => { if (active) setResult({ query: normalized, status: "error", profiles: [], message: cause instanceof Error ? cause.message : "Learner search is unavailable." }); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [accountId, normalized, retry, refreshKey]);

  const activeResult = result?.query === normalized ? result : undefined;
  const connectedMatches = data.profiles.filter(profile => related.has(profile.user_id)
    && [profile.display_name, profile.handle].some(value => value.toLowerCase().includes(normalized.toLowerCase())));
  const matches = normalized.length >= 2
    ? [...new Map([...connectedMatches, ...(activeResult?.status === "ready" ? activeResult.profiles : [])].map(profile => [profile.user_id, profile])).values()]
    : data.profiles.filter(profile => profile.user_id !== accountId && related.get(profile.user_id)?.status !== "pending"
      && (profile.discoverable || related.get(profile.user_id)?.status === "accepted"))
      .sort((a, b) => Number(related.get(b.user_id)?.status === "accepted") - Number(related.get(a.user_id)?.status === "accepted") || a.handle.localeCompare(b.handle));
  const people = normalized.length >= 2 || showAll ? matches : matches.slice(0, 8);

  return <GlassCard pad className="community-directory">
    <PanelHeader headingLevel={2} title="Your people" sub="Find a familiar face or meet a study partner." />
    <label className="community-search"><span><Search size={14} aria-hidden="true" /> Find someone</span>
      <input type="search" value={query} maxLength={80} placeholder="Name or handle" onChange={event => { setQuery(event.target.value); setShowAll(false); }} /></label>
    {normalized.length === 1 && <p className="sub">Enter one more character to search all discoverable learners.</p>}
    {normalized.length >= 2 && activeResult?.status === "loading" && <p role="status" className="sub">Searching discoverable learners…</p>}
    {normalized.length >= 2 && activeResult?.status === "error" && <div role="alert" className="community-error"><p>{activeResult.message}</p>
      <GButton size="sm" onClick={() => setRetry(value => value + 1)}>Retry search</GButton></div>}
    {!canConnect && <p className="sub">Create your community profile to add friends and send replies.</p>}
    {normalized.length < 2 && !data.connectionsError && incoming.length > 0 && <section className="community-invites" aria-label="Friend requests for you"><h3>Requests for you <span>{incoming.length}</span></h3>
      {incoming.map(connection => <div key={connection.id} className="community-person">
        <CommunityPersonButton profile={profiles.get(connection.requester_id)} onClick={() => onOpenProfile(connection.requester_id)} />
        <CommunityFriendAction accountId={accountId} otherId={connection.requester_id} connection={connection} disabled={!canConnect} onChanged={onChanged} />
      </div>)}
    </section>}
    {people.length > 0 && <div className="community-people">{people.map(profile => <div key={profile.user_id} className="community-person">
      <CommunityPersonButton profile={profile} onClick={() => onOpenProfile(profile.user_id)} />
      {canConnect && <CommunityFriendAction accountId={accountId} otherId={profile.user_id} connection={related.get(profile.user_id)} disabled={Boolean(data.connectionsError)} onChanged={onChanged} />}
    </div>)}</div>}
    {normalized.length < 2 && !people.length && <div className="community-empty small"><Users size={23} aria-hidden="true" /><h3>Your circle starts here</h3>
      <p>Discoverable learners appear here. Search for someone you know by their handle.</p></div>}
    {normalized.length >= 2 && activeResult?.status === "ready" && !people.length && <p className="sub">No discoverable learners or existing friends match this search.</p>}
    {normalized.length < 2 && matches.length > 8 && <GhostButton className="community-directory-more" onClick={() => setShowAll(value => !value)}>
      {showAll ? "Show fewer people" : `Show ${matches.length - 8} more people`}</GhostButton>}
    {normalized.length < 2 && !data.connectionsError && outgoing.length > 0 && <section className="community-invites" aria-label="Friend requests you sent"><h3>Requests you sent <span>{outgoing.length}</span></h3>
      {outgoing.map(connection => <div key={connection.id} className="community-person">
        <CommunityPersonButton profile={profiles.get(connection.addressee_id)} onClick={() => onOpenProfile(connection.addressee_id)} />
        <CommunityFriendAction accountId={accountId} otherId={connection.addressee_id} connection={connection} disabled={!canConnect} onChanged={onChanged} />
      </div>)}
    </section>}
  </GlassCard>;
}

import { useState } from "react";
import { ExternalLink, Music2, Piano, UserRound } from "lucide-react";
import { GlassCard, PanelHeader } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";

/** Spotify playlists. Tracks can't be copied into AXOM, so they play in Spotify's own embedded player. */
export interface SpotifyPlaylist {
  id: string;
  title: string;
  note: string;
  url: string;
}

export const PIANO_PLAYLIST: SpotifyPlaylist = {
  id: "0KAHoInyGB8kJ0NplpAP3h",
  title: "Exquisite chess — piano",
  note: "Your own playlist: solo piano for long, calm blocks.",
  url: "https://open.spotify.com/playlist/0KAHoInyGB8kJ0NplpAP3h",
};

export const SPOTIFY_PROFILE_URL = "https://open.spotify.com/user/mlgxgetxnoscoped";

export const JAZZ_PLAYLISTS: SpotifyPlaylist[] = [
  { id: "37i9dQZF1DX3SiCzCxMDOH", title: "Jazz for Study", note: "Spotify’s instrumental study jazz.", url: "https://open.spotify.com/playlist/37i9dQZF1DX3SiCzCxMDOH" },
  { id: "37i9dQZF1DWVqfgj8NZEp1", title: "Coffee Table Jazz", note: "Soft café jazz: brushed drums, piano trios.", url: "https://open.spotify.com/playlist/37i9dQZF1DWVqfgj8NZEp1" },
];

export function spotifyEmbedUrl(id: string): string {
  return `https://open.spotify.com/embed/playlist/${id}?utm_source=axom&theme=0`;
}

/**
 * Click-to-load: Spotify's player (and its cookies) only loads when you ask
 * for it, so opening the page never contacts Spotify.
 */
function SpotifyPlayer({ playlist }: { playlist: SpotifyPlaylist }) {
  const [loaded, setLoaded] = useState(false);
  return loaded ? (
    <iframe
      className="spotify-embed"
      title={`${playlist.title} on Spotify`}
      src={spotifyEmbedUrl(playlist.id)}
      loading="lazy"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
    />
  ) : (
    <button type="button" className="spotify-facade" onClick={() => setLoaded(true)}>
      <Music2 size={ICON_SIZE.emphasis} aria-hidden="true" />
      <b>Load the Spotify player</b>
      <small>{playlist.note} Loads spotify.com only when you press this.</small>
    </button>
  );
}

export function SpotifySection() {
  const [jazz, setJazz] = useState(JAZZ_PLAYLISTS[0]);
  return (
    <section className="soundscape-section" aria-labelledby="music-title">
      <div className="soundscape-section-head">
        <div><span className="soundscape-kicker"><Music2 size={ICON_SIZE.body} aria-hidden="true" /> Music</span><h2 id="music-title">Piano & jazz</h2></div>
        <p>Instrumental music for lighter blocks. It plays in Spotify’s player (Premium for full tracks); use your own device’s volume and keep it low while memorizing.</p>
      </div>
      <div className="music-grid">
        <GlassCard pad className="music-card piano">
          <PanelHeader
            headingLevel={3}
            title={PIANO_PLAYLIST.title}
            sub="Your playlist"
            action={<Piano size={ICON_SIZE.emphasis} aria-hidden="true" />}
          />
          <SpotifyPlayer playlist={PIANO_PLAYLIST} />
          <div className="music-links">
            <a href={PIANO_PLAYLIST.url} target="_blank" rel="noreferrer"><ExternalLink size={ICON_SIZE.microInline} aria-hidden="true" /> Open in Spotify</a>
            <a href={SPOTIFY_PROFILE_URL} target="_blank" rel="noreferrer"><UserRound size={ICON_SIZE.microInline} aria-hidden="true" /> Your Spotify profile</a>
          </div>
        </GlassCard>
        <GlassCard pad className="music-card jazz">
          <PanelHeader headingLevel={3} title="Jazz" sub={jazz.note} action={<Music2 size={ICON_SIZE.emphasis} aria-hidden="true" />} />
          <div className="soundscape-versions" role="radiogroup" aria-label="Jazz playlist">
            {JAZZ_PLAYLISTS.map((playlist) => (
              <button key={playlist.id} type="button" role="radio" aria-checked={jazz.id === playlist.id} className={jazz.id === playlist.id ? "on" : ""} onClick={() => setJazz(playlist)}>
                {playlist.title}
              </button>
            ))}
          </div>
          <SpotifyPlayer key={jazz.id} playlist={jazz} />
          <div className="music-links">
            <a href={jazz.url} target="_blank" rel="noreferrer"><ExternalLink size={ICON_SIZE.microInline} aria-hidden="true" /> Open in Spotify</a>
          </div>
        </GlassCard>
      </div>
    </section>
  );
}

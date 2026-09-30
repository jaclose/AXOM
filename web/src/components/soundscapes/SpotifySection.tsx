import { ExternalLink, Heart, Music2 } from "lucide-react";
import { SPOTIFY_CATALOG, useSpotify, type SpotifyPlaylist } from "../../lib/soundscapes/spotify";
import { useMediaLibrary } from "../../lib/soundscapes/library";

export { PIANO_PLAYLIST, JAZZ_PLAYLISTS, SPOTIFY_PROFILE_URL, spotifyEmbedUrl } from "../../lib/soundscapes/spotify";
export type { SpotifyPlaylist } from "../../lib/soundscapes/spotify";

export function SpotifySection({ playlists = SPOTIFY_CATALOG }: { playlists?: SpotifyPlaylist[] }) {
  const selected = useSpotify((state) => state.playlistId);
  const enabled = useSpotify((state) => state.enabled);
  const favorites = useMediaLibrary((state) => state.favorites);
  return <div className="music-grid media-music-grid">
    {playlists.map((playlist) => <article className="media-library-music" key={playlist.id}>
      <div className="media-library-music-heading"><Music2 size={21} aria-hidden="true" /><span>{playlist.category}</span><button type="button" aria-label={`${favorites.includes(playlist.id) ? "Unfavorite" : "Favorite"} ${playlist.title}`} aria-pressed={favorites.includes(playlist.id)} onClick={() => useMediaLibrary.getState().toggleFavorite(playlist.id)}><Heart size={17} fill={favorites.includes(playlist.id) ? "currentColor" : "none"} /></button></div>
      <h3>{playlist.title}</h3><p>{playlist.note}</p>
      <div className="media-library-music-actions"><button type="button" onClick={() => { useSpotify.getState().select(playlist.id); useMediaLibrary.getState().remember(playlist.id); }}>{enabled && selected === playlist.id ? "Show Spotify player" : "Open player"}</button><a href={playlist.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${playlist.title} in Spotify`}><ExternalLink size={17} /></a></div>
    </article>)}
  </div>;
}

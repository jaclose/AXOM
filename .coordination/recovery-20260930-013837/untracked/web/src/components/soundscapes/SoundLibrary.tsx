import { useState } from "react";
import { Search } from "lucide-react";
import { SOUNDSCAPES, SOUNDSCAPE_ORDER, FREQUENCY_ORDER, isSoundscapeId } from "../../lib/soundscapes/presets";
import { useSoundscape } from "../../lib/soundscapes/store";
import { useMediaLibrary } from "../../lib/soundscapes/library";
import { SPOTIFY_CATALOG, readSpotifyListening } from "../../lib/soundscapes/spotify";
import { useMediaSession } from "../../lib/soundscapes/mediaSession";
import { FrequencyCard, AmbientCard } from "./FrequencyCard";
import { SpotifySection } from "./SpotifySection";

const CATEGORIES = ["All", "Favorites", "Recent", "Jazz", "Lo-fi", "Ambient", "Nature", "Deep Focus", "Frequencies", "AXOM Originals"] as const;
type Category = typeof CATEGORIES[number];
const NATURE = new Set(["soft-rain", "ocean", "forest"]);
export function SoundLibrary() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("All");
  const pinned = useSoundscape((state) => state.pinned);
  const favorites = useMediaLibrary((state) => state.favorites);
  const recent = useMediaLibrary((state) => state.recent);
  const spotifyPlaying = useMediaSession((state) => state.sessions.spotify?.isPlaying);
  const listeningMinutes = Math.floor(readSpotifyListening().reduce((sum, day) => sum + day.seconds, 0) / 60);
  const matches = (id: string, title: string) => title.toLowerCase().includes(query.toLowerCase()) && (category !== "Favorites" || (isSoundscapeId(id) && pinned.includes(id)) || favorites.includes(id)) && (category !== "Recent" || recent.includes(id));
  const native = SOUNDSCAPE_ORDER.filter((id) => {
    if (!matches(id, `${SOUNDSCAPES[id].name} ${SOUNDSCAPES[id].band}`)) return false;
    const frequency = FREQUENCY_ORDER.includes(id);
    return ["All", "Favorites", "Recent", "AXOM Originals"].includes(category) || (category === "Frequencies" && frequency) || (category === "Nature" && NATURE.has(id)) || (category === "Ambient" && !frequency && !NATURE.has(id)) || (category === "Deep Focus" && ["gamma-40", "beta-20", "brown-noise"].includes(id));
  }).sort((a, b) => category === "Recent" ? recent.indexOf(a) - recent.indexOf(b) : 0);
  const playlists = SPOTIFY_CATALOG.filter((entry) => matches(entry.id, `${entry.title} ${entry.note}`) && (["All", "Favorites", "Recent"].includes(category) || entry.category === category)).sort((a, b) => category === "Recent" ? recent.indexOf(a.id) - recent.indexOf(b.id) : 0);
  return <section className="soundscape-section sound-library" aria-labelledby="sound-library-title">
    <div className="soundscape-section-head"><div><span className="soundscape-kicker">Your listening library</span><h2 id="sound-library-title">Find your sound</h2></div><label className="media-library-search"><Search size={17} aria-hidden="true" /><input type="search" placeholder="Search your library" aria-label="Search sound library" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
    <div className="media-library-filters" role="group" aria-label="Sound library category">{CATEGORIES.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    {!native.length && !playlists.length && <p className="media-library-empty">{category === "Favorites" ? "Pin a sound or favorite a playlist to keep it here." : category === "Recent" ? "The sounds you play and playlists you open will appear here." : "No sounds match this search. Try another category or phrase."}</p>}
    {!!playlists.length && <><SpotifySection playlists={playlists} /><p className="media-library-note">Spotify controls playback and availability. {listeningMinutes > 0 ? `${listeningMinutes} min observed on this device.` : "Listening time appears after Spotify reports playback."} {spotifyPlaying ? "Playing now." : ""}</p></>}
    {!!native.length && <div className="frequency-grid">{native.map((id) => FREQUENCY_ORDER.includes(id) ? <FrequencyCard key={id} id={id} /> : <AmbientCard key={id} id={id} />)}</div>}
    {category === "AXOM Originals" && <p className="media-library-note">AXOM’s generated versions run on this device. Your imported recordings remain available in the version controls.</p>}
  </section>;
}

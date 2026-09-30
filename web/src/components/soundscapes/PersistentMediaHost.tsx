import { useEffect, useRef, useState } from "react";
import { ExternalLink, Music2, X } from "lucide-react";
import { attachSpotifyController, detachSpotifyController, loadSpotifyAPI, SPOTIFY_CATALOG, useSpotify, type SpotifyController } from "../../lib/soundscapes/spotify";
import "../../styles/media-environment.css";

/** Shell-owned DOM. Route navigation only changes the library, never this player. */
export function PersistentMediaHost() {
  const enabled = useSpotify((state) => state.enabled);
  const panelOpen = useSpotify((state) => state.panelOpen);
  const playlistId = useSpotify((state) => state.playlistId);
  const status = useSpotify((state) => state.status);
  const error = useSpotify((state) => state.error);
  const [retry, setRetry] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const playlist = SPOTIFY_CATALOG.find((entry) => entry.id === playlistId)!;

  useEffect(() => {
    if (!enabled || !hostRef.current) return;
    let disposed = false;
    let ownedController: SpotifyController | undefined;
    const host = hostRef.current;
    const mount = document.createElement("div");
    host.replaceChildren(mount);
    useSpotify.setState({ status: "loading", error: undefined });
    const dispose = () => {
      disposed = true;
      clearTimeout(timeout);
      if (ownedController) detachSpotifyController(ownedController);
      host.replaceChildren();
    };
    const fail = (cause: unknown) => {
      if (disposed) return;
      dispose();
      useSpotify.setState({ status: "error", error: cause instanceof Error ? cause.message : "Spotify could not load." });
    };
    // Loading the API script does not mean its embedded player became ready.
    const timeout = window.setTimeout(() => {
      if (useSpotify.getState().status !== "ready") fail(new Error("Spotify didn’t finish connecting. Try again or open it directly."));
    }, 20_000);
    void loadSpotifyAPI().then((api) => {
      if (disposed) return;
      const loadedPlaylistId = useSpotify.getState().playlistId;
      api.createController(mount, { uri: `spotify:playlist:${loadedPlaylistId}`, width: "100%", height: 352 }, (controller) => {
        if (disposed) { controller.destroy(); return; }
        ownedController = controller;
        attachSpotifyController(controller, loadedPlaylistId);
      });
    }).catch(fail);
    return dispose;
  }, [enabled, retry]);

  useEffect(() => {
    if (!panelOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") useSpotify.setState({ panelOpen: false });
    };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); if (previous?.isConnected) previous.focus(); };
  }, [panelOpen]);

  return <aside className="persistent-spotify" aria-label="Spotify player" hidden={!panelOpen}>
    <div className="persistent-spotify-head"><span><Music2 size={16} aria-hidden="true" /> Spotify</span><button ref={closeRef} type="button" aria-label="Hide Spotify player" onClick={() => useSpotify.setState({ panelOpen: false })}><X size={18} /></button></div>
    <div ref={hostRef} className="persistent-spotify-frame" data-testid="persistent-spotify-frame" />
    {status === "loading" && <p role="status">Connecting to Spotify…</p>}
    {status === "error" && <p role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></p>}
    <div className="persistent-spotify-foot"><a href={playlist.url} target="_blank" rel="noopener noreferrer">Open in Spotify <ExternalLink size={13} /></a><button type="button" onClick={() => useSpotify.getState().disconnect()}>Disconnect</button></div>
    <small>Playback continues as you move through AXOM.</small>
  </aside>;
}

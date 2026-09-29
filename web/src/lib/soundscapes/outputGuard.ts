// I3-35: stop the soundscape when headphones come out, like music apps do.
// - AirPods: macOS sends "pause" to the Now Playing app; the media-session
//   pause handler (store.ts) already handles it.
// - Wired/other outputs: browsers fire `devicechange`, but only expose device
//   ids after a media permission. We act only when a known output id really
//   disappeared; with hidden ids we do nothing rather than guess. The packaged
//   app can add a CoreAudio route listener for full coverage.

/** True when a previously seen, specific output device is gone. */
export function outputRemoved(before: readonly string[], after: readonly string[]): boolean {
  const specific = (id: string) => id !== "" && id !== "default" && id !== "communications";
  const now = new Set(after.filter(specific));
  return before.filter(specific).some((id) => !now.has(id));
}

export function watchOutputRemoval(onRemoved: () => void): () => void {
  const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!devices?.enumerateDevices || !devices.addEventListener) return () => {};
  let snapshot: string[] = [];
  const read = async () => (await devices.enumerateDevices())
    .filter((device) => device.kind === "audiooutput")
    .map((device) => device.deviceId);
  void read().then((ids) => { snapshot = ids; }).catch(() => {});
  const onChange = () => {
    void read().then((ids) => {
      if (outputRemoved(snapshot, ids)) onRemoved();
      snapshot = ids;
    }).catch(() => {});
  };
  devices.addEventListener("devicechange", onChange);
  return () => devices.removeEventListener("devicechange", onChange);
}

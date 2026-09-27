import { useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { GlassCard, GButton, PanelHeader, Tag } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";
import { consumeInstallPrompt, getInstallPromptSnapshot, subscribeInstallPrompt } from "../../lib/pwaInstall";

export function InstallAxomCard() {
  const [installState, setInstallState] = useState(getInstallPromptSnapshot);
  const [asking, setAsking] = useState(false);

  useEffect(() => subscribeInstallPrompt(setInstallState), []);

  if (installState.installed || !installState.prompt) return null;

  async function install() {
    const promptEvent = installState.prompt;
    if (!promptEvent || asking) return;
    setAsking(true);
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
      // Browser prompts are single-use regardless of the choice. Successful
      // installs also emit appinstalled; consuming immediately prevents a
      // stale second click while that event is in flight.
      consumeInstallPrompt();
    } finally {
      setAsking(false);
    }
  }

  return (
    <GlassCard pad className="install-axom-card">
      <PanelHeader title="Use AXOM as an app" sub="Optional browser installation — this does not change where your workspace is stored."
        action={<Tag tone="cyan"><Smartphone size={ICON_SIZE.microInline} /> Browser app</Tag>} />
      <p className="sub">Open AXOM from your home screen or app launcher with the same offline-capable web experience. It is not a native mobile app.</p>
      <GButton onClick={() => void install()} disabled={asking}><Download size={ICON_SIZE.body} /> {asking ? "Opening install…" : "Install AXOM"}</GButton>
    </GlassCard>
  );
}

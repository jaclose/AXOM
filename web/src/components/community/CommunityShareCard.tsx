import { useId } from "react";
import { Globe, LockKeyhole, Users } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import type { ShareMode } from "../../lib/community/progressBoard";

const OPTIONS: Array<{ id: ShareMode; label: string; detail: string; Icon: typeof Users }> = [
  { id: "off", label: "Off", detail: "Only posts you choose", Icon: LockKeyhole },
  { id: "friends", label: "Friends", detail: "Accepted friends", Icon: Users },
  { id: "community", label: "Community", detail: "Everyone in Community", Icon: Globe },
];

/** Controlled consent fields. Only account creation and Account Settings own these choices. */
export function CommunityShareCard({ mode, discoverable, onChange, disabled = false }: {
  mode: ShareMode;
  discoverable: boolean;
  onChange: (mode: ShareMode) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="community-sharing-choice" disabled={disabled} aria-describedby={`${id}-help ${id}-privacy`}>
      <legend>Automatic progress sharing</legend>
      <p id={`${id}-help`} className="community-preferences-help">Share daily totals for leaderboards and a streak based on shared study days.</p>
      <div className="community-sharing-options">
        {OPTIONS.map(({ id: value, label, detail, Icon }) => (
          <label key={value} className={`community-sharing-option${mode === value ? " selected" : ""}`}>
            <span className="community-sharing-option-title">
              <input type="radio" name={`${id}-audience`} value={value} checked={mode === value}
                aria-labelledby={`${id}-${value}-label`} aria-describedby={`${id}-${value}-detail`} onChange={() => onChange(value)} />
              <Icon size={ICON_SIZE.emphasis} aria-hidden="true" />
              <strong id={`${id}-${value}-label`}>{label}</strong>
            </span>
            <small id={`${id}-${value}-detail`}>{detail}</small>
          </label>
        ))}
      </div>
      <p id={`${id}-privacy`} className="community-preferences-help">Only study minutes, card counts and question counts are shared. Notes, journals, sources and answers stay private. Days you post as “Only me” stay private.</p>
      {mode === "community" && !discoverable && (
        <p className="community-preferences-note">With learner search off, only accepted friends can see these totals. Turn on learner search to appear on the Community leaderboard.</p>
      )}
    </fieldset>
  );
}

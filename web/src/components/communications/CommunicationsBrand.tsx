/** The existing AXOM Orb is the mark. Never approximate it with a CSS sphere. */
export function CommunicationsBrand({ label }: { label: string }) {
  return <div className="comms-brand"><img src="/icons/axom-orb-512.png" width="42" height="42" alt="AXOM Orb" /><span>AXOM<small>{label}</small></span></div>;
}

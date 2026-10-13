import { useEffect } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { AccountSyncPanel } from "../shell/AccountSyncPanel";
import { markAppReady } from "../../lib/presentation";
import { AxomBrandLockup } from "../ui/BrandMark";
import { BROWSER_ENTRY } from "../../lib/landing/entry";
import "../../styles/landing-account.css";

/** Hydrated by the canonical bootstrap before mounting the existing account controls. */
export default function AccountEntry() {
  useEffect(() => markAppReady(), []);
  return <main className="landing-account">
    <header><a href="/" aria-label="AXOM home"><AxomBrandLockup size="md" /></a><a href={BROWSER_ENTRY}>Continue to AXOM <ArrowUpRight size={16} /></a></header>
    <section aria-labelledby="account-entry-title"><a className="landing-account-back" href="/"><ArrowLeft size={16} /> Back to home</a>
      <h1 id="account-entry-title">Your AXOM account</h1><p>Sign in to your account, or continue with your local workspace.</p>
      <AccountSyncPanel />
    </section>
  </main>;
}

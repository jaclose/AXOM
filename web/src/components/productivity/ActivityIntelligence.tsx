import { ArrowRight } from "lucide-react";
import type { ProductivityInsight } from "../../lib/productivityInsights";
import { useUi } from "../../lib/uiStore";
import { ICON_SIZE } from "../../lib/iconSize";
import { useReducedMotion } from "../../lib/motion";

export function ActivityIntelligence({ insight }: { insight: ProductivityInsight }) {
  const requestSettings = useUi((state) => state.requestSettings);
  const reduced = useReducedMotion();
  const localTarget = insight.href.startsWith("#productivity-");
  return <section className="productivity-next" aria-label="Suggested next action">
    <img src={`${import.meta.env.BASE_URL}icons/axom-orb-512.png`} alt="" />
    <div><span className="productivity-eyebrow">Your next step</span><h2>{insight.title}</h2><p>{insight.detail}</p></div>
    {insight.href === "#settings" || localTarget ? <button type="button" className="gbtn sm" onClick={() => insight.href === "#settings" ? requestSettings("data") : document.getElementById(insight.href.slice(1))?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" })}>{insight.action} <ArrowRight size={ICON_SIZE.body} /></button> : <a href={insight.href} className="gbtn sm">{insight.action} <ArrowRight size={ICON_SIZE.body} /></a>}
  </section>;
}

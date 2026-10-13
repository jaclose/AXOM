import { CommunicationsBrand } from "../components/communications/CommunicationsBrand";
import { useOpticalMotion } from "../lib/communications/useOpticalMotion";
import { useEffect, useState } from "react";
import { loadSupabase } from "../lib/account/supabase";
import "../styles/communications.css";
interface Article { title: string; excerpt: string; body: string; reading_minutes?: number }
export function EssayPage() {
  const opticalRoot = useOpticalMotion<HTMLElement>();
  const [article, setArticle] = useState<Article | null>(null); const [error, setError] = useState("");
  const id = new URLSearchParams(location.hash.split("?")[1]).get("id");
  useEffect(() => { let active = true; setArticle(null); setError(""); void (async () => { try { const client = await loadSupabase(); if (!client || !id) throw new Error("This essay is unavailable."); const result = await client.from("axom_articles").select("title,excerpt,body,reading_minutes").eq("id", id).maybeSingle(); if (result.error || !result.data) throw new Error("This essay is not published yet, or the link is unavailable."); if (active) setArticle(result.data); } catch (e) { if (active) setError(e instanceof Error ? e.message : "Could not load this essay."); } })(); return () => { active = false; }; }, [id]);
  return <article ref={opticalRoot} className="comms-page axom-essay"><div className="essay-brand comms-glass" data-optical=""><CommunicationsBrand label="Essays & Notes" /></div><p className="comms-kicker">ESSAYS & NOTES FROM JAFAR</p>{error ? <p role="alert">{error}</p> : article ? <><h1>{article.title}</h1><p className="essay-deck">{article.excerpt}</p><p className="comms-kicker">JAFAR FROM AXOM{article.reading_minutes ? ` · ${article.reading_minutes} MIN READ` : ""}</p>{article.body.split(/\n\s*\n/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</> : <p role="status">Opening essay…</p>}<a href="#communications">Manage essay emails</a></article>;
}

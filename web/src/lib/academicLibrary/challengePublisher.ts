import type { SupabaseClient } from "@supabase/supabase-js";
import { academicLibraryReader } from "./client";
import { readCatalog, readPreparedBank, safeLibraryPath, type LibraryReader } from "../privateLibrary/install";
import { assessBank } from "../question-content/assessBank";
import { readImageInfo, sha256 } from "../question-content/assets";

export interface PublishedChallengeQuestion {
  key: string; bankId: string; questionId: string; sourceChecksum: string; answerKey: string; eligible: true;
}
/** Administrative adapter: the canonical package parser and readiness gate.
 * SQL publication belongs to service_role; this adapter is never in the UI. */
export async function prepareChallengePool(read: LibraryReader, maximum = 20): Promise<PublishedChallengeQuestion[]> {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) throw new Error("Choose 1 to 100 questions.");
  const catalog = readCatalog(JSON.parse(new TextDecoder().decode(await read("catalog.json"))));
  const result = new Map<string, PublishedChallengeQuestion>();
  for (const source of catalog.sources) {
    if (!source.bankFile || source.status !== "prepared") continue;
    const bank = readPreparedBank(JSON.parse(new TextDecoder().decode(await read(source.bankFile))));
    const files: Array<{ name: string }> = [];
    for (const asset of new Map(bank.pkg.questions.flatMap(question => question.assets).map(asset => [asset.id,asset])).values()) {
      const bytes = await read(safeLibraryPath(`${source.bankFile.slice(0,source.bankFile.lastIndexOf("/"))}/assets/${asset.filename}`));
      if (!readImageInfo(bytes) || !asset.checksum || await sha256(bytes) !== asset.checksum) throw new Error("A challenge image failed verification.");
      files.push({ name:asset.filename });
    }
    const assessed = assessBank(bank.pkg,bank.issues,files);
    if (assessed.issues.some(issue => issue.severity === "error" && !issue.questionId)) continue;
    for (const question of bank.pkg.questions) {
      // Authored/exported material needs a separate provenance review before
      // competitive use. The first release admits source imports only.
      if (assessed.verdicts.get(question.id)?.readiness !== "ready" || question.correctAnswer?.labels.length !== 1
        || !question.provenance.sourceChecksum || !["pdf-import","docx-import","docx-template","manual-transcription"].includes(question.provenance.method)) continue;
      const bankId = question.bankId ?? bank.pkg.manifest.bank.id;
      const key = `${bankId}:${question.id}`;
      const value: PublishedChallengeQuestion = { key,bankId,questionId:question.id,sourceChecksum:question.provenance.sourceChecksum,answerKey:question.correctAnswer.labels[0],eligible:true };
      const duplicate = result.get(key);
      if (duplicate && JSON.stringify(duplicate)!==JSON.stringify(value)) throw new Error("Conflicting versions share a canonical challenge identity.");
      result.set(key,value);
    }
  }
  const pool = [...result.values()].sort((a,b) => a.key.localeCompare(b.key)).slice(0,maximum);
  if (!pool.length) throw new Error("This revision has no eligible reviewed source questions.");
  return pool;
}
export async function publishDailyChallenge(client: SupabaseClient, revision: string, day: string, maximum = 20): Promise<string> {
  const pool = await prepareChallengePool(await academicLibraryReader(client,revision),maximum);
  const { data,error } = await client.rpc("academic_publish_challenge",{ revision,challenge_day:day,pool });
  if (error || typeof data !== "string") throw new Error("The daily challenge was not published. Check reviewer approval and publisher permission.");
  return data;
}

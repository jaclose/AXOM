import { getPortableState } from "../../services/storageService";
import type { NoctyriumState } from "../types";
import type { SnapshotEnvelope } from "./syncTypes";
export async function snapshotWorkspace(state:NoctyriumState,input:{deviceId:string;baseRevision:number;idempotencyKey?:string;reason:SnapshotEnvelope["reason"]}):Promise<SnapshotEnvelope>{
  const payload=getPortableState(state); const bytes=new TextEncoder().encode(JSON.stringify(payload));
  const digest=await crypto.subtle.digest("SHA-256",bytes); const contentHash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,"0")).join("");
  return{schemaVersion:state.schemaVersion,contentHash,payload,deviceId:input.deviceId,baseRevision:input.baseRevision,idempotencyKey:input.idempotencyKey??crypto.randomUUID(),reason:input.reason};
}

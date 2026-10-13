import { workspaceDigest } from "./workspaceDigest";
import { getPortableState } from "../../services/storageService";
import type { NoctyriumState } from "../types";
import type { SnapshotEnvelope } from "./syncTypes";
export async function snapshotWorkspace(state:NoctyriumState,input:{accountUserId?:string;deviceId:string;baseRevision:number;idempotencyKey?:string;reason:SnapshotEnvelope["reason"]}):Promise<SnapshotEnvelope>{
  const payload=getPortableState(state); const digest=await workspaceDigest(payload);
  return{accountUserId:input.accountUserId,schemaVersion:state.schemaVersion,contentHash:digest.hash,payload,payloadBytes:digest.bytes,deviceId:input.deviceId,baseRevision:input.baseRevision,idempotencyKey:input.idempotencyKey??crypto.randomUUID(),reason:input.reason};
}

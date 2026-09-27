import { ApiError,withApi } from "../lib/api/http.js";

/** Retired: this endpoint trusted caller-supplied user IDs and is intentionally unavailable. */
export default withApi(["GET","POST"],async()=>{
  throw new ApiError(410,"Legacy cloud snapshots are retired. Local Vault data is unchanged; use Accounts & Sync V1 after configuration.");
});

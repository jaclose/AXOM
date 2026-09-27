import { ApiError,withApi } from "../lib/api/http.js";

/** Retired: username/PIN identity was not a safe ownership boundary. */
export default withApi(["GET","POST"],async()=>{
  throw new ApiError(410,"Legacy username/PIN accounts are retired. Use AXOM Accounts with provider-managed authentication.");
});

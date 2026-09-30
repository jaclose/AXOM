import { ApiError, withApi } from "../lib/api/http.js";

// Feedback now opens a local email draft; this legacy endpoint has no caller.
export default withApi(["POST"], async () => {
  throw new ApiError(410, "Server-side feedback email is retired. Use the local email draft instead.");
});

/**
 * GET /preview/disable — revokes the session cookie and returns to "/".
 *
 * Gated by the SAME strict auth check as every other route except
 * `/preview/enable` (see `server-preview/middleware/noindex.ts`) — a
 * request with no/expired/invalid cookie 401s before this handler ever
 * runs, same as the proven `preview`-branch behavior this ports (there is
 * no un-authed "disable" path; a session that's already invalid has
 * nothing to revoke).
 */
import { revokeSession } from "../../utils/preview-auth";

export default defineEventHandler((event) => {
  revokeSession(event);
  return sendRedirect(event, "/", 302);
});

import type { Env } from "./env";
import { dispatch } from "./router";
import { handlers } from "./handlers";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    // Non-API paths are served by the static-assets binding (run_worker_first only routes /api/* here;
    // this guard keeps `wrangler dev` and any misrouted request behaving the same).
    if (!pathname.startsWith("/api/") && env.ASSETS) return env.ASSETS.fetch(request);
    return dispatch(request, env, ctx, handlers);
  },
} satisfies ExportedHandler<Env>;

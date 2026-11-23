import { handleRequest } from "./handler.mjs";
import { d1Store } from "./d1-store.mjs";

export default {
  async fetch(request, env) {
    try { return await handleRequest(request, env, d1Store(env.DB)); }
    catch { return new Response(JSON.stringify({ error: "INTERNAL" }), { status: 500, headers: { "Content-Type": "application/json" } }); }
  },
  async scheduled(_event, env) { await d1Store(env.DB).cleanup(Date.now()); },
};

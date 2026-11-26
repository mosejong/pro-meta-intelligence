// Checks that the pinned Data Dragon version has a portrait for every champion in the published feed,
// and reports the newest available version. Run on a runner with internet access (GitHub Actions).
import { readFile } from "node:fs/promises";

const assets = await readFile(new URL("../app/champion-assets.ts", import.meta.url), "utf8");
const pinned = assets.match(/DATA_DRAGON_VERSION = "([^"]+)"/)?.[1];
const feed = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
const ids = new Set();
const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k === "champion_id" && typeof x === "string") ids.add(x); else walk(x); } };
walk(feed);

const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };
const versions = await get("https://ddragon.leagueoflegends.com/api/versions.json");
const latest = versions[0];
const catalog = async (v) => new Set(Object.keys((await get(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/champion.json`)).data));
const pinnedSet = await catalog(pinned);
const latestSet = latest === pinned ? pinnedSet : await catalog(latest);
const lower = (set) => new Set([...set].map((x) => x.toLowerCase()));
const missingPinned = [...ids].filter((id) => !lower(pinnedSet).has(id.toLowerCase()));
const missingLatest = [...ids].filter((id) => !lower(latestSet).has(id.toLowerCase()));
console.log(`ASSET_CHECK pinned=${pinned} latest=${latest} feed_champions=${ids.size}`);
console.log(`ASSET_CHECK missing_in_pinned=${JSON.stringify(missingPinned)}`);
console.log(`ASSET_CHECK missing_in_latest=${JSON.stringify(missingLatest)}`);
if (missingPinned.length) { console.error(`Pinned Data Dragon ${pinned} lacks portraits for ${missingPinned.join(", ")}; latest is ${latest}.`); process.exit(1); }

// 留白 · 运动板块数据抓取
// 输出 data/sports.json；每个数据源独立 try/catch，单源失败不拖垮整体。
// 零依赖，Node >= 18（GitHub Actions 内置）。
// 用法: node scripts/fetch-sports.mjs [--dry]   --dry 只打印结果不写文件

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "data/sports.json");
const UA =
  "Mozilla/5.0 (compatible; liubai-sports-bot/1.0; +https://chrisxu1997.github.io)";
const TIMEOUT = 20_000;

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_NEWS_LIMIT = 8;
const BBC_NEWS_LIMIT = 10;
const ESPORTS_WINDOW_DAYS = 2;
const ESPORTS_LIMIT = 20;

// ── 小工具 ──────────────────────────────────────────────
async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json", ...headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${res.status} ${url.slice(0, 80)}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${res.status} ${url.slice(0, 80)}`);
  return res.text();
}

/** 源隔离：失败返回 null 并记录到 errors */
async function safe(name, fn, errors) {
  try {
    return await fn();
  } catch (e) {
    errors[name] = String(e.message ?? e);
    console.error(`[warn] ${name}: ${e.message}`);
    return null;
  }
}

function espnTwoDays() {
  // 昨天到今天：覆盖北京时间早上想看的“昨晚”赛果
  // 注：该端点只接受单日期，范围格式会 400，故两天各拉一次合并
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  return [fmt(yesterday), fmt(today)];
}

/** ESPN scoreboard 两天合并去重 */
async function espnScoreboard(leaguePath) {
  const days = espnTwoDays();
  const boards = await Promise.all(
    days.map((d) => getJson(`${ESPN}/${leaguePath}/scoreboard?dates=${d}`)),
  );
  const seen = new Set();
  const events = [];
  for (const b of boards) {
    for (const ev of b?.events ?? []) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        events.push(ev);
      }
    }
  }
  return events;
}

// ── ESPN 通用（NBA 与各足球联赛同构） ────────────────────
function parseEspnEvents(payload) {
  const events = payload?.events ?? [];
  return events.map((ev) => {
    const comp = ev.competitions?.[0] ?? {};
    const teams = Object.fromEntries(
      (comp.competitors ?? []).map((c) => [
        c.homeAway,
        {
          name: c.team?.displayName ?? c.team?.abbreviation ?? "?",
          abbr: c.team?.abbreviation ?? "",
          logo: c.team?.logo ?? null,
          score: c.score ?? null,
          winner: c.winner ?? false,
        },
      ]),
    );
    const st = ev.status?.type ?? {};
    return {
      startTime: ev.date,
      state: st.state ?? "pre", // pre | in | post
      detail: st.shortDetail ?? st.description ?? "",
      home: teams.home ?? null,
      away: teams.away ?? null,
      link: ev.links?.[0]?.href ?? comp.links?.[0]?.href ?? null,
      note: comp.notes?.[0]?.headline ?? null, // 如 "Semifinal"
    };
  });
}

function parseEspnNews(payload, limit) {
  return (payload?.articles ?? []).slice(0, limit).map((a) => ({
    title: a.headline ?? "",
    desc: a.description ?? "",
    link: a.links?.web?.href ?? null,
    published: a.published ?? null,
    image: a.images?.[0]?.url ?? null,
  }));
}

// ── 板块：NBA ───────────────────────────────────────────
async function nba() {
  const [events, newsRaw] = await Promise.all([
    espnScoreboard("basketball/nba"),
    getJson(`${ESPN}/basketball/nba/news?limit=${ESPN_NEWS_LIMIT}`),
  ]);
  return {
    games: parseEspnEvents({ events }),
    news: parseEspnNews(newsRaw, ESPN_NEWS_LIMIT),
  };
}

// ── 板块：足球 ──────────────────────────────────────────
const SOCCER_LEAGUES = [
  { slug: "eng.1", name: "英超" },
  { slug: "esp.1", name: "西甲" },
  { slug: "ita.1", name: "意甲" },
  { slug: "ger.1", name: "德甲" },
  { slug: "fra.1", name: "法甲" },
  { slug: "uefa.champions", name: "欧冠" },
];

async function soccer() {
  const boards = await Promise.all(
    SOCCER_LEAGUES.map(async (l) => ({
      ...l,
      games: parseEspnEvents({ events: await espnScoreboard(`soccer/${l.slug}`) }),
    })),
  );
  const leagues = boards.filter((l) => l.games.length > 0);
  return { leagues };
}

/** BBC Sport RSS：只做轻量正则解析，避免引入依赖 */
async function bbcFootball() {
  const xml = await getText("https://feeds.bbci.co.uk/sport/football/rss.xml");
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(
    0,
    BBC_NEWS_LIMIT,
  );
  const pick = (block, tag) =>
    block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
  const cdata = (s) => s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
  return items.map((m) => ({
    title: cdata(pick(m[1], "title")),
    link: cdata(pick(m[1], "link")),
    published: cdata(pick(m[1], "pubDate")),
  }));
}

// ── 板块：电竞 ──────────────────────────────────────────
const RIOT_KEY = "0TvQnueCCgXmxkVJgGWYI1nzQ7bs6z7T"; // lolesports.com 前端公开 key

/** Riot lolesports 赛程（CI 海外网络可能可用；403 则整体降级） */
async function lolSchedule() {
  const data = await getJson(
    "https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&sportId=1",
    {
      "x-api-key": RIOT_KEY,
      origin: "https://lolesports.com",
      referer: "https://lolesports.com/schedule",
    },
  );
  const events = data?.data?.schedule?.events ?? [];
  const lo = Date.now() - ESPORTS_WINDOW_DAYS * 864e5;
  const hi = Date.now() + ESPORTS_WINDOW_DAYS * 864e5;
  return events
    .filter((e) => {
      const t = Date.parse(e.startTime);
      return t >= lo && t <= hi && e.state !== "unneeded";
    })
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
    .slice(0, ESPORTS_LIMIT)
    .map((e) => ({
      startTime: e.startTime,
      state:
        e.state === "completed"
          ? "post"
          : e.state === "inProgress"
            ? "in"
            : "pre",
      league: e.league?.name ?? "",
      home: e.match?.teams?.[0]
        ? { name: e.match.teams[0].name, score: e.match.teams[0].result?.gameWins ?? null }
        : null,
      away: e.match?.teams?.[1]
        ? { name: e.match.teams[1].name, score: e.match.teams[1].result?.gameWins ?? null }
        : null,
      link: "https://lolesports.com/schedule",
    }));
}

/** PandaScore（可选）：设置仓库 Secret PANDASCORE_TOKEN 后自动启用 */
async function pandascore() {
  const token = process.env.PANDASCORE_TOKEN;
  if (!token) return null; // 未配置 → 未启用，不算错误
  const games = [
    { slug: "lol", name: "LoL" },
    { slug: "csgo", name: "CS2" },
    { slug: "dota-2", name: "Dota2" },
  ];
  const heads = await Promise.all(
    games.map(async (g) => {
      const [up, recent] = await Promise.all([
        getJson(
          `https://api.pandascore.co/${g.slug}/matches/upcoming?sort=begin_at&per_page=10&token=${token}`,
        ),
        getJson(
          `https://api.pandascore.co/${g.slug}/matches/past?sort=-begin_at&per_page=5&token=${token}`,
        ),
      ]);
      return [...recent, ...up]
        .filter(
          (m) =>
            Math.abs(Date.parse(m.begin_at) - Date.now()) <=
            ESPORTS_WINDOW_DAYS * 864e5,
        )
        .sort((a, b) => Date.parse(a.begin_at) - Date.parse(b.begin_at))
        .map((m) => ({
          startTime: m.begin_at,
          state: m.status === "finished" ? "post" : m.status === "running" ? "in" : "pre",
          league: `${m.league?.name ?? ""} ${m.serie?.full_name ?? ""}`.trim(),
          home: { name: m.opponents?.[0]?.opponent?.name ?? m.name, score: m.results?.[0]?.score ?? null },
          away: { name: m.opponents?.[1]?.opponent?.name ?? "", score: m.results?.[1]?.score ?? null },
          link: m.official_stream_url ?? null,
        }));
    }),
  );
  return heads.flat().slice(0, 30);
}

async function esports() {
  const errors = {};
  const [lol, panda] = await Promise.all([
    safe("lolSchedule", lolSchedule, errors),
    safe("pandascore", pandascore, errors),
  ]);
  // PandaScore 优先（覆盖面广）；未配置/失败则用 Riot LoL
  const events = panda?.length ? panda : lol ?? [];
  const source = panda?.length ? "pandascore" : lol?.length ? "riot-lol" : "none";
  return { source, events, errors: Object.keys(errors).length ? errors : undefined };
}

// ── 主流程 ──────────────────────────────────────────────
const errors = {};
const [nbaData, soccerData, headlines, esportsData] = await Promise.all([
  safe("nba", nba, errors),
  safe("soccer", soccer, errors),
  safe("bbc", bbcFootball, errors),
  esports(),
]);

const out = {
  updatedAt: new Date().toISOString(),
  nba: nbaData,
  soccer: soccerData
    ? { ...soccerData, headlines: headlines ?? [] }
    : null,
  esports: esportsData,
  ...(Object.keys(errors).length ? { errors } : {}),
};

const json = JSON.stringify(out);
if (process.argv.includes("--dry")) {
  console.log(json);
} else {
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, json + "\n", "utf8");
  console.log(
    `ok -> ${OUT} (${json.length} bytes) nba=${nbaData?.games.length ?? "-"} soccer=${soccerData?.leagues.length ?? "-"} esports=${esportsData.events.length}(${esportsData.source})`,
  );
}

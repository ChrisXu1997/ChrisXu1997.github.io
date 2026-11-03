// 留白 · 运动板块数据抓取
// 主源：直播吧（中文赛程/比分/资讯，覆盖 NBA、足球、电竞）
// 备源：ESPN（NBA/足球）+ BBC（足球资讯），直播吧整体失败时降级使用
// 输出 data/sports.json；每个数据源独立 try/catch，单源失败不拖垮整体。
// 零依赖，Node >= 18（GitHub Actions 内置）。
// 用法: node scripts/fetch-sports.mjs [--dry]   --dry 只打印结果不写文件

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "data/sports.json");
const UA =
  "Mozilla/5.0 (compatible; liubai-sports-bot/1.0; +https://chrisxu1997.github.io)";
const TIMEOUT = 25_000;

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_NEWS_LIMIT = 8;
const BBC_NEWS_LIMIT = 10;
const NEWS_LIMIT = 10;
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

const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, "").trim();
const cnDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ── 主源：直播吧 ────────────────────────────────────────
// 首页服务端渲染赛程：<li label="标签..." id="saishi123" data-time="2026-11-03 15:45"
//   data-type="football|basketball|game|..." > <time>..</time> <span class="_league">联赛</span>
//   <span class="_teams"> 客队 <img/> - <img/> 主队</span> <a href="/zhibo/...">互动直播</a></li>
const ZB8_HOME = "https://www.zhibo8.com/";
const ZB8_SCORE = "https://bifen4m.qiumibao.com/json/list.htm?date=";
const ZB8_NEWS = (cat) => `https://news.zhibo8.com/${cat}/more.htm`;

const SOCCER_LEAGUE_KEYS = [
  "英超", "西甲", "意甲", "德甲", "法甲", "欧冠", "欧联", "中超", "亚冠", "世界杯",
];

function parseZb8Schedule(html) {
  const out = [];
  const re =
    /<li label="([^"]*)" id="saishi(\d+)" data-time="([^"]*)" data-rightishome="[^"]*" data-type="([^"]*)">([\s\S]*?)<\/li>/g;
  for (const m of html.matchAll(re)) {
    const [, label, id, dataTime, type, body] = m;
    const league = stripTags(body.match(/<span class="_league">([^<]*)<\/span>/)?.[1] ?? "");
    // 注意：_teams 内嵌套 <span> - </span>，非贪婪须锚定 </span></b> 才能取全
    const teamsHtml = body.match(/<span class="_teams">([\s\S]*?)<\/span><\/b>/)?.[1] ?? "";
    const parts = teamsHtml.split(/<span>\s*-\s*<\/span>/);
    if (parts.length < 2) continue; // 结构变化则跳过该条
    const link = body.match(/href="(\/zhibo\/[^"]+)"/)?.[1];
    out.push({
      id,
      tags: label.split(","),
      league,
      visit: stripTags(parts[0]),
      home: stripTags(parts[1]),
      startTime: new Date(dataTime.replace(" ", "T") + "+08:00").toISOString(),
      type,
      link: link ? "https://www.zhibo8.com" + link : null,
    });
  }
  return out;
}

/** 单场比分：球秘宝 PC 端（直播吧数据域），按比赛 id + 北京时间日期 */
async function matchScore(entry) {
  const cnYmd = cnDate(new Date(Date.parse(entry.startTime) + 8 * 3600_000));
  return getJson(`https://bifen4pc2.qiumibao.com/json/${cnYmd}/${entry.id}.htm`, {
    referer: ZB8_HOME,
  });
}

/** 有限并发执行，单场失败静默（保留赛程无比分） */
async function mapLimit(entries, limit, fn) {
  const out = new Map();
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, entries.length) },
    async () => {
      while (i < entries.length) {
        const it = entries[i++];
        try {
          out.set(it.id, await fn(it));
        } catch {
          /* 该场比赛比分缺失，不影响其他 */
        }
      }
    },
  );
  await Promise.all(workers);
  return out;
}

// 比赛分类：nba / soccer / esports，null 表示不关注
function classify(e) {
  if (e.type === "game") return "esports";
  if (e.type === "basketball" && e.tags.includes("NBA")) return "nba";
  if (
    e.type === "football" &&
    SOCCER_LEAGUE_KEYS.some((k) => e.league.includes(k) || e.tags.includes(k))
  ) {
    return "soccer";
  }
  return null;
}

/** 直播吧比分条目 → 统一比赛对象 */
function toZb8Game(entry, score) {
  const period = score?.period_cn ?? "";
  const hasScore = score && (score.home_score !== "" || score.visit_score !== "");
  // state: 1=未开 2=进行中；完场以 period_cn（"完"/"已结束"等）判定
  const state = /完|结/.test(period)
    ? "post"
    : score?.state === "2" || (hasScore && period && !/待定|延期|取消/.test(period))
      ? "in"
      : "pre";
  return {
    league: entry.league,
    startTime: entry.startTime,
    state,
    detail: period || "",
    home: {
      name: score?.home_team || entry.home,
      score: hasScore ? String(score.home_score) : null,
      winner: false,
    },
    away: {
      name: score?.visit_team || entry.visit,
      score: hasScore ? String(score.visit_score) : null,
      winner: false,
    },
    link: entry.link,
    note: null,
  };
}

/** 直播吧资讯：nba/zuqiu 用 more.htm（articleList），dianjing 用频道首页（boxnew） */
async function zb8News(cat) {
  const html = await getText(
    cat === "dianjing" ? `https://news.zhibo8.com/dianjing/` : ZB8_NEWS(cat),
  );
  let items;
  if (cat === "dianjing") {
    items = [...html.matchAll(
      /<h2 class="title"><a href="([^"]+)"[^>]*>([^<]+)<\/a><\/h2>[\s\S]*?<div class="date_start">([^<]+)<\/div>/g,
    )].map((m) => [m[1], m[2], m[3]]);
  } else {
    items = [...html.matchAll(
      /<span class="articleTitle"><a href="([^"]+)">([^<]+)<\/a><\/span><span class="source">[^<]*<\/span><span class="postTime">([^<]+)<\/span>/g,
    )].map((m) => [m[1], m[2], m[3]]);
  }
  return items
    .map(([link, title, time]) => ({
      title: title.trim(),
      link: link.startsWith("//") ? "https:" + link : link,
      published: new Date(time.replace(" ", "T") + "+08:00").toISOString(),
      source: "直播吧",
    }))
    .filter((n) =>
      cat !== "dianjing" || !/^(iPhone|苹果|iPad|Mac)/.test(n.title), // 电竞频道页混入科技新闻
    )
    .slice(0, NEWS_LIMIT);
}

// id 缓存：首页条目随比赛结束会消失，缓存保证赛后仍可按 id 回查比分（昨夜赛果）
const CACHE_FILE = resolve(ROOT, "data", "sports-cache.json");

async function zhibo8() {
  const schedule = parseZb8Schedule(await getText(ZB8_HOME));
  if (schedule.length === 0) throw new Error("schedule parsed 0 entries");

  let cache = { ids: {} };
  try {
    cache = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    if (!cache.ids) cache = { ids: {} };
  } catch {
    /* 首次运行无缓存 */
  }

  const now = Date.now();
  const PAST = 48 * 3600_000; // 过去 48h 内的比赛保留（昨夜赛果）
  const FUTURE = 72 * 3600_000; // 未来 3 天赛程
  for (const e of schedule) {
    const cat = classify(e);
    const t = Date.parse(e.startTime);
    if (!cat || t < now - PAST || t > now + FUTURE) continue;
    cache.ids[e.id] = {
      id: e.id,
      cat,
      leagueKey:
        SOCCER_LEAGUE_KEYS.find((k) => e.league.includes(k) || e.tags.includes(k)) ?? null,
      league: e.league,
      home: e.home,
      visit: e.visit,
      startTime: e.startTime,
      link: e.link,
    };
  }
  for (const [id, e] of Object.entries(cache.ids)) {
    if (Date.parse(e.startTime) < now - PAST) delete cache.ids[id];
  }

  // 昨夜 NBA 赛果回补：NBA 频道战报文章链接含比赛 id（matchXXXX），
  // 比赛结束后首页已无条目，从战报发现 id 并纳入缓存/比分回查
  {
    const newsHtml = await safe("zb8-nba-backfill", () => getText(ZB8_NEWS("nba")), {});
    if (newsHtml) {
      const seen = new Map(); // id -> 文章日期
      for (const m of newsHtml.matchAll(
        /news\.zhibo8\.com\/nba\/(\d{4}-\d{2}-\d{2})\/match(\d+)[^"']*\.htm/g,
      )) {
        if (!seen.has(m[2])) seen.set(m[2], m[1]);
      }
      for (const [id, date] of seen) {
        if (cache.ids[id]) continue;
        try {
          const s = await getJson(
            `https://bifen4pc2.qiumibao.com/json/${date}/${id}.htm`,
            { referer: ZB8_HOME },
          );
          if (s?.type !== "basketball" || s.leagueid !== "924") continue; // 924=NBA，排除混入 nba 频道的 CBA 等
          if (!/完|结/.test(s.period_cn ?? "")) continue; // 战报回补只收已完场
          const startTime = new Date(s.start.replace(" ", "T") + "+08:00").toISOString();
          if (Date.parse(startTime) < now - PAST) continue;
          cache.ids[id] = {
            id, cat: "nba", leagueKey: null, league: "NBA",
            home: s.home_team, visit: s.visit_team, startTime,
            link: "https://www.zhibo8.com" + s.url,
          };
        } catch {
          /* 该条战报无对应比分，跳过 */
        }
      }
    }
  }

  const watched = Object.values(cache.ids);
  // 已到开赛时间的逐场查比分（未开赛只列赛程）；单场失败静默跳过
  const started = watched.filter((e) => Date.parse(e.startTime) <= now + 15 * 60_000);
  const scoreMap = await mapLimit(started, 8, matchScore);

  const nbaGames = [];
  const soccerMap = new Map();
  const esportsGames = [];
  for (const e of watched) {
    const g = toZb8Game(e, scoreMap.get(e.id));
    if (e.cat === "nba") nbaGames.push(g);
    else if (e.cat === "soccer") {
      const key = e.leagueKey ?? "其他";
      if (!soccerMap.has(key)) soccerMap.set(key, []);
      soccerMap.get(key).push(g);
    } else esportsGames.push(g);
  }
  const byTime = (a, b) => new Date(a.startTime) - new Date(b.startTime);
  nbaGames.sort(byTime);
  esportsGames.sort(byTime);

  const leagues = [];
  for (const key of SOCCER_LEAGUE_KEYS) {
    const games = (soccerMap.get(key) ?? []).sort(byTime);
    if (games.length) leagues.push({ name: key, games });
  }

  const newsErrors = {};
  const [nbaNews, soccerNews, esportsNews] = await Promise.all([
    safe("zb8-news-nba", () => zb8News("nba"), newsErrors),
    safe("zb8-news-zuqiu", () => zb8News("zuqiu"), newsErrors),
    safe("zb8-news-dianjing", () => zb8News("dianjing"), newsErrors),
  ]);

  // 缓存随数据一起提交进仓库，供下一轮增量使用
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache) + "\n", "utf8");

  return {
    nba: { games: nbaGames, news: nbaNews ?? [] },
    soccer: { leagues, headlines: soccerNews ?? [] },
    esports: { source: "zhibo8", events: esportsGames.slice(0, 30), news: esportsNews ?? [] },
    newsErrors: Object.keys(newsErrors).length ? newsErrors : undefined,
  };
}

// ── 备源：ESPN（NBA 与各足球联赛同构） ────────────────────
function espnTwoDays() {
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  return [fmt(yesterday), fmt(today)];
}

async function espnScoreboard(leaguePath) {
  const boards = await Promise.all(
    espnTwoDays().map((d) => getJson(`${ESPN}/${leaguePath}/scoreboard?dates=${d}`)),
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

function parseEspnEvents(payload) {
  return (payload?.events ?? []).map((ev) => {
    const comp = ev.competitions?.[0] ?? {};
    const teams = Object.fromEntries(
      (comp.competitors ?? []).map((c) => [
        c.homeAway,
        {
          name: c.team?.displayName ?? c.team?.abbreviation ?? "?",
          abbr: c.team?.abbreviation ?? "",
          score: c.score ?? null,
          winner: c.winner ?? false,
        },
      ]),
    );
    const st = ev.status?.type ?? {};
    return {
      startTime: ev.date,
      state: st.state ?? "pre",
      detail: st.shortDetail ?? st.description ?? "",
      home: teams.home ?? null,
      away: teams.away ?? null,
      link: ev.links?.[0]?.href ?? comp.links?.[0]?.href ?? null,
      note: comp.notes?.[0]?.headline ?? null,
    };
  });
}

function parseEspnNews(payload, limit) {
  return (payload?.articles ?? []).slice(0, limit).map((a) => ({
    title: a.headline ?? "",
    desc: a.description ?? "",
    link: a.links?.web?.href ?? null,
    published: a.published ?? null,
    source: "ESPN",
  }));
}

async function espnNba() {
  const [events, newsRaw] = await Promise.all([
    espnScoreboard("basketball/nba"),
    getJson(`${ESPN}/basketball/nba/news?limit=${ESPN_NEWS_LIMIT}`),
  ]);
  return { games: parseEspnEvents({ events }), news: parseEspnNews(newsRaw, ESPN_NEWS_LIMIT) };
}

const ESPN_SOCCER = [
  { slug: "eng.1", name: "英超" },
  { slug: "esp.1", name: "西甲" },
  { slug: "ita.1", name: "意甲" },
  { slug: "ger.1", name: "德甲" },
  { slug: "fra.1", name: "法甲" },
  { slug: "uefa.champions", name: "欧冠" },
];

async function espnSoccer() {
  const boards = await Promise.all(
    ESPN_SOCCER.map(async (l) => ({
      name: l.name,
      games: parseEspnEvents({ events: await espnScoreboard(`soccer/${l.slug}`) }),
    })),
  );
  return { leagues: boards.filter((l) => l.games.length > 0), headlines: [] };
}

async function bbcFootball() {
  const xml = await getText("https://feeds.bbci.co.uk/sport/football/rss.xml");
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, BBC_NEWS_LIMIT);
  const pick = (block, tag) =>
    block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
  const cdata = (s) => s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
  return items.map((m) => ({
    title: cdata(pick(m[1], "title")),
    link: cdata(pick(m[1], "link")),
    published: cdata(pick(m[1], "pubDate")),
    source: "BBC",
  }));
}

/** PandaScore（可选备源）：设置仓库 Secret PANDASCORE_TOKEN 后自动启用，仅作电竞降级 */
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
        getJson(`https://api.pandascore.co/${g.slug}/matches/upcoming?sort=begin_at&per_page=10&token=${token}`),
        getJson(`https://api.pandascore.co/${g.slug}/matches/past?sort=-begin_at&per_page=5&token=${token}`),
      ]);
      return [...recent, ...up]
        .filter((m) => Math.abs(Date.parse(m.begin_at) - Date.now()) <= ESPORTS_WINDOW_DAYS * 864e5)
        .sort((a, b) => Date.parse(a.begin_at) - Date.parse(b.begin_at))
        .map((m) => ({
          startTime: m.begin_at,
          state: m.status === "finished" ? "post" : m.status === "running" ? "in" : "pre",
          league: `${m.league?.name ?? ""} ${m.serie?.full_name ?? ""}`.trim(),
          home: { name: m.opponents?.[0]?.opponent?.name ?? m.name ?? "", score: m.results?.[0]?.score ?? null, winner: false },
          away: { name: m.opponents?.[1]?.opponent?.name ?? "", score: m.results?.[1]?.score ?? null, winner: false },
          link: m.official_stream_url ?? null,
          note: null,
        }));
    }),
  );
  return heads.flat().slice(0, 30);
}

// ── 主流程 ──────────────────────────────────────────────
const errors = {};
const [zb8, espnNbaData, espnSoccerData, bbc] = await Promise.all([
  safe("zhibo8", zhibo8, errors),
  safe("espn-nba", espnNba, errors),
  safe("espn-soccer", espnSoccer, errors),
  safe("bbc", bbcFootball, errors),
]);

let nba, soccer, esports;
if (zb8) {
  ({ nba, soccer, esports } = zb8);
} else {
  // 直播吧整体失败 → ESPN/BBC 降级；电竞尝试 PandaScore（若配了 token）
  nba = espnNbaData;
  soccer = espnSoccerData ? { ...espnSoccerData, headlines: bbc ?? [] } : null;
  const panda = await safe("pandascore", pandascore, errors);
  esports = panda?.length
    ? { source: "pandascore", events: panda, news: [] }
    : { source: "none", events: [], news: [] };
}

const out = {
  updatedAt: new Date().toISOString(),
  source: zb8 ? "zhibo8" : "espn",
  nba,
  soccer,
  esports,
  ...(Object.keys(errors).length ? { errors } : {}),
};

const json = JSON.stringify(out);
if (process.argv.includes("--dry")) {
  console.log(json);
} else {
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, json + "\n", "utf8");
  console.log(
    `ok -> ${OUT} (${json.length} bytes) source=${out.source} nba=${nba?.games?.length ?? "-"} soccer=${soccer?.leagues?.length ?? "-"} esports=${esports.events.length} news=${nba?.news?.length ?? "-"}/${soccer?.headlines?.length ?? "-"}/${esports.news?.length ?? "-"}`,
  );
}

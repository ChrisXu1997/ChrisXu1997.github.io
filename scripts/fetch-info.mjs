// 留白 · 科技/AI/财经板块数据抓取
// 科技：IT之家 / 爱范儿 / 雷锋网 / 少数派 官方 RSS 混排
// AI：OpenAI / MIT Technology Review / 量子位 官方 RSS 混排
// 财经：东方财富行情（7 指数）+ 华尔街见闻 7×24 快讯
// 热榜：微博 / 百度 / B站热搜分平台聚合
// 输出 data/{tech,ai,finance,hot}.json；单源失败隔离。零依赖，Node >= 18。
// 用法: node scripts/fetch-info.mjs [--dry]

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_TECH = resolve(ROOT, "data/tech.json");
const OUT_AI = resolve(ROOT, "data/ai.json");
const OUT_FIN = resolve(ROOT, "data/finance.json");
const OUT_HOT = resolve(ROOT, "data/hot.json");
const UA =
  "Mozilla/5.0 (compatible; liubai-info-bot/1.0; +https://chrisxu1997.github.io)";
const TIMEOUT = 20_000;
const TECH_LIMIT = 25;
const AI_LIMIT = 30;
const HOT_LIMIT = 12;
const FIN_NEWS_LIMIT = 40;

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

async function safe(name, fn, errors) {
  try {
    return await fn();
  } catch (e) {
    errors[name] = String(e.message ?? e);
    console.error(`[warn] ${name}: ${e.message}`);
    return null;
  }
}

const stripCdata = (s) =>
  String(s ?? "").replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();

/** 通用 RSS item 解析（RSS2.0，兼容 link 元素与 link href 两种写法） */
function parseRss(xml, source, limit) {
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    return m ? stripCdata(m[1]) : "";
  };
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .slice(0, limit)
    .map((m) => {
      const block = m[1];
      let link = pick(block, "link");
      if (!link) link = block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "";
      const published = pick(block, "pubDate");
      return {
        title: pick(block, "title"),
        desc: pick(block, "description").replace(/<[^>]+>/g, "").slice(0, 120),
        link,
        published: published ? new Date(published).toISOString() : null,
        source,
      };
    })
    .filter((n) => n.title && n.link);
}

// ── 科技 ────────────────────────────────────────────────
const TECH_FEEDS = [
  { name: "IT之家", url: "https://www.ithome.com/rss/", limit: 12 }, // 更新最频繁，限流保多样
  { name: "爱范儿", url: "https://www.ifanr.com/feed", limit: 10 },
  { name: "雷锋网", url: "https://www.leiphone.com/feed", limit: 10 },
  { name: "少数派", url: "https://sspai.com/feed", limit: 10 },
  // 36氪 /feed 返回反爬挑战页，虎嗅 RSS 已停，故未收录
];

async function fetchTech(errors) {
  const feeds = await Promise.all(
    TECH_FEEDS.map((f) => safe(f.name, () => getText(f.url).then((x) => parseRss(x, f.name, f.limit)), errors)),
  );
  const seen = new Set();
  const items = feeds
    .filter(Boolean)
    .flat()
    .filter((n) => {
      const key = n.title.slice(0, 20); // 同题去重（跨源转载）
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.published ?? 0) - new Date(a.published ?? 0))
    .slice(0, TECH_LIMIT);
  return { updatedAt: new Date().toISOString(), items };
}

// ── AI：官方一手渠道 + 权威独立媒体 + 中文垂直报道 ────────
const AI_FEEDS = [
  { name: "OpenAI", url: "https://openai.com/news/rss.xml", limit: 12 },
  { name: "MIT Tech Review", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/", limit: 12 },
  { name: "量子位", url: "https://www.qbitai.com/feed", limit: 12 },
  // Anthropic 暂无可发现的官方 RSS；DeepMind 当前网络不可达，不采用二手转源
];

async function fetchAi(errors) {
  const feeds = await Promise.all(
    AI_FEEDS.map((f) => safe(f.name, () => getText(f.url).then((x) => parseRss(x, f.name, f.limit)), errors)),
  );
  const seen = new Set();
  const aiCn = /AI|人工智能|大模型|模型|机器人|智能体|自动驾驶|芯片|算力|OpenAI|DeepSeek|Agent|AIGC|生成式|具身|GPT|Claude|Gemini|Qwen|LLM/i;
  const items = feeds
    .filter(Boolean)
    .flat()
    .filter((n) => n.source !== "量子位" || aiCn.test(n.title)) // 过滤频道中的纯汽车等泛科技稿
    .filter((n) => {
      const key = n.title.slice(0, 24);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.published ?? 0) - new Date(a.published ?? 0))
    .slice(0, AI_LIMIT);
  return { updatedAt: new Date().toISOString(), items };
}

// ── 财经 ────────────────────────────────────────────────
// 东方财富 push2：f2 最新价 f3 涨跌幅% f4 涨跌额 f12 代码 f14 名称 f18 昨收（价格均 ×100）
const EM_INDEX_SECIDS =
  "1.000001,0.399001,0.399006,100.HSI,124.HSTECH,100.NDX,100.DJIA";

async function fetchIndices() {
  const j = await getJson(
    `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${EM_INDEX_SECIDS}&fields=f2,f3,f4,f12,f14,f18`,
  );
  const div = (v) => (typeof v === "number" ? v / 100 : null);
  return (j?.data?.diff ?? []).map((d) => ({
    name: d.f14,
    code: d.f12,
    price: div(d.f2),
    change: div(d.f4),
    changePct: div(d.f3),
    prevClose: div(d.f18),
  })).filter((i) => i.price != null);
}

async function fetchFinNews() {
  const j = await getJson(
    `https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=${FIN_NEWS_LIMIT + 10}`,
  );
  return (j?.data?.items ?? [])
    .filter((it) => (it.content_text ?? "").trim())
    .slice(0, FIN_NEWS_LIMIT)
    .map((it) => ({
      text: it.content_text.trim(),
      link: `https://wallstreetcn.com/lives/${it.id}`,
      published: new Date(it.display_time * 1000).toISOString(),
    }));
}

async function fetchFinance(errors) {
  const [indices, news] = await Promise.all([
    safe("eastmoney", fetchIndices, errors),
    safe("wallstcn", fetchFinNews, errors),
  ]);
  if (!indices && !news) throw new Error("all finance sources failed");
  return {
    updatedAt: new Date().toISOString(),
    indices: indices ?? [],
    news: news ?? [],
  };
}

// ── 热榜：微博 / 百度 / B站 ─────────────────────────────
async function weiboHot() {
  const j = await getJson("https://weibo.com/ajax/side/hotSearch", { referer: "https://weibo.com/hot/search" });
  return (j?.data?.realtime ?? []).filter((n) => n.note).slice(0, HOT_LIMIT).map((n, i) => ({
    title: n.note,
    link: `https://s.weibo.com/weibo?q=${encodeURIComponent(n.word_scheme || `#${n.note}#`)}`,
    heat: n.num ?? null,
    rank: n.realpos ?? i + 1,
  }));
}

async function baiduHot() {
  const j = await getJson("https://top.baidu.com/api/board?platform=wise&tab=realtime", { referer: "https://top.baidu.com/board?tab=realtime" });
  const found = [];
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    if (x.word && x.url) found.push(x);
    Object.values(x).forEach(walk);
  };
  walk(j?.data);
  return found.slice(0, HOT_LIMIT).map((n, i) => ({ title: n.word, link: n.url, heat: n.hotScore ?? null, rank: i + 1 }));
}

async function bilibiliHot() {
  const j = await getJson("https://api.bilibili.com/x/web-interface/search/square?limit=20", { referer: "https://www.bilibili.com/" });
  return (j?.data?.trending?.list ?? []).slice(0, HOT_LIMIT).map((n, i) => ({
    title: n.show_name || n.keyword,
    link: `https://search.bilibili.com/all?keyword=${encodeURIComponent(n.show_name || n.keyword)}`,
    heat: n.heat_score ?? null,
    rank: i + 1,
  }));
}

async function fetchHot(errors) {
  const defs = [
    { source: "微博", fn: weiboHot },
    { source: "百度", fn: baiduHot },
    { source: "B站", fn: bilibiliHot },
  ];
  const groups = await Promise.all(defs.map(async (d) => {
    const items = await safe(d.source, d.fn, errors);
    return items ? { source: d.source, items } : null;
  }));
  const valid = groups.filter((g) => g?.items.length);
  if (!valid.length) throw new Error("all hot sources failed");
  return { updatedAt: new Date().toISOString(), groups: valid };
}

// ── 主流程 ──────────────────────────────────────────────
const techErrors = {};
const aiErrors = {};
const finErrors = {};
const hotErrors = {};
const tech = await safe("tech", () => fetchTech(techErrors), techErrors);
const ai = await safe("ai", () => fetchAi(aiErrors), aiErrors);
const finance = await safe("finance", () => fetchFinance(finErrors), finErrors);
const hot = await safe("hot", () => fetchHot(hotErrors), hotErrors);

if (process.argv.includes("--dry")) {
  console.log(JSON.stringify({ tech, ai, finance, hot }, null, 1));
} else {
  if (tech) {
    await mkdir(dirname(OUT_TECH), { recursive: true });
    await writeFile(
      OUT_TECH,
      JSON.stringify({ ...tech, ...(Object.keys(techErrors).length ? { errors: techErrors } : {}) }) + "\n",
      "utf8",
    );
  }
  if (ai) {
    await mkdir(dirname(OUT_AI), { recursive: true });
    await writeFile(
      OUT_AI,
      JSON.stringify({ ...ai, ...(Object.keys(aiErrors).length ? { errors: aiErrors } : {}) }) + "\n",
      "utf8",
    );
  }
  if (finance) {
    await mkdir(dirname(OUT_FIN), { recursive: true });
    await writeFile(
      OUT_FIN,
      JSON.stringify({ ...finance, ...(Object.keys(finErrors).length ? { errors: finErrors } : {}) }) + "\n",
      "utf8",
    );
  }
  if (hot) {
    await mkdir(dirname(OUT_HOT), { recursive: true });
    await writeFile(
      OUT_HOT,
      JSON.stringify({ ...hot, ...(Object.keys(hotErrors).length ? { errors: hotErrors } : {}) }) + "\n",
      "utf8",
    );
  }
  console.log(
    `ok tech=${tech ? tech.items.length : "FAIL"}(${Object.keys(techErrors).join(",") || "无错"}) ai=${ai ? ai.items.length : "FAIL"}(${Object.keys(aiErrors).join(",") || "无错"}) finance=${finance ? finance.indices.length + "指/" + finance.news.length + "条" : "FAIL"}(${Object.keys(finErrors).join(",") || "无错"}) hot=${hot ? hot.groups.map(g=>g.source+g.items.length).join("/") : "FAIL"}(${Object.keys(hotErrors).join(",") || "无错"})`,
  );
}

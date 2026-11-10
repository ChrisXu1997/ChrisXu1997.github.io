// 构建站内公版书库：古籍（chinese-poetry）+ 现代文学（鲁迅，Ac-heron/luxun）
// 用法: node scripts/build-library.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "data/library-catalog.json");

// ── 工具 ──────────────────────────────────────────────
async function httpText(url, headers = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "liubai-library-bot/1.0", ...headers },
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${url.slice(0, 80)}`);
      return await res.text();
    } catch (e) {
      lastError = e;
      if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw lastError;
}

async function httpJson(url, headers = {}) {
  const text = await httpText(url, { accept: "application/json", ...headers });
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

// ── 古籍：chinese-poetry/chinese-poetry ────────────────
const CP_BASE = "https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master";
const CLASSICS = [
  { id: "lunyu", title: "论语", author: "孔子及其弟子", era: "春秋", description: "学而时习，立身行事的一部对话录。", path: "论语/lunyu.json" },
  { id: "shijing", title: "诗经", author: "先秦诗歌合集", era: "先秦", description: "关关雎鸠，在河之洲。中国最早的诗歌总集。", path: "诗经/shijing.json" },
  { id: "daxue", title: "大学", author: "曾子", era: "战国", description: "大学之道，在明明德，在亲民，在止于至善。", path: "四书五经/daxue.json" },
  { id: "zhongyong", title: "中庸", author: "子思", era: "战国", description: "不偏不倚，无过不及，体察中和之道。", path: "四书五经/zhongyong.json" },
  { id: "mengzi", title: "孟子", author: "孟子及其弟子", era: "战国", description: "民为贵，社稷次之，君为轻。", path: "四书五经/mengzi.json" },
  { id: "tang300", title: "唐诗三百首", author: "唐代诗人合集", era: "唐", description: "从春江花月夜到登鹳雀楼，一书看尽唐诗风华。", path: "蒙学/tangshisanbaishou.json" },
  { id: "guwen", title: "古文观止", author: "吴楚材、吴调侯编选", era: "清", description: "历代散文名篇，古文入门与精读之选。", path: "蒙学/guwenguanzhi.json" },
  { id: "qianziwen", title: "千字文", author: "周兴嗣", era: "南朝梁", description: "天地玄黄，宇宙洪荒。千字不重复的启蒙韵文。", path: "蒙学/qianziwen.json" },
  { id: "sanzijing", title: "三字经", author: "王应麟（相传）", era: "宋", description: "人之初，性本善。三字一句的传统启蒙读本。", path: "蒙学/sanzijing-traditional.json" },
  { id: "zhuzi", title: "朱子家训", author: "朱柏庐", era: "清", description: "黎明即起，洒扫庭除，治家格言的简明篇章。", path: "蒙学/zhuzijiaxun.json" },
  { id: "zengguang", title: "增广贤文", author: "民间格言合集", era: "明清", description: "汇集民间格言与处世智慧的韵文集。", path: "蒙学/zengguangxianwen.json" },
];

function normalizeClassic(data, def) {
  const chapters = [];
  function visit(node, context = {}) {
    if (Array.isArray(node)) return node.forEach((item) => visit(item, context));
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.paragraphs)) {
      const paragraphs = node.paragraphs.map(String).map((s) => s.trim()).filter(Boolean);
      if (!paragraphs.length) return;
      chapters.push({
        title: String(node.chapter || node.title || context.title || `第${chapters.length + 1}篇`),
        subtitle: String(node.subchapter || context.subtitle || ""),
        author: String(node.author || def.author),
        paragraphs,
      });
      return;
    }
    if (Array.isArray(node.content)) {
      if (node.content.every((line) => typeof line === "string")) {
        const paragraphs = node.content.map((s) => s.trim()).filter(Boolean);
        if (!paragraphs.length) return;
        chapters.push({
          title: String(node.title || node.chapter || context.title || `第${chapters.length + 1}篇`),
          subtitle: String([node.chapter, node.section].filter((v) => typeof v === "string" && v && v !== node.title).join(" · ") || context.subtitle || ""),
          author: String(node.author || def.author),
          paragraphs,
        });
      } else {
        const next = { title: node.title || context.title, subtitle: node.type || node.section || context.subtitle };
        node.content.forEach((item) => visit(item, next));
      }
    }
  }
  visit(data);
  return chapters;
}

// ── 现代文学：鲁迅（Ac-heron/luxun，作者1936年逝世，公版） ──
const LX_RAW = "https://raw.githubusercontent.com/Ac-heron/luxun/master";
const LX_API = "https://api.github.com/repos/Ac-heron/luxun/contents";
const LUXUN = [
  { id: "nahan", title: "呐喊", author: "鲁迅", era: "现代", description: "狂人日记、阿Q正传、故乡——中国现代小说的开山之作。", dir: "呐喊" },
  { id: "panghuang", title: "彷徨", author: "鲁迅", era: "现代", description: "祝福、伤逝——五四退潮期知识分子的迷茫与挣扎。", dir: "彷徨" },
  { id: "gushixinbian", title: "故事新编", author: "鲁迅", era: "现代", description: "以现代笔法重述古代神话与传说的奇想之作。", dir: "故事新编" },
  { id: "zhaohuaxishi", title: "朝花夕拾", author: "鲁迅", era: "现代", description: "从百草园到三味书屋——温情与批判交织的回忆散文。", dir: "朝花夕拾" },
  { id: "yecao", title: "野草", author: "鲁迅", era: "现代", description: "鲁迅最私人化的散文诗集，晦涩而炽热。", dir: "野草" },
];

async function luxunChapters(def) {
  const listing = await httpJson(`${LX_API}/${encodeURIComponent(`全集/${def.dir}`)}`, {
    accept: "application/vnd.github+json",
  });
  const files = listing.filter((f) => f.name.endsWith(".md") && !/目录|自序/.test(f.name));
  const chapters = await Promise.all(files.map(async (f) => {
    const url = `${LX_RAW}/${[...`全集/${def.dir}/${f.name}`].map(encodeURIComponent).join("")}`;
    const raw = await httpText(url);
    const lines = raw.replace(/```/g, "").split(/\r?\n/);
    const paragraphs = [];
    let current = null;
    for (const line of lines) {
      const text = line.trim();
      if (!text) {
        if (current) paragraphs.push(current); // 空行即段落边界
        current = null;
        continue;
      }
      // 段落以全角空格缩进开头；同段内的折行拼接为一句
      if (/^[　\s]/.test(line) || current === null) {
        if (current) paragraphs.push(current);
        current = text;
      } else if (current) current += text;
    }
    if (current) paragraphs.push(current);
    return { title: f.name.replace(/\.md$/, ""), subtitle: "", author: "鲁迅", paragraphs };
  }));
  }));
  return chapters.filter((c) => c.paragraphs.length);
}

// ── 汇总 ──────────────────────────────────────────────
const classicBooks = await Promise.all(CLASSICS.map(async (def) => {
  const data = await httpJson(`${CP_BASE}/${def.path.split("/").map(encodeURIComponent).join("/")}`);
  const chapters = normalizeClassic(data, def);
  if (!chapters.length) throw new Error(`${def.title}: no chapters parsed`);
  const { path, ...meta } = def;
  return { ...meta, chapters };
}));

const luxunBooks = await Promise.all(LUXUN.map(async (def) => {
  try {
    const chapters = await luxunChapters(def);
    if (!chapters.length) throw new Error("no chapters");
    return { ...def, chapters };
  } catch (e) {
    console.error(`[warn] luxun/${def.title}: ${e.message}`);
    return null;
  }
}));

const books = [...classicBooks, ...luxunBooks.filter(Boolean)];

const out = {
  updatedAt: new Date().toISOString(),
  source: {
    name: "chinese-poetry + Ac-heron/luxun",
    url: "https://github.com/chinese-poetry/chinese-poetry",
    note: "公版古籍与现代文学文本，仅作个人阅读与检索",
  },
  books,
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out) + "\n", "utf8");
console.log(books.map((b) => `${b.title}:${b.chapters.length}章`).join(" | "));
console.log(`ok -> ${OUT} (${(JSON.stringify(out).length / 1024 / 1024).toFixed(2)} MB)`);

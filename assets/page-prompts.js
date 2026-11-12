const page = AIShell.mount("prompts");
document.querySelector("#top-actions").innerHTML = `<button id="add-prompt">新建提示词</button>`;
const BUILTINS = [
  { id: "p1", category: "写作", title: "去 AI 味编辑", text: "请编辑以下文字：去掉空泛的总结、过度工整的排比和没有信息量的形容词。保留事实与个人语气，让表达像真人写的。不要解释修改过程，直接给修改稿。\n\n" },
  { id: "p2", category: "写作", title: "三种风格改写", text: "请把以下内容分别改写成：1）理性专业版；2）自然口语版；3）克制文学版。三种版本都不得改变事实。\n\n" },
  { id: "p3", category: "学习", title: "费曼讲解", text: "请用费曼技巧讲解以下概念：先给一个生活化比喻，再用准确语言解释，最后出一道检验理解的小题（不要立即给答案）。\n\n" },
  { id: "p4", category: "学习", title: "主动回忆导师", text: "基于以下材料向我提问，不要先讲答案。每次只问一个问题，等我回答后再指出薄弱点并继续追问。材料：\n\n" },
  { id: "p5", category: "编程", title: "生产级代码审查", text: "请审查以下代码，按严重程度列出问题：正确性、数据一致性、安全性、边界条件、性能与可维护性。每项给出证据和最小修改方案，避免泛泛而谈。\n\n" },
  { id: "p6", category: "编程", title: "最小复现助手", text: "针对以下 bug，先列出最可能的 3 个原因和验证顺序，再帮我构造一个最小复现用例。不要在原因未验证前直接重写全部代码。\n\n" },
  { id: "p7", category: "编程", title: "测试用例设计", text: "为以下函数设计测试：正常路径、空输入、边界值、异常输入、并发/时序（若适用）。使用项目惯用测试框架，并解释每组用例在防什么回归。\n\n" },
  { id: "p8", category: "效率", title: "会议记录整理", text: "把以下会议记录整理成：决议、待办（负责人/截止时间）、未决问题、关键分歧。没有明确给出的信息不要补写。\n\n" },
  { id: "p9", category: "效率", title: "邮件短而得体", text: "把以下要点写成一封简短邮件：先说结论，再给必要背景，最后明确下一步。语气自然、克制，不堆客套话。\n\n" },
  { id: "p10", category: "效率", title: "决策对照表", text: "针对以下选择，列出 3 个候选方案，按成本、收益、风险、可逆性、长期影响做对照表，最后给出明确推荐及适用条件。\n\n" },
  { id: "p11", category: "生活", title: "低负担计划", text: "把以下目标安排成一个不过载的计划：每天最多两件要事，保留缓冲和空白，标出最小可执行版本与放弃条件。\n\n" },
  { id: "p12", category: "生活", title: "书单策划", text: "围绕以下主题设计一份由浅入深的书单：每本说明适合谁、解决什么、阅读顺序；同时给公开免费的合法获取渠道。\n\n" },
];
let custom = AI.read(AI.PROMPTS_KEY, []);
let query = "";

page.innerHTML = `
  <div class="form-row">
    <input class="input" id="prompt-search" placeholder="搜索标题、分类或提示词内容">
    <div class="muted" style="align-self:center">${BUILTINS.length} 个内置模板 · 支持自定义</div>
  </div>
  <div class="prompt-grid" id="prompt-grid" style="margin-top:22px"></div>`;

function allPrompts() { return [...BUILTINS, ...custom]; }
function render() {
  const q = query.toLowerCase();
  const list = allPrompts().filter((p) => !q || `${p.title}${p.category}${p.text}`.toLowerCase().includes(q));
  document.querySelector("#prompt-grid").innerHTML = list.length ? list.map((p) => `
    <article class="card prompt-card">
      <span class="tag">${AI.esc(p.category)}</span>
      <h3>${AI.esc(p.title)}</h3>
      <p>${AI.esc(p.text.slice(0, 180))}${p.text.length > 180 ? "…" : ""}</p>
      <div class="prompt-actions">
        <button class="text-btn" data-use="${p.id}">用于对话 →</button>
        <button class="text-btn" data-copy="${p.id}">复制</button>
        ${p.custom ? `<button class="text-btn" data-delete="${p.id}">删除</button>` : ""}
      </div>
    </article>`).join("") : `<div class="muted">没有匹配的提示词。</div>`;
}
document.querySelector("#prompt-search").addEventListener("input", (event) => { query = event.target.value; render(); });
document.querySelector("#prompt-grid").addEventListener("click", (event) => {
  const use = event.target.closest("[data-use]");
  if (use) { sessionStorage.setItem("ai-draft", allPrompts().find((p) => p.id === use.dataset.use).text); location.href = "index.html"; return; }
  const copy = event.target.closest("[data-copy]");
  if (copy) { AI.copy(allPrompts().find((p) => p.id === copy.dataset.copy).text); return; }
  const del = event.target.closest("[data-delete]");
  if (del) { custom = custom.filter((p) => p.id !== del.dataset.delete); AI.write(AI.PROMPTS_KEY, custom); render(); }
});
document.querySelector("#add-prompt").addEventListener("click", () => {
  const title = prompt("提示词名称：");
  if (!title) return;
  const category = prompt("分类（写作 / 学习 / 编程 / 效率 / 生活）：", "自定义") || "自定义";
  const text = prompt("提示词内容：");
  if (!text) return;
  custom.unshift({ id: AI.uid(), title: title.slice(0, 40), category: category.slice(0, 12), text, custom: true });
  AI.write(AI.PROMPTS_KEY, custom); render(); AI.toast("已保存");
});
render();

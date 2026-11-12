const page = AIShell.mount("tools");
document.querySelector("#top-actions").innerHTML = `<a href="index.html">打开对话</a>`;
const PRESETS = [
  { id: "summary", title: "长文摘要", desc: "提炼重点、结论与行动项", prompt: "请把以下内容整理成「一句话结论 / 关键要点 / 可执行行动项」三部分。不要遗漏重要数字与限制条件，避免空泛套话。\n\n" },
  { id: "translate", title: "自然翻译", desc: "中英互译，保留语气与格式", prompt: "请判断以下文字的语言：中文则译成自然英文，英文则译成自然中文。保留原有语气、专有名词与 Markdown 结构，不额外解释。\n\n" },
  { id: "polish", title: "文字润色", desc: "更简洁、准确、有节奏", prompt: "请润色以下文字：保留事实与语气，删去冗余，让句子简洁、有节奏。先给润色稿，再用三点说明主要改动。\n\n" },
  { id: "explain", title: "代码解释", desc: "逐行讲解并给出改进建议", prompt: "请以中文解释以下代码：先说明整体用途，再逐行/逐块解释，最后给出最重要的 1-3 个改进建议。不要只复述代码。\n\n" },
  { id: "brainstorm", title: "头脑风暴", desc: "快速获得不同角度的想法", prompt: "围绕以下主题给出 10 个有区分度的想法，按「最稳妥 / 最有潜力 / 最反常」分组，并选出一个最值得先做的，说明原因。\n\n" },
  { id: "plan", title: "行动计划", desc: "把目标拆成可执行步骤", prompt: "把以下目标拆成可执行计划：列出阶段、每周任务、验收标准与最大风险。目标要具体，避免正确但无用的建议。\n\n" },
  { id: "table", title: "结构化提取", desc: "把杂乱信息整理成表格", prompt: "请从以下内容提取关键字段，整理为 Markdown 表格；无法确认的字段标为「未知」，不要编造。最后补充一句最重要的异常点。\n\n" },
  { id: "question", title: "苏格拉底追问", desc: "用问题帮你想得更深入", prompt: "不要直接给答案。围绕以下问题连续提出 6 个由浅入深、能暴露假设的追问，帮助我形成自己的判断。\n\n" },
  { id: "review", title: "严谨评审", desc: "找漏洞，而不只是给建议", prompt: "请评审以下内容，优先找出事实错误、逻辑漏洞、边界条件与被忽略的风险。按严重程度排序，并给出可验证的修正方式。\n\n" },
];
let selected = PRESETS[0];
let output = "";
let controller = null;
let running = false;

page.innerHTML = `
  <div class="tool-grid" id="preset-grid">${PRESETS.map((p) => `<button class="tool-card ${p.id === selected.id ? "on" : ""}" data-preset="${p.id}"><strong>${p.title}</strong><span>${p.desc}</span></button>`).join("")}</div>
  <div class="tool-work">
    <section>
      <label class="label" for="tool-input">输入内容</label>
      <textarea id="tool-input" rows="13" placeholder="粘贴文字、代码或要处理的内容…"></textarea>
      <div class="composer-bottom" style="margin-top:12px">
        <label class="text-btn" for="tool-file">导入文本文件</label>
        <input id="tool-file" type="file" accept=".txt,.md,.json,.js,.ts,.html,.css" hidden>
        <div style="display:flex;gap:12px">
          <button class="btn" id="tool-stop" hidden>停止</button>
          <button class="btn primary" id="tool-run">生成结果</button>
        </div>
      </div>
    </section>
    <section>
      <div class="label">输出</div>
      <div class="card tool-output" id="tool-output"><span class="muted">选择上方任务，输入内容后生成。</span></div>
      <div class="composer-bottom" style="margin-top:12px">
        <div style="display:flex;gap:16px">
          <button class="text-btn" id="output-copy">复制</button>
          <button class="text-btn" id="output-download">下载 Markdown</button>
        </div>
        <button class="text-btn" id="to-chat">在对话中继续 →</button>
      </div>
    </section>
  </div>`;

const input = document.querySelector("#tool-input");
const outputEl = document.querySelector("#tool-output");

document.querySelector("#preset-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (!button) return;
  selected = PRESETS.find((p) => p.id === button.dataset.preset);
  document.querySelectorAll(".tool-card").forEach((card) => card.classList.toggle("on", card === button));
  input.focus();
});

document.querySelector("#tool-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return AI.toast("文件请小于 2MB");
  input.value = await file.text();
  AI.toast(`已读取 ${file.name}`);
});

function setRunning(value) {
  running = value;
  document.querySelector("#tool-run").hidden = value;
  document.querySelector("#tool-stop").hidden = !value;
}

document.querySelector("#tool-run").addEventListener("click", async () => {
  const text = input.value.trim();
  if (!text) return AI.toast("请先输入内容");
  if (running) return;
  output = "";
  outputEl.innerHTML = '<span class="stream-caret"></span>';
  setRunning(true);
  controller = new AbortController();
  const userPrompt = selected.prompt + text;
  try {
    output = await AI.requestChat([{ role: "user", content: userPrompt }], {
      signal: controller.signal,
      onDelta: (_, full) => {
        output = full;
        outputEl.innerHTML = AI.markdown(full) + '<span class="stream-caret"></span>';
        outputEl.scrollTop = outputEl.scrollHeight;
      },
    });
    outputEl.innerHTML = AI.markdown(output);
  } catch (error) {
    if (error.name === "AbortError") outputEl.innerHTML = `<span class="muted">已停止生成。</span>`;
    else outputEl.innerHTML = `<span class="connection-result error">${AI.esc(AI.friendlyError(error))}</span>`;
  } finally {
    setRunning(false);
    outputEl.scrollTop = 0;
  }
});
document.querySelector("#tool-stop").addEventListener("click", () => controller?.abort());
document.querySelector("#output-copy").addEventListener("click", () => output ? AI.copy(output) : AI.toast("还没有可复制的输出"));
document.querySelector("#output-download").addEventListener("click", () => output ? AI.download(`留白-${selected.title}.md`, output, "text/markdown;charset=utf-8") : AI.toast("还没有可下载的输出"));
document.querySelector("#to-chat").addEventListener("click", () => {
  const text = input.value.trim();
  if (!text || !output) return AI.toast("请先生成结果");
  sessionStorage.setItem("ai-handoff", JSON.stringify([
    { role: "user", content: text },
    { role: "assistant", content: output },
  ]));
  location.href = "index.html";
});

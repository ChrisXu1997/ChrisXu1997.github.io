const page = AIShell.mount("settings");
const config = AI.settings();
page.innerHTML = `
  <div class="settings-grid">
    <section class="card settings-card">
      <h2>模型服务</h2>
      <label class="label" for="provider">服务商</label>
      <select class="select" id="provider">${Object.entries(AI.PROVIDERS).map(([id, p]) => `<option value="${id}" ${config.provider === id ? "selected" : ""}>${p.label}${p.needsKey ? "（需 API Key）" : "（免 Key）"}</option>`).join("")}</select>
      <label class="label" for="base-url">接口地址</label>
      <input class="input" id="base-url" value="${AI.esc(config.baseUrl)}" spellcheck="false">
      <label class="label" for="model">模型名</label>
      <input class="input" id="model" value="${AI.esc(config.model)}" spellcheck="false">
      <label class="label" for="api-key">API Key</label>
      <input class="input" id="api-key" type="password" value="${AI.esc(config.key)}" placeholder="公共体验模型无需填写" autocomplete="off" spellcheck="false">
      <div class="privacy-note">密钥只保存在当前浏览器的 localStorage 中，不会写入 GitHub 或上传到留白服务器。请求会直接发往你选择的服务商。</div>
      <div style="display:flex;gap:12px;margin-top:20px">
        <button class="btn primary" id="save-settings">保存设置</button>
        <button class="btn" id="test-connection">测试连接</button>
      </div>
      <div class="connection-result" id="connection-result" role="status"></div>
    </section>
    <div>
      <section class="card settings-card">
        <h2>生成偏好</h2>
        <label class="label" for="temperature">创造性 · <span id="temperature-value">${config.temperature}</span></label>
        <input id="temperature" type="range" min="0" max="1.5" step="0.1" value="${config.temperature}" style="width:100%;accent-color:var(--accent-dark)">
        <label class="label" for="system-prompt">系统提示词</label>
        <textarea id="system-prompt" rows="7">${AI.esc(config.system)}</textarea>
        <p class="tiny" style="margin-top:10px">系统提示词会随每次请求发送，用于约束 AI 的回答风格。</p>
      </section>
      <section class="card settings-card" style="margin-top:22px">
        <h2>数据管理</h2>
        <p class="muted">导出待办、便签、书架、阅读进度与 AI 会话。备份文件不包含 API Key。</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px">
          <button class="btn" id="export-data">导出全站数据</button>
          <label class="btn" for="import-data">导入数据</label>
          <input id="import-data" type="file" accept=".json" hidden>
          <button class="btn" id="clear-chats">清空 AI 会话</button>
        </div>
      </section>
    </div>
  </div>`;

function collect() {
  return {
    provider: document.querySelector("#provider").value,
    baseUrl: document.querySelector("#base-url").value.trim(),
    model: document.querySelector("#model").value.trim(),
    key: document.querySelector("#api-key").value.trim(),
    temperature: Number(document.querySelector("#temperature").value),
    system: document.querySelector("#system-prompt").value.trim(),
  };
}
document.querySelector("#provider").addEventListener("change", (event) => {
  const p = AI.PROVIDERS[event.target.value];
  document.querySelector("#base-url").value = p.baseUrl;
  document.querySelector("#model").value = p.model;
  document.querySelector("#api-key").value = "";
  document.querySelector("#api-key").disabled = !p.needsKey;
});
document.querySelector("#temperature").addEventListener("input", (event) => { document.querySelector("#temperature-value").textContent = event.target.value; });
document.querySelector("#save-settings").addEventListener("click", () => { AI.saveSettings(collect()); AI.toast("设置已保存"); location.reload(); });
document.querySelector("#test-connection").addEventListener("click", async () => {
  const result = document.querySelector("#connection-result");
  AI.saveSettings(collect());
  result.className = "connection-result"; result.textContent = "正在连接模型…";
  try {
    const text = await AI.requestChat([{ role: "user", content: "只回复：连接成功" }], { stream: false, maxTokens: 20 });
    result.className = "connection-result ok";
    result.textContent = `连接成功 · 模型回复：${text || "（空回复）"}`;
  } catch (error) {
    result.className = "connection-result error";
    result.textContent = AI.friendlyError(error);
  }
});
document.querySelector("#export-data").addEventListener("click", () => {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith("liubai-")) continue;
    let value = localStorage.getItem(key);
    if (key === "liubai-ai-settings") {
      const parsed = JSON.parse(value); delete parsed.key; value = JSON.stringify(parsed);
    }
    data[key] = value;
  }
  AI.download(`留白数据-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
});
document.querySelector("#import-data").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("备份格式不正确");
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith("liubai-") || typeof value !== "string") continue;
      localStorage.setItem(key, value);
    }
    AI.toast("导入成功"); setTimeout(() => location.reload(), 500);
  } catch (error) { AI.toast(error.message || "导入失败"); }
});
document.querySelector("#clear-chats").addEventListener("click", () => {
  if (!confirm("删除全部 AI 会话？其他数据不受影响。")) return;
  localStorage.removeItem("liubai-ai-chats");
  localStorage.removeItem("liubai-ai-current-chat");
  AI.toast("AI 会话已清空");
});

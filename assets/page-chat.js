const page = AIShell.mount("chat");
const topActions = document.querySelector("#top-actions");
topActions.innerHTML = `<button id="new-chat">新对话</button><a href="history.html">历史记录</a>`;
page.innerHTML = `
  <div class="chat-layout">
    <section class="messages" id="messages" aria-live="polite"></section>
    <div class="composer-wrap">
      <div class="composer">
        <textarea id="composer-input" rows="2" placeholder="给留白 AI 留言…（Enter 发送，Shift + Enter 换行）" aria-label="输入消息"></textarea>
        <div class="composer-bottom">
          <div class="composer-tools">
            <button id="voice-input" type="button" title="语音输入">语音</button>
            <button id="clear-chat" type="button">清空</button>
            <span class="tiny" id="message-count"></span>
          </div>
          <button class="btn primary send-btn" id="send-btn" type="button">发送</button>
          <button class="btn send-btn" id="stop-btn" type="button" hidden>停止</button>
        </div>
      </div>
      <div class="chat-notice"><span id="model-note"></span><a href="settings.html">模型与隐私设置 →</a></div>
    </div>
  </div>`;

const messagesEl = document.querySelector("#messages");
const input = document.querySelector("#composer-input");
const sendBtn = document.querySelector("#send-btn");
const stopBtn = document.querySelector("#stop-btn");
let current = null;
let busy = false;
let controller = null;
let recognition = null;

function initChat() {
  const handoff = sessionStorage.getItem("ai-handoff");
  if (handoff) {
    current = AI.newChat();
    current.messages = JSON.parse(handoff);
    current.title = current.messages.find((m) => m.role === "user")?.content.slice(0, 26) || "新对话";
    sessionStorage.removeItem("ai-handoff");
    AI.upsertChat(current);
  } else {
    const openId = sessionStorage.getItem("ai-open-chat");
    const savedId = openId || localStorage.getItem("liubai-ai-current-chat");
    current = AI.getChats().find((chat) => chat.id === savedId) || AI.newChat();
    sessionStorage.removeItem("ai-open-chat");
  }
  const draft = sessionStorage.getItem("ai-draft");
  if (draft) { input.value = draft; sessionStorage.removeItem("ai-draft"); }
  renderMessages();
  updateNotice();
  input.focus();
}

function updateNotice() {
  const config = AI.settings();
  document.querySelector("#model-note").textContent = config.provider === "public"
    ? "公共体验模型 · 可能限流，请勿输入隐私内容"
    : `${AI.modelLabel()} · 密钥仅保存在当前浏览器`;
  document.querySelector("#message-count").textContent = current?.messages.length ? `${current.messages.length} 条消息` : "";
}

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

function welcomeHtml() {
  const actions = [
    ["拆解目标", "帮我把一个目标拆成可执行步骤", "把「三个月内做好个人网站」拆成每周可执行的计划，并标出最容易放弃的风险点。"],
    ["解释代码", "贴一段代码，逐行讲清楚", "请用中文逐行解释这段代码，并指出一个可以改进的地方：\n\nconst unique = [...new Set(items)];"],
    ["润色文字", "让表达更准确、更有节奏", "请润色这句话，保留原意但让它更简洁、更有力量：我希望这个网站不只是一个好看的页面，而是每天真的愿意打开使用的工具。"],
    ["安排一天", "把工作、阅读和生活放进日程", "请给我安排一个兼顾专注工作、运动和阅读的周六计划，留出午休和空白时间。"],
  ];
  return `<div class="welcome"><div class="welcome-kicker">A quieter kind of intelligence</div><h1>今天，想让 AI<br>帮你做什么？</h1><p>多轮对话、流式输出、会话留存。你的聊天记录只保存在当前浏览器，公共体验模型无需密钥。</p><div class="quick-grid">${actions.map(([title, desc, prompt]) => `<button class="quick-item" data-prompt="${AI.esc(prompt)}"><strong>${title}</strong><span>${desc}</span></button>`).join("")}</div></div>`;
}

function renderMessages() {
  if (!current.messages.length) {
    messagesEl.innerHTML = welcomeHtml();
  } else {
    messagesEl.innerHTML = current.messages.map((message, index) => {
      const assistant = message.role === "assistant";
      const content = assistant ? AI.markdown(message.content) : AI.esc(message.content);
      return `<article class="message ${assistant ? "assistant" : "user"}">
        <div class="message-avatar">${assistant ? "留" : "你"}</div>
        <div class="message-body" data-index="${index}">${content || (busy ? '<span class="stream-caret"></span>' : "")}
          ${assistant ? `<div class="message-meta"><button data-copy="${index}">复制</button><button data-speak="${index}">朗读</button>${index === current.messages.length - 1 && !busy ? '<button id="regenerate">重新生成</button>' : ""}</div>` : ""}
        </div>
      </article>`;
    }).join("");
  }
  updateNotice();
  scrollToBottom();
}

function setBusy(value) {
  busy = value;
  sendBtn.hidden = value;
  stopBtn.hidden = !value;
  input.disabled = value;
}

function updateStreamingMessage(text) {
  const body = messagesEl.querySelector(`[data-index="${current.messages.length - 1}"]`);
  if (body) body.innerHTML = AI.markdown(text) + '<span class="stream-caret"></span>';
  scrollToBottom();
}

async function generate(regenerate = false) {
  const text = input.value.trim();
  if (busy || (!regenerate && !text)) return;
  if (!regenerate) {
    if (!current.messages.length) current.title = text.slice(0, 26) || "新对话";
    current.messages.push({ role: "user", content: text });
    input.value = "";
    input.style.height = "auto";
  } else {
    const last = current.messages.at(-1);
    if (last?.role === "assistant") current.messages.pop();
  }
  current.messages.push({ role: "assistant", content: "" });
  renderMessages();
  setBusy(true);
  controller = new AbortController();
  const requestMessages = current.messages.slice(0, -1).map(({ role, content }) => ({ role, content }));
  let pendingFrame = false;
  try {
    const result = await AI.requestChat(requestMessages, {
      signal: controller.signal,
      onDelta: (_, full) => {
        current.messages.at(-1).content = full;
        if (!pendingFrame) {
          pendingFrame = true;
          requestAnimationFrame(() => { updateStreamingMessage(full); pendingFrame = false; });
        }
      },
    });
    current.messages.at(-1).content = result || "（没有收到内容，请重试）";
  } catch (error) {
    if (error.name === "AbortError") {
      if (!current.messages.at(-1).content) current.messages.pop();
      AI.toast("已停止生成");
    } else {
      current.messages.at(-1).content = `⚠ ${AI.friendlyError(error)}`;
    }
  } finally {
    setBusy(false);
    if (current.messages.at(-1)?.role === "assistant" && !current.messages.at(-1).content) current.messages.pop();
    AI.upsertChat(current);
    localStorage.setItem("liubai-ai-current-chat", current.id);
    renderMessages();
    input.focus();
  }
}

sendBtn.addEventListener("click", () => generate(false));
stopBtn.addEventListener("click", () => controller?.abort());
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); generate(false);
  }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
});
messagesEl.addEventListener("click", (event) => {
  const quick = event.target.closest("[data-prompt]");
  if (quick) { input.value = quick.dataset.prompt; input.focus(); return; }
  const copy = event.target.closest("[data-copy]");
  if (copy) { AI.copy(current.messages[Number(copy.dataset.copy)].content); return; }
  const speak = event.target.closest("[data-speak]");
  if (speak) { AI.speak(current.messages[Number(speak.dataset.speak)].content); return; }
  if (event.target.closest("#regenerate")) generate(true);
});
document.querySelector("#new-chat").addEventListener("click", () => {
  if (busy) controller?.abort();
  current = AI.newChat();
  localStorage.setItem("liubai-ai-current-chat", current.id);
  renderMessages(); input.focus();
});
document.querySelector("#clear-chat").addEventListener("click", () => {
  if (!current.messages.length || !confirm("清空当前对话？此操作会删除本地记录。")) return;
  if (busy) controller?.abort();
  AI.deleteChat(current.id);
  current = AI.newChat();
  localStorage.setItem("liubai-ai-current-chat", current.id);
  renderMessages();
});

// 浏览器语音输入（支持时显示）
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognition) {
  document.querySelector("#voice-input").hidden = true;
} else {
  recognition = new SpeechRecognition();
  recognition.lang = "zh-CN"; recognition.interimResults = true;
  recognition.onresult = (event) => {
    const transcript = [...event.results].map((r) => r[0].transcript).join("");
    input.value = transcript;
    input.dispatchEvent(new Event("input"));
  };
  recognition.onerror = () => AI.toast("语音识别失败，请检查麦克风权限");
  document.querySelector("#voice-input").addEventListener("click", () => {
    try {
      if (document.querySelector("#voice-input").classList.toggle("listening")) {
        recognition.start(); AI.toast("开始聆听…");
      } else recognition.stop();
    } catch { recognition.stop(); }
  });
}

initChat();

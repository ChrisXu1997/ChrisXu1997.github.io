(() => {
  const SETTINGS_KEY = "liubai-ai-settings";
  const CHATS_KEY = "liubai-ai-chats";
  const PROMPTS_KEY = "liubai-ai-custom-prompts";
  const DEFAULTS = {
    provider: "public",
    baseUrl: "https://text.pollinations.ai/openai",
    model: "openai",
    key: "",
    temperature: 0.7,
    system: "你是「留白」的 AI 助手。用简洁、清晰、可靠的中文回答；涉及事实不确定时直说，不编造。代码给可运行的实现。",
  };
  const PROVIDERS = {
    public: { label: "公共体验模型", baseUrl: DEFAULTS.baseUrl, model: "openai", needsKey: false },
    glm: { label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-4-flash", needsKey: true },
    deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-chat", needsKey: true },
    openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini", needsKey: true },
    custom: { label: "自定义兼容接口", baseUrl: "", model: "", needsKey: false },
  };
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const settings = () => ({ ...DEFAULTS, ...read(SETTINGS_KEY, {}) });
  const saveSettings = (value) => write(SETTINGS_KEY, { ...settings(), ...value });
  const provider = () => PROVIDERS[settings().provider] || PROVIDERS.custom;
  const modelLabel = () => settings().provider === "public" ? PROVIDERS.public.label : settings().model || PROVIDERS[settings().provider]?.label || "自定义模型";

  function friendlyError(error) {
    const status = error.status || 0;
    if (status === 401 || status === 403) return "密钥无效或没有权限，请到「设置」检查。";
    if (status === 402 || status === 429) return "公共模型限流中，请稍后重试或切换自己的模型。";
    if (status === 404) return "接口或模型不存在，请检查设置里的地址和模型名。";
    if (status >= 500) return "模型服务暂时不可用，请稍后重试。";
    if (error.name === "AbortError") return "已停止生成。";
    return `请求失败：${error.message || "网络连接异常，请检查接口地址与网络。"}`;
  }

  async function requestChat(messages, { onDelta, signal, stream = true, maxTokens } = {}) {
    const config = settings();
    if (provider().needsKey && !config.key) {
      const error = new Error("请先在「设置」填写该服务商的 API Key。");
      error.code = "KEY_REQUIRED";
      throw error;
    }
    if (!config.baseUrl || !config.model) throw new Error("请先在「设置」补全接口地址与模型名。");
    const body = {
      model: config.model,
      messages: config.system ? [{ role: "system", content: config.system }, ...messages] : messages,
      temperature: Number(config.temperature),
      stream,
    };
    if (maxTokens) body.max_tokens = maxTokens;
    const headers = { "Content-Type": "application/json" };
    if (config.key) headers.Authorization = `Bearer ${config.key}`;
    const response = await fetch(config.baseUrl, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!response.ok) {
      const error = new Error((await response.text()).slice(0, 180));
      error.status = response.status;
      throw error;
    }
    if (!stream) {
      const data = await response.json();
      return data.choices?.[0]?.message?.content || "";
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const data = JSON.parse(payload);
          const delta = data.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            full += delta;
            onDelta?.(delta, full);
          }
        } catch { /* 忽略不完整数据帧 */ }
      }
    }
    return full;
  }

  const getChats = () => read(CHATS_KEY, []).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  function upsertChat(chat) {
    const chats = getChats().filter((item) => item.id !== chat.id);
    chat.updatedAt = new Date().toISOString();
    chats.unshift(chat);
    write(CHATS_KEY, chats.slice(0, 60));
    return chat;
  }
  const deleteChat = (id) => write(CHATS_KEY, getChats().filter((chat) => chat.id !== id));
  function newChat() {
    return { id: uid(), title: "新对话", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] };
  }

  function markdown(text) {
    const codeBlocks = [];
    let source = String(text ?? "").replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const token = `\u0000CODE${codeBlocks.length}\u0000`;
      codeBlocks.push(`<pre><code class="language-${esc(lang)}">${esc(code.replace(/^\n+|\n+$/g, ""))}</code></pre>`);
      return token;
    });
    source = esc(source)
      .replace(/^###\s+(.+)$/gm, "<h4>$1</h4>")
      .replace(/^##\s+(.+)$/gm, "<h3>$1</h3>")
      .replace(/^#\s+(.+)$/gm, "<h2>$1</h2>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    source = source.replace(/(^|\n)\s*[-*]\s+([^\n]+)/g, "$1<li>$2</li>");
    source = source.replace(/(^|\n)\s*\d+\.\s+([^\n]+)/g, "$1<li>$2</li>");
    source = source.replace(/(?:<li>[\s\S]*?<\/li>)/g, (block) => `<ul>${block}</ul>`).replace(/<\/ul>\s*<ul>/g, "");
    source = source.split(/\n{2,}/).map((part) => part.trim() ? `<p>${part.replace(/\n/g, "<br>")}</p>` : "").join("");
    codeBlocks.forEach((block, index) => { source = source.replace(`\u0000CODE${index}\u0000`, block); });
    return source;
  }

  function download(name, content, type = "text/plain;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("已复制"); }
    catch { toast("复制失败，请手动选择文本"); }
  }
  function toast(message) {
    const el = document.createElement("div");
    el.className = "ai-toast"; el.textContent = message;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 2200);
  }
  function speak(text) {
    if (!("speechSynthesis" in window)) return toast("当前浏览器不支持朗读");
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text).replace(/[`*#>\[\]()]/g, "").slice(0, 1200));
    utterance.lang = "zh-CN"; utterance.rate = 1.02;
    speechSynthesis.speak(utterance);
  }
  function chatToMarkdown(chat) {
    return `# ${chat.title}\n\n${chat.messages.map((m) => `## ${m.role === "user" ? "你" : "留白 AI"}\n\n${m.content}`).join("\n\n")}\n`;
  }

  window.AI = {
    PROVIDERS, settings, saveSettings, provider, modelLabel, requestChat, friendlyError,
    getChats, upsertChat, deleteChat, newChat, markdown, download, copy, toast, speak,
    chatToMarkdown, uid, read, write, PROMPTS_KEY, esc,
  };
})();

(() => {
  const ROUTES = [
    { id: "chat", href: "index.html", label: "对话", en: "Chat", no: "01" },
    { id: "tools", href: "tools.html", label: "工具", en: "Tools", no: "02" },
    { id: "prompts", href: "prompts.html", label: "提示词", en: "Prompts", no: "03" },
    { id: "history", href: "history.html", label: "历史", en: "History", no: "04" },
    { id: "settings", href: "settings.html", label: "设置", en: "Settings", no: "05" },
  ];
  function mount(active) {
    const route = ROUTES.find((r) => r.id === active) || ROUTES[0];
    document.title = `${route.label} · 留白 AI`;
    const aside = document.createElement("aside");
    aside.className = "shell-side";
    aside.innerHTML = `
      <a class="shell-brand" href="index.html"><span class="brand-mark">留</span><span class="brand-text">留白<small>AI STUDIO</small></span></a>
      <a class="model-state" href="settings.html"><i></i><span>${AI.esc(AI.modelLabel())}</span></a>
      <nav class="shell-nav" aria-label="AI 工具导航">${ROUTES.map((r) => `<a class="${r.id === active ? "on" : ""}" href="${r.href}"><i>${r.no}</i><span>${r.label}</span><b>${r.en}</b></a>`).join("")}</nav>
      <div class="side-note">本地优先 · 会话不离开浏览器<br>公共模型限流，私有密钥仅本地保存</div>`;
    const workspace = document.createElement("div");
    workspace.className = "workspace";
    workspace.innerHTML = `<header class="shell-top"><div class="page-title">${route.label} <span class="muted" style="font-family:var(--en);font-style:italic;margin-left:8px">${route.en}</span></div><div class="top-actions" id="top-actions"></div></header><main class="page ${active === "chat" ? "chat-page" : ""}" id="page"></main>`;
    document.body.replaceChildren(aside, workspace);
    return workspace.querySelector("#page");
  }
  window.AIShell = { mount, ROUTES };
})();

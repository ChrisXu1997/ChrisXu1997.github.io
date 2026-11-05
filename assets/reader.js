(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const backdrop = document.createElement("div");
  backdrop.className = "reader-backdrop";
  const panel = document.createElement("article");
  panel.className = "reader-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("aria-label", "站内阅读");
  panel.tabIndex = -1;
  panel.innerHTML = `
    <div class="reader-top">
      <span class="reader-kicker">Reading, without leaving</span>
      <button class="reader-close" type="button" aria-label="关闭阅读">×</button>
    </div>
    <h2 class="reader-title"></h2>
    <div class="reader-meta"></div>
    <div class="reader-body"></div>
    <footer class="reader-foot">
      <a class="reader-original" target="_blank" rel="noopener">阅读原文 ↗</a><br>
      内容由 RSS 自动整理，著作权归原作者所有。
    </footer>`;
  document.body.append(backdrop, panel);

  const title = panel.querySelector(".reader-title");
  const meta = panel.querySelector(".reader-meta");
  const body = panel.querySelector(".reader-body");
  const original = panel.querySelector(".reader-original");
  const closeButton = panel.querySelector(".reader-close");
  let lastFocus = null;

  function imageUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function open(item) {
    if (!item) return;
    lastFocus = document.activeElement;
    title.textContent = item.title || (item.text ? item.text.slice(0, 80) + (item.text.length > 80 ? "…" : "") : "未命名文章");
    const date = item.published && !Number.isNaN(new Date(item.published).getTime())
      ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(item.published))
      : "";
    meta.innerHTML = `<span class="src">${esc(item.source || "站内阅读")}</span>${date ? " · " + esc(date) : ""}`;
    const content = item.content || item.text || item.desc || "此来源仅提供标题与摘要，请通过下方原文链接继续阅读。";
    if (Array.isArray(item.blocks) && item.blocks.length) {
      body.innerHTML = item.blocks.map((block) => {
        if (block.type === "img") {
          const src = imageUrl(block.src);
          return src ? `<figure class="reader-figure"><img src="${esc(src)}" alt="${esc(block.alt || "文章配图")}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"></figure>` : "";
        }
        return block.text ? `<p>${esc(block.text)}</p>` : "";
      }).join("");
    } else {
      body.innerHTML = String(content).split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => `<p>${esc(line)}</p>`).join("");
    }
    if (item.link) {
      original.href = item.link;
      original.hidden = false;
    } else original.hidden = true;
    panel.scrollTop = 0;
    document.body.classList.add("reader-open");
    backdrop.classList.add("open");
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    closeButton.focus({ preventScroll: true });
  }

  function close() {
    backdrop.classList.remove("open");
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    document.body.classList.remove("reader-open");
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
  }

  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("open")) close();
  });
  function bind(container, items) {
    container.querySelectorAll(".news a").forEach((link, index) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        open(items[index]);
      });
    });
  }

  window.ArticleReader = { open, close, bind };
})();

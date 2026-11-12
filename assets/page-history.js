const page = AIShell.mount("history");
document.querySelector("#top-actions").innerHTML = `<button id="export-chats">导出全部</button><a href="index.html">新对话</a>`;
let query = "";
page.innerHTML = `<input class="input" id="history-search" placeholder="搜索标题或消息内容"><div id="history-list" style="margin-top:18px"></div>`;
function render() {
  const q = query.toLowerCase();
  const chats = AI.getChats().filter((chat) => !q || `${chat.title}${chat.messages.map((m) => m.content).join(" ")}`.toLowerCase().includes(q));
  document.querySelector("#history-list").innerHTML = chats.length ? chats.map((chat) => {
    const last = chat.messages.at(-1)?.content || "空对话";
    return `<article class="history-item">
      <div><h3>${AI.esc(chat.title)}</h3><p>${chat.messages.length} 条消息 · ${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(chat.updatedAt))}</p><p>${AI.esc(last.slice(0, 130))}</p></div>
      <div class="history-actions"><button class="text-btn" data-open="${chat.id}">继续</button><button class="text-btn" data-download="${chat.id}">导出</button><button class="text-btn" data-delete="${chat.id}">删除</button></div>
    </article>`;
  }).join("") : `<div class="muted" style="padding:36px 0">${q ? "没有匹配的会话。" : "还没有会话，去开始第一次对话吧。"}</div>`;
}
document.querySelector("#history-search").addEventListener("input", (event) => { query = event.target.value; render(); });
document.querySelector("#history-list").addEventListener("click", (event) => {
  const open = event.target.closest("[data-open]");
  if (open) { sessionStorage.setItem("ai-open-chat", open.dataset.open); location.href = "index.html"; return; }
  const download = event.target.closest("[data-download]");
  if (download) {
    const chat = AI.getChats().find((c) => c.id === download.dataset.download);
    if (chat) AI.download(`${chat.title}.md`, AI.chatToMarkdown(chat), "text/markdown;charset=utf-8");
    return;
  }
  const del = event.target.closest("[data-delete]");
  if (del && confirm("删除这段会话？")) { AI.deleteChat(del.dataset.delete); render(); AI.toast("已删除"); }
});
document.querySelector("#export-chats").addEventListener("click", () => {
  const chats = AI.getChats();
  if (!chats.length) return AI.toast("还没有可导出的会话");
  AI.download(`留白-AI会话-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(chats, null, 2), "application/json;charset=utf-8");
});
render();

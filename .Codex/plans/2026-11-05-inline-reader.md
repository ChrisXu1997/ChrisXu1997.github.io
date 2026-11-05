# 站内阅读器

日期：2026-11-05

## 目标
科技、AI、财经文章点击后不离开网站，在当前页以右侧阅读抽屉展示；移动端全屏。原文链接仅作来源与备用。

## 数据
静态站不依赖客户端跨域抓取。RSS 解析同时读取 description 与 content:encoded，解码实体、去除 HTML，保留段落，正文最多 6000 字，随现有 data/tech.json、data/ai.json 每 15 分钟更新。财经快讯沿用完整 text。

## 交互与设计
共享 assets/reader.css + reader.js，纸墨风抽屉、遮罩、Esc 关闭、移动端全屏、正文段落排版、来源/时间/原文链接与版权注记。digest 与 tech/ai/finance 详情页接入；体育比赛和热榜话题不属于文章，保持原链接。

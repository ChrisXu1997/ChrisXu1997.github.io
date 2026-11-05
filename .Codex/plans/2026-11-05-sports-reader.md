# 运动新闻站内图文阅读

日期：2026-11-05

## 数据
直播吧文章正文位于 `#signals.content`，段落与图片顺序清晰。fetch-sports.mjs 为 NBA/足球/电竞各前 5 条新闻补抓正文，生成 blocks：[{type:'text',text},{type:'img',src,alt}]，同时保留纯文本 content。图片仅接受 HTTPS，限制数量，单篇失败不影响整批。

## 阅读器
ArticleReader 优先渲染 blocks，图片 lazy load、失败隐藏、纸墨细边框；无 blocks 时沿用现有纯文本。digest 的 NBA 要闻和 sports.html 三板块新闻接入；比赛比分仍原站查看，未成功补抓的文章保持原链接。

## 验证
本地检查 NBA 纯图片战报、足球图文混排、电竞短文，验证图片实际加载、关闭与移动端，再推送由 CI 生成线上数据。

# 本地点击体验与三个市场

约束：纯本地 HOST 参考模型；不替代正式钱包、Solana原生市场或链上确认。

- [x] 进入测试账号不需要密码、地址、Root ID或人工填费；按当前套装推进。
- [x] 选中的生物与登记/退出的 workId 完全一致，不能误用最新另一只。
- [x] 未确认的写操作保留同一requestId，网络/截断/格式异常均可精确重试。
- [x] 原料、成品、生物三个市场分别显示；分类由服务端实际资产决定。
- [x] 原料按份点选挂牌；成品按自有workId挂牌；成交与取消无需重复输入。
- [x] 测试交易对手及模拟购买显式标出，价格用整数lamports格式化。
- [x] 实际浏览器完整构造、登记、领取、退出、三个市场及重置恢复通过。
- [x] 全量回归完成并固定源码与测试证据。

正式市场的托管与付款/转移原子指令尚未实现，正式市场不得开放。

Actual browser path and three-market buy/list/cancel/sale completed. Full regression 992/992 passes; final source identity is pinned by the separate acceptance record. Only ordinary public-reference goods are exposed by this local market; first-discovery rights trading is not enabled.

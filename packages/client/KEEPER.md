# 全局结算执行器

`planNextGlobalSettlement` 只读真实 finalized 账本，每次计划一个动作。它不保管私钥，
不扫描全体作品，不替某个钱包领取，也不假设运营金库可以无限代付。

| 实际状态 | 下一步 |
| --- | --- |
| Registry 尚未初始化 | 原生 SYNC_EMISSION，建立真实结算账本 |
| 事件游标处有到期事件 | APPLY_EVENT；从实际 Directory 推出 START 尾、END 前后邻居或 K Activation |
| 当前小时未闭合 | WAIT_COMPLETED_HOUR，不创建交易 |
| 当前 Hour4 已冻结成员 | ADVANCE；不等待全部成员补账 |
| 已开立的小时没有成员 | MATERIALIZE 空小时，完成残余账 |
| 当前账户尚未创建且无成员/K | EMPTY_SKIP 到闭合小时与下一真实事件的较早边界 |
| 当前账户尚未创建且有成员 | OPEN_HOUR，冻结真实分母及成员数 |
| 读事件期间 Registry 被别人改变 | REPLAN_STALE_REGISTRY，不输出旧交易意图 |
| 历史 Hour3 仍占当前前沿 | 明确提示手动按旧规则完成；不改标签当 Hour4 |
| 发放期结束且该边界事件已应用 | EMISSION_FRONTIER_COMPLETE；旧个人债务仍可补记和领取 |

返回前再次同批重读 Registry 与 Clock；这降低并发产生过期交易的概率，不等于预留
链上状态。原生执行仍检查游标和权限，签名前后都可能被另一合法操作推进。

CLI `keeper-plan --request /absolute/request.json` 接受：

```json
{
  "maxRent": "10000000",
  "resources": {
    "computeUnitLimit": 1400000,
    "loadedAccountsDataSizeLimit": 67108864,
    "heapSize": 262144,
    "priorityFeeLamports": "0"
  }
}
```

字段必须完整。此数值示例是明确上限，不是钱包应付报价。
`--out` 写一次可用于 `prepare --intent` 的新文件；等待或重读状态不会写假意图。
仍需 prepare、外部签名和显式 broadcast。不可一直重发已经过期的事件参数。

`runNativeKeeperStep` 将相同规划接入耐久 `NativePlayerSession`。默认
`broadcast:false` 只读规划，连 prepare 和签名回调都不调用。主动设置
`broadcast:true` 时，必须注入服务拥有者授权的 `signEnvelope`：prepare 后先核对完整
Frame、模拟，再调用外部签名器并经 session 严格校验完整签名和消息后发送。
返回 PENDING/UNKNOWN 时应先 reconcile，不能无条件开始下一笔或默默换号。
服务运行时间、资金、签名器、轮询和部署由实际运营环境提供，不存在内置私钥或隐形
补贴。导入模块和启动工作台不会启动一个发送交易的后台服务。

## 退还已完成小时的租存

在同一请求额外写入 `"closeHour":"0"`，明确选择关闭某个历史小时。客户端读取
真实 Hour、Registry 和 Clock，仅在 FINAL、全部分配守恒且前沿已越过时导出
CLOSE_FINAL_HOUR。退款只能付给 Hour 保存的原开立者；别人代调用也不能改变收款人。
这不是退还制造原料或 LAB 奖励，也不删除 Position 里的历史应付权益。

空闲时段可以跳过，不必每天机械创建 24 个账户；有活跃作品的每个小时全网一份
482B 快照。按官方网页默认参数，一份约需 0.0042456 SOL 存储押金，24 份约
0.1018944 SOL；实际须查询部署网络。全部成员完成计债后可退押金，否则快照与
尚未分配的收益必须继续保留。个人补账和结算交易仍有实际手续费，不能声称零成本。

验收分开记录：本模块测试验证 codec、事件尾表、读快照重检和默认不发送；实际
SBF、签名 Bank、容量与状态回滚见项目 `docs/FINAL-REVIEW.md` 的精确 ELF 证据。

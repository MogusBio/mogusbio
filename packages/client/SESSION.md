# 原生玩家交易与恢复

`NativePlayerSession`把真实BIOP0R2 ABI、官方Kit8 v1消息、钱包签名、
finalized账户读取和持久化恢复接在一起。构造器、导入和prepare都不签名、不发送。
唯一发送方法是显式调用`broadcastSigned(envelope, signedBytes)`。

## 交易顺序

1. 客户端在本地选择动作与精确nonce、材料计划、费用上限和账户表。
2. `prepare`核对实际GENESIS、BaseConfig、finalized ActorNonce和最新blockhash。
   nonce不符立即拒绝；不能替已经绑定制造H3/H5的载荷偷偷换号。
3. 构造一条原生 BIO 指令与全部明确 v1 资源预算，写真实文件 CAS 后导出公开 envelope。
   首次领取可明确指定 `labDestinationSetup:{beneficiary}`，原子前置固定 LAB ATA
   CreateIdempotent；此例外不接受任意转账或额外指令。
4. 外部钱包签名。导入时重新构造整个消息，并验证每个必要原生Ed25519签名，
   包括多所有者制造或3/5 Ops；钱包不能改载荷、账户、金额、费率、blockhash或已有共签。
5. 发送前再读实际nonce。已确认的请求直接回旧结果；冲突或旧缓存不可恢复不重发新业务。
   对尚未执行的请求，验证签名中真实blockhash仍有效；lastValidBlockHeight只是寿命
   元数据，不能当作签名证明。真实预检仍可能因状态变化而拒绝。
6. 签名、blockhash和原Frame的attempt先经CAS落盘，再调用`sendTransaction`。
   RPC接受只返回`PENDING`。超时、断线或不一致响应返回`UNKNOWN`，原Frame不变。
7. `reconcile`读finalized nonce/cache，返回真正业务结果；`refresh`只在原nonce仍空闲时
   更换交易blockhash，保留原Frame/H4/H3与材料来源编号。没有自动计时发送或自动换业务nonce。

连接与响应体默认合计15秒超时，可显式设1–60000ms。超时会中断HTTP；它不能撤回
已经交给网络的签名交易。默认没有fetch，应用必须明确注入网络传输。

## 长期历史

单个工作日志保持有界。达到512条或4MiB时，session将terminal记录交给真实
FileJournalStore耐久归档，取得私有品牌回执后才剪去主索引并CAS。未决请求不能归档。
归档/CAS中断至多留下重复保存的完整历史，不使已确认业务变成可重发。
旧`status`仍回原结果并标`LOCAL_DURABLE_ARCHIVE`；另一设备推进nonce后，通过
真实finalized观察更新高水位，不伪造丢失结果。具体FS保证见[RPC.md](RPC.md)。

## 命令行

在项目目录运行`npm run native:operator -- help`。命令行读取公开发布输入、意图、
未签名envelope和外部钱包已签名文件；不读钱包私钥。全部文件参数使用绝对路径。

| 命令 | 行为 |
|---|---|
| catalog / release / inspect | 读取ABI、发布输入与完整交易摘要 |
| prepare | 在线核对状态并生成未签名envelope，写有界持久工作日志 |
| simulate | 实际RPC只读模拟；不会宣称签名、执行或领奖成功 |
| refresh | 先核对原请求，再更新blockhash供钱包重新签名 |
| status | 链上最终业务结果或已耐久保留的原确认结果 |
| position-plan | 读取真实 Position 和历史账本，导出一次补记或领取的未签名 intent |
| keeper-plan | 从真实事件前沿规划一步全局结算，或明确选择关闭已完成小时 |
| cancel-prepare / cancel-status | 保留旧日志，准备另签的同序号 SYNC，并核对原请求与取消结果 |
| broadcast | **唯一发送命令**；外部完整签名、逐字节与状态检查、先耐久后发送 |

意图文件字段为`operation,nonce,payloadHex,suffix,dynamicAccounts,feePayer,resources`，
首次领取可额外包含严格限定的 `labDestinationSetup`。
nonce、费用和数量用规范十进制字符串或typed helper中的BigInt；不能用JS浮点数承载u64。
`catalog`列出每个动作精确载荷长度、固定账户顺序和依赖状态的动态尾条件。
建议使用typed helpers、P5及SYN phase-aware planners生成实际数据，不手工猜动态账户。

签名导入文件只含`{"signedTransactionBase64":"..."}`。输出采用0600、新文件创建，
不覆盖原envelope或旧签名。实际生产release必须通过当前源码与政策绑定；公开本地
测试身份只有明确fixture flag才能进入mode0，且发送只允许loopback端点。

## 持续收益的实际入口

`planPlayerPositionAction` 和 `position-plan` 将个人收益接到上述会话，读取实际
finalized BaseConfig、ActorNonce、Position 及所需账本，不要求玩家猜账户或历史游标。
每次只计划一笔，返回的预览不是已赚、已领取或已经执行的证明。

`--request` 文件形如：

```json
{
  "instanceHex": "本次质押实例的64位小写十六进制ID",
  "positionSeq": "0",
  "kind": "accrue",
  "maxRent": "10000000",
  "resources": {
    "computeUnitLimit": 1400000,
    "loadedAccountsDataSizeLimit": 67108864,
    "heapSize": 262144,
    "priorityFeeLamports": "0"
  }
}
```

这里的 ID 必须换成玩家实际实例 ID；资源与费用是玩家明确的上限，不是报价。
`accrue` 只选择该 Position 的下一个未结小时，要求真实冻结的 lazy Hour4；
前一段质押未清返回 `WAIT_PRIOR_POSITION`，全局未冻结返回 `WAIT_FROZEN_FRONTIER`，
自身覆盖完毕返回 `COVERAGE_COMPLETE`。缺账户、错误版本或坏数据直接报错。

将 `kind` 改为 `claim`，只领取实际累计且未付的债务；零债务返回
`NO_ACCRUED_DEBT`。原受益人的标准 LAB ATA 尚未初始化时，导出已限定的原子创建
元数据；以后转让作品，也不能把旧收益改付给新持有人或代执行者。

有动作时 `--out` 直接写可交给 `prepare --intent` 的新文件；等待状态不写伪造意图。
随后仍需 prepare、钱包签名和显式 broadcast。新一笔应重新读取状态，不能永久重试
旧计数。全局冻结小时的执行器与个人补账分别运行，其他成员延迟补账不堵住全网时间。
全局执行器、部署签名器与小时租存关闭的边界见 [KEEPER.md](KEEPER.md)。

永久过期的业务参数不能靠换 blockhash 修好。`cancel-prepare` 使用单独的
`--recovery-state` 目录，`--request` 同样明确指定 `maxRent` 和四项 `resources`，
另签同一 nonce 的固定 SYNC 交易；只有用户显式广播后才参与竞争。原交易先执行则
原交易成功；SYNC 先执行则旧请求无法再执行。未知结果不能冒称已取消，原始 Frame
和两份日志都会保留。取消也会破坏此前绑定该 nonce 的制造承诺，必须重新规划，
不能偷偷续用旧承诺。详见 [RECOVERY.md](RECOVERY.md)。

## 首创顺序

Artifact内容在链上公开；seal不保密。使用`planPrivateDesignCommit`：先在本地实验，
保留随机32字节salt，固定未来实际制造nonce，先提交并确认H22，再公开上传/验证，
在制造窗口用原作者、原nonce及salt实际制造。不能因并发或超时悄悄换nonce。
helper不会把salt或完整私有图放进COMMIT交易。未来nonce不被链上预留；额外动作
会破坏排定的工作流，必须在公开前规划清楚。节点不能判断链外最初研究者是谁。

公开开场的16个模型前沿为316。已知图不能获得首创K；同层、同B和同q的普通产出
相同，C下降影响首创比较。当前没有确认未公开的C<316方案，不保证每轮有首创奖励。

本地通过不是生产部署或真实钱包兼容验收。当前浏览器工作台负责本地构造实验，
原生线上动作由本SDK/命令行提供；完整钱包产品界面的独立验收仍在上线清单内。

# ECON-SETTLE2: 累计权益与有界幂等

2026-10-24制定，2026-10-25补充跨模块验收。此版本修订 ROLLUP1 第10—12模块的存储与执行方式，保留其经济行为。旧草案每活跃成品每小时建立497B永久Receipt，且每次调用永久保存完整Business，长期租存费用不能通过经济验收；不能用增加收费或假设玩家继续买材料来掩盖这个结构问题。

本次已实现可运行的 Node ESM 参考内核和精确二进制codec，尚无Solana程序部署、真实CU验收或生产放行。生产适配必须显式选择本版本，不能把旧Receipt ABI静默解释成累计权益。

## 不变的经济规则

发行总量仍为100,000,000 LAB，六位小数，共100,000,000,000,000原子。“生物能”是LAB产品名称，模拟E/FU不是第二币。四类原料、实际消耗、单向合成与合成费用的既有规则不变。

每纪元35,040h，`E_k=floor(N/2^(k+1))`，仅k0—45非零。其和N−17，17原子创世永封存。每小时仍独立计算：

`Budget(h)=floor(E_k×(t+1)/35040)−floor(E_k×t/35040)`。

全局有限奖励域 `[0,1611840)`；同步使用最多46项的前缀和，停机不逐小时同步释放缓存。登记时普通权重固定为 `B_int×(900000+q_ppm/10)×L_quarters`；分母为真实完整总权重与288000000000000000中较大者。K仍为77760000000000，唯一合法K与该根普通权重**先合并，再按该小时floor一次**。不同独立根分别floor，不把多个部件合成一张虚拟票。

## 每个区间保存永久债权

原OrdinaryInterval成为Position，固定instance、seq、beneficiary、B/q/L/W及start，end仅按真实退出/失效固化一次。新增三个u64：

| 字段 | 意义 |
| --- | --- |
| accrued | 此区间已完成规范物化的逐小时应付原子总和 |
| paid | 已实际支付的累计原子，0≤paid≤accrued |
| nextUnsettledHour | 此区间下一个尚未物化的有效小时，精确保留逐小时floor边界 |

每个Hour仍先扫描完整唯一ROOT目录，固定普通总W、唯一K及分母，然后第二遍逐根计算原应付并累加Position.accrued，不建立Root/h Receipt。第二遍游标和Position checkpoint在同一事务提交，重复游标拒绝；中途故障回滚本笔。全部根处理后仅一次封存 `budget−materializedSum`，不把未知名册当空。

该小时每根的应付仍可由永久Hour、普通区间与K历史重算；不需要为每根每h建立一个链上账户。Hour不再保存逐小时paid_sum，原8B位置强制保留0。按Position合并领取后无法仅凭本次付款给每个小时重新分摊paid，账务不应伪造这个字段。

物化x：pending−x / certified+x / Position.accrued+x。完整小时残余y：pending−y / sealed+y。领取x：Reserve−x / certified−x / circulating+x / Position.paid+x。制造真实burn保持supply−x及manufactureBurned+x，不能直接烧未领债权。累计paidTotal是流量统计，不再加进现存等式。

退出、转让和消费仍要求真实使用锁已结束以及全部有效历史物化；**无需先付款**。Position永久保留原beneficiary，即使根已转让或被合成消费，旧未领仍由原受益人领取。新所有者仅取得新登记区间的未来普通收益；转让后买回不恢复首创K资格。

## 领取绑定累计检查点

新入口1203/1 `CLAIM_POSITION`签定intervalId、expectedPaid、upToAccrued和实际目的Token账户。必须 `expectedPaid=当前paid` 且 `expectedPaid≤upToAccrued≤当前accrued`，实际付额为两签定值之差。目的Token内部owner必须等原区间beneficiary，mint/状态/实际authority/保护账户约束沿原Token规则；payer或actor不能借代发重定向。

跨钱包并发按Position写锁与paid CAS至多一笔适用。新增物化可能提高accrued，但不会超出已签upToAccrued自动付款。0额检查点允许安全成功，不产生新权益。后续交易失败时Token、paid、Treasury及nonce同笔回滚。当前owner、best和根是否Consumed均不是历史支付的重算输入。

## 一份ActorNonce替代永久Business

ExactFrame仍含32B op_id，但本执行版本限定为 `nonce:u64LE || zero24`。每部署域/actor只保留固定ActorNonce：nextNonce、最后完整请求H4和最后≤256B结果。

| 请求 | 行为 |
| --- | --- |
| nonce=nextNonce | 验权、业务全部通过后原子推进nonce及最后摘要/结果 |
| nonce=nextNonce−1且完整H4相同 | 返回最近原结果，不重读失效的历史业务账户、不重复支付 |
| nonce=nextNonce−1但H4不同 | 幂等冲突 |
| 更旧nonce | ALREADY_PROCESSED，拒绝；查询Position/Hour等累计事实和本地历史 |
| nonce>nextNonce | NONCE_GAP，拒绝 |

这明确改变原P0“任意旧M永久返回完整历史结果”的承诺。链上不能同时删除旧完整Business又声称能返回其原始Frame结果。ActorNonce由真实actor签名授权，公开crank只推进自己的nonce，并支付自身账户租存与网络费；没有新增公共补贴。新actor可建独立nonce，但不能越过领域状态、材料消耗、唯一目录、checkpoint或paid CAS。

核心包`executeAtomic`持唯一ActorNonce。结算包集成走`executePrepared`，不再在其内部维护第二套nonce。独立内核测试的自带nonce仅用于本地验收。

## 精确wire修订

公共120B头及实际PDA/runtime owner/域校验依旧由核心和链上适配层负责。新增schema如下，严格长度、整数范围、0哨兵、尾字节耗尽均已有可执行测试：

| 对象 | kind/schema | body / 总字节 | 变化 |
| --- | --- | ---: | --- |
| Position | 27/2 | 255 / 375 | 原231B普通区间后追加 accrued@231、paid@239、nextUnsettledHour@247，均u64LE |
| Hour | 18/2 | 297 / 417 | 原布局不变，paid_sum@257的8B强制reserved0 |
| ActorNonce | 35/1 | 298 / 418 | next8 + lastDigest32 + resultLen:u16 + result固定256B，剩余padding严格0 |

Position仍使用固定9B Bound，OPEN编码tag0/value0，CLOSED tag1/实际end；q1000量化、层级绝对L、B及W一致性由codec复核。Hour预算、K哨兵、分母、FINAL人数和残余必须一致；不能把这些字段仅作为不验证的字节包。

1201/1的物化入口只允许payload schema2执行，payload57/Frame209/result65长度不变，业务改为累计Position。1201/1 schema1与旧1201/2 Receipt领取只可作历史解码，执行版本禁止。新1203/1 schema1 payload120/Frame272/result88，profile19249：

`intervalId32 || expectedPaid:u64 || upToAccrued:u64 || destinationToken32 || rentPayer32 || maxRentDebit:u64`。

结果为`intervalId32 || beneficiary32 || amount:u64 || paid:u64 || accrued:u64`，88B。核心注册表已标记生产未启用。上述codec落地不表示真实Solana账户初始化、签名、SPL Token CPI或迁移程序已经实现。

## 可执行验收与成本门禁

截至本版，结算包55项node:test通过。覆盖首纪元35,040h逐笔预算求和、全部46个纪元边界、100m守恒、大整数、冷启动及唯一inflight空Hour、当前小时不提前封存、重复质押目录不膨胀、材料实例单向消费、父输入不再计权、K合并及切换、11根分批停机恢复、旧受益人未领保留、换号/nonce/paid CAS、Position/Hour/ActorNonce精确字节及畸形输入；另核作者售出后历史Winner保留、有限安全暂停/完整复核恢复不自动重启K。

首期一个q2/B7200 BIO：h0应付470890原子，残余1426469749封存。普通+K唯一冠军h0应付856164原子，只有一个Position累计入口。60独立部件h0各2378，共142680，不能用先合并再floor的142694替代。

存储改为O(唯一Root + 普通区间 + 全局Hour + actor + K历史)，去掉O(活Root×小时)与O(全部调用数)的永久账户乘积。持续运行仍每天新增24个417B Hour，即10008数据字节；既有Position和ActorNonce固定就地更新，领取频率不会增生永久Business/Receipt。真实租存须按独立账户调用当前RPC Rent计算，不能拿合计字节只算一户；停机补账也有真实交易费。

每小时仍扫描历史唯一Root，所有共享Registry/Treasury/Hour写热点仍需真实SBF测CU/heap/loaded-data、签后消息字节、并发回滚、恢复追赶与资金来源。此修订修复明显存储放大，不能据此宣布Solana完整验证或持续运营已经通过。无需新增费用、币、材料回收或奖励参数，未验收的生产门禁继续关闭。

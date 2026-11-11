# Solana 承载核实与实现验收

核实日期：2026-10-24；实现复核更新：2026-10-25（Asia/Shanghai）。本文件记录官方能力、旧方案成本和真实本地 SBF 执行结果；不表示主网部署或整套生产准入已经完成。旧规格原件保持不改，实施修订另行版本化。

当前实施已经从旧Receipt版本推进到累计Position和[ECON4独立历史结算](ECON4-LAZY-SPEC.md)，
并已在真实SBF与官方SDK签名Bank中实际运行。本文下方旧版本和独立内核数据保留其历史范围；
最新合并程序的ELF、完整构造链及验收范围以[最终复核](FINAL-REVIEW.md)和对应机器报告为准。
**下文的“60 件部件每天锁存 6.264 SOL”是已废弃的永久 Receipt 方案成本，
不是当前实现报价。** 当前按原有 Position 累计收益，全网共用每小时一份 482B Hour4。
按相同网页默认值，单份押存 `(482+128)×6960=4,245,600 lamports`，
24 份共 0.1018944 SOL；此项不随活跃作品数相乘。全部成员计债完成后可以关闭，
押存只退给原开立者；未完成的历史小时仍占用资金，不能提前关闭或声称没有成本。
这仅是 Hour 押存，不包含 Root/Position/Artifact、事件、交易手续费或服务成本。
实际网络金额须查询当前 RPC，不能将网页默认值固定为生产费率。
2026-10-25重新核对官方v1升级和格式文档，仍确认其主网启用；本次重新核对是文档核实，
不冒充一次新的主网程序部署、钱包签名或RPC实测。

## 已核实的网络能力

Solana Foundation 当前确认 v1 在主网、开发网、测试网启用；主网启用点为 2026-09-15 的 epoch 1035。v1 的 4096 字节、0x81 首字节、尾部签名和无 ALT 设想有实际标准依据。legacy/v0 仍为 1232 字节。客户端必须逐钱包检查版本支持，读取交易显式支持版本 1；不能把 SDK 只会读取当成能够构造和签名。[官方升级说明](https://solana.com/upgrades/larger-transaction-sizes)

以下为保守实施上限，不提前采用尚未核实激活的扩容：

| 项目 | 实施上限或语义 |
| --- | --- |
| v1 已签交易 | 4096 字节；地址全部 inline；本项目仍限制 64 个唯一地址 |
| v1 预算 | CU 和 loaded-data 必须显式为正；缺省为零；预算放 message config |
| 单交易执行 | 最多 1,400,000 CU |
| 堆 | 默认 32 KiB；可请求到 256 KiB，1024 字节整数倍 |
| SBF 栈帧 | 单帧 4096 字节；不能在栈上放整份图或 Artifact |
| loaded account data | 最大 64 MiB，与堆内存不是同一限制 |
| 单账户数据 | 最大 10 MiB；单指令增长最多 10 KiB |

格式字段以[官方 v1 规范](https://solana.com/docs/core/transactions/versioned-transactions)为依据；执行限制见[官方 Compute Budget](https://solana.com/docs/core/fees/compute-budget)，账户限制见[官方 Accounts](https://solana.com/docs/core/accounts)。v1 的 ComputeBudget 指令不负责配置预算，不能延用 v0 的设置方法。

这些边界支持“分段上传、借用读取、有限执行”，不能由此推出完整功能验证一定放得下。214100 字节 Artifact 小于账户上限，但复制其内容到默认堆仍会失败；最多七份此类载体必须借用或流式读取，不能全量反序列化到堆上。旧规格 73 轮之外还有探针、负控、隔离、来源和任务钩子，不能漏算。实施已明确修订为 FUNC2：固定内核的 88 个探针及有限负控属于发布验收，每个玩家图仍执行完整的 73 轮及全部结构、供能、容量、恢复和机械判断。它使用新哈希域及新 validator 版本，不沿用旧 H16 全文 SHA 的名称和字节。

另外，完整 Transcript 的普通 SHA256 不能靠逐 phase 的 hash 链替代：二者字节语义不同。官方 SHA syscall 只接受本次完整 slices，没有供跨调用延续的增量上下文；官方 Hasher 也仅导出在宿主端。因此多 MB 转录的增量软件 SHA 必须真实测 SBF 成本，或在明确修订的链上分步验证中保存哈希内部状态。[官方 SHA 实现](https://docs.rs/solana-sha256-hasher/3.1.0/src/solana_sha256_hasher/lib.rs.html)

## 旧结算的确定成本问题

ROLLUP1/13 §8.1 的 60 个部件样本，每小时创建 60 张 497 字节 Receipt，并额外永久保留 Hour 和每次操作的 Business。实际只读查询公开主网 RPC 后发现网页缺省公式与现网返回不同，不能把网页的 `(data_len + 128) × 6960` 当生产报价。九种大小的当前返回符合 `(data_len + 128) × 5080`；下表同时保留观测值及网页缺省对照：

| 旧路径 | 每天新账户 | 每天新数据 | 主网观测锁存 SOL/天 | 网页缺省对照 SOL/天 |
| --- | ---: | ---: | ---: | ---: |
| 仅单根 Receipt，每日 24 张 | 24 | 11928 B | 0.0762 | 0.1044 |
| 60 根，仅 Receipt | 1440 | 715680 B | 4.572 | 6.264 |
| 60 根，完成结算但暂不领 | 1872 | 937200 B | 5.97822528 | 8.19063936 |
| 60 根，每小时全部领取 | 3312 | 1831440 B | 11.45731008 | 15.69741696 |

最后一行还有按官方基础费算出的至少 1848 笔单签交易的 0.00924 SOL，优先费、失败、RPC、制造、首次登记均未计。对应旧样本首纪元收益合计仅 3.42432 LAB/天。这里没有假设 LAB 价格。RPC 取数是真实只读观测，交易数量与场景成本是基于这些取数的算术推演，尚未执行该结算场景。

租存余额通常可在账户关闭时退回，但旧规则明确永久保存且不开放关闭，因此对本方案是长期占用。网页缺省公式来源于[官方账户规则](https://solana.com/docs/core/accounts)，实际观测通过 [getMinimumBalanceForRentExemption](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption)；5080 只是本次采样曲线，不能冻结为未来费率。基础费依据[官方 Fees](https://solana.com/docs/core/fees)。

证据保存在 `programs/feasibility-probe/evidence/mainnet-readonly.json` 和 `mainnet-rent-samples.json`：RPC `api.mainnet-beta.solana.com` 返回 core 4.3.2、主网 genesis `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`。v1 feature 账户为 Feature 程序所有、Option=1、激活 slot 447120000，观测 finalized slot 460906687。497 字节底额为 3175000 lamports，其余样本含 0/50/128/417/517/518/519/621 字节。没有使用私有 RPC、钱包、签名、发送或资金。

因此旧 G12 不通过，不能照搬成生产版本。实施已改为持久累计权益与按受益区间的 Position，保留每小时独立 floor，去掉每根每小时新账户及每次永久完整 Frame 的强制增长。后续 ECON4 已完成同版真实本地 SBF/签名 Bank 验收，详见本文开头链接；这不等于公网部署或独立安全审查，也没有“跨小时合并后只 floor 一次”地改变奖励。

## 完整验证超预算时的最小替代

已实际尝试并保留失败证据：真实 Rust 生物内核对 37 份固定图执行全部 73 轮，即便使用 256 KiB 堆，也超过单笔 1,400,000 CU。因此根代理已明确批准 FUNC2 + STEP 实施修订，完整功能判准不改。不是凭估计提前放弃原子运行，也不能用探针的小计算替代真实物理执行。

实施采用链上验证状态机：

1. `BEGIN` 绑定已封存 Artifact、精确图、叶映射、规则和部署 hash；建立唯一验证会话及输入不可变指纹。没有扣材料或奖励。
2. `STEP` 由链上程序按确定 cursor、阶段和测试编号执行有限工作，持久化必要状态与累积转录摘要。客户端不能提交自报 PASS，不能跳步或换输入。
3. `FINISH` 只在全部测试完成后形成程序自己算出的最终 admission；中断只能从准确 cursor 继续，失败会话不给合成权。
4. `SYNTH_FINALIZE` 重核输入 Root 的真实 owner、LIVE 状态、revision、指纹、未质押及历史收益覆盖，再一次性销毁旧输入、扣费、创建新 Root 和任务记录。两个会话消费同一输入只有一份能成功。

这保留完整链上判断，但改变旧“同笔重跑全部功能”的实现接口，必须作为明确修订，不伪装旧门禁已通过。任务资格时间取真正完整验收和制造时点，不能回填 BEGIN 时间。会话使用的所有可变外部依赖必须消除、冻结或在最终化重核。

## 可执行验收顺序

| 门禁 | 必须取得的证据 |
| --- | --- |
| FEAS-01 编译 | 精确 Rust、cargo-build-sbf、platform-tools 版本；锁文件；ELF hash；实际 SBPF 版本 |
| FEAS-02 字节 | 官方 SDK 往返真实 v1；所有签名、64 key、4096 边界；0x80/0x81 混淆及畸形拒绝 |
| FEAS-03 内核 | 同一合法/非法固定输入在独立宿主实现与真实 SBF 输出一致；q、C、正流 bitmap、所有四段终态及新 FUNC2 digest 一致；正式 H7/H16 与 Core 发布清单另外集成验收 |
| FEAS-04 预算 | CELL/ORGAN/BIO 标准及最大形状，每个 STEP 与最终制造真实 SBF 在 ≤1.4M CU 与显式堆限制下运行；集成生产入口仍保留至少 10% 余量；固定内核探针及负控在发布验收执行 |
| FEAS-05 原子 | 真正 System/Token CPI、建户、burn、签名、并发输入消费；每个失败点无部分扣料/计奖 |
| FEAS-06 结算 | 新累计版本逐小时 floor 与旧数学逐项一致；跨季、减半、零人、停机、重复请求、领款与转让恢复无重复或丢失 |
| FEAS-07 成本 | 测量新账户增长、实际租存、成功/失败交易和每小时工作；明确维护者资金来源及积压恢复吞吐 |
| FEAS-08 网络 | 本地 Bank/validator 的真实 v1 交易、预算、loaded-data、费用及回滚；之后开发网独立复现。Mollusk 单指令不能替代完整网络交易验收 |

宿主测试不提供 CU，Mollusk 的 SBF 执行可提供 CU 但不等于钱包、RPC、Bank 和交易整包通过。`simulateTransaction` 的 `unitsConsumed`/`loadedAccountsDataSize` 必须来自最后同一 message；换 blockhash 或预算需要重取证。[官方模拟接口](https://solana.com/docs/rpc/http/simulatetransaction)

## 本地工具状态与 probe

首次检查时，PATH 和常见缓存中均未找到 Rust、Cargo、rustup、Solana CLI、cargo-build-sbf 或 Anchor。已有 Node v26.0.0、npm 11.12.1、Python3、clang，平台 Darwin arm64。未读取钱包或 `.env`，未签名、广播交易或花费资金。

现已实际安装并使用：host Rust 1.99.1、cargo-build-sbf 4.2.0、官方 platform-tools v1.56（内含 Rust 1.89/LLVM20）。工具保存在项目 `.local-tools/`；官方构建工具所需 `~/.cache/solana/v1.56/platform-tools` 仅建立到隔离目录的链接，没有改 shell profile。官方压缩包 SHA256 已核对为 `57cc5b6e7690cdff66fe9aae8f54a2bc2283fa766c207ddfb2cde1c2dd415eeb`。实际 ELF 为 EM_BPF、SBPFv3。构建采用锁定依赖及 `--offline`；需要额外检查构建日志中的栈帧错误，不能仅信构建工具退出码。[官方 cargo-build-sbf 仓库](https://github.com/anza-xyz/cargo-build-sbf)

`programs/feasibility-probe` 用于先测最多七份、每份最多 214100 字节数据的 SHA syscall、借用读取和有界整数算子成本。它不验完整 Graph、不制造 Root、不接收资金、不输出功能 PASS；即使通过，也只取得对应基线证据。完整功能验收仍由真实协议内核替换后执行。

probe 已取得真实 SBPFv3/Mollusk 结果：7×214100 B 一次 SHA 为 754336 CU；同样数据逐 8 B 遍历则超出 1.4M；软件增量 SHA 仅 1024 B 就需 115446 CU，67092 B 已超限。原始 JSON 同时保存成功和失败行，测试进程通过不代表资源失败行被改为通过。证据为 `programs/feasibility-probe/evidence/probe-results.json` 和 `probe-run.log`。

## 真实生物内核的分步验证

`programs/biolab-kernel` 是独立 Rust 实现，不读取 Node 的预期得分当计算结果。它从完整规范字节解码图，核对 260 条冻结边、自由边、端口、LCA、容量归属、opens、slots，再执行真实供能、物流、控制、恢复、机械作用及品质。图验证的一次聚合优化保留每项判断；9 个宿主结构测试已过，含 37 份图往返及 440 边/7713 B 边界。

会话采用 1213 B 固定 Scratch，绑定精确图 SHA、挑战、config、validator、Direct 身份摘要、actor 和代次。STEP 不接收玩家自报状态或品质；链上按 cursor 自行执行，每段测试起态照规格重置，73 轮全部完成才产生模型报告。真实 Clock 高水位、最近一次重复幂等、旧 cursor 拒绝、actor 签名重置、代次失效及真实交易后续指令失败的 Scratch 原子回滚，均在实际 SBF 中验收。

优化后实测如下，单笔上限 1400000 CU，默认堆 32768 B：

| 输入 | 1 轮 STEP | 2 轮 STEP | 4 轮 STEP | 8 轮 STEP |
| --- | ---: | ---: | ---: | ---: |
| C320 | 849056 | 900894 | 1004580 | 1211952 |
| 合法最大 440 边图 | 990716 | 1059648 | 1197522 | 超限；256 KiB 也超限 |

选择每次最多 2 轮，不删任何轮数，完整执行共 37 次 STEP；最大图全程最贵 STEP 为 1059707 CU，73 轮后 q/C、正流位图、FUNC2 digest 和终态与独立 Node 相同。`kernel-maximum-actual.json` 记录精确值。37 份图完整对照也已全部通过，共 1369 次 STEP；q/C/正流位图/FUNC2 digest/四段全部 N、I 与机械位置逐项相等。最贵为 scope18 的 1144415 CU（18.25% 余量），比最大 full 图更高，必须计入预算。状态机原生验收共 4 项测试全过。精确 ELF、锁文件及独立预期 SHA 见 `kernel-resources.json`；另有 5 个结构合法功能负控也已真实通过拒绝验收：父 COMMON 容量、弱肌肉、缺感知增益、partial 非整数路由、完成 73 轮后最终品质不足。Rust 返回与独立 Node 相同的失败含义和精确 cursor，失败 STEP 的 Scratch 原字节不变且不能取得最终报告。对应 `kernel-negative-actual.json`；合计 6 个真实 SBF 验收测试在记录的分次运行中通过，旧全轮单笔资源失败仍保留。固定 88-probe 发布验收及正式 Core 集成另列，不冒充已通过。

FUNC2 初始化 SHA 的输入为 56 B，域 `BIO6TI02`；每轮为 2311 B，域 `BIO6TR02`，含前摘要及完整 2271 B WitnessRecord。所有字节顺序已独立在 Node 与 Rust 实现，没有把旧普通 SHA 冒充哈希链。Scratch/请求/响应精确格式见 kernel README。

以上是私有测量入口及纯内核验收：BEGIN 中调用者给出的 validator/Direct 摘要仅用于绑定测试，**不是批准来源**。正式 Core 必须从不可由玩家写的 Config 获取发布后 ELF/模型清单的批准 validatorHash，读取真实封存 Direct74 与 revision，并在最后原子消费前重新核对 owner/unused/revision。当前 Scratch 不创建材料、Root、H16 或奖励，不连接资产发行。内联 Core 后要对最终 ELF 和实际账户集合重新测 CU；这份独立内核数据不能替代 Token CPI、最终制造、v1 Bank 消息、钱包、RPC 或生产手续费验收。


另补测了完整验证的每笔成本：C320 的 BEGIN 为 419430 CU、FINAL_REPORT 为 422264 CU，37 次 STEP 后总计 33828210 CU；最大 440 边总计 39672214 CU，scope18 总计 42154707 CU。私有接口每次完整验证为 39 笔（BEGIN+37STEP+FINAL_REPORT），正式 Core 可以把最后报告与制造合并，但需重新验收。仅以当前单签基础费 5000 lamports 计算，39 笔为 0.000195 SOL；优先费、账户租存、失败及最终制造另计。这是费用算术，没有广播或实际支付。Scratch 可按 actor 代次复用，不要求每轮验证永久新建；生物验证不是每日持续奖励必须重跑的任务。真实记录见 `kernel-end-to-end-actual.json`。

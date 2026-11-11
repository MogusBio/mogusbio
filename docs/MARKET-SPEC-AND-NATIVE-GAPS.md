# 三类交易市场：最小规格与原生差距

日期：2026-10-25。状态：**设计与只读核查，未部署、未新增生产 ABI**。本文不更改四类材料、单向合成、LAB 发行或生物验证规则。

用户要求三个独立入口：`MATERIAL` 原料市场、`PRODUCT` 成品市场、`BIO` 生物市场。已有项目发售是一级发行；玩家转卖是二级交易，两者必须区分。正在补齐的本地交互市场用于体验和验收，不能据此宣布正式 Solana 市场已经完成。

**挂牌与产出的状态说明：当前 HOST 的严格挂牌锁是已测试的先行实现，不是 TapeOut 相同规则，也不是已定案的最终市场/产出体验。三个市场已可在本地测试；生产版“挂牌期间继续普通产出”尚未实现。本文第4–7节的先退出挂牌流程描述当前严格模式，不能视为用户批准“以后上架必须停产”。如采用 TapeOut 的持续产出体验，必须先补第9节列出的成交边界和收益切分规格，再推进 M0–M7。**

## 1. TapeOut 实际提供什么

本次只采用用户指定的 `tapeout.net` 官方网站、官方客户端、官方 PDF 和它公开的只读 RPC。没有把另一个域名 `tapeout.world` 的 Solana 描述并入这些结论。搜索索引仍可能显示旧版 Projects 页面，以下以本次实际下载的客户端为准。

| 项目 | 核实结果 | 一手依据与边界 |
| --- | --- | --- |
| 基础资产 | NAND/LATCH 晶体管是 ERC-1155，流片后的电路是 ERC-721 | [官方白皮书 PDF](https://tapeout.net/TapeOut-Protocol.pdf)，5页；该 PDF 没有给出现行市场的完整结算规范 |
| 原料二级市场 | 当前 `/market` 客户端使用 `placeBid / fillBid / cancelBid / withdraw`；买家挂单时付足买价×数量，卖家交付相应项目、相应类型的晶体管 | [官方市场](https://tapeout.net/market)、[实际客户端](https://tapeout.net/app/assets/index-DsAkZLRU.js)、[官方订单快照](https://tapeout.net/market.json) |
| 卖单是否已开启 | 客户端包含 Ask ABI 和双边订单文案，但本次 BSC 配置 `askMarket=null`，加载也受该开关限制；不能仅凭文案宣称卖单已开启 | 同一官方客户端中的 BSC 配置、`og()` 与 `ig()` |
| 成品二级市场 | `/circuits` 交易各项目的具体电路 NFT；`list / setPrice / delist / buy(id, expectedPrice)`；买前重读，价格改变要求重新确认 | [官方电路市场](https://tapeout.net/circuits)、同一客户端中的 `Qo / o7 / i7 / aI / lI / a7`、[官方电路快照](https://tapeout.net/circuit-market.json) |
| 电路挂牌方式 | 官方界面说明挂牌后电路仍由卖家持有；授权、所有权变化可能使挂单失效，存在 `listingView.valid / delistStale`。不是“挂牌一定已把 NFT 转进托管” | 同一官方客户端的 `sell.note / cmk.staleBuy`、`listingView` ABI 与挂牌调用 |
| 收益跟随方式 | 官方客户端提示电路交易可能把挖矿权益和未领收益交给新持有人。BioLab 的旧 Position 固定受益人规则不同，不能照搬 | 同一客户端的 `hold.xcWarnMining / cmk.minePending`；BioLab 规则见下文 |

### 合约核查的证据等级

本次实际客户端在 BNB Chain（chain id 56）配置了：

| 用途 | 官方配置地址 | 实际只读结果 |
| --- | --- | --- |
| 晶体管买单市场 | `0xA6a80C1919a8326022d7c601a488888C13aA16E4` | `eth_getCode` 返回130字节代理；EIP-1967 implementation 槽指向 `0x3ea408210e06bfc7e7db57c34dcc0d7b1f07ce9b` |
| 电路市场 | `0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f` | `eth_getCode` 返回130字节代理；implementation 槽指向 `0x725771c38361abef7b844729b978c775f7a83dfb` |

查询使用官方公开 [RPC](https://tapeout.net/rpc)，返回 chain id `0x38`；同批 `eth_blockNumber` 为 `0x7bb63b7`。这些是 `latest` 观测，不是所有请求固定在同一块的证明，也不是永久不升级的保证。只读调用没有签名或广播交易。

官方订单快照生成于 `2026-10-25T14:23:08.148Z`，包含646条 openBids。电路快照生成于 `2026-10-25T14:12:36.891Z`，包含6219条列表记录和最近3000条成交记录，地址与客户端一致。这证明官方提供相应数据入口；索引列表长度不能直接称为“当前有效挂牌数量”或完整链上交易总数。

**没有完成逐行 Solidity 审计。** BscScan 源码页本次被访问挑战阻挡，代理与实现的 Sourcify 查询未找到匹配源码。已核到官方调用 ABI、实际客户端流程、部署代理和官方索引；不能据此断言全部退款、升级权限、费率冻结和重入防护已独立验证。界面出现1%文案也不能替代实时合约读取。后续需要对上述实际 implementation 的已验证源码和具体调用做独立复核。

本次下载指纹：客户端 `sha256 c350375383f58c95c7de48a7ce047ee33fa7ba28942a31736f08cf856bfcc225`；PDF `sha256 c4d7c94d103c5ee0c79c6ead2964c6c9114d5c8cf46e50430e0629180e020f71`。官方数据随时间变化，以上不是交易报价。

## 2. BioLab 已有能力与缺项

| 能力 | 已实现的范围 | 还缺什么 |
| --- | --- | --- |
| 四类原料发行/购买 | 原生 `launchpad::create / buy`；每项目四个 Classic SPL mint，decimals=0，无冻结 authority；价格、cap、全网额度、付款、铸币原子执行 | 不等于玩家间挂牌、托管和成交 |
| 原料转账基础 | 原料是真实 Classic SPL Token；余额可通过标准 Token Program 转移；制造实际销毁 Token | 本次没有把“市场托管→成交/取消→制造”作为原生签名链完整验收。通用转账标准存在不等于市场适配器已完成 |
| 原料发现 | 按真实项目派生/核对标准 ATA；非 ATA 代币提示另列 | 二级市场商品发现、挂牌索引和成交后的交接；首版交付应进入买家规范 ATA |
| Source | Token 销毁后保存不可重复消费的剩余物种前缀 | 不是可重新卖出的原料 Token；当前没有 Source 转售协议，不纳入市场 |
| 成品持有/转让 | Root 保存所有权、revision、LIVE/已消费状态；原生 `TRANSFER_ROOT` 和 SDK 规划已实现 | Root 是协议账户，不是钱包中的 SPL NFT；不能直接接通用 NFT 市场 |
| 退出/历史覆盖 | 普通及 K 退出、实际结束边界、历史覆盖检查、消费/转让锁已有实现 | 市场挂牌锁与现有质押/合成/转让的统一互斥尚未加入生产 ABI |
| 历史收益 | Position beneficiary 不可变；旧收益不因 Root 转手丢失；不要求先全部领取才能转让 | 市场必须明确显示这条规则，不能向买家承诺卖家旧未领 LAB |
| nonce/恢复 | ActorNonce、精确 Frame 摘要、最近结果缓存、UNKNOWN 重读/原请求重试 | 这些只覆盖现有操作，不能自动赋予尚不存在的市场操作防重放能力 |
| 挂牌/付款/取消 | 本地 `BIO-HOST-MARKET1` 正在提供三个可交互市场和 HOST 账本验收 | 生产程序当前33操作不含 LIST/FILL/CANCEL；没有正式原子资产与付款交换、链上挂单账户及其原生验收 |
| 服务与前端 | 发售目录、钱包发现、成品转让和本地体验入口可复用 | 正式市场的客户端编码、权限、RPC、签名、交易结果、索引、费用及恢复均须独立补齐 |

源码依据：

- [原生入口](../programs/biolab-economy/src/lib.rs)：Actor 必须是 on-curve signer，入口要求交易顶层调用，拒绝 CPI；列出当前操作。
- [原料发行](../programs/biolab-economy/src/launchpad.rs)：`pack_mint / create / buy`；[Token 校验](../programs/biolab-economy/src/token.rs)。
- [Root](../programs/biolab-economy/src/root.rs)：`read_root`；[结算](../programs/biolab-economy/src/settlement.rs)：`assert_movable / mark_revoke / transfer`。
- [生命周期规划](../packages/client/src/player-lifecycle.mjs)：`planPlayerLifecycleAction`；[交易日志](../packages/client/src/journal.mjs)：`PendingJournal / decodeActorNonceSnapshot`。
- [发现规则](DISCOVERY-OPERATIONS.md)；[现有生命周期测试](../packages/client/test/player-lifecycle.test.mjs)。本次只读引用，未重跑全套验收。

### 必须先解决的原生结构问题

当前 `TRANSFER_ROOT` 同时要求当前 owner 本人签名、`newOwner.is_on_curve()`，且原生入口拒绝 CPI。**不能创建一个外部市场 PDA，直接把 Root 转进去，再让该 PDA 调用原转让操作卖出。** PDA 是 off-curve；旧程序也没有买家可凭挂牌授权变更 owner 的分支。

本地 HOST 市场可以用专门测试身份调用参考引擎、修改测试 Root 所有权和测试余额，这是本地模型适配器的能力。它没有证明上述生产限制已经解决。也不应为绕过限制引入托管用户资产的服务器私钥。

最小生产实现推荐在现有原生协议中新增市场操作：原料用 canonical PDA Token 托管；Root 保持 seller owner，但由协议记录并强制挂牌锁，成交时在同一原生操作内验证卖家授权、付款和变更所有权。这样不用把 Root 改成 SPL NFT，也不用开放任意 CPI。

## 3. 三个市场的资产边界

| 市场 | 可售标的 | 不接受 |
| --- | --- | --- |
| MATERIAL 原料 | 已实际铸出的 AA/NUC/LIPID/SUGAR，按项目/mint/类别精确区分，正整数份 | Source、制造后的历史摄入份数、已消费 Token、项目尚未发行额度、LAB |
| PRODUCT 成品 | 实际 LIVE 的 COMPONENT、CELL、ORGAN Root，一件一单 | 已消费祖先、Blueprint/Artifact 的文字副本、仅预测但未产出的作品、BIO |
| BIO 生物 | 实际 LIVE 的完整 BIO Root，一件一单 | CELL/ORGAN 改名、未完成生物、未来生态世界资产 |

分类必须由服务端和链上实际资产导出，忽略浏览器自报 category。HOST 的规范 `root.scope` 可归一化；**原生 Root 的 body byte184 只有1=部件、2=复合，不能单独用它识别生物。** 必须先完整验证 schema/descriptor/target：schema1→COMPONENT；schema2且target1..15→CELL；schema3且target16..21→ORGAN；schema4且规范target22→BIO。PRODUCT/BIO 是市场展示分类，不是新增生物学参数。

两个不同项目的 AA 可以同属固定 AA 类别，但其 mint、发行来源、价格必须保留。不能把 A 项目的存量变成 B 项目的存量，不能跨 mint 填单。市场交易不会改 cap、issued、季额、制造预算或 LAB 权重。

## 4. 当前严格模式的最小交易提案

以下是严格模式的待实现提案；没有回填到现有冻结 ABI，挂牌期间的最终产出体验仍需按第9节收敛。市场采用 SOL 标价、一口价整单成交；没有自动做市、杠杆、竞价、拆单撮合或交易挖矿。原料每单是一组同 mint 的整数份，成品每单一件。需要少卖可取消后重新挂单。

1. **卖家定价。** 使用正整数 lamports；浏览器可提供快捷报价但必须显示最终 SOL。买家明确确认实际单价/数量/总价。HOST 固定测试报价不约束正式价格。
2. **初版不新增成交税或版税。** 建议市场协议手续费0；现有制造费、LAB合成销毁及网络费照常。这是新市场最小提案，不是已经冻结的经济变更；若未来收费，须另冻结费率、收款账户、舍入和上限后验收。
3. **挂牌不增发。** MATERIAL 从卖家规范 Token 账户转入该单托管 ATA；卖家剩余余额才可制造。当前 HOST 先行模式下，PRODUCT/BIO 需实际 owner、LIVE、正确 revision、证书有效、普通/K已退出且到达物理结束边界、历史覆盖完整，然后锁定。这是本地实现现状，不是最终“不可边挖边售”的固定原则。
4. **当前严格模式的挂牌锁覆盖全部入口。** 同一 Root 同时最多一条 OPEN 挂单；该模式下 STAKE、SYNTH消费、TRANSFER、重复挂牌和其他会改变所有权/生命周期的路径均核对 canonical lock。只在网页禁按钮不算完成。允许挂牌持续产出的正式模式需要区分产出登记与资产转让/消费锁，不能直接照此禁用全部操作。
5. **成交原子交付。** 买家授权精确 listing/revision/价格；程序重读状态、正确 mint/Root、托管或锁、收款地址、实际余额、Clock、费用/rent上限。SOL付款、原料/Root交付、锁释放、挂单SOLD、nonce/result一起成功或一起回滚。网络已收交易费不属于业务回滚。
6. **取消只退原物。** 仅原卖家可取消 OPEN 挂单；原料原数量退原卖家规范 ATA，Root 解锁，状态 CANCELLED。不得重新铸原料、恢复季额、恢复已烧制造材料、退款 LAB合成费或删除历史 Position。
7. **状态终态。** `OPEN→SOLD` 或 `OPEN→CANCELLED`；终态不可回 OPEN，不可再次付款/交付。改价最小实现为取消后新单，减少多套价格竞态；旧 listingId 永远不复用。首版无自动到期，避免引入定时退款服务。
8. **同账号不可自买。** buyer≠seller；这不能证明两个钱包属于不同人。换号互买只移动原资产与SOL、支付网络费，不给原料、LAB、首创资格、销量补贴或榜单奖金，故不会凭交易制造协议价值。

### 精确记录与权限

新 `MarketListingV1` 记录最少包含：发布 domain/config、不可复用 listingId、seller、创建请求 businessKey、assetKind、派生 category、project/mint/class/quantity 或 rootInstance/rootRevision/规范 scope、SOL总价、listingRevision、OPEN/SOLD/CANCELLED、创建时间/slot、成交buyer及关闭时间/slot。非该资产分支字段禁止出现；数量/价格是有界整数，JSON使用规范十进制字符串。

挂牌 seller 签名；成交 buyer 签名；取消 seller 签名。每次使用该 Actor 当前原生 nonce，绑定同一发布身份、精确请求字段和所有账户。市场后台、目录管理员和 Ops3/5均不能替用户修改价格、卖出或取走托管资产。收款人必须由 listing.seller 导出，不能由成交请求自由提供。

MATERIAL 托管由该单 canonical PDA控制。Token Program、mint、托管ATA、卖方/买方ATA、authority、账户状态、委托/关闭权限、租存及余额全部实读校验；不能接受任意“长得像原料”的 Token。ROOT锁必须由 canonical instance派生，fill在内部引用现有 `assert_movable/mark_revoke` 等效规则，不宽松重写历史收益条件。

账户租存单独报价。永久终态收据应使用小记录或既有耐久归档策略，不能按小时新增市场收据。若未来关闭挂单账户退租，必须先定义不能重建旧 listingId 的链上终态/单调序号及归档规则；没有该防重放方案前不得仅依靠前端缓存销毁终态证据。

### 历史收益与当前严格模式下的买入后产出

- 卖家旧 Position 的 beneficiary 不变；未领 LAB仍归原受益人，随时可按原 Position领取。取消/成交不能改历史 accrued、paid 或 beneficiary。
- 买家获得实际 Root及其已核验品质/材料基数；购买本身不复制权重，也不自动质押。买家明确登记后，按现有开始边界产生新 Position和未来普通权重。
- 卖家 K已结束才能出售；Winner/作者身份和过往首创奖金不随商品买卖改写。复制、挂牌和购买不产生新首创。未来激活仍执行现有资格规则，市场不能承诺“买下旧Winner就立即拿K”。
- 界面展示冻结规则下的真实权重及当前估算，不能把历史某天 LAB产量写成保证日收益；卖家历史未领 LAB不计入商品价内资产。

## 5. 玩家点选流程

**购买：** 三市场选择→按真实类别看到商品→点商品→核对数量、SOL总价、品质、当前退出/可交付状态及历史收益归属→准备交易→模拟→钱包明确签名→查询最终结果→进入“我的资产”。原料自动带真实 project/mint进入库存重读；Root自动带 instance进入资产页，可继续制造/合成/登记。

**出售：** 我的可售资产→点“出售”→材料点数量、成品点具体作品→输入一次价格或选择明确报价→确认托管/锁定与租存→签名→我的挂单。取消/成交都根据该条真实listing操作，不再手填ID。仍在质押的作品展示“先退出并完成覆盖”，不得静默退押或自动领取。

导航交接只填已核验身份和ID，不自动交易；页面必须选到正确资产页签。刷新、断网、切钱包后重新核实该 Actor/发布身份及账户状态，不把迟到响应恢复成可交易。列表未读成功要显示失败或覆盖不足，不能显示成“市场没有商品”。

## 6. 必须逐层完成的生产模块

| 依赖顺序 | 模块 | 必须产出的可验收结果 |
| --- | --- | --- |
| M0 | 新市场规则/编码 | 先确定挂牌期间能否继续产出及第9节成交边界，再冻结账户、payload、账户清单、错误码、租存/费用口径和权限；独立 ABI/发布身份，保留旧33操作证据 |
| M1 | 原料挂牌托管 | 真正 Classic Token CPI、正确项目/mint/class、整数数量、规范ATA、单单托管；原料守恒 |
| M2 | Root挂牌锁与产出关系 | 实际Root完整解码和分类；按最终模式区分禁止转让/消费与允许持续产出；当前先行严格模式仍要求退出/覆盖、禁止挂牌后登记 |
| M3 | 原生成交/取消 | SOL与资产原子交换；终态单次；取消退原物；重复/并发/失败回滚及nonce缓存恢复 |
| M4 | SDK/桥接/认证 | 固定请求DTO/账户推导、实际finalized重读、精确intent、模拟/签名/result、跨会话隔离和UNKNOWN恢复 |
| M5 | 发现/前端 | 三市场、筛选/分页/我的挂单、真实商品状态、成交资产自动发现、原页交接与失效；原料一级发行仍单独标明 |
| M6 | 真正签名Bank链验收 | 同配置买料→挂牌→购买/取消→制造/合成→登记/退出/覆盖→转卖→新主人登记，逐笔资金/材料/Root/旧债/nonce对账 |
| M7 | 真实环境验收 | 目标链部署身份、真实RPC/钱包能力与finality、CU/包尺寸/租存/网络费、服务/索引恢复和多用户负载；未执行前不宣称已上线 |

新的Root锁会改变原生账户依赖和入口条件，因此M2不是只加一个网页即可完成。旧ELF/ABI、HOST市场测试和新市场候选的证据必须分别标识，不能复用旧发布hash声称它包含新操作。

## 7. 最小验收矩阵与守恒

| 场景 | 必须结果 |
| --- | --- |
| 10份AA挂5份 | seller可用减少5，escrow增加5；总supply、issued、季额不变；不能再用托管5份制造 |
| 买家成交 | escrow减少5、buyer规范ATA增加5、卖家收到该单SOL；各资产分支完全一致；只能消费该单一次 |
| 取消/重复取消 | 首次原物退回且无成交款；再次拒绝或精确重试返回同结果，不能再次退物 |
| 最后一个商品两人抢 | 可写账户锁+状态/revision只允许一人成功；失败方无业务付款/交付，网络费按链实际规则 |
| 成交与取消并发 | 只能一个终态；不存在一方收到钱又取回商品 |
| 伪造category/mint/owner/amount | 原始资产与listing派生校验拒绝，不能把CELL当BIO或跨项目交付 |
| 当前严格模式挂牌后质押/合成/转让 | 各入口拒绝；如改为持续产出模式，另验挂牌继续产出、单次计权、成交边界切分和取消不改变产出，不能把本行沿用为最终体验 |
| 旧受益人未领 | 挂牌和成交不抹旧债；旧人领取准确，新人不能领旧债；新人登记只生成新开始边界权益 |
| 改价/旧quote/重复领取 | 旧listing已取消或revision不符就拒绝；旧Position既有paid CAS与nonce防重仍有效 |
| 新钱包/自买自卖 | 不增加Token、LAB、首创或未来重复权重；统计不得作为奖励发行依据 |
| 停机跨退出边界 | 重读实际Clock、RootReg和历史覆盖；没覆盖完继续等待，不伪造可售状态 |
| 提交超时/重启 | UNKNOWN不当失败重建新订单；先按原Actor nonce/Frame/result与真实listing重读，精确重试只得原效果一次 |
| 任意一步CPI/费用失败 | SOL业务款、Token、Root、lock、listing、nonce原子回滚；外部网络已收费用单独记录 |

全局不变量：`原料Token supply = 各实际Token账户余额总和`；各单托管总额与OPEN订单义务一致；`SOL业务付款 = 卖家收入 + 已定义协议费`；同一LIVE Root最多一条OPEN单、一个当前owner；已消费祖先不可回到LIVE。市场不写LAB发行曲线、不改合成材料预算、不增加任何奖励凭证。

## 8. 本地体验市场的明确界线

[HOST适配器](../apps/playtest/market.mjs)和[测试市场界面](../apps/player/dist/test-market.js)采用 `BIO-HOST-MARKET1`、`testOnly:true`、`nativeExecutionVerified:false`。它可以演示真实参考账本中的余额/成品移动、托管占用、取消、模拟对手成交和三类点选入口。

固定测试价格、测试SOL、测试交易对手、HOST可控托管身份、进程内事务和直接测试账本修改，均不是公网钱包授权、原生CPI、链上市场托管、真实SOL成交或链上finality证明。测试模式不得在正式origin启用，不得索取真实钱包私钥，不得将测试成交/销量计入正式市场。

完成本地交互与HOST验收后，可以说“本地三个市场可测试”；只有M0–M6完成且证据绑定实际新程序后，可以说“原生市场已在本地链验收”；真实环境条件与用户允许上线后，才能称为正式上线市场。

## 9. TapeOut 挂牌、开挖与收益的追加核查

追加核查使用同一 [官方客户端](https://tapeout.net/app/assets/index-DsAkZLRU.js)、[官方电路市场](https://tapeout.net/circuits)、[官方电路索引](https://tapeout.net/circuit-market.json)和 [官方 RPC](https://tapeout.net/rpc)。没有签名或发送交易。固定读取 BNB block `0x7bb68c3`（129722563），避免把不同时间的“挂牌”与“开挖”拼成同一状态。

### 已直接确认

| 问题 | 结果 | 证据等级 |
| --- | --- | --- |
| 做出电路是否自动开挖 | 官方流程区分制作与 `arm / start`；普通开挖调用直接 `start`，验证池先 `arm` 再 `start` | 实际客户端 `Pz`；没有把产出NFT等同于已ACTIVE |
| 开挖是否必须把NFT托管给矿池 | 至少已核样本不需要：`getMiner.status=ACTIVE` 时 `ownerOf` 仍为卖家普通地址，不是 mining/market 合约 | 同块实际 `eth_call`，见样本；不能泛化为所有桥接/租赁产品也没有托管 |
| 正在开挖能否有效挂牌 | **可以；当前 TapeOut 不是一律先停挖才能挂牌** | 同块 `listingView.valid=true`、`ownerOf=seller`、`getMiner.status=1`，三个独立样本满足 |
| 上架时客户端是否先停挖 | 当前电路挂牌流程只做必要 `approve` 再 `list`，没有调用 `stop` | 实际客户端 `o7`；并有上述链上共存事实交叉核对 |
| 挂牌中能否看到未领收益 | 可以，三样本 `pending` 均为正；挂牌与ACTIVE/未领余额共存 | 实际 `pending(bytes32)`；单时点正余额不能单独证明每秒增长速率 |
| 卖家挂牌后能否领取或停挖 | 当前样本 `claim`、`stop` 只读模拟均成功；官方页面也明确提示卖家成交前可领取/停挖 | `eth_call` 非持久模拟＋实际客户端；没有执行成功收据，不能把模拟称真实领取 |
| 下架页面是否主动停挖 | `aI` 仅发送 `delist(id)`，未附带 `stop`；样本卖家 `delist` 模拟成功 | 客户端与只读模拟；未取得实现源码/执行轨迹，**不将此夸大为所有内部状态不变的逐行证明** |

代表样本如下。三个样本的 market 为 `0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f`，mining 为 `0x7E2E0DC66a3bD9103E69b766afA62d9f7b697b46`，电路合约为 `0xb1024b89886B9a34Aa4ff5F31C411D708b20a14C`：

| listing / 电路ID | 同块 seller = ownerOf | listing.valid | miner.status / verifWeight | pending最小单位 |
| --- | --- | --- | --- | --- |
| 26475 / 3341 | `0x6f5306d25d5c0416d540e89529b8ba4620edef19` | true | 1（ACTIVE）/114 | 15,494,932 |
| 26472 / 17757 | `0xc1c59c6ec5d37ef390282cbf2ae2908df3dbdf98` | true | 1（ACTIVE）/171 | 41,099,682 |
| 26434 / 5859 | `0x236cd3db696d2e69046c220e1c18717024c55bd2` | true | 1（ACTIVE）/2 | 602,689 |

样本3341的 `minerKey` 为 `0x0f03257a78a04765dd2bc7cab77bed97517e426a384384e25da6f1e4d44b1f2c`。客户端按 `keccak256(abi.encodePacked(circuits, circuitId))` 构造 key；`Qr` 明确映射 `NONE=0 / ACTIVE=1 / REVOKED=2 / COOLING=3`。同块从官方索引挑选的前48条可挖挂牌，其 `getMiner` 均为ACTIVE；上表三条另外重读了实际有效挂单与owner，没有把索引自报valid当最终结论。

### 还不能声称已独立验证的部分

官方客户端在 `cmk.yieldActive / cmk.minePending / hold.xcWarnMining` 告知：活跃电路售出后产出与未领BEM跟随新持有人；`cmk.minePendingBuyer` 又提示卖家成交前可先领走。挂牌UI也读取实际挖矿状态与未领数额，不能把未领BEM承诺为受挂牌保护的买入资产。

但本次没有执行买卖，没有获得 `buy` 的内部调用轨迹或实现 Solidity 源码；`claim` 只读模拟无持久日志。故**“自动迁移未领BEM和未来权益的全部条件”“buy是否内部调用挖矿结算”“delist对挖矿所有字段完全无影响”仍未完成独立合约验证**。实际观察支持“有效挂牌与ACTIVE共存”，不支持宣称完整市场合约已审计无漏洞。固定块 mining implementation 槽返回 `0xa3dbe873da37cd4e4a13c7cef23a7db6ca60f898`，后续源码核查必须绑定该实现。

### BioLab 如果采用挂牌持续产出的体验

这会改变当前先行模式，先补交易语义再编码，不可仅删掉按钮禁用或绕过 `assert_movable / TRANSFER_ROOT`。至少须冻结：

1. **挂牌不停止当前普通产出**；禁止重复出售、消费或场外转走商品，与允许现有产出继续要分开校验。挂牌后新增登记、停挖、领款、首创K操作分别定义允许条件。
2. **成交同一小时只计一次。** 明确是当前小时仍归旧Position、下一边界归新Position，还是另有合法切分。实际owner立即转移、旧Position结束、新Position开始及事件顺序必须原子协调；不能让卖家和买家同一份作品同时计完整权重。
3. **历史未领LAB仍归旧受益人。** 这是BioLab既有固定beneficiary规则，和TapeOut客户端描述的未领BEM随电路模式不同。不能用市场订单改旧Position的beneficiary/accrued/paid，也不能让买家把旧债再次领走。
4. **自动退出/登记需要真正新操作。** 若希望成交后不断产，需对卖家旧段关闭、新人未来段登记、费用/rent、nonce、结算尚未覆盖时的行为和恢复统一定义，不能伪装成既有单独transfer已经支持。
5. **取消只撤市场状态。** 在持续产出模式下取消不应顺带停挖或重复登记；`buy`与取消/停挖/领款/小时结算并发必须互斥或按明确顺序成功。首创作者/K与普通产出分开定义，不能出售时重发首创。

这些是待补的生产规格，不是已实现行为；冻结生物验证和LAB经济参数保持不变。

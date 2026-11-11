# A3 跨层合成：编码前依赖和验收规格

日期：2026-10-25。状态：**本地实现与验收完成**。模块包含真实输入、Artifact/旧会话读取、公开冻结清单、实际下一步、完整FINAL预检与第八页。A3阶段全量Node回归682/682通过；同版23,653笔签名Bank重放另保存原始80/156字节回执与实际前后账户。普通合成与精确旧请求确认分别核验，真实钱包/公网验收仍留在A7。详见 `evidence/synthesis-a3-final-acceptance-20261025.json`。

## 不变量

沿用四类固定原料、单向制造/合成、一亿LAB及既有费用和权重。上层合成消费真实直接子Root，继承原始Artifact与不可变叶胶囊，不再次扣其底层原料。旧Root停止未来计权，旧Position的已赚未领权益保留给原受益人；不要求先领光旧债才可合成。

普通合成不能套用A2固定制造nonce窗口：702载荷不含最终nonce，验证STEP数量可变且可由别人推进，输出ID到实际FINAL nonce才确定。持久化应固定设计与真实输入快照，每次根据实际状态生成当前一步；不能假定37次STEP已经涵盖全部来源验证和73轮物理实验。

## A3.1 真实输入与预检

- [x] 只接受固定发布、ReadOnlyRpc、Actor、目标和最多6个唯一直接实例ID，读取Base/Econ/Clock/ActorNonce/Actor、Root和RootReg。
- [x] 上层输入从真实Root尾部取原始702 Artifact ID，扩展有界读取后整批重读。对外单独提供summary，不接受浏览器胶囊、余额、PASS或游标。
- [x] CELL消费四个primitive1/2/3/4，primitive4的profile等于角色；ORGAN消费members(target)对应CELL；BIO消费ORGAN16至21。
- [x] 重用planSynthesisPayload、原始Artifact绑定和assertChildUnchanged，核所有权、LIVE、revision、指纹、准确历史叶胶囊。
- [x] 实际RootReg需certificateFault=false；普通与K区间均已结束且当前边界达到end；coverageSequence=ordinaryCount、nextCoverageHour=u64MAX。只有真实缺失/空System PDA可当作未注册。
- [x] 展示退出、等待边界、个人历史补账与未领债权的区别。A4已提供完整K退出；合成仍核真实结束及覆盖，未知K不能当作无K。

## A3.2 Artifact与实际验证状态

- [x] kind702读取器支持251字节前缀后的partial/full/unsealed/sealed状态，核owner/header/domain/config/PDA、长度、SHA、实际written/sequence和冻结载荷前缀。
- [x] 复用decodeNativeSynthesisVerification，从真实kind37/schema3账户重新取得WeakSet品牌，不从持久JSON恢复所谓可信游标。
- [x] 公布现有generation/phase/workSequence/progress/physicsRound/used/hash/quality/task/cost，并补直接/叶/来源SHA、数量、B和retired；字段取原生精确位置。
- [x] 新BEGIN必须读取原会话generation。原生还接受schema4蓝图、schema5历史回放；未支持其严格读取时明确阻塞，不默认generation0。

## A3.3 固定清单与当前一步

- [x] 清单冻结release/ABI/domain/config/Actor、完整702 bytes、Artifact与graph SHA、target/challenge、真实输入revision/fingerprint、父Artifact、上传/验证租存上限、maxFee和资源预算。
- [x] 恢复从冻结702 bytes严格重建计划，不在FINAL后重新选择已消费子Root，也不要求成功历史的子Root重新LIVE。
- [x] partial按实际written和sequence规划PUT；full/unsealed规划SEAL；sealed读取实际旧generation后BEGIN；当前V4未完成规划精确下一STEP；phase6且round73进入FINAL预检。
- [x] phase0至4是继承/胶囊/重叠/哈希工作；phase5才是73轮物理验证，每次最多2轮，最后1轮。接受第三方真实推进，不要求每STEP都存在作者日志。
- [x] 当前Actor有待处理请求时先恢复原请求；别人推进验证不代表本账户旧nonce已经解决。每次最多一个unsigned intent，页面只明确交接现有交易控制台。
- [x] 保存公开清单不保密也不预留nonce；COMMIT首创支路留在A4独立完成，不在公开上传后声称仍保密。

## A3.4 FINAL、实际输出与页面

- [x] FINAL前重读子Root/RootReg/原始Artifact、完整V4、Clock/Task/Round/Disclosure，以及实际LAB Mint、Actor LAB账户、Reserve、Treasury和新Root PDA。
- [x] q2 BIO即使普通模式也可能登记Knowledge并影响旧K；按真实KSlot引用补Activation、RootReg、普通Position、Root、Registry及必要stopEvent，不能省略未知依赖。
- [x] 复用planSynthesisRegistration和planSynthesisFinalization；真实LAB余额需足额，未来收益或未领取债权不能抵制造费用。
- [x] CELL费0.8LAB；六器官分别3.2/4.8/6.4/3.2/3.2/3.2LAB；BIO费12LAB。按实际基数核算，不将器官平均费用当统一价。
- [x] 严格解码156字节FINAL结果、80字节BEGIN/STEP结果并与原Frame/冻结载荷/真实状态关联。长度再次按原生构造器核验，不能只信元数据。
- [x] 成功后核实际输出Root、冻结Artifact、V4.used及所有直接子Root的parent/consumedBusiness/revision/时间；返回前最终一致性重读。
- [x] 实际输出存在和原请求精确确认分别展示。未知旧回执不补造，部分上传、封存和本地PASS不冒充成品。
- [x] 页面提供设计与真实输入选择、费用/覆盖阻塞、逐步进度和实际成品质押交接；不自动连接钱包、签名、发送或领取。

建议桥接入口为synthesis-inputs、synthesis-plan、synthesis-next。设计可以采用规范graphHex；现工作台用零domain/config，必须显式绑定服务端固定发布上下文并复验，不能复用零上下文校验后直接发送。

## 验收出口

- [x] 部件→CELL→ORGAN→BIO逐层对账实际输入、费用、品质、权重和输出；普通路径先通过。
- [x] 重复输入、非法连接、改名、改子图、并发消费/转让、部分上传后其他nonce操作、第三方STEP、重启和失败FINAL均不产生额外成品或权重。
- [x] 缺LAB、开放区间、历史覆盖未完成、未知Task/K/旧会话及变化后的依赖均拒绝旧草案。
- [x] 本地实际原生执行、记录适配测试、恶意宿主变体和实际浏览器QA分别记录；真实网络/钱包、持续负载和独立安全审计仍按A6至A11验收。

复用来源：packages/client/src/synthesis-workflow.mjs、player-assets.mjs、economy-accounts.mjs；原生verification.rs、settlement.rs和component.rs。当前逐项出口已在对应模块、测试与验收摘要登记；后续修改需复验受影响路径。

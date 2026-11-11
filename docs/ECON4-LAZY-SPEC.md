# ECON4-R1: 冻结小时与按成品计债分开

状态：实现前交叉检查、同76b完整BIO原生冷链/签名Bank和明确历史14profile真实Winner/K交错计债验收均已通过；正式部署与独立安全审查仍未执行。此修复不改变四类原料、单向合成、质押资格、小时预算、
分母下限、普通/K权重、逐根逐小时一次向下取整、历史受益人或一亿LAB总量。

## 必须解决的问题

ECON3的nextHour仅在该小时所有活跃Root计债完毕后前进；END事件也要求该Position
已经计到end。合法的大量独立低阶成品能使其他玩家的时间推进、退出和合成一起等待。
冷链成功只证明小集合正确，不能证明全寿命额度下的全网liveness。

## 最小新增接口

新增`ADVANCE_FROZEN_HOUR`，建议native29 /1102/4/schema2。载荷16字节
`hour:u64LE,maxRent:u64LE`；结果16字节`hour,nextHour`。公共prefix8后仅Registry[W]、
Hour[W]；无额外钱包、Token CPI、制造、发币或费用机制。

Hour升级kind18/schema4，原body361字节不改偏移，追加`lazy:u8`于361，精确body362/
record482。旧schema3/481只能明确按原顺序路径读取/完成；不能ADVANCE旧记录、扩展旧账户
或给旧记录重贴schema4。新OPEN一律创建schema4。
新OPEN仍完整验证实际有序Event前沿，冻结activeCount、普通/K合计、唯一K身份、
分母与预算，并记录原开小时者。默认lazy=0；既有逐根顺序模式保留。

ADVANCE要求：实际当前Registry.nextHour==hour，实际已完成该小时，真实已OPEN的
Hour处于READY/PARTIAL且lazy=0，全部原Header/域/PDA/预算/计数关系合法。设置lazy=1，
把后续不再使用的legacy traversal next/previous字段规范置MAX，Registry.nextHour=hour+1。
不挪动任何U/Pending/Debt/V/Paid，不把未计的债封存。最新相同nonce仍幂等，竞争新nonce
按同一实际nextHour CAS失败；后续指令失败整笔回滚。

## 冻结后计债

原MATERIALIZE载荷和返回长度不变。lazy=0仍按当前小时的原有顺序路径执行。
lazy=1允许hour<Registry.nextHour，调用者可提交任意一项该小时实际合法Position：

- 必须是原生创建的真实Directory、RootReg和Position，Header/PDA/原Root/序号一致。
- Position的实际start<=hour<end；不能依据Directory**现在**是否活跃来否定其历史资格。
- Position.nextUnsettled必须精确等于hour；RootReg.coverage与其真实序号一致。
  新注册的start基于实际Clock的未来小时，所以不能加入已经完成/冻结的旧小时。
- 不检查已变动的当前链表prev/next或要求该项等于legacy next；不扫描别人作品。
- `amount=floor(hourBudget*(positionWeight+sameRootValidK)/frozenDenominator)`仍只算一次。
  更新该Position和其RootReg覆盖；Pending→Debt恰好amount。
- Hour的processed计数/CAS和累计已分配额照常增加；Position单调游标禁止同项重复贡献
  processed。活动区间不重叠，因此同Root不能用多个Position充数。
- processed达到冻结activeCount时，才将精确budget−已分配额的残余Pending→V并FINAL。
  lazy模式不依赖已经改变的原链表尾；不能提前封存别人的未计收益。
- 计完旧小时不能把Registry.nextHour退回hour+1；仅原顺序当前小时模式负责其原有推进。

## END、转让和上层合成

应用真实ORD_END只验证真实不可改的end、事件身份与当前活跃成员关系，移除
`Position.nextUnsettled==end`的全局依赖。END只改变未来小时的缓存分母，不抹除旧Position。
退出或其他人的未来小时不等待该Position先计债。

原Root转让/投入合成仍要求其**自己的**已结束区间计债覆盖完整。再次注册保留既有
ECON3的非重叠区间排队语义：实际前一区间已经END且时间到达才可创建后一区间，
RootReg.coverageSeq继续指最早未结区间；后一区间不能越过旧区间先计债。不是新增
“必须先计完才能再注册”的资格门。原已计未领Debt保持原受益人；不会继承到新成品。
玩家可先补自己所需输入的历史覆盖，无需补所有其他活跃Root。

## 空闲、回收租存与守恒

EMPTY_SKIP仅证明当前frontier后的半开区间为空并封存该区间精确prefix差；更早lazy
Hour的Pending仍保留，未来可以计债。CLOSE仍仅允许FINAL、真实全部覆盖且守恒的小时，
归还原开小时者的SOL租存。未计旧Hour不能关闭，也没有收益过期或材料回收。

从未有Root注册时，首次STAKE的cold空闲补齐同样只能封存当前frontier之后的确定空范围。
它仍要求Debt=0，但允许Pending大于该新范围预算；差额可能属于更早已ADVANCE、尚未
FINAL的空lazy Hour，必须保留。不能因这些旧空Hour未处理而拒绝第一位真实玩家。

`N=Unreleased+Pending+Debt+V+Paid`守恒不变；实际Reserve=尚未领取池与封存余额，
制造销毁只来自实际玩家LAB。新接口本身不能领取、转账或增加供应。

## 必过验收

1. 相同真实Interval/Hour数据，旧顺序全结与任意乱序lazy结算逐Position所得、残余、
   历史受益人完全一致；同根K仍单floor。
2. A、B同活跃；A不计债；冻结h并推进h+1，B正常补自己的h，END仍可应用并冻结后续
   小时；B退出后只补B覆盖即可制造/转让，A的旧收益不丢。
3. 先处理部分顺序前缀再ADVANCE，其余乱序处理；已处理项不能再次计数。新Position、
   假目录/序号、错权重、双Position同小时、越时、未OPEN或未成熟小时均拒绝。
4. END后保留旧Pending，当前active=0时EMPTY_SKIP，随后仍能计旧债和实际领取。
5. 不同钱包竞争同Hour游标、重复计债、重复领取、ADVANCE重放、后序失败与停机恢复。
6. 保留原完整冷链结果；新lazy实际SBF/Bank路径独立验收，准确绑定新ELF/ABI/Hour schema。
   不能把a56a旧逐根链通过冒作本修复通过。

容量边界：按需计算每位持有人自身历史仍有真实计算/交易成本；全网推进不再放大为
每小时必须先写全部Root。事件处理与每次实际登记/退出仍线性相关，不能承诺公链
在任意外部拥堵下立即执行。运营金库不能被假定承担无上限代付。

## 本次实际验收记录

- 新独立ELF：`76b35cfb902775b4dc4cd6e94040a9fa70aefdc68448006c5eaafbf724ccc58e`，
  `programs/biolab-economy/target/econ4r1-production-deploy/biolab_economy.so`。
  这是明确local-public-fixture mode0，不能部署为正式生产身份。
- 当前ABI：`8f48f9ea410c5edaec52910b80508a955a5c04ddf30ebf6122ccffd4f8d1c87a`。
  旧4502字节已经完整归档；原a56完整23312笔冷链/Bank报告不覆盖、不改标签。
- 同新ELF通过7项lazy、16项ordinary回归、4项EMPTY_SKIP、2项SDK→SBF及2项真实Loader/P0门禁。
  实际资金跨模块回归仍是4部件赚808520、烧800000造CELL、消费后旧部件债8520照领。
- 新增正向模块冷trace与官方Kit8签名v1 Bank均实际执行40笔：2真F1、3次ADVANCE，
  A完全不结时B继续计债、真实END和EMPTY_SKIP照常推进，A后补旧债；各7134atoms，
  合计14268，frontier10、Pending/Debt均0；全结才退原Hour1租存。
  最大1695B/669023CU。这是模块冷链，不能冒作完整BIO冷链。
- 精确日志/hash：`programs/biolab-economy/evidence/econ4r1-native-acceptance.json`；
  Bank报告：`programs/transaction-transport/evidence/econ4-lazy-bank-76b35cfb.json`。
  生物数学FUNC2R2的14文件冻结检查继续通过。
- 同76b实际完整冷链595.01秒、签名Bank391.77秒通过：23653笔、341次ADVANCE，全部小时成员逆序计债；
  60部件→15细胞→6器官→BIO，81输入Consumed，实际赚48083160atoms、烧48000000、BIO两小时941780，最终1024940。
  Bank最大1695B/1202315CU；14个数学文件和28个native源码hash均无漂移。根的另一实现独立核对1081个终态账户及全部23653条SDK/frame/meta。
- 真正Winner/K的lazy分支用独立historical14开场320验证（ELF78cf07c2），不能冒当前16已知种子/开场316的首创资格。
  真C318制造后获Winner、K433..435；另真制造F1参与，两份相同实际ledger分别顺序计债与跨成员/小时交错lazy计债。
  先FINAL空Hour435，再F1的433/434，再BIO433/434，终态Position/RootReg/Treasury/Mint/Reserve逐字节相同；
  BIO强跳自身433直接领434被拒。同根H+K每小时856164，错误拆开floor会856163；额外F1每小时2378，整小时合计858542。
  历史Winner及旧债在随后实际K故障重验/停止后仍保留，没有奖励铸币。
- 完整scope/日志/hash：`programs/biolab-economy/evidence/econ4r1-integrated-acceptance.json`；
  完整Bank：`programs/transaction-transport/evidence/full-lifecycle-bank-76b35cfb.json`。
  同76b还完成正式Ops4、P5七项/合成两项、开场两项/Safety三项、实际BIO故障续验一项及最大输入/容量/挑战边界。
  13项旧测试只属于旧裸BURN/BOOT兼Ops/Clock0夹具，明确不计入正式profile通过数。
- 同76b又完成两项定点真实Bank续验，不重置/预填债务：真实BIO再赚470890后，先真实转出并关闭旧LAB ATA，
  `ATA CreateIdempotent→CLAIM`在index1成功，CLAIM错或之后第三条指令失败均原子恢复ATA/债务/nonce/Reserve。
  两个独立实际原账分支还验证同actor/nonce的原请求与显式SYNC恢复两份不同H4，仅先到者推进一次，cache准确记录赢家。
  最终聚合：`programs/biolab-economy/evidence/econ4r1-integrated-acceptance-final.json`；native业务源及76b ELF均未变。

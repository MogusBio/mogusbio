# P6.1 图值、真实叶绑定和结构报告的精确编码

2026年10月24日，P6-STRUCTURE1。本文固定Graph、Binding和Report三种内部只读值的全部字段、端点、排序、大小及本地原因码。结构目录和判据见[02](02-ports-capacity-and-closure.md)，真实账户/父链/权限见[03](03-integration-and-authority.md)。本轮只有文档，没有实现、编码器、模拟器、测试程序、钱包签名、链上写入或部署。

P6.1不设601公开入口、链上opcode、BIO kind、PDA、Business、费用、独立证书或可交易PASS。三种值不是P0 ExactFrame，也不是P4 codec；后续P7/P8正式封装及Root存储另定。四类原料直接制造、合成单向，不增加开包、拆解或回收。

## 1 字节、身份与三种独立值

整数固定宽度LE，无padding、隐式默认、浮点、字符串、公钥展示文本、任意函数blob或尾随字段。本文计数明确使用u8/u16，**不是P0通用Vec的u32前缀**；不能由SDK自动选另一种编码。解码先检查长度、计数和联合界，再遍历；未知schema、标签、非零reserved或任何长度不符均拒绝。

| 值 | magic8 ASCII / hex | 字段头 |
| --- | --- | --- |
| Graph | BIOP6G01 / `42494f5036473031` | magic8、schema:u16=1、target_scope:u8、reserved:u8=0、body_len:u32 |
| Binding | BIOP6B01 / `42494f5036423031` | 同样16字节头，magic不同 |
| Report | BIOP6R01 / `42494f5036523031` | 同样16字节头，magic不同 |

各头偏移：magic@0、schema@8、target_scope@10、reserved@11、body_len@12、body@16。各body须恰好耗尽；长度不包含16字节头。schema1只开放本文字段，不接受未知字段扩展。

`graph_exact_sha`是完整Graph头及body原字节的普通SHA256；`binding_exact_sha`同理取完整Binding原字节。它们不是typed hash，没有新hash标签，也不是H7 DESIGN、H4 REQUEST、签名、账户证明或首创身份。不能因精确图bytes或摘要不同，断言语义设计不同或获得新奖励。

Graph的rule_hash唯一指真实BaseConfig已批准的functional_validator_hash，沿P5相同语义；catalog指BaseConfig.material_catalog_hash，D/config也须与可信发布和实际配置一致。schema1由该获准验证器解释，客户端不能填写新rule_hash自行批准规则。本地精确值会绑定D/config；未来P6.3的去资产身份、端口等价和镜像语义去重不得直接套用此普通摘要。

## 2 scope、层级节点与固定树

scope是闭合u8目录，不是instance ID、wallet或玩家自选节点：

| scope | 节点含义 | kind | role |
| --- | --- | ---: | ---: |
| 1—15 | C01—C15 | 1 CELL | 对应1—15 |
| 16—21 | O01—O06 | 2 ORGAN | scope−15，即1—6 |
| 22 | 完整BIO | 3 BIO | 0 |

0只表示目录上下文边界，不是资产树节点，不可作target_scope；23—255不开放。叶部件不另占scope节点，它们通过每C四个位置及Binding关联P5真实Root。

固定父关系：C01/C02→16；C03/C04/C05→17；C06/C07/C08/C09→18；C10/C11→19；C12/C13→20；C14/C15→21；16—21→22。选择target时，必须提供它的**完整子树**；target自己的parent_scope=0，其余节点按上述关系指向本树内直接父。没有玩家增加的第16细胞、组织壳、额外层或路由节点。

Node恰4字节：scope:u8、kind:u8、role:u8、parent_scope:u8。节点按scope严格升序、唯一，数量n≤22且恰等目标完整子树。CELL目标n=1；六器官n依次3/4/5/3/3/3；BIO n=22。每个节点的kind、role、parent均由目录重建并核对，不能只因parent可解析就接受一般树。

## 3 Graph完整body与长度

body按下列次序连续编码；n为Node数、c为成员Cell数、e为Edge数、o为Open数、s为Slot数：

| 次序/相对偏移 | 字段 | 精确编码 |
| --- | --- | --- |
| 0 | domain | D32 |
| 32 | config_id | 32字节 |
| 64 | catalog | 32字节 |
| 96 | rule_hash | 32字节，真实functional_validator_hash |
| 128 | node_count及nodes | n:u8后接Node4[n] |
| 129+4n | cell_count及cells | c:u8后接Cell5[c] |
| 130+4n+5c | tier_count及tiers | t:u8后接Tier2[t]，t必须=n |
| 131+6n+5c | edge_count及edges | e:u16后接Edge16[e] |
| 133+6n+5c+16e | open_count及opens | o:u8后接Open6[o]，o必须=3c |
| 134+6n+23c+16e | slot_count及slots | s:u8后接Slot3[s] |

因此body恰`135+6n+23c+16e+3s`，完整Graph恰`151+6n+23c+16e+3s`。各计数在数值宽度之外还必须满足本目标的确切集合；不能填一个少成员但长度自洽的图。

Cell恰5字节：role:u8、v_ppm:u32。每个成员C恰一项，按role严格升序，c为本目标全部真实C数，≤15。动态集合{1,2,4,5,6,7,8,10,11,12,13}的v在0—1000000且为1000倍数；硬集合{3,9,14,15}必须0。v不可从后续请求q、费用或父层重新填大。

Tier恰2字节：scope:u8、mode:u8，按scope升序，树内每scope恰一项。mode0=DIRECT_PAIR，mode1=COMMON_COUPLED7.5，其余拒绝。档位没有用户cap字段；所有后代档位保留。各scope按其真实源/汇owner投影施加约束，不是仅按edge.owner分段统计；确切成员见02。父DIRECT不能抹去子COMMON约束。

Slot恰3字节：role:u8、x:u8、y:u8。只有BIO恰15项、role1—15升序，x∈0—4、y∈0—2，一对一占满5×3；低层s=0且没有dummy槽。槽位是装配坐标，不是axis_A/B动态坐标，不改变角色、力、物理cap、供能或时序。

## 4 Endpoint5：闭合端点类型

Endpoint恰5字节：kind:u8、role:u8、sub:u8、port:u16_LE。类型标签和每个域都须符合下表，不接受未知端点或用户新建context。kind0的port直接引用[P5数字端口](../p5-component1-20261024/01-components-and-conformance.md)，并与Binding中的真实descriptor匹配。

| kind | 名称 | role | sub | 唯一开放port |
| ---: | --- | --- | --- | --- |
| 0 | LEAF | C1—15 | 1B/2E/3I/4S | P5对应primitive/profile目录数字ID |
| 1 | ENV | 0 | 0 | 1 O、2 Wsink、3 F、4 Rsink、5 Jin、6 Jsink、7 f、8 b |
| 2 | MAINT | C1—15 | 0 | 1 E_IN |
| 3 | JOB | C1—15 | 槽0/1 | 1 E_IN |
| 4 | AXIS | 1 A/2 B | 0 | 1 Force_IN、2 x_OUT |
| 5 | LOAD | 1 A/2 B | 0 | 1 Force_IN |
| 6 | ANCHOR | 1 A/2 B | 0 | 1 Bind_IN |
| 7 | HEAD | 12 | 0 | 1 f_IN、2 b_IN、16—30为N01—N15_IN、32 H_OUT |
| 8 | GUARD_TARGET | C1—15 | 0 | 1 surfaceO、2 surfaceW、3 pump、4 gut、5 Rexit、6 Jin、7 Jout |

表内范围不表示全部笛卡尔积可连线；例如GT.surfaceO/W仅用于02固定S01/02 guard绑定，GT.pump只C04/05，GT.gut只C06/07/08，GT.Rexit只C09，GT.Jin/Jout只C15。固定边目录进一步限制具体端点对，不能拿一个存在的port接另一种功能。

所有非叶是F1.2已有维护、联合任务、环境、预算监测、机械或guard操作的固定结构标识，没有新资产、原料B、独立能量、可复制cap或用户程序。MAINT/JOB不作为第五件部件；JOB把同细胞I/S同一槽路径对应为一次预算，不能因E→JOB与I→S两边存在就重复收费或一份E付两任务。

端点锚唯一如下：LEAF/MAINT/JOB/HEAD/GUARD_TARGET锚其对应C；AXIS/LOAD/ANCHOR的A锚C10、B锚C11；ENV无资产树锚。除ENV外，任一端点的锚C必须属于本目标子树，不写不存在邻居的叶或假Root。

Env.f/b是只读，不是Env.F物质供给；AXIS.x是姿态只读，不是槽位。HEAD只表示C12维护监测已有f/b和15个轮初N所得的受限H12；它只交E12.7/I12.5，不向S授权。B.Nstock的质量流和轮初只读沿P5不同port区分，不能把RO当可搬物质或多一份库存。

## 5 Edge16：类型、比例、排序和归属

Edge恰16字节：owner_scope:u8、edge_type:u8、src:Endpoint5、dst:Endpoint5、fraction_ppm:u32。字段相对偏移分别0、1、2、7、12。没有客户端自填cap、通量、权重、阶段号、函数或证书字段。

| edge_type | 唯一含义 | fraction规则 |
| ---: | --- | --- |
| 1 | 可变N：S06/07.Nout→合法B.N0/N1 | 0—1000000任意整数 |
| 2 | 可变O：S01/02.Oout→合法B.O0/O1 | 同上 |
| 3 | 可变W：合法B.W0/W1→S01/02.Win | 同上 |
| 4 | 固定物质：其余F/Fp/Fd/Nlumen/R/J及本地反应边 | 必须0 |
| 5 | ENERGY | 必须0 |
| 6 | TASK | 必须0 |
| 7 | READONLY | 必须0 |
| 8 | CONTROL | 必须0 |
| 9 | GUARD_BIND | 必须0 |
| 10 | MECHANICAL_BIND | 必须0 |

仅1—3可由玩家选择合法端点对和固定分配，且两端锚均在本子树。其它类型全部由02闭合目录诱导，不能凭类型标签添加新任务、控制线、只读源、guard、锚或供能路径。类型4里的加工/隔室类型不可互换：同为碳物料不允许跳过F→Fp→Fd→Nlumen/Rlumen实际作用。

全体边按以下**整数元组**严格升序：owner_scope、edge_type、src.kind、src.role、src.sub、src.port、dst.kind、dst.role、dst.sub、dst.port。port按u16数值比较，不按其LE bytes的字典序。fraction不作为键。相同有序端点对全图只能一次，不能换owner/type或fraction伪装第二条；重复直接拒绝，不静默合并或去重。

fraction=0仍是合法已声明边，仍核类型、顺序、归属并计结构边数；不因未来测试没有正通量而在P6.1删除它。P6.3是否将语义零边归一化、怎样处理相同类型端口置换，必须另定。P6.1不自动翻转或重命名P5物理端口，也不将镜像后的coords覆盖真实输入。

非ENV边的owner_scope恰为两锚C在本图固定节点树的最低公共祖先；锚相同则该C自身，跨CELL在对应ORGAN或BIO。任一端为ENV时，owner_scope必须0，表示唯一目录边界绑定，不表示新root、可调配额或用户外部路由。ENV边仍须其真实另一端属于本子树且在固定目录，不能将owner0当作逃避LCA和父子不变性的万能值。

## 6 固定边诱导、完整性与边数上界

02逐条列出完整BIO闭合固定集合。低层图取其中所有非ENV端点锚均属于当前子树的边，**恰好各一次**；ENV边只需其所有真实锚属于该子树。两端锚不齐的固定关系是可派生的开放固定接口，不写不存在邻居或任意替代边。其目录语义保留，日后合法父层成员齐备时必须加入。

固定集合内ENERGY45及TASK30包含全部15个本地slot0/1。硬角色v0的第二路径固定存在，但后续动态使用u1必须0；存在一条结构路径不授动态提升或第二次品质。RO53包含C12维护监测，不遗漏H12调度前置；GUARD共12，不是旧草案8条。确切分解如下：

| 类型组 | 完整BIO固定数量 |
| --- | ---: |
| 固定物质 | 90 |
| ENERGY | 45 |
| TASK | 30 |
| READONLY | 53 |
| CONTROL | 24 |
| GUARD_BIND | 12 |
| MECHANICAL_BIND | 6 |
| 固定非物质合计 | 170 |
| 全部固定合计 | 260 |

每种可变N/O/W最多60条，三种合最多180；全部物质最多270。因此本模型完整图语义最大边数440，虽然edge_count的解码硬界另设≤512；合法schema1不能用剩余72个位置增加新边。固定集合缺边、多边、重复、反向、替代或类型不同均拒绝。

E172的172是物质边数：82可变N/O/W+90固定物质；再加170固定非物质，Graph实际e=342。标准180物质图则Graph e=350，不能误把结构图边数当任务C或直接用它计奖。C所需全测试正通量并集仍归P6.2/P6.3及任务模块。

完整BIO n22/c15/s15，因此完整Graph长度唯一为`673+16e`：E172的e342时6,145字节；标准e350时6,273字节；语义最大e440时**7,713字节**，body7,697。这个上界也覆盖所有较低目标的合法完整子树；本地值不因此成为一笔能直接发送的native instruction或突破P0 Frame4096。

## 7 Open6、跨层保存与组合

每个成员B必须恰有三项Open，按(role,species)严格升序，role是C1—15、species1=N/2=O/3=W、remaining_ppm:u32，共6字节。不是P1化学物种ID，也不表示新可交易库存。

对每个成员B/物种，取当前全部类型1/2入边或类型3出边的fraction之和a，先检查加法和a≤1000000，再要求remaining=1000000−a。三项即使remaining0也保留，o=3c；不能省略0项、给每个物理口各记一个1000000或把余量借给其他B/species。单口0.5、每种合1的实际通量cap及流量×比例的整微单位可除性由后续动态核验，结构不伪造实际flow。

BIO所有Open必须0。低层R>0还必须存在至少一个当前子树外的合法宏对端，能够在固定祖先首次形成合法连接；否则是永远填不满的结构，拒绝。N的宏对端仅C06/C07.S.Nout，O仅C01/C02.S.Oout，W仅C01/C02.S.Win。因此O03已含两N源，其四成员的N余量均须0；O01已含两O/W源汇，其两成员的O/W余量均须0。此必要条件不提前保证实际通量或品质。

低层只允许未来父层与当前已造子树外的合法真实角色连接。不能在父层新增两端早已位于同一既造子树中的边，不能删除/改比率已有内部边。父新增边逐项从两端所涉输入的对应B/species余量扣减；这里对应的是该边的B目标N/O或B源W那一组，不向S宏源额外造一份Open配额。

预期的开放接口不等于数据丢失：低层节点/固定诱导边/Open齐备、可信实际输入证据也齐备时，可以形成限定范围的结构PASS；它不承诺未来任何父层组合或功能q。真正缺节点、必有固定边或完整证据不能伪装为开放余量。固定虚拟邻居怎样完成DUT边界而不覆盖其内部比率，仍须P6.2另行固定。

子图完整记录与父图展平记录不是整文件逐字节相同：原child target的parent0会在父树中接到真实父scope，父新增外部边会使完整父图Open下降。本版不借此允许修改子图；对每个真实直接输入child，投影算法唯一为：

1. 取固定角色树中以child.scope为根的完整成员集合，不能以客户端任意选择的节点子集作投影。取父Graph相同D/config/catalog/rule，头target改为child.scope。
2. 提取这些成员的完整Node；只将child目标节点的parent_scope恢复0，其余kind/role/parent逐字段保留。提取对应全部Cell及Tier，v和mode原bytes不变。
3. 提取两非ENV锚都位于该成员集合的所有Edge16，以及其唯一非ENV锚位于该集合的固定ENV边。跨出该集合的父新增边完全排除，不能将它们算作child原内部边；反过来，父若偷偷新增了两锚已在child内的边，该边会落入投影并导致比较不等，不能被过滤隐藏。所有保留边的owner/type/端点/fraction原16字节不变。
4. 仅从第3步保留的N/O/W边重算child每B三项Open；不复制父已经扣减的Open，也不把父新跨边再次扣入。非BIO child的Slot为空；本模型没有BIO之上的可合成层，不能发明父BIO投影规则改变原几何。
5. 按本文顺序、计数、精确长度及原schema重编码整个投影Graph，必须逐字节等于真实child已冻结的原Graph。图缺失、子schema未定或不能取得真实原bytes时是UNKNOWN依赖，不以相同总B或相似布局放行。

该比较只针对Graph。历史child Binding的snapshot_id可能属于过去上下文，不能要求整个历史Binding字节与当前父Binding相同；当前真实叶ID、descriptor、不可变指纹和父链对应关系按03另核，不能借上下文更新替换叶。投影重建不修改实际child Root、其原Graph或历史状态。

## 8 Binding值：完整真实叶映射

Binding独立采用BIOP6B01头，target_scope须等Graph。body：

| body偏移 | 字段 | 精确编码 |
| ---: | --- | --- |
| 0 | graph_exact_sha | 完整Graph普通SHA256，32字节 |
| 32 | snapshot_id | 完整P4 codec2/kind3 ACCOUNT_SNAPSHOT本地记录的普通SHA256，32字节 |
| 64 | binding_count | u8，必须4c，最大60 |
| 65 | bindings | Binding70[4c] |

Binding70依次：Crole:u8、primitive:u8、LeafDescriptor4、instance_id32、immutable_leaf_fingerprint32，偏移0/1/2/6/38。按(Crole,primitive)升序，每成员四位置B/E/I/S恰一，实际instance ID全体独立；generic B/E/I descriptor profile0，S profile恰等该C角色，全部遵守P5。

总body=`65+280c`，完整Binding=`81+280c`；CELL c1为361字节，BIO c15为4,281字节。snapshot_id、fingerprint及ID不允许用假值或零sentinel冒充未取得的证据；实际账户及上下文必须能解析并核验。值齐备但真实证据尚未取得可以报告UNKNOWN，不把字段自报当真实。

这里的snapshot_id仅适用本地结构报告的P4真实读取承载，沿[P5的P4 codec2](../p5-component1-20261024/06-p4-codec2-v1-transport.md)完整单响应、最多100键、全记录16MiB、每PRESENT data10MiB及真实来源/网络要求。它不是链上账户包含证明，普通hash不自证内容可信。若完整输入依赖超过这些界或无法取得完整一致快照，本地相关检查UNKNOWN/阻断，不截断、分批拼同bank或伪造P4文件；未来P7程序内真实上下文/证明承载须另定，不能因本地Snapshot格式存在就声称正式制造可用。

immutable_leaf_fingerprint的唯一普通SHA256输入为：真实P5 COMPONENT Root完整header[0,120) || body[0,202) || body[323,end)。这精确排除body202—322的121字节未来owner/生命周期区域，保留原身份、q/B/范围及完整DP。四Source样本Root1055的指纹输入934字节；真实PDA/owner/完整schema、可消费性和父链仍另核，不能凭指纹批准资产。详细集成见03。

真实直接输入、已Consumed后代、父链及完整来源的证明是03内部上下文的强制部分。Binding只给映射和确切承诺，不序列化一套任意“祖先已验”布尔证明。P7/P9正式证明传输/账户封装尚须其模块定稿；缺证不能形成结构PASS。

## 9 Report值：恰306字节的限定结构结论

Report独立采用BIOP6R01头，target_scope与Graph/Binding相同，body固定290字节：

| body偏移 | 长度 | 字段 |
| ---: | ---: | --- |
| 0 | 32 | domain |
| 32 | 32 | config_id |
| 64 | 32 | rule_hash |
| 96 | 32 | graph_exact_sha |
| 128 | 32 | binding_exact_sha |
| 160 | 32 | snapshot_id |
| 192 | 1 | result：0 PASS、1 FAIL、2 INCOMPLETE |
| 193 | 1 | check_count，必须12 |
| 194 | 96 | Check8[12]，ID严格1—12升序唯一 |

Check恰8字节：id:u8、status:u8、reason:u16、scope:u8、role:u8、edge_index:u16，偏移0/1/2/4/5/6。status0=PASS、1=FAIL、2=UNKNOWN。scope0表示目录上下文/无单节点关联，其余须为1—22有效相关scope；role0表示无具体C，其余为C1—15。edge_index从0开始，必须小于Graph.edge_count，ffff表示无对应边；不能把未知索引填0冒充第一边。

| Check ID | 固定检查 |
| ---: | --- |
| 1 | 框、版本、字段及共同绑定身份 |
| 2 | 固定层级树及目标完整成员 |
| 3 | 真实输入上下文及实际根读取 |
| 4 | 真实叶/来源唯一与descriptor映射 |
| 5 | 不可变子图、v/tier及投影保持 |
| 6 | 端口闭合类型、方向及上下文权限 |
| 7 | 固定诱导边和因果模板 |
| 8 | 实际端点锚及LCA归属 |
| 9 | 容量owner、scope cut的正确成员 |
| 10 | fraction聚合和Open精确余量 |
| 11 | v、tier、slots字段和不可变范围 |
| 12 | 所需数据与结构范围完整性 |

任一FAIL则result=FAIL；无FAIL而有UNKNOWN则INCOMPLETE；全部12项PASS才PASS。没有调用者选择的NA、缺省PASS或“只核最好一部分”。PASS项reason必须0、scope/role为0、edge_index=ffff；FAIL/UNKNOWN按第10节reason及真实可定位事实记录，不以文字说明替代字段。

Graph或Binding不可解码，缺可用snapshot_id，或两者虽分别可解析但target_scope不相同、Binding.graph_exact_sha不等实际Graph摘要时，只给本地DecodeDiagnostic，不产生可接受的Report，也不填零hash/snapshot sentinel。共同输入身份必须先成立：Graph/Binding语法、目标与确切图引用和32字节上下文绑定已齐、但真实账户/父schema/来源证据不齐时，才可以产生INCOMPLETE报告；UNKNOWN明确不授结构通过。确定反例优先，不把已知重复ID等改称未知；缺证也不伪造不存在或错误状态。

Report重复其原输入D/config/rule及snapshot身份，逐字节核图/绑定摘要和目标scope；不能将另一份图、旧快照、另一批资产的PASS贴到本请求。结构检查顺序固定1—12，依赖尚不能求值的项应UNKNOWN。各项若有多个可定位反例，按(scope,role,edge_index,reason)数值元组选择最小者；无边用ffff，不能以服务返回先后顺序决定报告内容。

## 10 本地reason闭合枚举

reason是本内部Report的u16，独立于P4原因及链上Custom错误；P6.1不分配新链上错误号。仅以下0—30合法，status必须与列一致。字段非法且无法形成Report时同名诊断只作为本地错误说明，不伪造本类型成功解析。

| reason | 唯一名称 | status | 解释 |
| ---: | --- | --- | --- |
| 0 | PASS_OK | PASS | 本项必需事实与规则已完整满足 |
| 1 | FAIL_HEADER_OR_LENGTH | FAIL | 已定位的头、body长度、计数、尾部或reserved不符 |
| 2 | FAIL_SCHEMA | FAIL | 已定位的schema/类型版本不受批准 |
| 3 | FAIL_DOMAIN_OR_MODEL | FAIL | 可信D/config/catalog/rule绑定明确不符 |
| 4 | FAIL_TREE | FAIL | 固定目标树、kind/role/parent或成员集不符 |
| 5 | UNKNOWN_REAL_INPUT | UNKNOWN | 必须的真实Root/输入事实未可靠取得 |
| 6 | FAIL_REAL_INPUT | FAIL | 已取得真实账户内容明确不合法 |
| 7 | FAIL_LEAF_DESCRIPTOR | FAIL | 叶位置、P5描述或C/S角色映射不符 |
| 8 | UNKNOWN_PROVENANCE | UNKNOWN | 真实来源/父链证明不完整，不能推定唯一 |
| 9 | FAIL_PROVENANCE | FAIL | 已证明来源重叠、错误父链或关联不符 |
| 10 | UNKNOWN_CHILD_SCHEMA | UNKNOWN | 所需真实CELL/ORGAN等schema尚未冻结或可核 |
| 11 | FAIL_CHILD_MUTATION | FAIL | 子内部图、v/tier、固定比率或投影被修改 |
| 12 | FAIL_ENDPOINT | FAIL | 未开放kind/role/sub/port或越上下文读取 |
| 13 | FAIL_EDGE_TYPE_OR_DIRECTION | FAIL | 边类型、方向或固定作用对象不符 |
| 14 | FAIL_EDGE_ORDER_OR_DUPLICATE | FAIL | 边乱序、重复端点对或换type/owner重复 |
| 15 | FAIL_FIXED_EDGE_SET | FAIL | 诱导固定边有缺项、多项或替代 |
| 16 | FAIL_CAUSAL_TEMPLATE | FAIL | 固定控制/读/任务/guard/机械因果模板不符 |
| 17 | FAIL_LCA | FAIL | 非ENV owner非真实LCA，或ENV未用唯一边界owner0 |
| 18 | FAIL_CAPACITY_OWNER | FAIL | 原叶实例/功能预算身份被别名、层级等重开 |
| 19 | FAIL_CUT_MEMBERS | FAIL | scope cut投影成员不按真实源/汇owner派生 |
| 20 | FAIL_FRACTION | FAIL | 比例范围、非适用类型字段或同组总和不符 |
| 21 | FAIL_OPEN | FAIL | Open缺项、错序、假余量、超额或非法跨层补边 |
| 22 | FAIL_V | FAIL | 动态v范围/步长、硬v0或原v不变性不符 |
| 23 | FAIL_TIER | FAIL | tier集合/档位/后代约束保留不符 |
| 24 | FAIL_SLOTS | FAIL | BIO槽位集、坐标、一对一或低层必须为空不符 |
| 25 | FAIL_LIMIT | FAIL | 模型共同计数/字节/端点或遍历界被超出 |
| 26 | UNKNOWN_SNAPSHOT | UNKNOWN | 上下文身份虽齐，但来源/覆盖/读取可信度不足 |
| 27 | FAIL_COMPLETENESS | FAIL | 已确定遗漏本scope必需结构，非合法开放接口 |
| 28 | FAIL_REPORT_INCONSISTENT | FAIL | 报告与输入、索引、聚合或状态组合矛盾 |
| 29 | UNKNOWN_REQUIRED_ARTIFACT | UNKNOWN | 已绑定但尚不能取回/核对的必需完整制品 |
| 30 | FAIL_LEAF_FINGERPRINT | FAIL | 真实不可变Root片段与Binding指纹明确不符 |

没有把UNKNOWN钳位成PASS或把缺账户当不存在的规则。不同本地类型的同数字reason不互换；更不能拿本报告状态修改P0永久Business、Source.p、Root、品质或已形成的历史权利。

## 11 与后续模块及真实准入的界面

本文完成精确结构值和界限，不提供虚拟邻居资产、结构PASS币或独立制造。正式P7调用需要重新核真实输入/权限、P6.2完整供能/流量/状态/guard/机械/q及来源/费用/原子新根；P6.1不会让一个非法功能图因字段可解而取得品质。

实际流量cap、整数分流可除性、真实cut数值、帧值/守恒、最低服务、全部测试、q/C及K都不存入本结构Report充当已验结果。P6.3的端口等价置换及四镜像最小语义编码也没有在本版完成；本版严格保存原实际图，不用H7掩盖这些剩余设计。

最大BIO Graph7,713、Binding4,281、Report306均为内部值长度，不能据此宣称能塞进P0 Frame4096或原生v1交易。正式P7/P8数据承载、Root字段及P9证明/当前终端父链方案须另行定稿，并在真实实现后验收内存/账户/计算/网络/签名/原子容量。缺完整设计或真实准入时保持阻断，不改为只传hash、先消费后补图或后台人工PASS。

# 功能状态编码 轨迹与资格摘要

2026年10月24日。本文与[功能算法](01-function-semantics.md)共同定义F1.4的精确执行出口。全部记录是内部确定性值，不是P0交易、独立PASS资产或可交易证书；没有602指令。正式合成必须自行执行，不接受客户端签一张结果代替。多字节整数均LE；Option为u8标签0无/1有，Vec为u32长度后接内容；拒绝尾字节、未知标签和非规范零字段。

## 1 模型量与产品奖励

FU和microFU仅是数字功能模型的量纲。N、O、W、E、力和功各有类型，不能因均用u64就相互兑换。模型E不是LAB余额。“生物能”是既有LAB奖励的产品称呼，本轮不另造一种代币、不改变一亿发行上限。功能通过只产生资格；质押、小时预算及领取另由10—12决定。

每个相乘/累计先用checked u128或有符号i128，验证结果可表示为目标类型后窄化；除法要求整除，唯01明确品质标尺和向下.001处允许floor。失败不能用饱和、四舍五入或最后一支吃尾差修补。

## 2 固定控制帧736字节

字段连续无padding，相对偏移如下。

| 偏移 | 字段 | 类型和字节 |
| --- | --- | --- |
| 0 | tag origin_role slot f b phase target | 七个u8，共7 |
| 7 | d | u64，8 |
| 15 | xA xB | i64[2]，16 |
| 31 | N0 | u64[15]，120 |
| 151 | u0 | u64[15]，120 |
| 271 | u1 | u64[15]，120 |
| 391 | m | u64[15]，120 |
| 511 | feed | u64[15]，120 |
| 631 | nextI | u8，1 |
| 632 | service_micro | u64，8 |
| 640 | input_digest | bytes32 |
| 672 | forceA forceB | i64[2]，16 |
| 688 | workA workB | u64[2]，16 |
| 704 | routing_sha | bytes32 |

tag闭集：1 BASE_NORMAL、2 SAFE、3 BODY、4 BASE_PLAN、5 SAFE_PLAN、6 BOOST_PLAN。不序列化空帧。origin_role只12/13，slot只0/1；按实际付费槽绑定，tag1/2/4/5只slot0，tag3/6只slot1。phase0=L/1=R；target0无/1—15恢复目标。未用字段**全部0**，不能藏备用状态。

BASE_NORMAL携带f/b/x/phase，service=1000000；SAFE另带完整N0、target/d；BODY仅携N0，service=w12，其f/b/phase/x/target/d均0。三者的u0/u1/m/feed/nextI/force/work/routing_sha均0。BASE来自真实f1/b0/满库正常模式，SAFE来自f1安全模式；不可在STARVE产帧。

BASE_PLAN携正常f/b/x/phase和基准u0/m/feed/两轴力功/nextI，N0全0；SAFE_PLAN携安全f/b/x/phase/N0和全部安全u0/m/feed/target/d/nextI，力功/u1为0。BASE_PLAN/SAFE_PLAN service=1000000。BOOST_PLAN仅tag/origin/slot、N0、u1、增量m/feed、service=w13、input_digest、增量force/work及routing_sha可非零；f/b/phase/target/d/x/nextI/u0全0，力的方向从已消费BASE中的真实相位计算并写入有符号force，不从未用phase0猜方向。

正式RUN固定四帧BASE_NORMAL/BODY/BASE_PLAN/BOOST_PLAN，按(role,slot)排序；SAFE恰SAFE/SAFE_PLAN两帧，STARVE0。w=0仍有零服务BODY/BOOST，E和增量全0，不建u=0任务Exec；没有可选省略零帧的编码。BOOST中N0仍是真实正常快照，零服务帧不获得付费服务或增加品质。

input_digest=普通SHA256(ASCII BIO6IN14无NUL || tag:u8 || graph_exact_sha32 || ReadBody)。BASE的ReadBody=f:u8||b:u8||x:i64[2]；SAFE为同前缀再N0:u64[15]；BODY仅N0。C13的ReadBody=count:u8||所消费C12帧736[count]，BASE/SAFE的count1，BOOST的count2且按BASE、BODY顺序。每帧必须经Graph规定的真实路径到达，不能因摘要相等就补出不存在的传输。

routing_sha对计划帧为普通SHA256(ASCII BIO6RT14 || graph_exact_sha32 || count:u16 || Row[count])；Row=edge_index:u16||amount_micro:u64，按实际执行扩展图的边索引升序，省略0。只含该帧所许可的物质计划：BASE为基准，BOOST为增量，SAFE为安全完整计划；具体流量由01和固定比例重新算，不由玩家填。框内有多少源/汇都不能复制任务服务量。

同一轮每个origin/slot最多一帧，共最多4；接收后仍保留作本轮审计，不能复制为新付费收据。状态边界全部清空。

## 3 运行状态

RuntimeState头16：magic八字节ASCII BIOP6S14，schema:u16=1，target_scope:u8，reserved:u8=0，body_len:u32。target沿P6.1既有scope目录。body如下。

| 顺序 | 字段 | 编码与上限 |
| --- | --- | --- |
| 1 | CellState | 按C01—15固定15项，每项N/W/E/J四u64及I:u8，33字节 |
| 2 | axis position | xA/xB两个i64 |
| 3 | axis force | 两个i64 |
| 4 | round_snapshot | Option；有值为f/b两u8、N0:u64[15]、x:i64[2]，138字节 |
| 5 | H12 | Option；有值f/b/any_deficit三u8 |
| 6 | frames | Vec<Frame736>，≤4，按origin_role、slot升序 |
| 7 | execution_receipts | Vec<Exec19>，≤30 |
| 8 | material_buffers | Vec<Buffer10>，≤360 |
| 9 | local_buffers | Vec<Local10>，≤45 |
| 10 | macro_buffers | Fp/Fd/Nlumen/Rlumen四u64，共32 |

Exec19=role:u8||slot:u8||work_micro:u64||energy_paid:u64||frame_ref:u8。按(role,slot)唯一排序，只为实际u>0任务生成；维护和u=0任务不生成Exec。frame_ref为当前frames中0起索引，确切绑定为：C12.job0/1分别指自己真实生成的BASE/SAFE或BODY输出帧，本地许可另核H12/固定读口，不能虚构C12输入计划；C13.job0指C12 BASE/SAFE，job1指BODY且必须同时核同轮BASE；其余角色job0指C13 BASE_PLAN/SAFE_PLAN，job1指BOOST_PLAN。索引指向帧还须核真实Graph来源/类型/slot，不能仅索引在界内。work_micro是任务实际服务量，不是全部角色都产生机械功，不能与第6阶段外功混用。energy_paid等于实际正任务E；维护账另在能量表中。

Buffer10=edge_index:u16||amount:u64，非零项按index升序唯一。只允许执行图中类型1—4物质边。结构目录自由N/O/W最多180、固定物质90，实际合法物质边最多270；360是保守codec容量上界，不增加90条可用边。每项仍须实际edge_index/type/容量合法，不能靠尚有codec空间添加J/F/反应之外的边。每项暂存不是新库存，容量取该边端口及01阶段义务。Local10=role:u8||kind:u8||amount:u64，kind1 Ojoin、2 Nincoming、3 Woutgoing，非零，按(role,kind)升序；每项≤1000000。B.Wstock仍在CellState.W，Ojoin和本地临时不能跨边界留存。禁止再加第五种池、任意blob或跨轮缓存。

最小boundary body=577，记录593字节；保守codec最大body=8282，记录8298字节：577+138+3+4×736+30×19+360×10+45×10。这个上界不声称每一容量同时可由合法Graph达到；正式功能另核实际边/任务上限。边界两个Option无值、四个Vec全空，macro_buffers0，E/W/force0、J1000000；15个N/I及两轴位置仍按01保留。状态不能在中途丢弃尚有债务的帧、物质或E来伪造空边界。

## 4 执行图与索引

实际Graph字节保持不变。完整BIO的执行图就是它的所有边；partial按01夹具规则补全后的15角色图，沿P6.1相同整数键排序再赋u16零起索引。实际Graph原边不因重排就失去身份：Transcript前置执行图，逐条建立原边到执行边的唯一映射；实际来源/容量仍按原真实scope约束。边≤440，任何扩展超过上界即夹具失败，不能截断。64字节正边bitmap只索引**原Graph**，未用高位全0，只有其真实类型1/2/3正式正通量可置1。

执行图编码为edge_count:u16||Edge16[e]，无额外Graph头。执行图不是新增Root、资产图、玩家可修改固定环境或canon的输入；其唯一内容由原Graph、target和fixture1决定。

## 5 确定性轨迹

Transcript只定义可重建的字节串；可流式hash，不要求链上保存整个数MB串。SHA相同不能代替实际执行。头固定为ASCII BIO6TR14||schema:u16=1||D32||config32||rule32||graph_exact_sha32||leafmap_sha32||target:u8||evidence_kind:u8||challenge:u32||suite:u32=1||fixture:u32=1||load:u32=1||DUT_mask:u16||执行图Vec<u8>。Vec长度包含上节完整执行图。

后续记录按下列三组顺序，每条为record_len:u32||Record；末尾没有隐含分隔符。

1. 73轮正式测试，case1 N32、2 S2R、3 H2R、4 SH；各case round从0起，每轮phase1—7。每次case开始先一条phase0初态记录。
2. 88探针，id0—7 ENVPOSE按(f,b,phase)词典序；id8—23 BODY按全满、C01不足…C15不足；id24—87 MODE_SAFE按(N向量序号,b,phase)。每个一条探针记录。
3. 12负控按01列举顺序id0—11，再对DUT真实角色升序隔离id12起。每个从原相应测试初态重放完整固定测试，phase0和1—7记录规则相同；期望退化本身不是玩家正式FAIL。切slot1在q1时允许正常低档通过，但必须第二服务0。

正式/负控PhaseRecord：kind:u8(1正式/3负控)||case_or_mutation:u8||round:u16||phase:u8||runtime_state:Vec<u8>||flow:Vec<Flow10>||energy:u64[15][8]||service:u32[15]||reason:u16。Runtime包括完整16头。Flow10按执行edge_index升序、去零、每phase记录当phase真实有向运输总量；只允许物质类型1—4及E类型5，≤405项=360+45。同一边同phase有多个细步骤时相加；不把累计全轮flow在每phase重记。J入/回为不同固定边，不能相消。

energy是当轮截至该phase的累计：每角色N_used、O_used、E_generated、maintenance_E、job0_E、job1_E、external_work、internal_heat，八u64共960字节。N_used/O_used只计代谢实耗，补库另在真实flow。internal_heat=已释放基础反应热+已付维护/任务E−已发生外功−mechanical_pending；pending仅按01从已付肌肉Exec、其真实Frame及已发生功重建，不是第九个状态/可用E池。phase6前保留待做功部分，完成时pending转外功，累计热不减少，phase7必须pending0。各phase实际E余额等于E_generated−已付维护/两job，阶段7归零。

service固定只在成功phase7的正常RUN记录评定：11动态填01的完整本轮r（包括已消费验证的控制r），4硬角色在该轮硬条件全通过时填1000000；运行的虚拟角色也按同一函数记录，但最终q仅取DUT集合。phase0—6和SAFE/STARVE的service全0，不提前挑某阶段给控制服务加分。每phase在工作副本计算全部依赖义务，满足后才形成该phase记录；有错时选规定首错，失败记录Runtime及累计energy取该phase入口值、flow为空、service全0，reason非0并终止该case。即失败phase不提交局部工作副本，避免独立实现按不同内部子步骤留下不同半付费轨迹；这只是纯函数诊断规则，不是新增链上事务/资产回滚入口。不能继续造一个PASS轨迹。

探针Record：kind:u8=2||id:u8||input_len:u16||input_bytes||output_count:u8||Frame736[output_count]||reason:u16。input_bytes按输入固定组编码：ENVPOSE f/b/phase三u8、BODY N:u64[15]、MODE_SAFE N:u64[15]||b:u8||phase:u8。ENVPOSE默认N全满；L为xA−500000/xB500000、R相反；f0输出0，f1/b0输出四正常帧，f1/b1输出两SAFE帧。BODY只输出C12 BODY一帧，即使输入有缺库也仅测试纯读取，不切换SAFE；service按获准c/v的w12，其余未用域0。MODE_SAFE固定f1并由给定N/b唯一选模式，RUN四帧，RECOVER/HOLD两帧，target/d/nextI按01预测。输出按(role,slot)排序，不允许只选一个生产者或省略零服务帧。全部用本次获准挑战、真实控制descriptor或固定虚拟descriptor，不补能量/收据/库存，也不向正式运行提供帧。

负控实际流/状态按下节有限注入表确定；预期失败是负控成功，不令原模型合成失败。若隔离器仍放行不应存在的作用才使验证器整体拒绝。各负控的case、阶段、数额及额外probe固定，不由实现者任选。局部隔离按role升序，固定禁该角色的真实S计分/硬作用，保留维护/请求/邻居输入；每个从四族各自S_L依次重放N32/S2R/H2R/SH，首错结束该case，其他case仍重置重放，不把输出交邻居代做。

### 5.1 十二负控的唯一注入表

mutation_id为0—11，独立从S_L重放指定case；不修改原Graph或原正式轨迹。r=min(真实DUT角色集合)，j=(r=1时2，否则1)；k取真实DUT与九非控制动态集合的最小交集成员，交集空则固定C01（夹具中的同一角色），不存在用户自选role。case内按原七阶段顺序执行，到指定角色/动作时注入；若该case首错已发生则不继续该case。金额均microFU。非法来源/重复许可尝试在验证前作为固定对抗输入，未通过校验不得真的写入物质/E/功；失败Runtime按上文统一取phase入口快照，不保留不确定的半阶段子步骤。没有新外界生理输入。

| id | 固定变异、位置和数额 | 重放 / 正确观察 |
| --- | --- | --- |
| 0 | phase2 C12.job0：跳过当地追加反应/付费任务和BASE/SAFE生成；维护仍真做 | N32；缺必要帧，reason11 |
| 1 | phase2 C12.job1：仅当w12>0跳过其反应/任务/BODY；w12=0没有任务可切，保留规范零服务BODY | N32；正服务时reason11；零服务保持原低档，第二服务0 |
| 2 | phase3 C13.job0：跳过其追加反应/任务/BASE_PLAN或SAFE_PLAN，保留既有C12帧 | N32；reason11 |
| 3 | phase3 C13.job1：仅w13>0跳过其反应/任务/BOOST；w13=0保留零服务BOOST | N32；正服务reason11；零服务不得增加服务 |
| 4 | C12输出保持内容，phase3交付时将BASE_NORMAL送I13.port2、BODY送I13.port1，与固定目的口互换 | N32；先核slot0输入，reason10，C13不为错输入追加E |
| 5 | phase2生成BODY后只将其N0[15]改为全1000000；input_digest仍来自原真实读向量，其余字段不变 | N32、S2R；真实RUN可能全部相同，所以还必须执行下面16个负控BODY probes |
| 6 | phase2 BODY输出N0改为逐项原锁存N0−250000，digest仍原锁存输入，其他字段不变；选定case/probe均N≥500000，无clamp | N32、S2R；正常首个BODY不符reason11；另执行下面16 probes |
| 7 | phase4 k第一次合法正job1及其确切Exec已建立后，再尝试重复完全相同(role,slot,frame_ref,work,energy)的Exec一次；k为非控制动态角色，首次合法任务真实消费同轮BOOST_PLAN。该job1为0则无操作，不能凭空造收据 | N32；第二次在扣N/O/E前reason12，不能先真付两次或凭重复增加服务 |
| 8 | phase0安装仅对r的S作用固定输出阻断，整个case各阶段凡调用其计分/硬输出均返回数值0或无可交付帧；不改维护/请求/邻居输入，不把RO输入当输出 | N32；按七阶段/固定依赖中最早真实作用缺失报错或本轮服务低于请求。S01/02被动O也属该S输出，不能晚至phase4才阻断；控制producer帧保留作已付审计但不交付下游，不序列化tag0 |
| 9 | r正常job0前（r12 phase2/r13 phase3/其它phase4）用E_j到JOB_r,0的1000000外来E替代当地N/O反应；当地反应不先执行 | N32；跨owner且无合法ENERGY边，reason7，在记credit或任务收据前拒绝 |
| 10 | phase6真实肌力已暂定、位移尚未提交时，尝试向A叠加固定+1000000有符号外来力，来源为未付费虚拟外力，非S10 | N32；reason16，非法项不入功/位移；不靠力方向或取消原负载掩盖 |
| 11 | phase5不执行全部34条J边及S09.17→ENV.Rsink，企图仅把J末态写成1、R末计数写成所需量；其余真实物流照旧 | N32；禁止以末值替真实路径，phase5 reason14，虚构末值在校验前不提交 |

id7所选k无正job1时保持原低档，不得凭空造一个任务来触发某种预期失败；k不是控制角色，故其许可精确来自BOOST_PLAN，不把C12自己产BODY误写成消费BOOST。其余局部每role隔离仍逐一检验真实必经作用。id8控制producer帧可留在审计数组及原已付Exec引用中，但没有真实交付收据就不能凭数组存在推定下游许可。局部隔离使用同一从phase0安装的角色输出阻断，逐role独立。低档零作用的服务本来为0时，不强求质量再次下降，但该角色必要硬作用仍须被隔离。

id5和id6在各自上述所有runtime case后，固定再执行BODY probe_id8—23的16个输入，各生成一条NegativeProbeRecord：kind:u8=4 || mutation_id:u8(5或6) || probe_id:u8 || input_len:u16=120 || 原N:u64[15] || output_count:u8=1 || 实际变异BODY Frame736 || reason:u16。每条完整864字节，外层仍record_len:u32。它不走模式选择/不付E/不入运行；正常oracle仍为原给定N的纯读取，不随变异改变。id5的全满probe8可reason0，其余9—23必须reason18；id6全部8—23均reason18。全部16条都写，不能首个反例后省尾项；这些预期非零reason不是原模型FAIL。BODY即便service0仍必须复制输入N，所以常量输出不能因低档跳过这项函数符合性。

负控组的确切外层顺序为id0…11；每id先按表case编号升序的runtime记录，再仅id5/6追加其16条kind4记录；其后才按真实role升序写局部隔离四case。总额外NegativeProbe恰32条，不混入原88条正常probe或73转移；它们参与完整Transcript SHA，但不参与品质/任务C的正通量并集。无其它未列mutation字段、额外role选择或可变注入量。

默认实际FAIL先比较解码→来源→结构→执行；执行内部按(case,round,phase,role,端口数字顺序)首错。负控按序使用变异位置，未知/资源不足不伪报数学FAIL。TRANSCRIPT SHA对头和全部记录原字节普通SHA256；成功必须包含全部测试、探针和负控，不接受省略记录或只hash正常周期。

## 6 资格载荷 ADMISSION321 与H16

H16沿P0 typed-hash格式，codec1/tag16，payload精确321；本稿解释schema1不另占payload字节，不加一个u16后变成323。typed头仍16字节，完整输入337；不新增hash tag。该payload依次如下。

| 偏移 | 字段 | 字节 |
| --- | --- | --- |
| 0 | D config rule graph_exact_sha leafmap_sha evidence_ref | 六bytes32，共192 |
| 192 | target_scope evidence_kind | 两u8 |
| 194 | challenge_ppm q_ppm | 两u32，共8 |
| 202 | task_applicable | u8，0/1 |
| 203 | task_C | u64 |
| 211 | suite fixture load | 三u32，共12 |
| 223 | DUT_mask | u16 |
| 225 | transcript_sha | bytes32 |
| 257 | positive_edge_bitmap | 64 |

evidence_kind0为BLUEPRINT、evidence_ref为完整sealed Artifact ID；kind1为MANUFACTURED、ref为实际输出Root实例ID。BLUEPRINT叶映射精确为leaf_count:u8后接(role:u8,primitive:u8,descriptor:u32)6字节行，BIO361字节；MANUFACTURED为leaf_count:u8后接可信执行LeafMap70行，BIO4201字节。两者按(role,primitive)升序且恰目标完整原语集；普通SHA256覆盖包括count的完整bytes。没有假实例/假Snapshot补位。

D/config/rule/Graph/叶映射/证据身份必须和当前真实制造或种子全部相等。DUT_mask仅使用低15bit，真实成员置1；target之外0。task_applicable1才允许首创任务，且必须符合01完整BIO q2等所有条件；非适用C0。挑战不是q；q按真实最差服务向下.001，不能填入期望值。H16完整typed preimage337字节；Root/Seed存此identity及规定摘要，不能传一串裸hash自证。

本地成功记录Header16=magic BIOP6Q14||schema:u16=1||target:u8||reserved0||body_len:u32=321，加该payload，共337。它不附带可授予权限的签名；正式程序同笔重算。

## 7 本地失败与检查报告

本地Report头16=magic BIOP6R14||schema1:u16||target:u8||reserved0||body_len:u32。body固定：status:u8(1PASS/2FAIL/3UNKNOWN)||reason:u16||test:u8||round:u16||phase:u8||role:u8||port:u16||q:u32||task:u8||C:u64||admission_id32||transcript_sha32||checks:u8[8]，合95字节，完整111。checks分别输入解码、来源、结构、夹具、73转移、88探针、隔离负控、品质任务；0未执行/1通过/2失败/3未知。

PASS reason0、全部checks1，admission_id=H16；FAIL的reason非0、q/task/C/admission全0，记录首错；UNKNOWN同样不能留下可用资格，只能报告已取回的轨迹前缀SHA，不能标成完整transcript。非相关定位域0。PASS的transcript_sha才是完整串。Report不属于P0账户或result<=256的新增例外。

内部reason闭集：0 OK；1 BAD_CODEC；2 BAD_PROVENANCE；3 STRUCTURE；4 FIXTURE；5 INTEGER；6 STOCK；7 LOCAL_ENERGY；8 PORT_CAP；9 MACRO_CUT；10 CONTROL_SOURCE；11 CONTROL_FRAME；12 TASK_PERMISSION；13 GUARD；14 MATERIAL_BALANCE；15 STATE_BOUNDARY；16 MECHANICAL_WORK；17 QUALITY；18 PROBE；19 ISOLATION；20 TASK_ADMISSION；21 TRACE_CODEC；22 UNKNOWN_INPUT；23 UNKNOWN_RESOURCE。1—21是有限真实反例，22/23仅UNKNOWN。外部702统一映射其文中结构/功能/来源错误，不能直接把reason当链CustomError。

## 8 实现后独立验证

须由两个独立实现逐字节比对完整E172和负例的State/Frame/Trace/H16，实际测完整同笔执行资源；若CPU、账户加载或日志资源不够，必须停在未准入，不能改成相信客户端PASS。本文给出字段与期望，不声称已有可运行的模拟器、部署或链上性能。


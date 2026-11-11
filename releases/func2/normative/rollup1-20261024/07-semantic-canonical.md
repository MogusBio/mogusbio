# ROLLUP1／P6.3 语义规范编码

2026-10-24。本稿固定设计等价与H7，不改变已造根、材料或功能参数。输入为[P6-STRUCTURE1](../p6-structure1-20261024/01-graph-codec.md)严格可解码且结构通过的完整Graph；制造入口还须按[06](06-synthesis-abi.md)核真实来源并按[01](01-function-semantics.md)执行功能。语义编码不替代这些检查。本稿不开放601/602/603写指令。

## 1 三种字节身份

| 身份 | 精确定义 | 能证明什么 |
| --- | --- | --- |
| 实际Graph摘要 | SHA256(原Graph完整字节) | 实际物理提交及子图继承；含D/config、原端口和声明的零边 |
| Artifact摘要 | SHA256(原Artifact完整payload) | 原始图、真实叶映射及来源胶囊的确切承载；见04 |
| design_id | H7(本稿CanonicalBytes) | 同一功能规则下、本文且仅本文等价变换后的设计身份 |

SHA256是普通SHA256；H7是P0 typed hash：`BIOHASH\0 || codec:u16=1 || tag:u16=7 || payload_len:u32 || payload`。ASCII前缀8字节，所有整数小端定宽；不是把十六进制字符串再hash。没有钱包、根ID、材料批次、Artifact ID、提交时间、作者、salt、名称、请求q、客户端报告或显示折线节点进入CanonicalBytes。材料免除、权限继承、首次披露或首创资格均不能由H7推出。

## 2 规范化输入及拒绝边界

接受的对象只有P6 Graph schema1、target为CELL/ORGAN/BIO的完整目标子树。按获准Config核catalog和rule_hash；rule_hash必须等于Config.functional_validator_hash，不接受客户端新规则。节点、角色、端点、LCA、固定边、Open、v、tier和slots均先按结构规范核验。未知schema/规则、重复边、非法端口、未完成子树或非规范整数编码不进入H7，不能先hash后放行。

CELL/ORGAN的开放接口是完整设计的一部分，不把尚未连接的环境自由选择填进语义；对应Open按实际内部边重算。BIO须全部闭合。完整物理Graph保存在不可变Artifact内，规范化只在工作副本操作，不能重写实际Graph、父层承诺或输入Root证据。

## 3 唯一允许的三个步骤

步骤依下列顺序；没有以相同输出、相同C、相同q、名称相似或预测生物功能相似为由增加等价关系。

### 3.1 删除声明的零比例N/O/W边

仅从副本删除type1/2/3且fraction_ppm=0的边，重建edge_count并按原边排序规则重排。其余边保留，包括所有固定非物质边与固定物质边。不能删除fraction>0但某次没有通量的边；功能测试的正通量并集仅决定C，不替代语义图。零边删除不改变Open；必须再按保留边重算并确认与原Open相同。

### 3.2 同一B、同一物种的两个等能力口置换

对实际存在的每个细胞B，独立处理N口1/2、O口3/4、W口5/6。只有这三对允许交换；不换角色，不交换N/O/W，不交换S源/汇，不交换B7及以后端口，不交换E/I/S端口。原两个口均有相同cap0.5、同一capacity_owner；交换后仍逐口及合并核cap。

对N/O收集该B目标口的所有正比例入边；对W收集该B源口的所有正比例出边。每个口的column这样编码：`entry_count:u8 || Entry10[]`。Entry10依次为owner_scope:u8、对端Endpoint5、fraction_ppm:u32；Entry按(owner_scope,对端kind/role/sub/port,fraction数值)整数元组严格排序。合法目录中每column至多2项；无边编码为00。比较column时按实际编码的无符号字节字典序，不把LE整数重新按十进制比较。

两column较小者映到该物种较低端口号，较大者映到较高端口号；相同则保留映射，因两列完全相同而输出相同。映射仅改该B端点port字段，随后全Edge按P6规定的整数元组重排。每边至多一个可置换B端点；目录禁止B到B的N/O/W边，所以各对独立归一，无需枚举2的45次方种全局组合。空column00小于非空column，因此E172硬角色仅一个有效O或W分支时，正边在语义副本落在该物种高口；这不改变原物理Graph的低口选择。

本步骤保留owner/LCA、物种、对端、比例、能力总量及全部因果边。置换前后目录能力、合法性、功能与C须相同；这里是有限对称性，不授权任意图同构、角色重命名或上下文权限交换。

### 3.3 BIO矩形四镜像

仅BIO有15个几何槽，候选变换恰为：I:(x,y)、LR:(4−x,y)、UD:(x,2−y)、R180:(4−x,2−y)。每个变换只改Slot3中的x/y，保留role并按role升序；控制axis_A/B、动态机械位置、节点、端口、边、v和tier不随槽位反转。5×3无90度/270度旋转，也不交换x/y域。

对每个候选按第4节完整编码，取无符号字节字典序最小者作为CanonicalBytes。相等时输出完全相同，无需另记镜像标签。CELL/ORGAN无slots，只编码一次。不能通过镜像修改既造子根的内部图或免费重新布局。

## 4 CanonicalBytes精确布局

CanonicalBytes不是P6 Graph的原16字节头，也不是其完整body。依次为：

| 顺序 | 字段 | 编码 |
| --- | --- | --- |
| 1 | semantic_schema | u16=1 |
| 2 | target_scope | u8，原目标scope |
| 3 | material_catalog_hash | bytes32，获准catalog |
| 4 | functional_rule_hash | bytes32，获准rule |
| 5 | node_count / nodes | u8，随后Node4数组，P6规范排序 |
| 6 | cell_count / cells | u8，随后Cell5数组，按role |
| 7 | tier_count / tiers | u8，随后Tier2数组，按scope |
| 8 | edge_count / edges | u16，随后规范后的Edge16数组 |
| 9 | open_count / opens | u8，随后Open6数组，按(role,species) |
| 10 | slot_count / slots | u8，随后Slot3数组，按role；已选最小镜像 |

Node4、Cell5、Tier2、Edge16、Open6、Slot3的字段和范围完全引用P6-STRUCTURE1，不二次定义opaque graph。metadata中的D/config以及Graph头magic/schema/reserved/body_len不复制；schema1本身通过semantic_schema和获准rule解释。根/Artifact仍单独校验同D/config，不因语义跨部署相同而获得资产跨域权限。

设节点n、细胞c、保留边e、槽s，所有目标都有n个Tier、3c个Open；CanonicalBytes长度恰`74+6n+23c+16e+3s`。BIO n22/c15/s15，长度`596+16e`：

| 完整BIO | e | CanonicalBytes | H7完整typed输入 |
| --- | ---: | ---: | ---: |
| E172、无声明零边 | 342 | 6068 | 6084 |
| 标准180物质边 | 350 | 6196 | 6212 |
| 目录全440边均保留 | 440 | 7636 | 7652 |

实际Graph对应6145/6273/7713字节；不能把上述语义长度误当原图长度。删零边后的e只会下降。完整功能转录、品质和C不进入H7，因为它们必须由同一设计及获准函数确定；证书不一致是09的错误证明对象，不能用另一份H7掩盖。

## 5 披露与种子的关系

完整披露存原sealed Artifact及H7，其他人可从实际完整图重建同一CanonicalBytes；只给H7/URI/半个Artifact不算已登记的完整披露。本文“首次”仅指08登记协议事件的可验证先后，不保证全网、现实科研或所有公开原始字节中的第一次。Artifact上传/SEALED并非自动Disclosure，但链上原始bytes已公开；先上传再COMMIT可能被别人读取并抢先承诺。客户端必须先确认有效COMMIT再公开新设计Artifact，不能宣传上传过程保密。复制、换owner/op_id、合法端口置换、四镜像及加零边不会刷新同design_id已登记的首次披露。不同H7也不自动首创，08仍要求严格改进和完整知识时序。

SEED1十二来源记录当前规范后仍十二不同设计：C不同先区分十组；仅S09/S10同C330，其槽位只交换C14/C15，既非全矩形镜像，双口置换也不改变槽，故不等价。上线仍逐份执行本规范及功能算法，不能只信这段计数或旧Markdown文件hash。

## 6 CAN24静态验收期望

以下是实现验收规格，未执行程序；原物理Graph不因预期等价而改写。

| ID | 输入变化或边界 | 期望 |
| --- | --- | --- |
| CAN01 | 相同原Graph不同owner | 相同CanonicalBytes/H7；来源另核 |
| CAN02 | 不同D/config、相同获准catalog/rule和结构 | 语义H7相同；资产不能跨域 |
| CAN03 | 只加合法fraction0 N边 | 原Graph SHA变，H7不变 |
| CAN04 | 零边导致重复或非法端口 | 先结构拒绝，不进入canonical |
| CAN05 | 删除正比例但当前RUN无通量的边 | 不能借本规范视为相同 |
| CAN06 | 单B N1/2合法互换 | H7不变，原图/Binding不改 |
| CAN07 | 单B O3/4合法互换 | H7不变 |
| CAN08 | 单B W5/6合法互换 | H7不变 |
| CAN09 | 45对任意组合合法互换 | 同一规范输出，不穷举执行 |
| CAN10 | column相同 | 任选原映射得到相同Edge集合 |
| CAN11 | 空column与正column | 空落低口，正落高口 |
| CAN12 | Entry排序改为显示字符串序 | 拒绝该编码器输出 |
| CAN13 | 两个N源角色对换 | 不属于端口对称，按真实结构处理 |
| CAN14 | B7/Nstock或RO口改名 | 不允许按双口置换归一 |
| CAN15 | BIO左右镜像 | H7不变 |
| CAN16 | BIO上下镜像 | H7不变 |
| CAN17 | BIO180度镜像 | H7不变 |
| CAN18 | BIO90度旋转或x/y交换 | 非法槽域或不同设计，不列入等价 |
| CAN19 | 只镜像slot却反转axis力符号 | 额外控制改动不被允许 |
| CAN20 | 只改v或tier | 保留字段，H7变化（或结构拒绝） |
| CAN21 | 同q/同C而实际连接不同 | 可不同H7，仍无同成本首创奖励 |
| CAN22 | E172完整编码 | 6068payload、6084typed；原图6145 |
| CAN23 | BIO全440边 | 7636payload、7652typed；原图7713 |
| CAN24 | root子图继承比较使用规范副本 | 拒绝；继承必须比原物理投影 |

实施后门槛包括独立编码器向量、镜像/双口组合的不变量、严格解码、真实费用和同笔执行资源；这些是实现验收，不是尚缺语义规则。没有声称已发现可领奖的成本<328新设计。

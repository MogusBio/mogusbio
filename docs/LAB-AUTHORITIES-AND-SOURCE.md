# LAB 权限、源码与外部显示

更新：2026-10-26。用户决定**暂不公开 GitHub**。只保存本地源码与发布资料，不声称已对外开源或取得浏览器／GMGN验证标签。当前无主网部署授权。

## 权限逐项验收

| 项目 | 固定处理 | 当前证据边界 |
| --- | --- | --- |
| LAB供应量 | INIT一次创建100,000,000 LAB储备，6位小数 | 原生本地验收已覆盖，Devnet尚待真实INIT |
| Mint authority | 创建时协议PDA临时铸造固定储备，INIT内SetAuthority(None) | `initialize.rs`；部署后必须独立读82字节Mint确认None |
| Freeze authority | InitializeMint2时即None | 同上；实际读Mint确认None |
| Reserve owner | 固定协议PDA，根据冻结排放及已验证债务支付 | 必须保留以执行合法领取；它不是继续增发权限，也不是玩家管理员提款口 |
| Program upgrade authority | Loader-v3不可升级后才允许INIT | 本地部署/恢复测试；真实不可升级和字节码一致仍需链上记录 |
| Ops 3/5 | 既定SOL运营费用支出权限 | 此角色仍存在，不使用“所有权限均放弃”的宣传口径；不得与LAB增发/冻结混为一谈 |
| 元数据 | Token名称、Logo、URI发布和不可变状态单独确认 | 当前不把UI名称当成已发布的链上元数据 |
| 源码公开 | 暂不公开GitHub，保存597文件源码清单及完整本地包 | 对外开源待用户恢复该要求后执行 |
| 可验证构建 | 公开commit、固定工具链/锁文件、容器可复现构建与链上ELF核对 | 当前本机SBF v3构建及hash不是第三方远程Verified徽章 |

冻结升级权限后程序不能再更新或关闭，程序存储资金不能通过关闭程序退回。因此正式主网的构建体积、完整验收和源码验证顺序必须先核清，再执行不可逆的最终冻结。Devnet身份不复用于主网。

## GMGN判定

[GMGN官方中文文档](https://docs.gmgn.ai/cn/dai-bi-an-quan-jian-ce)把“已开源／已放弃”列在ETH代币部分；其中开源指Etherscan源码公开。Solana栏核对Mint权限和冻结/黑名单等链上状态。[GMGN官方说明](https://gmgn.ai/blog/how-to-check-if-a-solana-token-is-safe/)进一步明确Solana字段 `renounced_mint`、`renounced_freeze_account`。

不能为了显示勾选而伪造状态，也不能用Devnet测试替代主网收录后的实际显示。官方对各网络、浏览器标签的支持以当时真实数据为准。

源码公开与链上代码对应的标准流程参考[Solana Verified Builds](https://solana.com/docs/programs/verified-builds)。正式执行时应在需要升级权限签名的验证元数据写入完成后，再撤销升级权限；当前Devnet本机部署哈希对比不代替该公开服务流程。

## 当前体积和主网预算口径

当前正式模式SBF v3 ELF为1,049,256字节，约1.05 MB，包含整个协议；不是单独LAB Mint，也不是每位玩家／每个作品重复部署一份。

主网只读RPC实测（`evidence/mainnet-readonly-cost-quote-20261026.json`）：程序与ProgramData最低存储余额5.33193244 SOL；79个开场账户0.76718668 SOL；部署及开场网络费预留0.01149 SOL；既定服务总支出上限0.34 SOL；合计6.45060912 SOL。这是当前尺寸启动口径，含费用估计和服务预算，不是每日收费，不含玩家后续账户、服务器/RPC、流动性或独立审计。

LAB Mint的82字节账户本身存储最低余额为0.0010668 SOL，不能把整个协议存储成本称作“发行一个币的手续费”。体积优化试编译只在独立目录进行，未完成原生计算资源与正确性验收的候选ELF不得替换已冻结构建或用于部署。

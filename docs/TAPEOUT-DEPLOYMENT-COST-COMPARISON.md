# TapeOut 部署费用：已核实与未核实

2026-10-26，只研究用户指定原版 `tapeout.net`，BNB Chain chainId56。未把TapeOutETH、tapeout.world或其他仿版的费用混入。

一手资料：[官方5页白皮书](https://tapeout.net/TapeOut-Protocol.pdf)、[官方客户端](https://tapeout.net/app/assets/index-DsAkZLRU.js)、[官方只读RPC](https://tapeout.net/rpc)、[协议方TapeKit规范](https://github.com/TapeOutProtocol/TapeKit/blob/main/SPEC.md)。实际方法、固定区块与结果见 `evidence/tapeout-deployment-architecture-readonly-20261026.json`。

## 结论

TapeOut也有最初的协议部署Gas。但没有取得全部合约的创建交易收据，本次无法给出可信的整套初始部署BNB账单。玩家调用createCPU的协议收费、创建实例Gas、交易市场费用，不等于项目方部署整个协议的成本。

固定区块129,870,199实际读取：Factory代理130字节，共享implementation7734字节；Circuits代理295字节，beacon619字节，共享implementation12560字节；Transistors代理295字节，beacon619字节，共享implementation9265字节。另一真实CPU与Genesis共用Circuits实现，直接说明后续项目不重部署整套执行逻辑。仅代理字节数不能当成整套协议代码或总代价。

白皮书将电路逻辑定义为数据，工厂生成一致的处理器执行规则。读求值与写入部署/流片交易的收费口径也不同，不能把免费eth_call当成所有链上操作均免费。

我们的Solana实现同样是全网共用一个程序，不是每个玩家部署1.05MB。其约6.45SOL启动口径主要来自当前完整程序和79个开场账户的最低存储余额，不能称作相同意义的“Gas很贵”。TAPE的BNB Gas账单与Solana租存不能直接按币的数量或代理大小比较。

用户0.1–0.2SOL主网硬预算继续有效；TAPE的部署机制不能用来证明当前昂贵方案必须保留，也不能证明完整同功能Solana协议必定能在该预算内完成。下一版须先测程序字节、初始状态、真实性验证和费用，再定范围。

本次BscScan在工具和浏览器均遇到访问验证；公开创建API和可用历史RPC未返回需要的创建回执，已停止进一步扫描。未尝试绕过访问挑战。当前工厂、市场、挖矿等模块的权限状态须分别核对，不能用旧白皮书的一句弃权推定整套现行协议都不可升级。

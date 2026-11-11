# 点击体验与三市场本地验收

日期：2026-10-25。已完成本机体验与本地回归，未部署。**正式原生市场、挂牌期间继续产出及成交收益切分尚未实现**；本地先行挂牌锁不等于TAPE同等规则。

当前源码497文件，releaseHash `c29dfa9abeb8d732765de5efc8635cec4f7d61683381f09c21511d1180c02e44`。最终完整Node回归992/992通过、0失败；14份数学模型、四类原料、一亿LAB、生产ABI和原生ELF保持原身份。原生ELF为`67c79ff71e977ade39d0823b561c7d8d13c0669060d0ed83dff4a2031afad100`。本轮没有新执行原生链交易。

## 修复和完成

- 普通成品交接切到正确作品页并重置历史分页；历史权益保留精确单条选择；看板选中作品自动带入操作ID。
- 未应用JSON不再被图形编辑覆盖；实验超时、取消和旧响应不会恢复过期PASS；合成计划清除旧图并切到正确模式。
- 一键本机账号，套装/输入/费用自动带入；两只生物时，英雄按钮作用于当前选中的那只。
- 网络中断、截断JSON或错误格式保留原请求，按同一requestId重试；start、动作、重置均幂等，持久化未知结果不会冒充失败退款。
- WORK挂牌跨层校验冲突、正常nullable费用误拒已修；响应成员和市场分类/金额明确校验。
- 原料、成品、生物三个独立市场，现有资产托管、买卖、取消、测试对手成交及实际库存/owner交付。测试对手先真实购料、制造，转卖不增发。

## 浏览器实际路径

同一本机账号从购一套120份原料开始，制造60部件→15细胞→6器官→C310生物；升级销毁48 LAB，余额48.225840→0.225840。登记推进两个测试小时后领取0.470890 LAB；退出并再推进一小时后领取0.470890 LAB，余额1.167620，待领0。

逐项走通原料买入/挂牌/取消/测试出售、成品买入/挂牌/取消、生物挂牌/取消/测试出售。AA一份0.0005测试SOL，所购部件0.0012测试SOL，最终生物0.072测试SOL，均为明确的本地固定测试报价。生物售出从自有成品消失；旧LAB余额不转给对手。

刷新和服务器重启后保留61个自有成品、1.167620测试LAB及9.854778807测试SOL。随后明确重置，交付给用户的是60个可合成部件、120份备用原料、48.225840测试LAB的初始状态。页面没有input/textarea，不需手填地址/ID；实际1280×720浏览器无横向溢出，最终记录无console错误。

本轮UI是HOST参考模型，System/PDA/rent与测试SOL明确适配；材料、验证和奖励使用既有模块。其baseline的48.225840 LAB与此前原生Bank记录48.083160 LAB属于不同账本/历史，不能混称同一证明。旧23,709笔原生完整链报告保持原配置和身份。

## 证据与边界

- [机器验收记录](../evidence/click-playtest-three-markets-acceptance-20261025.json)
- [最终全量日志](../evidence/click-playtest-three-markets-final-20261025.log)
- [15项实际参考运行与市场](../evidence/playtest-market-and-runtime-final-20261025.log)
- [21项UI/HTTP/恢复接口](../evidence/click-playtest-ui-http-final-20261025.log)
- [实际浏览器逐步记录](../evidence/click-playtest-browser-steps-20261025.json)
- [源码清单](../releases/production/source-manifest-20261025-click-playtest-markets.json)及[精确源码归档](../releases/production/source-archive-20261025-click-playtest-markets.tar.gz)
- [使用指南](LOCAL-CLICK-PLAYTEST.md)、[模块修改指南](MODULES-AND-CHANGE-GUIDE.md)、[正式市场缺项与TAPE核对](MARKET-SPEC-AND-NATIVE-GAPS.md)

真实钱包、目标RPC、生产签名器/运维接入、原生市场及实际环境验收仍未完成。原生程序当前33操作没有生产LIST/FILL/CANCEL；本地通过不是正式流动性、链上并发或无未知漏洞的保证。独立安全审计按用户要求暂不安排。

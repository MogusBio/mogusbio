# 参考样本与构造进度说明修正

日期：2026-10-26。当前公开参考17个；本机预置账号只接C310固定批量路径。规则内自定义设计可通过既有主站模块验证、逐件制造和逐目标合成；测试账号尚未接通该完整流程。17个设计不是允许合成构造的白名单，也不表示17种真实生物物种。

## 本次修正

- 工坊显著标明“公开参考样本／固定C310／批量执行”，解释开局60部件属于预备样本，不是玩家刚刚完成的逐件设计。
- 样本按钮明确标出批量制造60件、合成15细胞、6器官和1生物。没有改动作、kitId、材料消费或费用规则。
- 当前所选套装的进度仅来自RAW/PARTS/CELLS/ORGANS/BIO阶段，不再读全账户动作集合。其他套装完成BIO不会把当前RAW套装显示为五步都完成。
- 本步费用取所选kit.upgradeCostAtoms，拒绝借用另一套装的全局报价；缺失费用显示待核对，锁定或缺件仍不能执行。
- 新增设计实验、单件制造、单件合成的新标签入口，说明与预置账号的数据独立。没有把这些链接包装成已完成的自由构造接入。

新增sample-construction.js只管理样本展示与阶段描述；后端、科学/经济规则、原生程序与测试账号库存均未修改。后续真正逐件流程按[模式与缺项](CONSTRUCTION-MODES-AND-GAPS.md)独立接入。

## 验收与数据保留

全量1011/1011通过，0失败；聚焦28/28通过，其中新增3项实际挂载用例覆盖跨套装进度、当前套装报价、只读选择、单次批量请求及UNKNOWN精确重试。

实际1280×720浏览器只读验证：PARTS样本的进度为前序／当前／未来／未来／未来；RAW为当前／未来／未来／未来／未来。费用分别显示12 LAB与不收LAB制造费，三个独立入口与目标一致，无横向溢出、console错误。没有点击制造、合成、推进时间、领取或重置。两份既有测试账号文件在验收前后逐字节一致。

本次没有执行新的链上交易、原生Bank、真实钱包或手机设备验收。四类原料、一亿LAB与14份数学模型身份不变，正式市场及挂牌持续产出仍是独立未完成项。

## 固定记录

- [机器验收](../evidence/sample-construction-acceptance-20261026.json)
- [全量日志](../evidence/sample-construction-full-20261026.log)
- [聚焦日志](../evidence/sample-construction-focused-20261026.log)
- [只读浏览器记录](../evidence/sample-construction-browser-20261026.json)
- [数据保留结果](../evidence/sample-construction-data-preserved-20261026.json)
- [源码清单](../releases/production/source-manifest-20261026-sample-construction.json)：507文件，releaseHash `6f73c531ca3458397e7a1c07920d0c8198f3fcf4486a1f82a863e1f70f89f793`
- [精确源码归档](../releases/production/source-archive-20261026-sample-construction.tar.gz)

以前504文件／1008项及所有历史快照保留原身份。测试全部通过只说明已实现路径通过其验收，不代表尚未实现的自由构造流程已经完成。

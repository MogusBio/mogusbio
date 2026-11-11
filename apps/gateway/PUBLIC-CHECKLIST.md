# 公网用户层：编码前检查

- 公网入口独立于本地工作台，默认不启动；固定HTTPS origin、发布和RPC，不从Forwarded、请求体或Cookie选择身份/网络。
- 消息签名登录不是交易授权；挑战绑定站点/发布/Actor/时限且仅消费一次。会话只保留哈希，HttpOnly/Secure/SameSite=Strict，注销/过期与重启可核验。
- 所有native POST须登录，主体Actor等于会话Actor。inspect/simulate可由真实必需共签人查看规范信封；不能据前端claimed signers放行。
- 不同Actor隔离耐久日志、清单和恢复。相同Actor多会话共享同一nonce历史；不能因换浏览器产生并行账本。
- research-next跨作者仅允许作者清单指定的cranker；在角色校验前不创建作者session目录。
- Host、Origin、JSON、大小、并发和有界速率先检查；不信任代理传来的IP/Origin。未知路由和错误不暴露路径、Cookie或私有设计。
- 钱包登录/切换/注销清除旧页面草案和签名。真实签名发送仍经过现有P10.1，各步必须明确点击。
- 逐层验收重放挑战、并发登录、过期、重启、换号、跨租户读写、共签权限及真实HTTP；不部署、不使用真实钱包或资金。

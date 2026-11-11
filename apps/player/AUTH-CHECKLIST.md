# 钱包登录页面：编码前检查

- [x] 仅发现钱包和读取站点会话不请求签名；连接、读取挑战与签署登录消息分别明确点击。
- [x] 签名前展示完整挑战，精确核13行、origin/release/ABI/domain/config/Actor、Nonce及Issued/Expiration。返回signedMessage及请求buffer都必须与签名前快照逐字节相同。
- [x] Cookie由服务端HttpOnly设置；JS不存储token或签名。登录不是链上交易授权。
- [x] 登录/注销/钱包账户切换广播统一失效事件，清除所有旧草案、签名和交易交接；不删除服务端历史日志。
- [x] 公网原生入口只有authenticated配置才启用；本地模式保留原来行为。
- [x] 异步登录、配置、钱包变化使用generation+AbortController，旧成功不能恢复旧会话。
- [x] 窗口重新获得焦点时重读会话；相同会话不重复清草案，失败/到期/跨标签注销清空身份。私有设计不写浏览器持久存储。
- [x] Cookie写请求串行且不因钱包变化中断；合并待处理logout。旧login之后强制logout完成前不能开始新login。
- [x] 跨标签先发不含秘密的session-invalidated仅清空，logout完成后session-changed才重读；接收标签若有旧login在途，也在其后排队logout。
- [x] 钱包账户公钥必须编码为所显示地址。Connect同步change事件是预期账户返回，不会撤销并中断自身。
- [x] fetch及响应body都独立受超时约束；请求4KiB/响应16KiB，限定同源路由、JSON、禁止重定向，钱包/供应商原始错误不直接展示。

`node --test test/auth-panel.test.mjs`：10/10通过，证据
`evidence/auth-panel-current.log`；模块和测试语法检查通过。
测试读取真实HTML，使用真实gateway.handler、bridge配置、public-auth耐久存储
和临时Node Ed25519密钥，精确覆盖session顶层context及login.session.context。
受sandbox禁止listen限制，HTTP传输在进程内执行真实handler并读取其序列化正文、
响应头及cookie清除语义；没有虚构登录业务响应或发送链上交易。

跨7个业务控制器清理事件的最终集成由各控制器测试覆盖；本模块只发统一事件，
不会删除耐久交易日志。未上线，未使用真实钱包密钥，未安排独立审计。

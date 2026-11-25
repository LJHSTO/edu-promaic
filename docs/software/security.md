# 课堂安全与部署

知点提供两种运行配置。演示配置默认监听回环地址，使用匿名学习记录。机构部署使用 HTTPS，由机构身份系统完成多因素鉴别。应用校验访问令牌并按班级分配学生、教师和审计员权限。

## 身份与授权

机构签发面向课堂 API 的 RS256 访问令牌，应用使用配置绑定的 RSA 公钥验签。令牌包含 `iss`、`aud`、`sub`、`client_id`、`jti`、`iat`、`exp` 和机构认可的 `acr`，如带 `nbf` 则一并校验生效时间。令牌有效期最长 15 分钟。`acr` 所代表的鉴别方式由机构身份系统执行并验证。 [访问令牌规范](https://www.rfc-editor.org/rfc/rfc9068.html#section-4) · [JWT 安全实践](https://www.rfc-editor.org/rfc/rfc8725.html)

命令行及服务客户端使用 `Authorization: Bearer`。浏览器通过与课堂同源的机构登录服务取得 `__Host-edu-promaic` Cookie。登录服务设置 `Secure`、`HttpOnly`、`Path=/` 和 `SameSite=Lax` 或 `SameSite=Strict`，将 Cookie 限定在本站主机。携带 Cookie 的写入必须来自配置中的 HTTPS 源。学生、教师和审计员权限由服务端班级名册确定。

| 角色 | 班级权限 |
|---|---|
| 学生 | 读取已发布课件，创建、恢复和提交本人学习会话 |
| 教师 | 发布所管班级的课程，查看该班的汇总和学习回放 |
| 审计员 | 读取所管班级的近期审计记录，入口为 `GET /api/classroom/audit?class=班级编号`，最多返回最近 50 条 |

## 学习记录与智能体

受保护的课堂记录按班级保存，使用 AES-256-GCM 加密。审计按请求记录操作、结果、时间和主体代号，使用独立密钥计算 HMAC 链。审计报表面向运营人员，学习回放面向授课教师。轮换数据或审计密钥前，先验证现有记录的读取、恢复和迁移流程。

服务端根据会话阶段决定是否提供帮助。独立验证阶段只接受作答。智能体按当前课包版本查询已发布材料，使用限定的工具和引用范围。任务输入为课包版本、练习阶段和结构化学习状态，机构账号标识留在身份与会话层。 [系统架构](architecture.md)

## 机构部署

1. 配置机构身份系统和 HTTPS 站点。为课堂 API 注册专用受众，确认令牌的 `acr` 对应机构批准的多因素鉴别方式。把签发方公钥、站点 TLS 证书和私钥放在专用服务账号可读的位置。
2. 准备部署配置。`issuer` 对应签发方声明，`origin` 为课堂对外的 HTTPS 源。将实际班级与机构账号编号录入 `memberships` 名册，同一账号在同一班级对应一个角色。以下为示例配置。

   ```json
   {
     "issuer": "https://identity.example.edu",
     "audience": "https://learn.example.edu/api",
     "origin": "https://learn.example.edu",
     "publicKeyFile": "/etc/edu-promaic/identity-public.pem",
     "acceptedAcr": ["urn:example:auth:mfa"],
     "memberships": [
       { "subject": "student-01", "classId": "calculus-a", "role": "student" },
       { "subject": "teacher-01", "classId": "calculus-a", "role": "teacher" },
       { "subject": "auditor-01", "classId": "calculus-a", "role": "auditor" }
     ],
     "defaultClass": "calculus-a",
     "dataDirectory": "/var/lib/edu-promaic",
     "tlsCertFile": "/etc/edu-promaic/tls/chain.pem",
     "tlsKeyFile": "/etc/edu-promaic/tls/private-key.pem"
   }
   ```

3. 为 `dataDirectory` 设置服务账号专有权限。使用机构密钥服务为 `CLASSROOM_STORE_KEY` 和 `CLASSROOM_AUDIT_KEY` 分别注入独立的 32 字节密钥，环境变量采用标准 Base64 编码。课堂数据目录由一个服务进程写入。班级快照明文和审计文件的上限分别为 2 MiB。机构部署需集中保存审计记录，设置容量告警并演练归档和恢复。
4. 启动受保护配置，按接入拓扑设置 `HOST` 和 `PORT`。通过机构登录服务完成浏览器登录，用三个角色分别验收学习、发布和审计操作，再用另一个班级确认访问隔离。

   ```bash
   npm ci --ignore-scripts --omit=dev
   NODE_ENV=production CLASSROOM_PROFILE=protected CLASSROOM_SECURITY_CONFIG=/etc/edu-promaic/security.json npm start
   ```

`npm test` 验证令牌校验、同源写入、班级和会话隔离、加密恢复及审计读取。机构选择启用外部选材时，模型仅接收公开课包片段和提示等级。登录体验、证书信任链、身份目录、存储和日志接入应在目标环境使用验收账号验证。 [系统架构](architecture.md) · [代码质量报告](code_quality.md) · [代码评审记录](code_review.md)

## 等保三级对照

项目以 GB/T 22239—2019 的第三级安全要求作为机构部署目标。运营单位依据实际业务影响和系统边界定级、办理备案，并将目标环境交由符合条件的测评机构按 GB/T 28448—2019 开展等级测评。云部署同时核对适用的云计算安全扩展要求和供应方责任。第三级系统每年至少测评、自查各一次，整改后保留可复核材料。 [定级与实施标准目录](https://openstd.samr.gov.cn/bzgk/std/std_list?p.p1=0&p.p2=%E7%BD%91%E7%BB%9C%E5%AE%89%E5%85%A8%E7%AD%89%E7%BA%A7%E4%BF%9D%E6%8A%A4&p.p90=circulation_date&p.p91=desc) · [安全基本要求](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=BAFB47E8874764186BDB7865E8344DAF) · [等级测评要求](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=7E736CDF4502B6FF1258DD250AA3EC8C) · [信息安全等级保护管理办法](https://www.miit.gov.cn/jgsj/xxjsfzs/xxgk/art/2020/art_a981907528694176a61b5b52c2d19895.html)

| 控制领域 | 应用交付 | 目标环境验收材料 |
|---|---|---|
| 安全物理环境 | 部署边界和设备清单随机构配置确定 | 机房或云平台的环境、物理访问和容灾证明 |
| 安全通信网络与区域边界 | HTTPS、同源写入和身份验证 | 网络拓扑、区域划分、出入口策略、传输保护、监测告警和模型访问边界 |
| 安全计算环境 | 令牌验签、班级与会话授权、数据加密及练习阶段门控 | 机构多因素鉴别策略、OS 和服务加固、密钥管理、数据分类、备份与恢复演练 |
| 安全管理中心 | 单独的审计员角色及审计记录完整性校验 | 安全日志集中采集和告警值守、访问分权、统一时钟与日志留存。相关网络日志按《网络安全法》第二十三条留存不少于六个月。 [现行网络安全法](https://shca.miit.gov.cn/zwgk/zcwj/flfg/art/2025/art_c502acb4374848e0a7752925c72fe775.html) |
| 安全管理制度、机构、人员、建设及运维 | 部署手册、权限边界、版本记录和质量检查 | 岗位职责、账号开通与撤销流程、变更审批、供应商管理、培训、应急演练和事件处置记录 |

商用密码应用单独按系统适用规定管理。依法需要使用商用密码保护的系统，应由运营方制定密码应用方案、核对密码产品及服务要求，并开展商用密码应用安全性评估。 [信息系统密码应用基本要求](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=53282C88712CE157043B7A2C590278FC) · [商用密码应用安全性评估管理办法](https://www.sca.gov.cn/sca/xxgk/2023-10/07/content_1061109.shtml)

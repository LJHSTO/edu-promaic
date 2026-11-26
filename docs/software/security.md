# 课堂安全与部署

知点提供两种运行配置。演示配置默认监听回环地址，使用匿名学习记录。机构部署使用 HTTPS，由机构身份系统完成多因素鉴别。应用校验访问令牌并按班级分配学生、教师和审计员权限。

## 身份与授权

机构签发面向课堂 API 的 RS256 访问令牌，应用使用配置绑定的 RSA 公钥验签。令牌包含 `iss`、`aud`、`sub`、`client_id`、`jti`、`iat`、`exp` 和机构认可的 `acr`，如带 `nbf` 则一并校验生效时间。令牌有效期最长 15 分钟。`acr` 所代表的鉴别方式由机构身份系统执行并验证。 [访问令牌规范](https://www.rfc-editor.org/rfc/rfc9068.html#section-4) · [JWT 安全实践](https://www.rfc-editor.org/rfc/rfc8725.html)

命令行及服务客户端使用 `Authorization: Bearer`。浏览器通过与课堂同源的机构登录服务取得 `__Host-edu-promaic` Cookie。登录服务设置 `Secure`、`HttpOnly`、`Path=/` 和 `SameSite=Lax` 或 `SameSite=Strict`，将 Cookie 限定在本站主机。携带 Cookie 的写入必须来自配置中的 HTTPS 源。学生、教师和审计员权限由服务端班级名册确定。

| 角色 | 班级权限 |
|---|---|
| 学生 | 读取已发布课件，创建、恢复和提交本人学习会话 |
| 教师 | 发布所管班级的课程，查看该班汇总与回放，导出只含会话编号和学习结果的 CSV |
| 审计员 | 通过 `GET /api/classroom/audit?class=班级编号` 读取本班当前审计分段的最近 50 条记录 |

## 学习记录与智能体

受保护的课堂记录按班级保存，使用 AES-256-GCM 加密。审计按请求记录操作、结果、时间和主体代号，使用独立密钥计算 HMAC 链。审计报表面向运营人员，学习回放面向授课教师。轮换数据或审计密钥前，先验证现有记录的读取、恢复和迁移流程。

机构可通过 `sessionRetentionDays` 启用会话留存策略，天数从创建或最后一次成功提交起算。读取和重试沿用原到期时间。应用在启动和运行期间每小时清理到期会话，读取和写入学习记录前也会检查。缺少可信时间的旧记录从首次检查起保留一个完整周期。清理审计只记录班级和处理结果。备份、归档和已导出的文件按机构各自的留存策略处理。

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
     "sessionRetentionDays": 30,
     "dataDirectory": "/var/lib/edu-promaic",
     "tlsCertFile": "/etc/edu-promaic/tls/chain.pem",
     "tlsKeyFile": "/etc/edu-promaic/tls/private-key.pem"
   }
   ```

3. 为 `dataDirectory` 设置服务账号专有权限。通过 `CLASSROOM_STORE_KEY_FILE` 和 `CLASSROOM_AUDIT_KEY_FILE` 提供两个凭证文件，分别保存独立的 32 字节密钥，使用标准 Base64 编码。也可由密钥服务直接注入 `CLASSROOM_STORE_KEY` 和 `CLASSROOM_AUDIT_KEY`。每项密钥选择一种注入方式。课堂数据目录由一个服务进程写入。 [Linux 部署示例](deployment.md)
4. 启动受保护配置，按接入拓扑设置 `HOST` 和 `PORT`。通过机构登录服务完成浏览器登录，用三个角色分别验收学习、发布和审计操作，再用另一个班级确认访问隔离。

   ```bash
   npm ci --ignore-scripts --omit=dev
   NODE_ENV=production CLASSROOM_PROFILE=protected CLASSROOM_SECURITY_CONFIG=/etc/edu-promaic/security.json npm start
   ```

`npm test` 验证授权、留存、加密恢复和审计。`npm run test:protected` 使用临时证书验证文件凭据、到期清理、停机轮转和重启续写。Nginx 测试核对两段 HTTPS、应用授权及日志关联。在目标环境使用验收账号核对机构登录、证书信任链、身份目录、存储和日志接入。机构启用外部选材时，模型输入限于公开课包片段和提示等级。 [系统架构](architecture.md) · [Linux 部署](deployment.md) · [代码质量报告](code_quality.md)

## 审计归档与备份恢复

首次归档时，在可信环境运行 `classroom-audit.js export`，将审计快照和签名检查点交给独立的日志保管方。后续归档带上已保管的检查点。命令验证当前审计链是否延续已确认的历史，再写入新的归档文件。若历史被截短或分叉，命令返回错误。

```bash
export CLASSROOM_AUDIT_KEY_FILE=/etc/edu-promaic/credentials/audit-key
checkpoint=$(node scripts/classroom-audit.js export \
  --file /var/lib/edu-promaic/access-audit.json \
  --checkpoint /srv/audit-custody/previous-checkpoint.json \
  --out /srv/audit-custody/next-audit.json) && \
  (set -C; printf '%s\n' "$checkpoint" > /srv/audit-custody/next-checkpoint.json)
```

首次可信归档省略 `--checkpoint`。复核时可用 `verify` 代替 `export`，保留 `--file` 和 `--checkpoint` 参数并省略 `--out`。归档目录和密钥按岗位分开保管。

活动分段上限为 2 MiB。使用量达到 80% 时安排归档窗口，达到 95% 时优先轮转。服务在启动和跨过阈值时记录 `CLASSROOM_AUDIT_CAPACITY`，每个进程对同一级别记录一次。日志只含告警级别、已用字节和容量上限，可转发至机构日志平台。

受保护操作先写入授权记录，为结果在当前分段内预留空间。容量不足时返回 `503`，业务操作尚未执行。客户端提前断开时，审计结果记为 `error`，表示响应未完成。异常停机或审计写入失败后，按请求编号复核有授权记录而缺少结果的操作。

轮转在维护窗口进行。停止写入后导出当前分段，将完整归档和对应的末尾检查点交由独立保管。`rollover` 核对活动分段、归档与检查点，在新路径生成续写候选，沿用上一段的序号和链头。

```bash
node scripts/classroom-audit.js rollover \
  --file /var/lib/edu-promaic/access-audit.json \
  --archive /srv/audit-custody/current-audit.json \
  --checkpoint /srv/audit-custody/current-checkpoint.json \
  --out /var/lib/edu-promaic/access-audit.next.json
node scripts/classroom-audit.js verify \
  --file /var/lib/edu-promaic/access-audit.next.json \
  --checkpoint /srv/audit-custody/current-checkpoint.json
```

管理员核对候选文件的服务账号权限，在同一目录原子替换活动文件，然后重启。机构可将 `auditCheckpointFile` 指向由独立保管方提供的只读检查点。启动时会核对其与活动分段的关系。每次切换把配置指向新的归档末尾检查点，跨分段核查从各段归档依次进行。

备份操作在维护窗口执行，先停止对课堂数据目录的写入。命令验证课程快照、审计链及备份清单，生成可独立保管的密文副本。恢复较早的学习快照时，用 `--audit-from` 和 `--checkpoint` 保留经过核对的现行审计链。恢复到新目录后，机构先用验收账号核对会话和审计，再按变更流程切换正式数据目录。

```bash
export CLASSROOM_STORE_KEY_FILE=/etc/edu-promaic/credentials/store-key
export CLASSROOM_AUDIT_KEY_FILE=/etc/edu-promaic/credentials/audit-key
node scripts/classroom-backup.js backup /var/lib/edu-promaic /srv/edu-backups/run-001
node scripts/classroom-backup.js verify /srv/edu-backups/run-001
node scripts/classroom-backup.js restore /srv/edu-backups/run-001 /srv/edu-restore/run-001 \
  --audit-from /var/lib/edu-promaic/access-audit.json \
  --checkpoint /srv/audit-custody/current-checkpoint.json
```

备份和恢复使用全新目标目录。保管密钥时保留各备份对应的密钥版本，记录实际恢复用时以及可恢复的数据时间点。审计归档和课堂备份分别匹配机构的日志与学习数据留存策略。

## 等保三级对照

项目以 GB/T 22239—2019 的第三级安全要求作为机构部署目标。运营单位依据实际业务影响和系统边界定级、办理备案，并将目标环境交由符合条件的测评机构按 GB/T 28448—2019 开展等级测评。云部署同时核对适用的云计算安全扩展要求和供应方责任。第三级系统每年至少测评、自查各一次，整改后保留可复核材料。 [定级与实施标准目录](https://openstd.samr.gov.cn/bzgk/std/std_list?p.p1=0&p.p2=%E7%BD%91%E7%BB%9C%E5%AE%89%E5%85%A8%E7%AD%89%E7%BA%A7%E4%BF%9D%E6%8A%A4&p.p90=circulation_date&p.p91=desc) · [安全基本要求](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=BAFB47E8874764186BDB7865E8344DAF) · [等级测评要求](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=7E736CDF4502B6FF1258DD250AA3EC8C) · [信息安全等级保护管理办法](https://www.miit.gov.cn/jgsj/xxjsfzs/xxgk/art/2020/art_a981907528694176a61b5b52c2d19895.html)

| 控制领域 | 应用交付 | 目标环境验收材料 |
|---|---|---|
| 安全物理环境 | 部署边界和设备清单随机构配置确定 | 机房或云平台的环境、物理访问和容灾证明 |
| 安全通信网络与区域边界 | HTTPS、同源写入和身份验证 | 网络拓扑、区域划分、出入口策略、传输保护、监测告警和模型访问边界 |
| 安全计算环境 | 令牌验签、班级与会话授权、会话期限、快照加密、核验式备份恢复、练习阶段门控及 Linux 最小权限服务单元 | 机构多因素鉴别策略、OS 和服务加固、密钥管理、数据分类、备份与恢复演练 |
| 安全管理中心 | 独立审计员角色、审计链、归档和分段续写及启动检查点核验 | 安全日志集中采集和告警值守、访问分权、统一时钟与日志留存。相关网络日志按《网络安全法》第二十三条留存不少于六个月。 [现行网络安全法](https://shca.miit.gov.cn/zwgk/zcwj/flfg/art/2025/art_c502acb4374848e0a7752925c72fe775.html) |
| 安全管理制度、机构、人员、建设及运维 | 部署手册、权限边界、版本记录和质量检查 | 岗位职责、账号开通与撤销流程、变更审批、供应商管理、培训、应急演练和事件处置记录 |

商用密码应用单独按系统适用规定管理。依法需要使用商用密码保护的系统，应由运营方制定密码应用方案、核对密码产品及服务要求，并开展商用密码应用安全性评估。 [信息系统密码应用基本要求](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=53282C88712CE157043B7A2C590278FC) · [商用密码应用安全性评估管理办法](https://www.sca.gov.cn/sca/xxgk/2023-10/07/content_1061109.shtml)

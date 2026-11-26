# Linux 机构课堂部署

参考部署由机构 HTTPS 网关和同机课堂服务组成。网关提供浏览器同源登录，校验 TLS 后转发至 `127.0.0.1:3443`。课堂服务使用独立系统账户，发布目录和配置由管理员管理，课堂快照由单个服务进程写入。 [安全与等保对照](security.md)

## 准备发布目录

选择支持 cgroup v2 IP 过滤的 Linux 和 systemd 252 或更新版本。参考单元要求 `/usr/bin/node` 为机构批准的 Node.js 22 或 24。以下命令在审核通过的提交上执行。构建账户先按锁文件安装生产依赖，再将产物交给管理员，便于核对提交号并回滚程序版本。

```bash
commit=$(git rev-parse HEAD)
bundle=$(mktemp -d)
git archive "$commit" code scripts package.json package-lock.json | tar -x -C "$bundle"
(cd "$bundle" && npm ci --ignore-scripts --omit=dev)

release="/opt/edu-promaic/releases/$commit"
sudo install -d -m 0755 "$release"
sudo cp -a "$bundle/." "$release/"
sudo chown -R root:root "$release"
sudo chmod -R a+rX,go-w "$release"
sudo ln -sfn "$release" /opt/edu-promaic/current.next
sudo mv -Tf /opt/edu-promaic/current.next /opt/edu-promaic/current
```

## 装载配置与凭据

```bash
getent passwd edu-promaic >/dev/null || sudo useradd --system --user-group \
  --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin edu-promaic
sudo install -d -o root -g edu-promaic -m 0750 /etc/edu-promaic
sudo install -d -o root -g root -m 0700 /etc/edu-promaic/credentials
sudo install -o root -g edu-promaic -m 0640 deployment/linux/classroom.example.json \
  /etc/edu-promaic/classroom.json
sudo install -o root -g root -m 0644 deployment/linux/edu-promaic.service \
  /etc/systemd/system/edu-promaic.service
```

1. 编辑 `/etc/edu-promaic/classroom.json`，填写实际签发方、受众、站点源、机构批准的鉴别等级和班级名册。`origin` 填浏览器访问的公开 HTTPS 源，如 `https://learn.example.edu`。根据批准的学习数据留存规则填写 `sessionRetentionDays`，示例为 30 天。 [配置示例](../../deployment/linux/classroom.example.json)
2. 将机构 RSA 签发公钥安装为 `/etc/edu-promaic/identity-public.pem`，将后端证书链安装为 `/etc/edu-promaic/tls-chain.pem`。两者由 `root:edu-promaic` 持有，权限为 `0640`。请为后端证书设置网关使用的内部 DNS 名称。
3. 通过机构密钥分发流程把独立的存储密钥、审计密钥和后端 TLS 私钥分别写入 `/etc/edu-promaic/credentials/store-key`、`audit-key`、`tls-private.pem`。这些源文件由 `root:root` 持有，权限为 `0600`。存储密钥和审计密钥分别采用 32 字节的标准 Base64 表示。systemd 将凭据副本挂载为只读文件，用于服务启动。 [systemd 凭据说明](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#Credentials)

```bash
sudo systemd-analyze verify /etc/systemd/system/edu-promaic.service
sudo systemctl daemon-reload
sudo systemctl enable --now edu-promaic.service
sudo systemctl status edu-promaic.service
```

单元固定回环监听与 HTTPS，限制服务的网络连接和系统权限。systemd 创建权限为 `0700` 的 `/var/lib/edu-promaic` 作为业务写入目录。参考配置使用内置检索和工具，应用网络仅开放回环。部署时在主机或网络防火墙保留入口策略，并核对内核实际启用 cgroup IP 过滤。 [参考单元](../../deployment/linux/edu-promaic.service) · [systemd 网络控制](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html#IPAddressAllow=ADDRESS%5B/PREFIXLENGTH%5D%E2%80%A6)

## 配置网关与验收

将 Nginx 模板放入 `http` 配置区，例如 `/etc/nginx/conf.d/edu-promaic.conf`。填写浏览器访问的站点名和站点证书链、私钥路径，以及课堂服务证书上的内部名称和签发 CA。网关通过 HTTPS 转发至 `127.0.0.1:3443`，按内部名称校验证书。多个虚拟主机共用监听地址时，将默认虚拟主机的 TLS 版本和请求头容量与课堂配置对齐。先运行 `sudo nginx -t`，检查通过后再执行 `sudo systemctl reload nginx`。 [Nginx 课堂模板](../../deployment/linux/nginx-classroom.example.conf) · [Nginx 上游 TLS 配置](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_ssl_verify) · [TLS 虚拟主机选项](https://nginx.org/en/docs/http/ngx_http_ssl_module.html#ssl_protocols)

机构登录与回调在同一 HTTPS 源配置独立路由，由登录服务设置 `__Host-edu-promaic` Cookie。课堂路由保留客户端 `Origin` 和凭据，由应用按站点源、令牌声明与班级名册授予权限。 [浏览器凭据约定](security.md#身份与授权)

课堂访问日志只写时间、请求方法、状态和应用返回的请求编号。审计员用响应中的 `X-Request-Id` 关联授权及拒绝记录。错误日志用于故障诊断，按运维权限保管。 [Nginx 访问日志](https://nginx.org/en/docs/http/ngx_http_log_module.html#log_format) · [Nginx 上游响应变量](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#var_upstream_http_)

- 确认端口 `3443` 只监听回环地址。通过网关访问 `/api/health`，核对受信任证书与 `200` 响应。
- 未登录时访问 `/api/classroom` 应返回 `401`。使用验收账号核对同班教师发布、学生作答和审计员读取记录，再验证跨班级或跨角色访问返回 `403`。
- 用 `systemd-analyze security edu-promaic.service` 核对进程账户、文件系统沙箱和网络设置，用 `journalctl -u edu-promaic.service` 查看启动与检查结果。服务启动检查与机构测评分别记录。 [安全验收矩阵](security.md#等保三级对照)

Linux 自动检查安装并启动参考服务单元，验证回环监听、运行账号和目录权限。网关测试用两份独立证书启动 Nginx 与课堂服务，核对同源授权、拒绝响应和签名审计。 [安装测试](../../tests/system/linux-service.sh) · [网关测试](../../tests/system/nginx-gateway.js)

运维可用 `journalctl -u edu-promaic.service --grep=CLASSROOM_AUDIT_CAPACITY` 查看审计容量事件，并在集中日志平台按 `warning` 和 `critical` 设告警。 [阈值与轮转步骤](security.md#审计归档与备份恢复) · [journalctl 筛选](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html#-g)

升级时切换至审核过的发布目录并重启服务，随后重复健康、授权和作答验收。回滚程序时保留课堂数据目录，先核对快照格式与目标版本，再切回上一已验证的发布目录。机构按维护窗口执行审计轮转、启动检查点更新和数据恢复。 [运维步骤](security.md#审计归档与备份恢复)

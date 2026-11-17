# Codex Quota Guard

Windows 11 本地额度守护程序（Electron + TypeScript）。

## 当前版本边界（务必阅读）

- 0.1.1 修复 Windows `spawn codex ENOENT`：自动解析 CLI 路径、兼容 `.cmd/.bat`，找不到 CLI 时显示错误而不再让主进程崩溃；界面增加自定义 CLI 路径。

- 通过 `codex app-server` 的 `account/read` 和 `account/rateLimits/read` 读取当前 CLI/App Server 所见的登录账号与额度。
- 5 小时窗口通过 `windowDurationMins` 在 240–360 分钟范围筛选；找不到窗口时 fail-closed，不会触发停止。
- 通过 Windows UI Automation 搜索 Codex/ChatGPT 主窗口中的按钮，按钮名严格匹配 Stop/Cancel/停止/取消/中断。
- **UIA 点击仅代表发送了按钮 Invoke，不代表 Codex 已经结束任务。** 当前脚本未验证具体 Codex Desktop 版本的控件树，因此首次必须手动测试。
- Codex App Server 属于实验性接口，版本可能变化。守护程序启动的是独立 App Server/CLI 进程；它读取的账号是否与 Codex 桌面端切换后的账号同步，必须在你的机器上验证。不能仅凭 CLI 登录成功就认定它识别了桌面端当前账号。
- 目前尚未实现“将 App Server 额度上下文与桌面端当前会话做强绑定”的官方保证。程序采用邮箱白名单保护，并在每次轮询重新读取身份。账号识别失败或额度读取失败时不停止。
- 本项目是可运行的开发起始版本，不是已经在你的 Windows 电脑上验收通过的正式安装包。

## 环境

- Windows 10/11
- Node.js 20+
- 必须单独安装 Codex CLI（仅安装 Codex 桌面端不一定包含 CLI）；官方 Windows 安装方式见下方。
- npm

## 安装 Codex CLI（首次使用）

在 PowerShell 执行 OpenAI 官方 Windows 安装命令：

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
```

安装完成后重新打开 PowerShell，检查：

```powershell
codex --version
where.exe codex
```

也可以使用 npm 安装：

```powershell
npm install -g @openai/codex
```

本程序会依次检查设置中的自定义路径、`CODEX_PATH` 环境变量、`where.exe codex`，以及常见安装目录。Windows 的 `codex.cmd` / `codex.bat` 会通过 `cmd.exe` 启动。若安装后仍找不到，请在 PowerShell 运行 `where.exe codex`，把返回的完整路径复制到程序的“Codex CLI 路径”输入框。

## 启动

```powershell
npm install
npm run dev
```

## 构建安装包

```powershell
npm run package:win
```

安装包输出在 `dist/`。

## 首次配置步骤

1. 确认 Codex CLI 已安装，并且 `codex --version` 正常。
2. 运行 `npm run dev`。
3. 确认当前 Codex 桌面端登录账号。
4. 在程序中填写账号 A 的邮箱，保存。
5. 检查程序显示的邮箱、套餐和额度是否与 Codex 桌面端一致。
6. 保持“自动点击停止按钮”关闭，启动一个无风险的测试任务。
7. 点击“测试停止按钮”，确认 UIA 能找到并点击 Codex 当前任务的停止按钮。
8. 确认 Codex 任务确实停止，而非仅按钮被触发。
9. 切换到账号 B，确认程序显示不受保护；再切回 A，确认识别恢复。
10. 只有上述全部验证通过后，才启用自动停止。

## 重要说明

- 账号 A 的 5 小时或每周任意一个额度剩余比例 <= 阈值时（默认 20%）触发停止尝试；两项采用 OR 判断。
- 账号 B 不触发停止。
- 目前 `pollSeconds` 最小 5 秒，默认 30 秒；阈值可能因轮询间隔和服务端刷新延迟而略有越过。
- 不读取、不导出、不上传 `auth.json` 或 OAuth Token。
- 退出程序不会关闭 Codex。
- 程序窗口关闭后最小化到系统托盘；托盘菜单可退出。
- 自动启动注册、签名、更新机制尚未包含在此开发版中。

## 开发说明

`src/main/main.ts`：App Server JSONL 客户端、账号/额度轮询和保护判断。  
`scripts/stop-codex.ps1`：Windows UI Automation 停止按钮查找。  
`src/renderer/`：配置和状态界面。


## v0.1.2 变更

- Vite 开发服务器固定使用 `127.0.0.1:2326`。
- 使用 `--strictPort`，如果 2326 已被占用则明确报错，不会静默切换到其他端口。
- Electron 开发窗口同步连接 `http://127.0.0.1:2326`。
- `npm run dev` 期间 Vite 服务与 Electron 主进程都需要运行；停止 npm/Electron 进程后，监控也会停止。

## 后台运行说明

- 点击窗口右上角关闭按钮会隐藏到系统托盘，不会退出守护进程；托盘菜单选择“退出”才会结束程序。
- 保存设置只会写入本机配置文件，不会让程序在退出后继续监控。
- 要持续监控额度，程序必须保持运行（可以只留在系统托盘）。
- 当前开发版尚未配置 Windows 登录后自动启动；需要用户手动启动程序。


## v0.1.3 修复

- 修复 `npm run dev` 启动竞态：先执行 `tsc -p tsconfig.main.json` 完成主进程首次编译，再并行启动 TypeScript watch、Vite 和 Electron。
- 确保 Electron 读取的 `dist/main/main.js` 已由当前 `src/main/main.ts` 编译生成，避免旧产物仍引用 5173。
- 同步将仓库内预编译的 `dist/main/main.js` 开发地址更新为 2326。
- Vite 继续使用 `--strictPort`，端口冲突时明确失败。


## v0.1.4 修复

- 修复 Windows PowerShell 5.1 读取 UI Automation 脚本时的中文编码问题。
- `stop-codex.ps1` 改为 ASCII-only 脚本，并以 UTF-8 BOM 保存，避免 ANSI 代码页破坏语法。
- 停止按钮名称匹配使用 .NET 正则 Unicode 转义，兼容 Stop、Cancel、停止、取消、中断。
- 仅尝试调用可见且启用的按钮；未找到时输出英文诊断信息及可见按钮名称，不执行其他操作。
- PowerShell 使用 `-NonInteractive` 启动，避免交互提示阻塞。
- 注意：脚本成功调用 Invoke 只证明 UI Automation 触发了按钮，不等于已确认 Codex 任务完全停止。必须在桌面端观察任务状态。


## v0.1.5 网络监控稳定性修复

- `account/rateLimits/read` 超时从 10 秒提高到 30 秒；`account/read` 为 15 秒。
- 增加单飞保护：上一次额度轮询未结束时，不再并发发起下一次轮询。
- 失败后采用 15s、30s、60s、120s 递增退避，成功后恢复配置轮询间隔。
- 额度读取失败时清空界面额度，避免把上一次缓存值误认为最新值；失败时不会触发自动停止。
- 新增可选网络代理地址。填写本机代理软件提供的 HTTP 代理地址，例如 `http://127.0.0.1:端口`；端口必须以代理软件实际设置为准。配置变更后重启 App Server 子进程。
- App Server 子进程继承当前环境变量；设置代理后同时设置 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 及小写变量。
- 默认轮询间隔调整为 30 秒，可在 5–60 秒范围内设置。

## 网络故障排查

如果日志仍显示 `failed to fetch codex rate limits`，说明 App Server 进程无法访问 Codex 额度后端。先确认浏览器能打开 `https://chatgpt.com`，再检查代理软件的本地 HTTP 代理地址/端口，并填入程序的“网络代理地址”。不要填写代理订阅地址或节点地址；应填写本机监听地址。

- PowerShell UIA 脚本显式使用 UTF-8 输出，避免中文按钮名称在 Node.js 日志中乱码；诊断按钮名最多输出 20 个。
- 仅接受 `windowDurationMins` 为 240–360 分钟的额度窗口作为 5 小时额度，避免把每周额度误认成 5 小时额度。


## v0.1.6 双额度联合保护

- 同时解析 5 小时额度窗口（240–360 分钟）和每周额度窗口（6–8 天）。
- 不依赖 `primary` / `secondary` 字段位置判断窗口类型，而是根据 `windowDurationMins` 分类。
- 账号 A 使用同一个剩余阈值分别判断两项额度；任意一项剩余额度小于等于阈值，即触发停止尝试（逻辑为 OR）。
- 账号 B 不请求额度接口、不参与停止判断。
- 如果只有一项额度窗口成功返回，则仍使用该项执行保护，并在状态栏提示另一项未返回；两项都缺失时不触发停止。
- 网络请求失败时清空当前额度展示，不使用过期额度执行停止。
- 主界面分别展示 5 小时和每周剩余额度、已使用比例及重置时间。
- 版本仍需在实际 Codex App Server 响应上验证其 `windowDurationMins` 数据；若后端未返回每周窗口，界面会明确显示暂无数据，不会假装双额度均已监控。


## v0.1.7 独立停止阈值设置

- 设置页面拆分为“5 小时额度停止阈值（剩余 %）”和“每周额度停止阈值（剩余 %）”两个独立输入框。
- 两项阈值分别保存、分别显示状态，并独立参与 OR 停止判断。
- 两项默认值均为剩余 20%，范围为 1–100%。
- 旧版本的单一 `threshold` 配置会自动迁移为两项相同阈值，原有设置不会丢失。


## v0.1.8 修复

- 修复 v0.1.7 `src/main/main.ts` 中两个独立额度阈值声明之间误写入字面量 `\\n` 导致的 TypeScript `TS1127` / `TS1434` 编译错误。
- 仅修正换行符并更新版本号；5 小时与每周额度独立阈值逻辑保持不变。

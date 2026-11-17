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

- 账号 A 剩余额度 <= 阈值时（默认 20%）触发停止尝试。
- 账号 B 不触发停止。
- 目前 `pollSeconds` 最小 5 秒，默认 12 秒；阈值可能因轮询间隔和服务端刷新延迟而略有越过。
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

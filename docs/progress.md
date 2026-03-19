# 实施进度

- [FIX] 2026-03-19：修复后台地址写入失败。构建阶段不再依赖 `package/base-files/files/bin/config_generate` 的固定文本匹配，改为生成 `files/etc/uci-defaults/99-custom-lan-ip` 在首次启动时写入 `network.lan.ipaddr`。
- [CHORE] 2026-03-19：在工作流环境变量中启用 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`，提前适配 GitHub Actions Node.js 24 运行时切换。
- [FEAT] 2026-03-19：固件默认系统名改为 `CeliaWRT`，同时保留用户自定义输入能力（`firmware_name`）。

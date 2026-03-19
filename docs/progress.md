# 实施进度

- [PERF] 2026-03-19：全量编译加速第一阶段完成：`openwrt-builder.yml` 将缓存拆分为 `ccache` / `dl` / `toolchain` 三层，并把 `CCACHE_MAXSIZE` 从 `2G` 提升到 `20G`。
- [PERF] 2026-03-19：全量编译并发策略调整为“线程数+1 + 负载上限”（`-j${nproc+1} -l${nproc}`），降低高负载抖动导致的构建回退概率。
- [DOC] 2026-03-19：新增 `docs/full-build-acceleration.md`，沉淀全量编译提速策略、本地执行约束与预期收益。
- [FIX] 2026-03-19：修复后台地址写入失败。构建阶段不再依赖 `package/base-files/files/bin/config_generate` 的固定文本匹配，改为生成 `files/etc/uci-defaults/99-custom-lan-ip` 在首次启动时写入 `network.lan.ipaddr`。
- [CHORE] 2026-03-19：在工作流环境变量中启用 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`，提前适配 GitHub Actions Node.js 24 运行时切换。
- [FEAT] 2026-03-19：固件默认系统名改为 `CeliaWRT`，同时保留用户自定义输入能力（`firmware_name`）。
- [FIX] 2026-03-19：为编译阶段增加每分钟心跳日志，缓解 `tools/cmake` 等长耗时阶段“无输出像卡住”的问题。

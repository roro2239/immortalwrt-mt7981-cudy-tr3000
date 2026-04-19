## 项目概览

基于 GitHub Actions 为 Cudy TR3000 v1 256MB 设备自动编译 ImmortalWrt 固件，支持按工作流输入定制固件名称、主机名、WiFi 名称、LAN 地址和可选功能包。

## 技术栈

- GitHub Actions
- OpenWrt / ImmortalWrt 构建系统
- Shell 脚本
- LuCI 自定义插件

## 目录结构

- `.github/workflows/`：构建、快编、SDK 插件、U-Boot 工作流
- `config/`：设备构建配置
- `package/`：仓库内自定义 LuCI 插件
- `diy-part1.sh`：feeds 更新前定制脚本
- `diy-part2.sh`：feeds 更新后定制脚本

## 关键模块

- `openwrt-builder.yml`：全量固件编译与发布主流程
- `openwrt-fast-builder.yml`：快速验证流程
- `openwrt-sdk-plugin-builder.yml`：SDK 模式编译自定义插件
- `package/luci-app-button-automation`：按钮自动化插件
- `package/luci-app-ufi-tools`：UFI 工具插件

## 构建与运行

- 手动触发 GitHub Actions `ImmortalWrt 全量编译` 进行完整固件构建
- 手动触发 `ImmortalWrt 快速编译` 做快速验证
- 手动触发 `ImmortalWrt SDK 插件编译` 生成自定义插件 ipk

## 当前任务状态

- 已定位 run `24621418082` 失败在 `openwrt-builder.yml` 的 `构建 256M 固件` 步骤
- 已确认前置步骤成功，当前缺少可公开获取的失败正文日志
- 已完成工作流失败日志采集与 artifact 上传增强，下次失败可直接下载日志定位具体报错

## 下一步

- 重新触发 `ImmortalWrt 全量编译`
- 下载 `build-logs-<run_number>-<run_attempt>` artifact 查看失败正文
- 根据具体失败包或错误命令再做定点修复

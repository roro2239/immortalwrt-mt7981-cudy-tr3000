# 首页风格收敛说明

## 目标

首页回归默认 LuCI 风格，不再提供独立仪表盘页面。

## 已调整

1. 移除 `package/luci-app-home-dashboard`。
2. `config/256m.config` 不再默认选择 `luci-app-home-dashboard`。
3. `diy-part1.sh` 不再注入 `luci-app-home-dashboard`。

## 边界

1. 默认 LuCI 主页由上游主题和菜单实现决定。
2. 原首页中的 Hero、卡片、圆形指标、流量图和软件源快捷切换不再保留。

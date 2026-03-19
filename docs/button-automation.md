# 按键自动化功能说明

## 功能入口

- LuCI 菜单：`系统 -> 按键自动化`
- 事件来源：`/etc/hotplug.d/button/*`

## 支持动作

1. WiFi 总开关
- 状态：`开/关`
- 行为：统一设置所有 `wifi-device` 的 `disabled` 并执行 `wifi` 重载。

2. LED 开关
- 状态：`开/关`
- 行为：写入 `/sys/class/leds/<led_name>/brightness`。

3. 自定义命令
- 仅当全局开启“允许自定义命令”后生效。
- 行为：执行用户填写的 shell 命令。

## 全局设置

- `启用自动化`：总开关。
- `去抖动毫秒`：同一按键同一事件在短时间内重复触发时忽略。
- `允许自定义命令`：控制是否允许执行 `自定义命令` 动作。

## 规则配置

每条规则由以下字段组成：

- `按钮名`：如 `mode_switch`、`BTN_0`
- `动作事件`：`pressed` 或 `released`
- `执行类型`：`WiFi 总开关` / `LED 开关` / `自定义命令`
- 动作参数：随执行类型变化

## 典型示例（滑动开关控制 WiFi）

- 规则 A：`mode_switch + pressed -> WiFi 总开关: 开`
- 规则 B：`mode_switch + released -> WiFi 总开关: 关`

## 排障

- 查看执行日志：
  `logread | grep button-automation`
- 如果没有触发：
  1. 检查按钮名是否正确（`mode_switch`/`BTN_0`）。
  2. 检查全局总开关是否开启。
  3. 检查对应服务是否存在 `/etc/init.d/<service>`。

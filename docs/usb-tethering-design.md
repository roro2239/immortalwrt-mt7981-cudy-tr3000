# USB 共享网络内置方案

## 目标

让固件开箱即用支持主流手机 USB 共享网络接入，并在首启时默认打开现有 MTK 加速能力，不要求用户手工选装或手工进后台启用。

## 当前现状

1. 已内置 USB 网络基础包：
   - `kmod-usb-net`
   - `kmod-usb-net-cdc-ether`
   - `kmod-usb-net-rndis`
2. 已内置加速链路：
   - `luci-app-turboacc-mtk`
   - `kmod-mediatek_hnat`
   - `kmod-ipt-offload`
   - `kmod-nft-offload`
3. 当前缺口：
   - `cdc-ncm`、`ipheth`、`usb-wdm` 等未内置，USB 共享兼容面不完整。
   - 加速插件已编进固件，但没有首启自动启用动作。

## 已实施

1. 在 `config/256m.config` 中默认内置：
   - `kmod-usb-net-cdc-ncm`
   - `kmod-usb-net-ipheth`
   - `kmod-usb-wdm`
2. 在全量工作流构建阶段新增 `uci-defaults` 脚本：
   - `99-usb-turboacc`
3. 首启默认写入：
   - `firewall.@defaults[0].flow_offloading='1'`
   - `firewall.@defaults[0].flow_offloading_hw='1'`

## 选择依据

1. `rndis` 覆盖常见 Android USB 共享。
2. `cdc-ncm` 可补足部分新机型或非 `rndis` 枚举模式。
3. `ipheth` 覆盖 iPhone USB 共享。
4. `usb-wdm` 是部分 USB 网络设备控制通道依赖，成本低，保留更稳妥。

## 边界

1. 本次目标是“手机 USB 共享网络”，不包含完整 `MBIM/QMI` modem 拨号栈。
2. 本次默认不自动创建 `wan/wwan` 接口，只保证驱动与加速能力内置、首启默认开启加速。
3. MTK HNAT 对 USB 共享链路的最终收益取决于实际驱动和数据面，当前实施保证“默认打开能力”，不承诺所有场景都获得一致加速效果。

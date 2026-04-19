# USB 网络驱动内置方案

## 目标

固件只默认提供 USB 网络相关内核驱动，不再为 USB 网络单独创建接口、热插拔绑定、协议页面或加速策略。

## 已保留

`config/256m.config` 继续默认内置 USB 网络驱动：

1. `kmod-usb-net`
2. `kmod-usb-net-cdc-ether`
3. `kmod-usb-net-cdc-mbim`
4. `kmod-usb-net-cdc-ncm`
5. `kmod-usb-net-huawei-cdc-ncm`
6. `kmod-usb-net-ipheth`
7. `kmod-usb-net-qmi-wwan`
8. `kmod-usb-net-qmi-wwan-fibocom`
9. `kmod-usb-net-qmi-wwan-quectel`
10. `kmod-usb-net-rndis`
11. `kmod-usb-wdm`

## 已移除

1. 全量构建不再注入 `100-usb-turboacc`。
2. 全量构建不再注入 `101-usb-tethering`。
3. 全量构建不再注入 `90-usb-tethering`。
4. 默认配置不再选择 `luci-proto-mbim`、`luci-proto-ncm`、`luci-proto-qmi`。
5. 默认配置不再选择 `comgt`、`comgt-ncm`、`umbim`、`uqmi`、`wwan`。
6. 默认配置不再选择 `usb-modeswitch`、`usbutils`。
7. 移除 `package/luci-app-usb-network` 残留目录。

## 边界

1. USB 网络设备可由内核驱动识别，但不会自动成为 WAN。
2. 固件不会预置 `usbwan/usbwan6`。
3. 固件不会自动把 USB 网络加入防火墙 `wan` 区。
4. 固件不会因 USB 网络默认开启 `flow_offloading` 或 `packet_steering`。
5. 需要拨号协议、工具或 LuCI 配置入口时，由用户后续按需安装。

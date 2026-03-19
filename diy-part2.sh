#!/bin/bash
#
# https://github.com/P3TERX/Actions-OpenWrt
# File name: diy-part2.sh
# Description: OpenWrt DIY script part 2 (After Update feeds)
#
# Copyright (c) 2019-2024 P3TERX <https://p3terx.com>
#
# This is free software, licensed under the MIT License.
# See /LICENSE for more information.
#

# Modify default IP
#sed -i 's/192.168.1.1/192.168.50.5/g' package/base-files/files/bin/config_generate

# Modify default theme
#sed -i 's/luci-theme-bootstrap/luci-theme-argon/g' feeds/luci/collections/luci/Makefile

# Modify hostname
#sed -i 's/OpenWrt/P3TERX-Router/g' package/base-files/files/bin/config_generate

# 临时解决Rust问题
sed -i 's/ci-llvm=true/ci-llvm=false/g' feeds/packages/lang/rust/Makefile

# 修复 mtwifi-cfg 扫描策略与缺失脚本告警
if [ -f package/mtk/applications/mtwifi-cfg/files/mtwifi-cfg/mtwifi_cfg ]; then
python3 - <<'PY'
from pathlib import Path

path = Path("package/mtk/applications/mtwifi-cfg/files/mtwifi-cfg/mtwifi_cfg")
text = path.read_text(encoding="utf-8")

text = text.replace(
    '__exec_iwpriv_cmd(ifname, "ApCliAutoConnect", "3")',
    '__exec_iwpriv_cmd(ifname, "ApCliAutoConnect", "1")',
)
text = text.replace(
    'os.execute("startwapp.sh")',
    'os.execute("command -v startwapp.sh >/dev/null 2>&1 && startwapp.sh || true")',
)

path.write_text(text, encoding="utf-8")
PY
fi

# 禁用“系统在线更新”（隐藏菜单并移除对应 ACL）
if [ "${DISABLE_SYSTEM_UPDATE:-true}" = "true" ]; then
python3 - <<'PY'
import json
from pathlib import Path

targets = [
    (
        Path("feeds/luci/modules/luci-mod-system/root/usr/share/luci/menu.d/luci-mod-system.json"),
        "admin/system/flash",
    ),
    (
        Path("feeds/luci/modules/luci-mod-system/root/usr/share/rpcd/acl.d/luci-mod-system.json"),
        "luci-mod-system-flash",
    ),
]

for path, key in targets:
    if not path.exists():
        continue
    data = json.loads(path.read_text(encoding="utf-8"))
    if key in data:
        data.pop(key)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
PY
else
  echo "保留系统在线更新"
fi

# add date in output file name
sed -i -e '/^IMG_PREFIX:=/i BUILD_DATE := $(shell date +%Y%m%d)' \
       -e '/^IMG_PREFIX:=/ s/\($(SUBTARGET)\)/\1-$(BUILD_DATE)/' include/image.mk

# set ubi to 122M
# sed -i 's/reg = <0x5c0000 0x7000000>;/reg = <0x5c0000 0x7a40000>;/' target/linux/mediatek/dts/mt7981b-cudy-tr3000-v1-ubootmod.dts

# Add OpenClash Meta
mkdir -p files/etc/openclash/core

wget -qO "clash_meta.tar.gz" "https://raw.githubusercontent.com/vernesong/OpenClash/core/master/meta/clash-linux-arm64.tar.gz"
tar -zxvf "clash_meta.tar.gz" -C files/etc/openclash/core/
mv files/etc/openclash/core/clash files/etc/openclash/core/clash_meta
chmod +x files/etc/openclash/core/clash_meta
rm -f "clash_meta.tar.gz"

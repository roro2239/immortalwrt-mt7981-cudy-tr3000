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

replacements = [
    (
        'function __apcli_auto_connect(ifname)\n'
        '    __exec_iwpriv_cmd(ifname, "ApCliEnable", "1")\n'
        '    __exec_iwpriv_cmd(ifname, "ApCliAutoConnect", "3")\n'
        'end\n',
        'function __sta_cfg_ready(v)\n'
        '    if not v or not v.config or v.config.disabled then\n'
        '        return false\n'
        '    end\n'
        '    local ssid = utils.trim(v.config.ssid or "")\n'
        '    if #ssid == 0 then\n'
        '        return false\n'
        '    end\n'
        '    return true\n'
        'end\n'
        '\n'
        'function __cfg_has_sta_ready(cfg)\n'
        '    if not cfg or not cfg.interfaces then\n'
        '        return false\n'
        '    end\n'
        '    for _, v in pairs(cfg.interfaces) do\n'
        '        if v and v.config and v.config.mode == "sta" and __sta_cfg_ready(v) then\n'
        '            return true\n'
        '        end\n'
        '    end\n'
        '    return false\n'
        'end\n'
        '\n'
        'function __apcli_auto_connect(ifname)\n'
        '    __exec_iwpriv_cmd(ifname, "ApCliEnable", "1")\n'
        '    __exec_iwpriv_cmd(ifname, "ApCliAutoConnect", "1")\n'
        'end\n',
    ),
    (
        '    if not dev then return end\n'
        '\n'
        '    if is_dbdc then\n',
        '    if not dev then return end\n'
        '\n'
        '    local apcli_ready = __cfg_has_sta_ready(cfg)\n'
        '\n'
        '    if is_dbdc then\n',
    ),
    (
        '            -- restart apcli vif\n'
        '            for _,vif in ipairs(restore_vifs) do\n'
        '                if vif_is_apcli(vif, dev) then\n'
        '                    nixio.syslog("info", "mtwifi-cfg: restore apcli vif: "..vif)\n'
        '                    ifup(vif)\n'
        '                    __apcli_auto_connect(vif)\n'
        '                end\n'
        '            end\n',
        '            -- restart apcli vif\n'
        '            if apcli_ready then\n'
        '                for _,vif in ipairs(restore_vifs) do\n'
        '                    if vif_is_apcli(vif, dev) then\n'
        '                        nixio.syslog("info", "mtwifi-cfg: restore apcli vif: "..vif)\n'
        '                        ifup(vif)\n'
        '                        __apcli_auto_connect(vif)\n'
        '                    end\n'
        '                end\n'
        '            else\n'
        '                nixio.syslog("info", "mtwifi-cfg: skip restore apcli vif (sta config not ready)")\n'
        '            end\n',
    ),
    (
        '    local start_vif = function(v)\n'
        '        if (not v.config.disabled) and v.mtwifi_ifname then\n'
        '            local vif = v.mtwifi_ifname\n'
        '            nixio.syslog("info", "mtwifi-cfg: up vif: "..vif)\n'
        '            ifup(vif)\n'
        '        end\n'
        '    end\n',
        '    local start_vif = function(v)\n'
        '        if (not v.config.disabled) and v.mtwifi_ifname then\n'
        '            if v.config.mode == "sta" and not __sta_cfg_ready(v) then\n'
        '                nixio.syslog("info", "mtwifi-cfg: skip sta vif (empty ssid): "..v.mtwifi_ifname)\n'
        '                return\n'
        '            end\n'
        '            local vif = v.mtwifi_ifname\n'
        '            nixio.syslog("info", "mtwifi-cfg: up vif: "..vif)\n'
        '            ifup(vif)\n'
        '        end\n'
        '    end\n',
    ),
    (
        '            if not v.config.disabled then\n'
        '                dats.ApCliEnable = 1\n'
        '            end\n'
        '            dats.ApCliSsid = v.config.ssid or ""\n',
        '            local sta_ssid = utils.trim(v.config.ssid or "")\n'
        '            if (not v.config.disabled) and #sta_ssid > 0 then\n'
        '                dats.ApCliEnable = 1\n'
        '            end\n'
        '            dats.ApCliSsid = sta_ssid\n',
    ),
    (
        '    local apcli_hook = function(v)\n'
        '        if (not v.config.disabled) and v.mtwifi_ifname then\n'
        '            local vif = v.mtwifi_ifname\n'
        '            __apcli_auto_connect(vif)\n'
        '        end\n'
        '    end\n',
        '    local apcli_hook = function(v)\n'
        '        if (not v.config.disabled) and v.mtwifi_ifname then\n'
        '            local vif = v.mtwifi_ifname\n'
        '            if __sta_cfg_ready(v) then\n'
        '                __apcli_auto_connect(vif)\n'
        '            else\n'
        '                nixio.syslog("info", "mtwifi-cfg: skip apcli auto connect (empty ssid): "..vif)\n'
        '            end\n'
        '        end\n'
        '    end\n',
    ),
    (
        'os.execute("startwapp.sh")',
        'os.execute("command -v startwapp.sh >/dev/null 2>&1 && startwapp.sh || true")',
    ),
]

for old, new in replacements:
    text = text.replace(old, new)

path.write_text(text, encoding="utf-8")
PY
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

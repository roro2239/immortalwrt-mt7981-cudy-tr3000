#!/bin/bash
#
# https://github.com/P3TERX/Actions-OpenWrt
# File name: diy-part1.sh
# Description: OpenWrt DIY script part 1 (Before Update feeds)
#
# Copyright (c) 2019-2024 P3TERX <https://p3terx.com>
#
# This is free software, licensed under the MIT License.
# See /LICENSE for more information.
#

# Uncomment a feed source
#sed -i 's/^#\(.*helloworld\)/\1/' feeds.conf.default

# Add a feed source
#echo 'src-git helloworld https://github.com/fw876/helloworld' >>feeds.conf.default
#echo 'src-git passwall https://github.com/xiaorouji/openwrt-passwall' >>feeds.conf.default

git clone --depth=1 --single-branch --branch master https://github.com/jerrykuku/luci-theme-argon package/luci-theme-argon
git clone --depth=1 --single-branch --branch master https://github.com/jerrykuku/luci-app-argon-config package/luci-app-argon-config
git clone https://github.com/timsaya/luci-app-bandix package/luci-app-bandix
git clone https://github.com/timsaya/openwrt-bandix package/openwrt-bandix

if [ "${ISTORE_ENABLE:-true}" = "true" ]; then
  git clone https://github.com/linkease/istore package/istore
else
  echo "跳过 iStore 源"
fi

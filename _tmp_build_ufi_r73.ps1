$ErrorActionPreference = 'Stop'

function Convert-ToWslPath {
	param(
		[Parameter(Mandatory = $true)]
		[string]$Path
	)

	$full = [System.IO.Path]::GetFullPath($Path)

	if ($full -match '^([A-Za-z]):\\(.*)$') {
		$drive = $matches[1].ToLowerInvariant()
		$rest = $matches[2] -replace '\\', '/'
		return "/mnt/$drive/$rest"
	}

	throw "无法转换为 WSL 路径：$Path"
}

$root = 'E:\AIDE\immortalwrt-mt7981-cudy-tr3000'
$preview = Join-Path $root '_tmp_ipk_preview\luci-app-ufi-tools_1.0.0-r73_all.ipk'
$desktop = 'C:\Users\shier\Desktop\luci-app-ufi-tools_1.0.0-r73_all.ipk'
$scriptWin = Join-Path $env:TEMP 'codex_build_ufi_r73.sh'
$scriptWsl = Convert-ToWslPath $scriptWin
$rootWsl = Convert-ToWslPath $root
$previewWsl = Convert-ToWslPath $preview
$desktopWsl = Convert-ToWslPath $desktop
$previewDirWsl = Convert-ToWslPath (Split-Path $preview)
$desktopDirWsl = Convert-ToWslPath (Split-Path $desktop)

$shell = @"
set -e
ROOT='$rootWsl'
PKGROOT='/tmp/luci-app-ufi-tools-r73'
OUT='/tmp/luci-app-ufi-tools_1.0.0-r73_all.ipk'
SRC="`$ROOT/package/luci-app-ufi-tools"
PREVIEW='$previewWsl'
DESKTOP='$desktopWsl'
PREVIEW_DIR='$previewDirWsl'
DESKTOP_DIR='$desktopDirWsl'
rm -rf "`$PKGROOT" "`$OUT"
mkdir -p "`$PKGROOT/data" "`$PKGROOT/control" "`$PREVIEW_DIR" "`$DESKTOP_DIR"
cp -r "`$SRC/root/." "`$PKGROOT/data/"
mkdir -p "`$PKGROOT/data/www/luci-static/resources/view"
cp "`$SRC/htdocs/luci-static/resources/view/ufi-tools.js" "`$PKGROOT/data/www/luci-static/resources/view/ufi-tools.js"
cp "`$SRC/postinst" "`$PKGROOT/control/postinst"
chmod 755 "`$PKGROOT/control/postinst"
chmod 755 "`$PKGROOT/data/www/cgi-bin/ufi-tools-proxy"
cat > "`$PKGROOT/control/control" <<'EOF'
Package: luci-app-ufi-tools
Version: 1.0.0-r73
Depends: luci-base
Source: package/luci-app-ufi-tools
Section: luci
Category: LuCI
Title: LuCI support for UFI-TOOLS
Architecture: all
Maintainer: 洛夕
Description: LuCI frontend for UFI-TOOLS redraw
EOF
printf '2.0\n' > "`$PKGROOT/debian-binary"
(cd "`$PKGROOT/control" && tar --format=gnu --numeric-owner --owner=0 --group=0 -czf "`$PKGROOT/control.tar.gz" .)
(cd "`$PKGROOT/data" && tar --format=gnu --numeric-owner --owner=0 --group=0 -czf "`$PKGROOT/data.tar.gz" .)
(cd "`$PKGROOT" && tar --format=gnu --numeric-owner --owner=0 --group=0 -cf - ./debian-binary ./data.tar.gz ./control.tar.gz | gzip -n - > "`$OUT")
cp "`$OUT" "`$PREVIEW"
cp "`$OUT" "`$DESKTOP"
stat -c '%n|%s|%y' "`$PREVIEW" "`$DESKTOP"
"@

[System.IO.File]::WriteAllText($scriptWin, $shell, [System.Text.UTF8Encoding]::new($false))

try {
	& wsl.exe sh $scriptWsl
}
finally {
	Remove-Item $scriptWin -Force -ErrorAction SilentlyContinue
}

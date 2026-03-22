'use strict';
'require view';
'require rpc';
'require fs';

var MIRROR_OFFICIAL = 'https://downloads.immortalwrt.org';
var MIRROR_USTC = 'https://mirrors.ustc.edu.cn/immortalwrt';
var KNOWN_MIRRORS = [
	'https://downloads.immortalwrt.org',
	'https://mirrors.vsean.net/openwrt',
	'https://mirrors.ustc.edu.cn/immortalwrt'
];

var callSystemBoard = rpc.declare({
	object: 'system',
	method: 'board',
	expect: {}
});

var callSystemInfo = rpc.declare({
	object: 'system',
	method: 'info',
	expect: {}
});

var callIfaceStatus = rpc.declare({
	object: 'network.interface',
	method: 'status',
	params: [ 'interface' ],
	expect: {}
});

function toNum(v) {
	var n = parseFloat(v);
	return isNaN(n) ? 0 : n;
}

function clamp(v, min, max) {
	return Math.max(min, Math.min(max, v));
}

function safeText(v) {
	if (v == null || v === '')
		return '-';

	return String(v);
}

function formatUptime(sec) {
	sec = Math.max(0, toNum(sec));

	if (!sec)
		return '-';

	var d = Math.floor(sec / 86400);
	var h = Math.floor((sec % 86400) / 3600);
	var m = Math.floor((sec % 3600) / 60);

	if (d > 0)
		return d + '天 ' + h + '小时';

	return h + '小时 ' + m + '分钟';
}

function formatMemory(info) {
	var memory = (info && info.memory) || {};
	var total = toNum(memory.total);
	var free = toNum(memory.free);
	var buffered = toNum(memory.buffered);
	var shared = toNum(memory.shared);
	var used = Math.max(0, total - free - buffered - shared);

	if (total <= 0) {
		return {
			percent: 0,
			label: '-',
			subtitle: _('无内存数据')
		};
	}

	return {
		percent: clamp(Math.round((used * 100) / total), 0, 100),
		label: Math.round(used / 1024 / 1024) + ' / ' + Math.round(total / 1024 / 1024) + ' MB',
		subtitle: _('内存占用')
	};
}

function firstAddr(obj) {
	var arr = (obj && obj['ipv4-address']) || [];
	return (arr.length && arr[0] && arr[0].address) ? arr[0].address : '-';
}

function firstIpv6(obj) {
	var arr = (obj && obj['ipv6-address']) || [];
	return (arr.length && arr[0] && arr[0].address) ? arr[0].address : '-';
}

function firstGateway(obj) {
	var arr = (obj && obj.route) || [];
	for (var i = 0; i < arr.length; i++) {
		if (arr[i] && arr[i].target === '0.0.0.0')
			return arr[i].nexthop || '-';
	}

	return '-';
}

function firstDns(obj) {
	var arr = (obj && obj['dns-server']) || [];
	return arr.length ? arr[0] : '-';
}

function routeCount(obj) {
	var arr = (obj && obj.route) || [];
	return String(arr.length || 0);
}

function formatRate(bytesPerSec) {
	var v = Math.max(0, Number(bytesPerSec || 0));

	if (v < 1024)
		return v.toFixed(0) + ' B/s';
	if (v < 1024 * 1024)
		return (v / 1024).toFixed(1) + ' KB/s';

	return (v / (1024 * 1024)).toFixed(2) + ' MB/s';
}

function getWanCounters(wan) {
	var s = (wan && wan.statistics) || {};

	return {
		rx: toNum(s.rx_bytes),
		tx: toNum(s.tx_bytes)
	};
}

function buildPath(values, maxVal, width, height) {
	if (!values.length)
		return '';

	var stepX = width / Math.max(values.length - 1, 1);
	var out = '';

	for (var i = 0; i < values.length; i++) {
		var x = (i * stepX).toFixed(2);
		var y = (height - (values[i] / maxVal) * height).toFixed(2);
		out += (i === 0 ? 'M' : 'L') + x + ',' + y;
	}

	return out;
}

function parseCpuStat(text) {
	if (!text)
		return null;

	var lines = String(text).split('\n');

	for (var i = 0; i < lines.length; i++) {
		if (lines[i].indexOf('cpu ') !== 0)
			continue;

		var parts = lines[i].trim().split(/\s+/).slice(1).map(toNum);
		var idle = (parts[3] || 0) + (parts[4] || 0);
		var total = 0;

		for (var j = 0; j < parts.length; j++)
			total += parts[j];

		return { idle: idle, total: total };
	}

	return null;
}

function calcCpuPercent(prev, next) {
	if (!prev || !next || next.total <= prev.total)
		return null;

	var idleDelta = next.idle - prev.idle;
	var totalDelta = next.total - prev.total;

	if (totalDelta <= 0)
		return null;

	return clamp(Math.round((1 - idleDelta / totalDelta) * 100), 0, 100);
}

function currentMirror(content) {
	var text = String(content || '');

	if (text.indexOf(MIRROR_USTC) >= 0)
		return {
			label: _('中科大源'),
			url: MIRROR_USTC
		};

	if (text.indexOf(MIRROR_OFFICIAL) >= 0)
		return {
			label: _('官方源'),
			url: MIRROR_OFFICIAL
		};

	return {
		label: _('自定义源'),
		url: '-'
	};
}

function replaceMirror(content, url) {
	var text = String(content || '');

	for (var i = 0; i < KNOWN_MIRRORS.length; i++)
		text = text.replace(new RegExp(KNOWN_MIRRORS[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), url);

	return text;
}

function ifaceDevice(obj) {
	return safeText((obj && (obj.device || obj.l3_device)) || '-');
}

function hasIfaceData(obj) {
	if (!obj)
		return false;

	if (obj.up)
		return true;

	if (firstAddr(obj) !== '-' || firstIpv6(obj) !== '-')
		return true;

	return !!(obj.device || obj.l3_device || obj.proto);
}

function makeMetric(title, tone) {
	var radius = 38;
	var circumference = 2 * Math.PI * radius;
	var progress = E('circle', {
		'class': 'home-ring-progress tone-' + tone,
		'cx': '48',
		'cy': '48',
		'r': String(radius),
		'stroke-dasharray': String(circumference),
		'stroke-dashoffset': String(circumference)
	});
	var percentEl = E('div', { 'class': 'home-ring-percent' }, '--%');
	var valueEl = E('div', { 'class': 'home-metric-value' }, '-');
	var subtitleEl = E('div', { 'class': 'home-metric-sub' }, '');

	return {
		node: E('section', { 'class': 'home-metric' }, [
			E('div', { 'class': 'home-metric-top' }, [
				E('div', { 'class': 'home-metric-title' }, title)
			]),
			E('div', { 'class': 'home-metric-main' }, [
				E('div', { 'class': 'home-ring-wrap' }, [
					E('svg', { 'class': 'home-ring', 'viewBox': '0 0 96 96' }, [
						E('circle', {
							'class': 'home-ring-track',
							'cx': '48',
							'cy': '48',
							'r': String(radius)
						}),
						progress
					]),
					percentEl
				]),
				E('div', { 'class': 'home-metric-text' }, [
					valueEl,
					subtitleEl
				])
			])
		]),
		progress: progress,
		percent: percentEl,
		value: valueEl,
		subtitle: subtitleEl,
		circumference: circumference
	};
}

function setMetric(metric, percent, value, subtitle) {
	var p = clamp(toNum(percent), 0, 100);
	metric.progress.setAttribute('stroke-dashoffset', String(metric.circumference * (1 - p / 100)));
	metric.percent.textContent = Math.round(p) + '%';
	metric.value.textContent = safeText(value);
	metric.subtitle.textContent = safeText(subtitle);
}

function sourceButton(label, type, onClick) {
	return E('button', {
		'class': 'home-source-btn' + (type ? ' ' + type : ''),
		'click': onClick
	}, label);
}

function infoRow(label, value) {
	return E('div', { 'class': 'home-info-row' }, [
		E('span', { 'class': 'home-info-key' }, label),
		E('span', { 'class': 'home-info-value' }, safeText(value))
	]);
}

function ifaceRows(statuses) {
	var names = [
		{ key: 'wan', label: _('WAN') },
		{ key: 'wan6', label: _('WAN6') },
		{ key: 'lan', label: _('LAN') },
		{ key: 'wwan', label: _('USB/WWAN') }
	];
	var rows = [];

	for (var i = 0; i < names.length; i++) {
		var meta = names[i];
		var st = statuses[meta.key];

		if (!hasIfaceData(st))
			continue;

		rows.push(E('div', { 'class': 'home-iface-row' }, [
			E('div', { 'class': 'home-iface-main' }, [
				E('div', { 'class': 'home-iface-label' }, meta.label),
				E('div', { 'class': 'home-iface-device' }, ifaceDevice(st))
			]),
			E('div', { 'class': 'home-iface-side' }, [
				E('span', { 'class': 'home-iface-badge ' + (st.up ? 'is-up' : 'is-down') }, st.up ? _('在线') : _('离线')),
				E('div', { 'class': 'home-iface-addr' }, firstAddr(st))
			])
		]));
	}

	if (!rows.length)
		rows.push(E('div', { 'class': 'home-empty' }, _('暂无接口数据')));

	return rows;
}

return view.extend({
	load: function() {
		return Promise.all([
			callSystemBoard().catch(function() { return {}; }),
			callSystemInfo().catch(function() { return {}; }),
			callIfaceStatus('wan').catch(function() { return {}; }),
			callIfaceStatus('lan').catch(function() { return {}; }),
			callIfaceStatus('wan6').catch(function() { return {}; }),
			callIfaceStatus('wwan').catch(function() { return {}; }),
			fs.read('/etc/opkg/distfeeds.conf').catch(function() { return ''; }),
			fs.read('/proc/stat').catch(function() { return ''; })
		]);
	},

	render: function(data) {
		var board = data[0] || {};
		var info = data[1] || {};
		var statuses = {
			wan: data[2] || {},
			lan: data[3] || {},
			wan6: data[4] || {},
			wwan: data[5] || {}
		};
		var distfeeds = data[6] || '';
		var cpuSnapshot = parseCpuStat(data[7] || '');
		var mem = formatMemory(info);
		var wan = statuses.wan;
		var currentSource = currentMirror(distfeeds);
		var loadText = Array.isArray(info.load) && info.load.length ? (info.load[0] / 65535).toFixed(2) : '-';
		var cpuMetric = makeMetric(_('CPU 占用率'), 'cpu');
		var memMetric = makeMetric(_('内存占用'), 'mem');
		var routeMetric = makeMetric(_('路由条目'), 'route');
		var chartW = 760;
		var chartH = 168;
		var rxPath = E('path', { 'class': 'home-rx-line', 'd': '' });
		var txPath = E('path', { 'class': 'home-tx-line', 'd': '' });
		var rxRateEl = E('strong', { 'class': 'home-rx' }, '0 B/s');
		var txRateEl = E('strong', { 'class': 'home-tx' }, '0 B/s');
		var sourceValue = E('div', { 'class': 'home-source-value' }, currentSource.label);
		var sourceHint = E('div', { 'class': 'home-source-hint' }, _('切源后可直接在软件包页刷新索引。'));
		var ifaceWrap = E('div', { 'class': 'home-iface-list' }, ifaceRows(statuses));
		var currentSourceInfo = E('span', { 'class': 'home-info-value' }, currentSource.label);
		var maxPoints = 40;
		var rxHistory = [];
		var txHistory = [];
		var timer = null;
		var lastCounters = getWanCounters(wan);
		var lastTs = Date.now();
		var cpuPercent = clamp(Math.round(toNum(loadText) * 100), 0, 100);

		setMetric(cpuMetric, cpuPercent, loadText, _('1 分钟负载'));
		setMetric(memMetric, mem.percent, mem.label, mem.subtitle);
		setMetric(routeMetric, clamp(routeCount(wan) * 10, 0, 100), routeCount(wan), _('WAN 路由条目'));

		function repaintChart(rxRate, txRate) {
			rxRateEl.textContent = formatRate(rxRate);
			txRateEl.textContent = formatRate(txRate);

			rxHistory.push(rxRate);
			txHistory.push(txRate);
			if (rxHistory.length > maxPoints)
				rxHistory.shift();
			if (txHistory.length > maxPoints)
				txHistory.shift();

			var peak = 1;

			for (var i = 0; i < rxHistory.length; i++) {
				peak = Math.max(peak, rxHistory[i], txHistory[i]);
			}

			rxPath.setAttribute('d', buildPath(rxHistory, peak, chartW, chartH));
			txPath.setAttribute('d', buildPath(txHistory, peak, chartW, chartH));
		}

		function updateMirrorButtons(activeUrl, buttons) {
			buttons.forEach(function(meta) {
				if (meta.url === activeUrl)
					meta.node.classList.add('is-active');
				else
					meta.node.classList.remove('is-active');
			});
		}

		function writeMirror(url, label, buttons) {
			sourceHint.textContent = _('正在切换软件源...');
			buttons.forEach(function(meta) { meta.node.disabled = true; });

			return fs.read('/etc/opkg/distfeeds.conf').then(function(text) {
				return fs.write('/etc/opkg/distfeeds.conf', replaceMirror(text, url));
			}).then(function() {
				sourceValue.textContent = label;
				currentSourceInfo.textContent = label;
				sourceHint.textContent = _('已切换为 ') + label + _('，如需立即刷新可前往软件包页执行更新。');
				updateMirrorButtons(url, buttons);
			}).catch(function() {
				sourceHint.textContent = _('切换失败，请检查 `/etc/opkg/distfeeds.conf` 是否可写。');
			}).then(function() {
				buttons.forEach(function(meta) { meta.node.disabled = false; });
			}, function() {
				buttons.forEach(function(meta) { meta.node.disabled = false; });
			});
		}

		var sourceButtons = [];
		var officialBtn = sourceButton(_('官方源'), '', function() {
			writeMirror(MIRROR_OFFICIAL, _('官方源'), sourceButtons);
		});
		var ustcBtn = sourceButton(_('中科大源'), 'is-primary', function() {
			writeMirror(MIRROR_USTC, _('中科大源'), sourceButtons);
		});

		sourceButtons.push({ node: officialBtn, url: MIRROR_OFFICIAL });
		sourceButtons.push({ node: ustcBtn, url: MIRROR_USTC });
		updateMirrorButtons(currentSource.url, sourceButtons);

		var style = E('style', {}, '\
.home-dashboard{--bg-a:#fffaf0;--bg-b:#f6f8ff;--surface:rgba(255,255,255,.78);--surface-strong:rgba(255,255,255,.92);--line:rgba(31,41,55,.08);--text:#1f2937;--muted:#6b7280;--accent:#2563eb;--accent-warm:#f59e0b;--accent-green:#10b981;display:flex;flex-direction:column;gap:18px;color:var(--text);}\
.home-hero{position:relative;overflow:hidden;padding:22px;border-radius:24px;background:linear-gradient(135deg,#fff6dd 0%,#f7f9ff 55%,#eef6ff 100%);box-shadow:0 16px 40px rgba(15,23,42,.08);}\
.home-hero:before{content:\"\";position:absolute;inset:auto -10% -38% auto;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(37,99,235,.14),rgba(37,99,235,0));}\
.home-hero:after{content:\"\";position:absolute;inset:-20% auto auto -8%;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(245,158,11,.16),rgba(245,158,11,0));}\
.home-hero-inner{position:relative;display:grid;grid-template-columns:minmax(0,1.6fr) minmax(280px,1fr);gap:18px;align-items:stretch;}\
.home-title{font-size:30px;line-height:1.1;font-weight:800;letter-spacing:-.02em;}\
.home-subtitle{margin-top:8px;color:var(--muted);font-size:13px;}\
.home-pill-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;}\
.home-pill{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.72);backdrop-filter:blur(8px);font-size:12px;color:#334155;box-shadow:inset 0 0 0 1px rgba(255,255,255,.55);}\
.home-pill b{font-weight:700;color:#0f172a;}\
.home-source-panel,.home-panel,.home-metric{background:var(--surface);backdrop-filter:blur(12px);border-radius:22px;box-shadow:0 10px 30px rgba(15,23,42,.06);}\
.home-source-panel{position:relative;padding:18px;}\
.home-source-title{font-size:13px;color:var(--muted);}\
.home-source-value{margin-top:6px;font-size:26px;font-weight:800;letter-spacing:-.02em;}\
.home-source-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;}\
.home-source-btn{appearance:none;border:none;border-radius:999px;padding:10px 14px;background:rgba(255,255,255,.88);color:#0f172a;font-weight:700;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(15,23,42,.08);}\
.home-source-btn.is-primary{background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;box-shadow:none;}\
.home-source-btn.is-active{transform:translateY(-1px);box-shadow:0 8px 20px rgba(37,99,235,.18);}\
.home-source-btn:disabled{opacity:.6;cursor:not-allowed;}\
.home-source-hint{margin-top:12px;font-size:12px;color:var(--muted);line-height:1.5;}\
.home-metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;}\
.home-metric{padding:16px 18px;}\
.home-metric-top{display:flex;align-items:center;justify-content:space-between;}\
.home-metric-title{font-size:13px;color:var(--muted);}\
.home-metric-main{display:flex;gap:14px;align-items:center;margin-top:10px;}\
.home-ring-wrap{position:relative;width:96px;height:96px;flex:0 0 96px;}\
.home-ring{width:96px;height:96px;transform:rotate(-90deg);}\
.home-ring-track{fill:none;stroke:rgba(15,23,42,.08);stroke-width:8;}\
.home-ring-progress{fill:none;stroke-width:8;stroke-linecap:round;transition:stroke-dashoffset .35s ease;}\
.home-ring-progress.tone-cpu{stroke:#2563eb;}\
.home-ring-progress.tone-mem{stroke:#10b981;}\
.home-ring-progress.tone-route{stroke:#f59e0b;}\
.home-ring-percent{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:800;}\
.home-metric-text{min-width:0;}\
.home-metric-value{font-size:22px;font-weight:800;line-height:1.2;word-break:break-word;}\
.home-metric-sub{margin-top:6px;font-size:12px;color:var(--muted);}\
.home-panels{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(300px,1fr);gap:14px;}\
.home-panel{padding:18px;}\
.home-panel-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px;}\
.home-panel-title{margin:0;font-size:16px;font-weight:800;}\
.home-panel-note{font-size:12px;color:var(--muted);}\
.home-traffic-rate{display:flex;gap:16px;font-size:13px;}\
.home-rx{color:#2563eb;}\
.home-tx{color:#f97316;}\
.home-chart-wrap{height:220px;border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(244,247,255,.82));padding:10px;}\
.home-chart{width:100%;height:100%;display:block;}\
.home-grid-line{stroke:rgba(100,116,139,.18);stroke-width:1;stroke-dasharray:4 4;}\
.home-rx-line{fill:none;stroke:#2563eb;stroke-width:2.6;}\
.home-tx-line{fill:none;stroke:#f97316;stroke-width:2.6;}\
.home-chart-label{margin-top:8px;text-align:right;font-size:12px;color:var(--muted);}\
.home-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}\
.home-info-card{padding:16px;border-radius:18px;background:rgba(255,255,255,.72);}\
.home-info-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;}\
.home-info-key{font-size:12px;color:var(--muted);}\
.home-info-value{font-size:13px;color:var(--text);word-break:break-all;text-align:right;}\
.home-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;}\
.home-btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:999px;background:#fff;text-decoration:none;color:#0f172a;font-weight:700;box-shadow:inset 0 0 0 1px rgba(15,23,42,.08);}\
.home-iface-list{display:flex;flex-direction:column;gap:10px;}\
.home-iface-row{display:flex;justify-content:space-between;gap:14px;padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.72);}\
.home-iface-main,.home-iface-side{display:flex;flex-direction:column;gap:6px;}\
.home-iface-side{text-align:right;align-items:flex-end;}\
.home-iface-label{font-size:14px;font-weight:700;}\
.home-iface-device,.home-iface-addr{font-size:12px;color:var(--muted);word-break:break-all;}\
.home-iface-badge{display:inline-flex;align-items:center;padding:5px 10px;border-radius:999px;font-size:12px;font-weight:700;}\
.home-iface-badge.is-up{background:rgba(16,185,129,.14);color:#047857;}\
.home-iface-badge.is-down{background:rgba(239,68,68,.12);color:#b91c1c;}\
.home-empty{padding:22px 16px;border-radius:18px;background:rgba(255,255,255,.62);color:var(--muted);text-align:center;font-size:13px;}\
@media (max-width: 1080px){.home-hero-inner,.home-panels{grid-template-columns:1fr;}.home-metric-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}\
@media (max-width: 640px){.home-dashboard{gap:14px;}.home-hero{padding:18px;border-radius:20px;}.home-title{font-size:24px;}.home-metric-grid,.home-info-grid{grid-template-columns:1fr;}.home-chart-wrap{height:180px;}.home-source-actions,.home-actions{gap:8px;}.home-source-btn,.home-btn{width:100%;}.home-iface-row{flex-direction:column;}.home-iface-side{text-align:left;align-items:flex-start;}}\
');

		var node = E('div', { 'class': 'home-dashboard' }, [
			style,
			E('section', { 'class': 'home-hero' }, [
				E('div', { 'class': 'home-hero-inner' }, [
					E('div', {}, [
						E('div', { 'class': 'home-title' }, board.hostname || board.model || _('路由器首页')),
						E('div', { 'class': 'home-subtitle' }, [
							(board.release && board.release.description) ? board.release.description : '-',
							' | ',
							_('内核') + ': ' + safeText(board.kernel),
							' | ',
							_('在线时长') + ': ' + formatUptime(info.uptime)
						]),
						E('div', { 'class': 'home-pill-row' }, [
							E('div', { 'class': 'home-pill' }, [_('WAN IPv4'), ' ', E('b', {}, firstAddr(wan))]),
							E('div', { 'class': 'home-pill' }, [_('WAN 网关'), ' ', E('b', {}, firstGateway(wan))]),
							E('div', { 'class': 'home-pill' }, [_('LAN IPv4'), ' ', E('b', {}, firstAddr(statuses.lan))]),
							E('div', { 'class': 'home-pill' }, [_('DNS'), ' ', E('b', {}, firstDns(wan))])
						])
					]),
					E('aside', { 'class': 'home-source-panel' }, [
						E('div', { 'class': 'home-source-title' }, _('软件源快捷切换')),
						sourceValue,
						E('div', { 'class': 'home-source-actions' }, [
							ustcBtn,
							officialBtn
						]),
						sourceHint
					])
				])
			]),
			E('div', { 'class': 'home-metric-grid' }, [
				cpuMetric.node,
				memMetric.node,
				routeMetric.node
			]),
			E('div', { 'class': 'home-panels' }, [
				E('section', { 'class': 'home-panel' }, [
					E('div', { 'class': 'home-panel-head' }, [
						E('h3', { 'class': 'home-panel-title' }, _('实时流量')),
						E('div', { 'class': 'home-traffic-rate' }, [
							E('span', {}, [_('下行'), ' ', rxRateEl]),
							E('span', {}, [_('上行'), ' ', txRateEl])
						])
					]),
					E('div', { 'class': 'home-chart-wrap' }, [
						E('svg', { 'class': 'home-chart', 'viewBox': '0 0 ' + chartW + ' ' + chartH, 'preserveAspectRatio': 'none' }, [
							E('line', { 'class': 'home-grid-line', 'x1': '0', 'y1': '42', 'x2': String(chartW), 'y2': '42' }),
							E('line', { 'class': 'home-grid-line', 'x1': '0', 'y1': '84', 'x2': String(chartW), 'y2': '84' }),
							E('line', { 'class': 'home-grid-line', 'x1': '0', 'y1': '126', 'x2': String(chartW), 'y2': '126' }),
							rxPath,
							txPath
						])
					]),
					E('div', { 'class': 'home-chart-label' }, _('最近 60 秒')),
					E('div', { 'class': 'home-actions' }, [
						E('a', { 'class': 'home-btn', 'href': L.url('admin/network/network') }, _('网络接口')),
						E('a', { 'class': 'home-btn', 'href': L.url('admin/network/wireless') }, _('无线设置')),
						E('a', { 'class': 'home-btn', 'href': L.url('admin/network/firewall') }, _('防火墙')),
						E('a', { 'class': 'home-btn', 'href': L.url('admin/services/package-manager') }, _('软件包'))
					])
				]),
				E('section', { 'class': 'home-panel' }, [
					E('div', { 'class': 'home-panel-head' }, [
						E('h3', { 'class': 'home-panel-title' }, _('网络概览')),
						E('div', { 'class': 'home-panel-note' }, _('自动适配手机与桌面端'))
					]),
					E('div', { 'class': 'home-info-grid' }, [
						E('div', { 'class': 'home-info-card' }, [
							infoRow(_('WAN 状态'), wan.up ? _('在线') : _('离线')),
							infoRow(_('WAN IPv4'), firstAddr(wan)),
							infoRow(_('WAN 网关'), firstGateway(wan)),
							infoRow(_('WAN DNS'), firstDns(wan))
						]),
						E('div', { 'class': 'home-info-card' }, [
							infoRow(_('LAN IPv4'), firstAddr(statuses.lan)),
							infoRow(_('LAN IPv6'), firstIpv6(statuses.lan)),
							infoRow(_('系统温度'), '-'),
							E('div', { 'class': 'home-info-row' }, [
								E('span', { 'class': 'home-info-key' }, _('当前软件源')),
								currentSourceInfo
							])
						])
					]),
					E('div', { 'class': 'home-panel-head', 'style': 'margin-top:18px;' }, [
						E('h3', { 'class': 'home-panel-title' }, _('接口状态')),
						E('div', { 'class': 'home-panel-note' }, _('不再依赖缺失的 RPC 接口'))
					]),
					ifaceWrap
				])
			])
		]);

		function updateIfacePanel(nextStatuses) {
			while (ifaceWrap.firstChild)
				ifaceWrap.removeChild(ifaceWrap.firstChild);

			ifaceRows(nextStatuses).forEach(function(row) {
				ifaceWrap.appendChild(row);
			});
		}

		function tick() {
			return Promise.all([
				callIfaceStatus('wan').catch(function() { return {}; }),
				callIfaceStatus('lan').catch(function() { return {}; }),
				callIfaceStatus('wan6').catch(function() { return {}; }),
				callIfaceStatus('wwan').catch(function() { return {}; }),
				callSystemInfo().catch(function() { return {}; }),
				fs.read('/proc/stat').catch(function() { return ''; })
			]).then(function(nextData) {
				var nextWan = nextData[0] || {};
				var nextStatuses = {
					wan: nextData[0] || {},
					lan: nextData[1] || {},
					wan6: nextData[2] || {},
					wwan: nextData[3] || {}
				};
				var nextInfo = nextData[4] || {};
				var nextCpu = parseCpuStat(nextData[5] || '');
				var now = Date.now();
				var curCounters = getWanCounters(nextWan);
				var dt = (now - lastTs) / 1000;
				var nextMem = formatMemory(nextInfo);
				var usage = calcCpuPercent(cpuSnapshot, nextCpu);

				if (!cpuSnapshot && nextCpu)
					cpuSnapshot = nextCpu;

				if (usage != null) {
					cpuSnapshot = nextCpu;
					setMetric(cpuMetric, usage, usage + '%', _('实时 CPU 占用'));
				}

				setMetric(memMetric, nextMem.percent, nextMem.label, nextMem.subtitle);
				setMetric(routeMetric, clamp(routeCount(nextWan) * 10, 0, 100), routeCount(nextWan), _('WAN 路由条目'));
				updateIfacePanel(nextStatuses);

				if (dt > 0.2 && curCounters.rx >= lastCounters.rx && curCounters.tx >= lastCounters.tx) {
					repaintChart((curCounters.rx - lastCounters.rx) / dt, (curCounters.tx - lastCounters.tx) / dt);
				}

				lastCounters = curCounters;
				lastTs = now;
			}).catch(function() {
				repaintChart(0, 0);
			});
		}

		repaintChart(0, 0);
		timer = window.setInterval(tick, 2000);
		node.addEventListener('remove', function() {
			if (timer)
				window.clearInterval(timer);
		});

		return node;
	}
});

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

function systemArch(board) {
	return safeText((board && (board.system || board.model)) || '-');
}

function firmwareVersion(board) {
	return safeText((board && board.release && board.release.description) || '-');
}

function productName(board) {
	var model = String((board && board.model) || '').trim();

	if (!model)
		return '-';

	return model.replace(/\s+v\d+.*$/i, '');
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

function normalizeTemp(value) {
	var n = toNum(value);

	if (!n)
		return null;

	if (n > 1000)
		n = n / 1000;

	if (n < -40 || n > 150)
		return null;

	return n;
}

function formatTemp(value) {
	var n = normalizeTemp(value);

	return n == null ? '-' : n.toFixed(1) + '°C';
}

function thermalRole(type) {
	type = String(type || '').trim().toLowerCase();

	if (/wifi|wlan|wireless|radio|phy|mt76|2g|5g/.test(type))
		return 'wifi';

	if (/cpu|soc|package/.test(type))
		return 'cpu';

	return '';
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

function pushUnique(list, value) {
	value = String(value || '').trim();

	if (!value || list.indexOf(value) >= 0)
		return;

	list.push(value);
}

function collectDeviceNames(list, value) {
	if (Array.isArray(value)) {
		for (var i = 0; i < value.length; i++)
			collectDeviceNames(list, value[i]);

		return;
	}

	String(value || '').split(/[\s,]+/).forEach(function(name) {
		if (name && name !== 'lo')
			pushUnique(list, name);
	});
}

function trafficDevices(name, status) {
	var names = [];

	collectDeviceNames(names, status.l3_device);
	collectDeviceNames(names, status.device);
	collectDeviceNames(names, status.ifname);
	collectDeviceNames(names, status.device_name);
	collectDeviceNames(names, status['l3-device']);
	collectDeviceNames(names, status['device-name']);

	if (name === 'lan')
		collectDeviceNames(names, [ 'br-lan' ]);
	else if (name === 'wan')
		collectDeviceNames(names, [ 'pppoe-wan', 'eth0', 'wan' ]);
	else if (name === 'wan6')
		collectDeviceNames(names, [ 'pppoe-wan', 'eth0', 'wan6' ]);
	else if (name === 'wwan')
		collectDeviceNames(names, [ 'wwan0', 'wlan0', 'rax0', 'apcli0' ]);

	return names;
}

function readSysfsCounters(devices) {
	var jobs = [];

	for (var i = 0; i < devices.length; i++) {
		(function(dev) {
			var base = '/sys/class/net/' + dev + '/statistics/';

			jobs.push(Promise.all([
				fs.read(base + 'rx_bytes').then(toNum).catch(function() { return null; }),
				fs.read(base + 'tx_bytes').then(toNum).catch(function() { return null; })
			]).then(function(values) {
				if (values[0] == null && values[1] == null)
					return null;

				return {
					device: dev,
					rx: toNum(values[0]),
					tx: toNum(values[1])
				};
			}));
		})(devices[i]);
	}

	return Promise.all(jobs).then(function(results) {
		var total = { rx: 0, tx: 0 };
		var found = false;

		for (var i = 0; i < results.length; i++) {
			if (!results[i])
				continue;

			total.rx += toNum(results[i].rx);
			total.tx += toNum(results[i].tx);
			found = true;
		}

		if (!found)
			return { rx: 0, tx: 0, ok: false, devices: [] };

		return {
			rx: total.rx,
			tx: total.tx,
			ok: true,
			devices: results.filter(function(item) { return item; }).map(function(item) { return item.device; })
		};
	});
}

function resolveTrafficCounters(statuses, preferredDevices) {
	var order = [ 'wan', 'wwan', 'lan', 'wan6' ];
	var devices = [];
	var ubusCounters = { rx: 0, tx: 0 };
	var hasUbusCounters = false;

	(preferredDevices || []).forEach(function(dev) {
		pushUnique(devices, dev);
	});

	for (var i = 0; i < order.length; i++) {
		var name = order[i];
		var status = statuses[name] || {};
		var counters = getWanCounters(status);

		if (counters.rx > 0 || counters.tx > 0) {
			ubusCounters.rx += counters.rx;
			ubusCounters.tx += counters.tx;
			hasUbusCounters = true;
		}

		trafficDevices(name, status).forEach(function(dev) {
			pushUnique(devices, dev);
		});
	}

	if (hasUbusCounters)
		return Promise.resolve({
			rx: ubusCounters.rx,
			tx: ubusCounters.tx,
			ok: true,
			devices: devices
		});

	return readSysfsCounters(devices);
}

function buildPath(values, maxVal, width, height) {
	if (!values.length)
		return '';

	var stepX = width / Math.max(values.length - 1, 1);
	var out = '';

	for (var i = 0; i < values.length; i++) {
		var x = values.length === 1 ? (width / 2).toFixed(2) : (i * stepX).toFixed(2);
		var y = (height - (values[i] / maxVal) * (height - 18) - 9).toFixed(2);
		out += (i === 0 ? 'M' : 'L') + x + ',' + y;
	}

	return out;
}

function buildAreaPath(values, maxVal, width, height) {
	if (!values.length)
		return '';

	var line = buildPath(values, maxVal, width, height);
	var stepX = width / Math.max(values.length - 1, 1);
	var firstX = values.length === 1 ? width / 2 : 0;
	var lastX = values.length === 1 ? width / 2 : (values.length - 1) * stepX;

	return line + 'L' + lastX.toFixed(2) + ',' + height + 'L' + firstX.toFixed(2) + ',' + height + 'Z';
}

function lastPoint(values, maxVal, width, height) {
	if (!values.length)
		return null;

	var stepX = width / Math.max(values.length - 1, 1);
	var i = values.length - 1;

	return {
		x: values.length === 1 ? width / 2 : i * stepX,
		y: height - (values[i] / maxVal) * (height - 18) - 9
	};
}

function drawSeries(ctx, values, maxVal, width, height, strokeColor, fillColor, dotColor) {
	if (!values.length)
		return;

	var stepX = width / Math.max(values.length - 1, 1);
	var pts = [];

	for (var i = 0; i < values.length; i++) {
		pts.push({
			x: values.length === 1 ? width / 2 : i * stepX,
			y: height - (values[i] / maxVal) * (height - 18) - 9
		});
	}

	function trace(points) {
		if (points.length === 1) {
			ctx.moveTo(points[0].x, points[0].y);
			ctx.lineTo(points[0].x + 0.01, points[0].y);
			return;
		}

		ctx.moveTo(points[0].x, points[0].y);
		for (var p = 1; p < points.length - 1; p++) {
			var cx = (points[p].x + points[p + 1].x) / 2;
			var cy = (points[p].y + points[p + 1].y) / 2;
			ctx.quadraticCurveTo(points[p].x, points[p].y, cx, cy);
		}
		ctx.quadraticCurveTo(
			points[points.length - 1].x,
			points[points.length - 1].y,
			points[points.length - 1].x,
			points[points.length - 1].y
		);
	}

	ctx.beginPath();
	ctx.moveTo(pts[0].x, height);
	trace(pts);
	ctx.lineTo(pts[pts.length - 1].x, height);
	ctx.closePath();
	ctx.fillStyle = fillColor;
	ctx.fill();

	ctx.beginPath();
	trace(pts);
	ctx.strokeStyle = strokeColor;
	ctx.lineWidth = 2.4;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.stroke();

	var last = pts[pts.length - 1];
	ctx.beginPath();
	ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
	ctx.fillStyle = dotColor;
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = '#ffffff';
	ctx.stroke();
}

function drawNormalizedSeries(ctx, values, width, height, strokeColor, fillColor, dotColor) {
	if (!values.length)
		return;

	var minVal = Infinity;
	var maxVal = -Infinity;

	for (var i = 0; i < values.length; i++) {
		minVal = Math.min(minVal, values[i]);
		maxVal = Math.max(maxVal, values[i]);
	}

	var span = Math.max(4, maxVal - minVal);
	var stepX = width / Math.max(values.length - 1, 1);
	var pts = [];

	for (var j = 0; j < values.length; j++) {
		var normalized = (values[j] - minVal) / span;
		pts.push({
			x: values.length === 1 ? width / 2 : j * stepX,
			y: height - normalized * (height - 26) - 13
		});
	}

	function trace(points) {
		if (points.length === 1) {
			ctx.moveTo(points[0].x, points[0].y);
			ctx.lineTo(points[0].x + 0.01, points[0].y);
			return;
		}

		ctx.moveTo(points[0].x, points[0].y);
		for (var p = 1; p < points.length - 1; p++) {
			var cx = (points[p].x + points[p + 1].x) / 2;
			var cy = (points[p].y + points[p + 1].y) / 2;
			ctx.quadraticCurveTo(points[p].x, points[p].y, cx, cy);
		}
		ctx.quadraticCurveTo(
			points[points.length - 1].x,
			points[points.length - 1].y,
			points[points.length - 1].x,
			points[points.length - 1].y
		);
	}

	ctx.beginPath();
	ctx.moveTo(pts[0].x, height - 4);
	trace(pts);
	ctx.lineTo(pts[pts.length - 1].x, height - 4);
	ctx.closePath();
	ctx.fillStyle = fillColor;
	ctx.fill();

	ctx.beginPath();
	trace(pts);
	ctx.strokeStyle = strokeColor;
	ctx.lineWidth = 2.2;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.stroke();

	var last = pts[pts.length - 1];
	ctx.beginPath();
	ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
	ctx.fillStyle = dotColor;
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = '#ffffff';
	ctx.stroke();
}

function getCanvasBox(canvas, fallbackW, fallbackH) {
	var rect = canvas.getBoundingClientRect();
	var width = Math.max(1, rect.width || fallbackW);
	var height = Math.max(1, rect.height || fallbackH);
	var dpr = Math.max(1, window.devicePixelRatio || 1);

	if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
	}

	var ctx = canvas.getContext('2d');
	if (!ctx)
		return null;

	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.clearRect(0, 0, width, height);

	return {
		ctx: ctx,
		width: width,
		height: height
	};
}

function drawMetricRing(metric, percent) {
	var box = getCanvasBox(metric.canvas, 124, 124);
	if (!box)
		return;

	var ctx = box.ctx;
	var width = box.width;
	var height = box.height;
	var cx = width / 2;
	var cy = height / 2;
	var radius = Math.min(width, height) / 2 - 10;
	var start = -Math.PI / 2;
	var end = start + (Math.PI * 2) * (clamp(percent, 0, 100) / 100);

	ctx.lineWidth = 10;
	ctx.lineCap = 'round';
	ctx.strokeStyle = 'rgba(20,32,51,.10)';
	ctx.beginPath();
	ctx.arc(cx, cy, radius, 0, Math.PI * 2);
	ctx.stroke();

	ctx.strokeStyle = metric.color;
	ctx.beginPath();
	ctx.arc(cx, cy, radius, start, end, false);
	ctx.stroke();
}

function drawTempSeries(ctx, values, width, height) {
	if (!values.length)
		return;

	var min = Math.min.apply(Math, values);
	var max = Math.max.apply(Math, values);
	var span = Math.max(4, max - min);
	var stepX = width / Math.max(values.length - 1, 1);
	var pts = [];

	for (var i = 0; i < values.length; i++) {
		var normalized = (values[i] - min) / span;
		pts.push({
			x: values.length === 1 ? width / 2 : i * stepX,
			y: height - normalized * (height - 22) - 11
		});
	}

	function trace(points) {
		if (points.length === 1) {
			ctx.moveTo(points[0].x, points[0].y);
			ctx.lineTo(points[0].x + 0.01, points[0].y);
			return;
		}

		ctx.moveTo(points[0].x, points[0].y);
		for (var p = 1; p < points.length - 1; p++) {
			var cx = (points[p].x + points[p + 1].x) / 2;
			var cy = (points[p].y + points[p + 1].y) / 2;
			ctx.quadraticCurveTo(points[p].x, points[p].y, cx, cy);
		}
		ctx.quadraticCurveTo(
			points[points.length - 1].x,
			points[points.length - 1].y,
			points[points.length - 1].x,
			points[points.length - 1].y
		);
	}

	ctx.beginPath();
	ctx.moveTo(pts[0].x, height);
	trace(pts);
	ctx.lineTo(pts[pts.length - 1].x, height);
	ctx.closePath();
	ctx.fillStyle = 'rgba(255,107,53,.08)';
	ctx.fill();

	ctx.beginPath();
	trace(pts);
	ctx.strokeStyle = '#ff6b35';
	ctx.lineWidth = 2.6;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.stroke();

	var last = pts[pts.length - 1];
	ctx.beginPath();
	ctx.arc(last.x, last.y, 6.5, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(255,107,53,.18)';
	ctx.fill();

	ctx.beginPath();
	ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
	ctx.fillStyle = '#ff6b35';
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = '#ffffff';
	ctx.stroke();
}

function discoverThermalSensors() {
	var jobs = [];

	for (var i = 0; i < 6; i++) {
		(function(idx) {
			var base = '/sys/class/thermal/thermal_zone' + idx + '/';

			jobs.push(Promise.all([
				fs.read(base + 'temp').catch(function() { return null; }),
				fs.read(base + 'type').catch(function() { return ''; })
			]).then(function(values) {
				var temp = normalizeTemp(values[0]);
				var type = String(values[1] || '').trim().toLowerCase();

				if (temp == null)
					return null;

				return {
					path: base + 'temp',
					type: type,
					temp: temp,
					role: thermalRole(type),
					score: /cpu|soc|package/.test(type) ? 3 : (/wifi|wlan|wireless|radio|phy|mt76|2g|5g/.test(type) ? 3 : 1)
				};
			}));
		})(i);
	}

	return Promise.all(jobs).then(function(results) {
		results = results.filter(function(item) { return item; });
		results.sort(function(a, b) { return b.score - a.score; });

		var cpu = null;
		var wifi = null;

		for (var i = 0; i < results.length; i++) {
			if (!cpu && (results[i].role === 'cpu' || (!results[i].role && !cpu)))
				cpu = results[i];

			if (!wifi && results[i].role === 'wifi')
				wifi = results[i];
		}

		if (!wifi) {
			for (var j = 0; j < results.length; j++) {
				if (cpu && results[j].path === cpu.path)
					continue;

				wifi = results[j];
				break;
			}
		}

		return {
			cpu: cpu,
			wifi: wifi
		};
	});
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

function wifiInterfaceSummary(statuses) {
	var names = [];
	var wwan = (statuses && statuses.wwan) || {};

	collectDeviceNames(names, wwan.l3_device);
	collectDeviceNames(names, wwan.device);
	collectDeviceNames(names, wwan.ifname);
	collectDeviceNames(names, wwan.device_name);
	collectDeviceNames(names, [ 'rax0', 'wlan0', 'wlan1', 'ra0', 'rai0', 'apcli0', 'wwan0' ]);

	return {
		name: names.length ? names[0] : _('未检测到'),
		state: wwan.up ? _('在线') : _('离线')
	};
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

function makeMetric(title, tone) {
	var canvas = E('canvas', { 'class': 'home-ring-canvas', 'width': '124', 'height': '124' });
	var percentEl = E('div', { 'class': 'home-ring-percent' }, '--%');
	var valueEl = E('div', { 'class': 'home-metric-value' }, '-');
	var subtitleEl = E('div', { 'class': 'home-metric-sub' }, '');
	var mainEl = E('div', { 'class': 'home-metric-main' }, [
		E('div', { 'class': 'home-ring-wrap' }, [
			canvas,
			E('div', { 'class': 'home-ring-core' }),
			percentEl
		]),
		E('div', { 'class': 'home-metric-text' }, [
			valueEl,
			subtitleEl
		])
	]);

	return {
		node: E('section', { 'class': 'home-metric' }, [
			E('div', { 'class': 'home-metric-top' }, [
				E('div', { 'class': 'home-metric-title' }, title)
			]),
			mainEl
		]),
		main: mainEl,
		canvas: canvas,
		color: tone === 'cpu' ? '#1677ff' : '#10b981',
		percent: percentEl,
		value: valueEl,
		subtitle: subtitleEl
	};
}

function setMetric(metric, percent, value, subtitle) {
	var p = clamp(toNum(percent), 0, 100);
	var from = toNum(metric.currentPercent);
	var to = p;
	var duration = 620;

	if (metric.animFrame)
		window.cancelAnimationFrame(metric.animFrame);

	function ease(t) {
		return 1 - Math.pow(1 - t, 3);
	}

	function drawFrame(now) {
		if (metric.animStart == null)
			metric.animStart = now;

		var progress = Math.min(1, (now - metric.animStart) / duration);
		var current = from + (to - from) * ease(progress);

		current = clamp(current, 0, 100);
		drawMetricRing(metric, current);
		metric.percent.textContent = Math.round(current) + '%';

		if (progress < 1)
			metric.animFrame = window.requestAnimationFrame(drawFrame);
		else
			metric.animFrame = null;
	}

	metric.currentPercent = p;
	metric.animStart = null;
	metric.value.textContent = safeText(value);
	metric.subtitle.textContent = safeText(subtitle);
	metric.animFrame = window.requestAnimationFrame(drawFrame);
}

function sourceButton(label, onClick) {
	return E('button', {
		'class': 'home-source-btn',
		'click': onClick
	}, label);
}

function infoRow(label, value) {
	return E('div', { 'class': 'home-info-row' }, [
		E('span', { 'class': 'home-info-key' }, label),
		E('span', { 'class': 'home-info-value' }, safeText(value))
	]);
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

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
		var routerName = board.hostname || board.model || _('路由器');
		var productLabel = productName(board);
		var currentSource = currentMirror(distfeeds);
		var cpuMetric = makeMetric(_('CPU 占用率'), 'cpu');
		var memMetric = makeMetric(_('内存占用'), 'mem');
		var tempCanvas = E('canvas', { 'class': 'home-temp-chart', 'width': '320', 'height': '96' });
		var tempValueEl = E('strong', { 'class': 'home-temp-value' }, '-');
		var tempEmptyEl = E('div', { 'class': 'home-temp-empty' }, _('未获取到 CPU 温度'));
		var rxRateEl = E('strong', { 'class': 'home-rx' }, '0 B/s');
		var txRateEl = E('strong', { 'class': 'home-tx' }, '0 B/s');
		var chartW = 760;
		var chartH = 220;
		var chartCanvas = E('canvas', { 'class': 'home-chart', 'width': String(chartW), 'height': String(chartH) });
		var chartEmptyEl = E('div', { 'class': 'home-chart-empty' }, _('正在采集接口流量...'));
		var sourceValue = E('div', { 'class': 'home-source-value' }, currentSource.label);
		var sourceHint = E('div', { 'class': 'home-source-hint' }, '');
		var maxPoints = 40;
		var rxHistory = [];
		var txHistory = [];
		var displayRxHistory = [];
		var displayTxHistory = [];
		var tempHistory = [];
		var displayTempHistory = [];
		var timer = null;
		var chartAnimFrame = null;
		var tempAnimFrame = null;
		var lastCounters = null;
		var lastTs = Date.now();
		var trafficDevicesCache = [];
		var cpuThermalSensor = null;
		var uptimeLabel = formatUptime(info.uptime);
		var firmware = firmwareVersion(board);
		var arch = systemArch(board);
		var kernel = safeText(board.kernel);
		var model = safeText(board.model);

		cpuMetric.node.classList.add('home-metric-cpu');
		cpuMetric.main.appendChild(E('div', { 'class': 'home-temp-block' }, [
			E('div', { 'class': 'home-temp-head' }, [
				E('span', { 'class': 'home-temp-title' }, _('CPU 温度')),
				tempValueEl
			]),
			E('div', { 'class': 'home-temp-wrap' }, [
				tempEmptyEl,
				tempCanvas
			])
		]));

		window.setTimeout(function() {
			setMetric(cpuMetric, 0, _('等待采样'), '');
			setMetric(memMetric, mem.percent, mem.label, mem.subtitle);
		}, 0);

		discoverThermalSensors().then(function(sensors) {
			cpuThermalSensor = sensors && sensors.cpu;

			if (!cpuThermalSensor)
				drawTempChart([]);
			else
				updateTemp(cpuThermalSensor.temp);
		}).catch(function() {
			drawTempChart([]);
		});

		function drawChart(rxValues, txValues) {
			var peak = 1;
			var hasTraffic = false;

			for (var i = 0; i < rxValues.length; i++) {
				peak = Math.max(peak, rxValues[i] || 0, txValues[i] || 0);
				if ((rxValues[i] || 0) > 0 || (txValues[i] || 0) > 0)
					hasTraffic = true;
			}

			var box = getCanvasBox(chartCanvas, chartW, chartH);
			if (!box)
				return;

			var ctx = box.ctx;
			var width = box.width;
			var height = box.height;

			ctx.strokeStyle = 'rgba(96,112,134,.16)';
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 6]);
			[Math.round(height * 0.2), Math.round(height * 0.4), Math.round(height * 0.6)].forEach(function(y) {
				ctx.beginPath();
				ctx.moveTo(0, y);
				ctx.lineTo(width, y);
				ctx.stroke();
			});
			ctx.setLineDash([]);

			if (!hasTraffic) {
				chartEmptyEl.style.display = 'flex';
				return;
			}

			chartEmptyEl.style.display = 'none';
			drawSeries(ctx, rxValues, peak, width, height, '#1677ff', 'rgba(22,119,255,.12)', '#1677ff');
			drawSeries(ctx, txValues, peak, width, height, '#ff8a1f', 'rgba(255,138,31,.10)', '#ff8a1f');
		}

		function drawTempChart(values) {
			var box = getCanvasBox(tempCanvas, 320, 96);
			if (!box)
				return;

			var ctx = box.ctx;
			var width = box.width;
			var height = box.height;
			var min = 999;
			var hasData = false;

			for (var i = 0; i < values.length; i++) {
				min = Math.min(min, values[i]);
				if (values[i] > 0)
					hasData = true;
			}

			if (!hasData) {
				tempEmptyEl.style.display = 'flex';
				return;
			}

			tempEmptyEl.style.display = 'none';
			ctx.strokeStyle = 'rgba(255,107,53,.10)';
			ctx.lineWidth = 1;
			ctx.setLineDash([3, 5]);
			[Math.round(height * 0.3), Math.round(height * 0.6)].forEach(function(y) {
				ctx.beginPath();
				ctx.moveTo(0, y);
				ctx.lineTo(width, y);
				ctx.stroke();
			});
			ctx.setLineDash([]);
			drawTempSeries(ctx, values, width, height);
		}

		function animateChart() {
			var fromRx = displayRxHistory.slice();
			var fromTx = displayTxHistory.slice();
			var toRx = rxHistory.slice();
			var toTx = txHistory.slice();
			var duration = 720;
			var start = null;

			while (fromRx.length < toRx.length)
				fromRx.unshift(0);
			while (fromTx.length < toTx.length)
				fromTx.unshift(0);

			if (chartAnimFrame)
				window.cancelAnimationFrame(chartAnimFrame);

			function ease(t) {
				return 1 - Math.pow(1 - t, 3);
			}

			function frame(now) {
				if (start == null)
					start = now;

				var p = Math.min(1, (now - start) / duration);
				var e = ease(p);
				var nextRx = [];
				var nextTx = [];

				for (var i = 0; i < toRx.length; i++) {
					nextRx.push(fromRx[i] + (toRx[i] - fromRx[i]) * e);
					nextTx.push(fromTx[i] + (toTx[i] - fromTx[i]) * e);
				}

				displayRxHistory = nextRx;
				displayTxHistory = nextTx;
				drawChart(displayRxHistory, displayTxHistory);

				if (p < 1)
					chartAnimFrame = window.requestAnimationFrame(frame);
				else
					chartAnimFrame = null;
			}

			chartAnimFrame = window.requestAnimationFrame(frame);
		}

		function animateTempChart() {
			var from = displayTempHistory.slice();
			var to = tempHistory.slice();
			var duration = 720;
			var start = null;

			while (from.length < to.length)
				from.unshift(to[0] || 0);

			if (tempAnimFrame)
				window.cancelAnimationFrame(tempAnimFrame);

			function ease(t) {
				return 1 - Math.pow(1 - t, 3);
			}

			function frame(now) {
				if (start == null)
					start = now;

				var p = Math.min(1, (now - start) / duration);
				var e = ease(p);
				var next = [];

				for (var i = 0; i < to.length; i++)
					next.push(from[i] + (to[i] - from[i]) * e);

				displayTempHistory = next;
				drawTempChart(displayTempHistory);

				if (p < 1)
					tempAnimFrame = window.requestAnimationFrame(frame);
				else
					tempAnimFrame = null;
			}

			tempAnimFrame = window.requestAnimationFrame(frame);
		}

		function repaintChart(rxRate, txRate) {
			rxRateEl.textContent = formatRate(rxRate);
			txRateEl.textContent = formatRate(txRate);

			rxHistory.push(rxRate);
			txHistory.push(txRate);
			if (rxHistory.length > maxPoints)
				rxHistory.shift();
			if (txHistory.length > maxPoints)
				txHistory.shift();

			animateChart();
		}

		function updateTemp(temp) {
			tempValueEl.textContent = formatTemp(temp);
			if (temp == null)
				return;

			tempHistory.push(temp);
			if (tempHistory.length > maxPoints)
				tempHistory.shift();

			animateTempChart();
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
				sourceHint.textContent = _('已切换为 ') + label;
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
		var officialBtn = sourceButton(_('官方源'), function() {
			writeMirror(MIRROR_OFFICIAL, _('官方源'), sourceButtons);
		});
		var ustcBtn = sourceButton(_('中科大源'), function() {
			writeMirror(MIRROR_USTC, _('中科大源'), sourceButtons);
		});

		sourceButtons.push({ node: officialBtn, url: MIRROR_OFFICIAL });
		sourceButtons.push({ node: ustcBtn, url: MIRROR_USTC });
		updateMirrorButtons(currentSource.url, sourceButtons);

		var style = E('style', {}, '\
.home-dashboard{--bg:#f4f7fb;--surface:#ffffff;--surface-alt:#f8fbff;--line:#dbe5f0;--text:#142033;--muted:#607086;--accent:#1677ff;--accent-2:#10b981;--accent-3:#ff8a1f;display:flex;flex-direction:column;gap:24px;color:var(--text);max-width:1480px;margin:0 auto;padding:12px 8px 28px;background:transparent;}\
.home-card,.home-metric,.home-source-panel,.home-hero,.home-panel{background:var(--surface);border:1px solid rgba(20,32,51,.06);box-shadow:0 18px 48px rgba(15,23,42,.08);border-radius:28px;}\
.home-hero{position:relative;overflow:hidden;padding:34px 34px 30px;background:linear-gradient(135deg,#0f172a 0%,#13233a 45%,#17385f 100%);color:#f8fbff;}\
.home-hero:before{content:\"\";position:absolute;right:-120px;top:-120px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(56,189,248,.28),rgba(56,189,248,0));}\
.home-hero:after{content:\"\";position:absolute;left:-80px;bottom:-130px;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,rgba(22,119,255,.26),rgba(22,119,255,0));}\
.home-hero-inner{position:relative;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(420px,1fr);gap:24px;align-items:start;}\
.home-eyebrow{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.1);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:rgba(248,251,255,.76);}\
.home-title{margin-top:16px;font-size:42px;line-height:1.02;font-weight:800;letter-spacing:-.04em;word-break:break-word;}\
.home-subtitle{margin-top:12px;max-width:46rem;color:rgba(248,251,255,.76);font-size:15px;line-height:1.7;}\
.home-summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}\
.home-summary-card{padding:18px 18px 16px;border-radius:22px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.12);}\
.home-summary-key{font-size:12px;color:rgba(248,251,255,.62);}\
.home-summary-value{margin-top:8px;font-size:18px;line-height:1.35;font-weight:700;word-break:break-word;color:#fff;}\
.home-main-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(340px,420px);gap:24px;align-items:stretch;}\
.home-panel{padding:26px 26px 22px;background:linear-gradient(180deg,#ffffff 0%,#f9fbff 100%);}\
.home-traffic-panel{min-height:420px;}\
.home-panel-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px;}\
.home-panel-title{margin:0;font-size:20px;font-weight:800;color:var(--text);}\
.home-panel-note{font-size:13px;color:var(--muted);}\
.home-traffic-rate{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;min-width:min(100%,420px);}\
.home-wifi-info-chip{padding:12px 14px;border-radius:18px;background:linear-gradient(180deg,#fbfdff 0%,#f4f8ff 100%);border:1px solid rgba(20,32,51,.08);}\
.home-wifi-info-key{display:block;font-size:12px;color:var(--muted);}\
.home-wifi-info-value{display:block;margin-top:6px;font-size:18px;font-weight:800;line-height:1.2;color:var(--text);word-break:break-word;}\
.home-rx{display:block;margin-top:6px;font-size:18px;font-weight:800;line-height:1.2;color:var(--accent);}\
.home-tx{display:block;margin-top:6px;font-size:18px;font-weight:800;line-height:1.2;color:var(--accent-3);}\
.home-chart-wrap{position:relative;height:300px;padding:16px;border-radius:24px;background:linear-gradient(180deg,#f8fbff 0%,#eef5ff 100%);border:1px solid rgba(22,119,255,.08);}\
.home-chart{width:100%;height:100%;display:block;}\
.home-chart-empty{position:absolute;inset:16px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:13px;color:var(--muted);border-radius:18px;background:rgba(255,255,255,.78);}\
.home-chart-label{margin-top:12px;text-align:right;font-size:12px;color:var(--muted);}\
.home-side-stack{display:grid;grid-template-columns:1fr;gap:20px;}\
.home-metric{padding:24px 24px 22px;background:linear-gradient(180deg,#ffffff 0%,#f9fbff 100%);}\
.home-metric-top{display:flex;align-items:center;justify-content:space-between;}\
.home-metric-title{font-size:13px;color:var(--muted);letter-spacing:.04em;}\
.home-metric-main{display:flex;gap:18px;align-items:center;margin-top:18px;}\
.home-ring-wrap{position:relative;width:124px;height:124px;flex:0 0 124px;}\
.home-ring-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}\
.home-ring-core{position:absolute;inset:17px;border-radius:50%;background:#ffffff;box-shadow:inset 0 0 0 1px rgba(20,32,51,.06);}\
.home-ring-percent{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:var(--text);z-index:1;}\
.home-metric-text{min-width:0;flex:1;}\
.home-metric-value{font-size:28px;font-weight:800;line-height:1.15;word-break:break-word;color:var(--text);}\
.home-metric-sub{margin-top:8px;font-size:13px;color:var(--muted);line-height:1.6;}\
.home-metric-cpu .home-metric-main{align-items:center;}\
.home-metric-cpu .home-metric-text{display:none;}\
.home-temp-block{margin-top:18px;padding-top:16px;border-top:1px solid rgba(20,32,51,.08);}\
.home-temp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;}\
.home-temp-title{font-size:12px;color:var(--muted);letter-spacing:.04em;}\
.home-temp-value{font-size:19px;font-weight:800;color:#ff6b35;}\
.home-temp-wrap{position:relative;margin-top:12px;height:96px;border-radius:18px;background:linear-gradient(180deg,#fffdfb 0%,#fff5ef 100%);border:1px solid rgba(255,107,53,.14);overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.85);}\
.home-temp-chart{width:100%;height:100%;display:block;}\
.home-temp-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--muted);background:rgba(255,255,255,.72);}\
.home-metric-cpu .home-ring-wrap{align-self:center;}\
.home-metric-cpu .home-temp-block{margin-top:-10%;padding-top:0;border-top:none;flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;align-self:center;}\
.home-metric-cpu .home-temp-head{min-height:24px;align-items:center;}\
.home-metric-cpu .home-temp-wrap{margin-top:2px;height:88px;}\
.home-source-panel{padding:24px 26px 26px;background:linear-gradient(180deg,#ffffff 0%,#f9fbff 100%);}\
.home-source-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}\
.home-source-title{font-size:18px;font-weight:800;color:var(--text);}\
.home-source-value{margin-top:6px;font-size:30px;font-weight:800;letter-spacing:-.03em;color:var(--text);}\
.home-source-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px;}\
.home-source-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:999px;padding:12px 18px;background:#eef4fb;color:#10213a;font-weight:700;line-height:1;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(20,32,51,.08);transition:background .2s ease,color .2s ease,transform .2s ease,box-shadow .2s ease;}\
.home-source-btn.is-active{background:linear-gradient(135deg,#1677ff,#4096ff);color:#fff;transform:translateY(-1px);box-shadow:0 10px 24px rgba(22,119,255,.22);}\
.home-source-btn:disabled{opacity:.6;cursor:not-allowed;}\
.home-source-hint{min-height:20px;margin-top:14px;font-size:12px;color:var(--muted);line-height:1.6;}\
@media (max-width: 1220px){.home-dashboard{padding:10px 6px 24px;}.home-hero-inner,.home-main-grid{grid-template-columns:1fr;}.home-side-stack{grid-template-columns:repeat(2,minmax(0,1fr));}}\
@media (max-width: 780px){.home-dashboard{gap:18px;padding:4px 0 20px;}.home-hero,.home-panel,.home-metric,.home-source-panel{border-radius:22px;padding:20px;}.home-title{font-size:30px;}.home-subtitle{font-size:14px;}.home-summary-grid,.home-side-stack{grid-template-columns:1fr;}.home-panel-head,.home-source-head{flex-direction:column;align-items:flex-start;}.home-traffic-rate{grid-template-columns:1fr;gap:10px;min-width:0;width:100%;}.home-chart-wrap{height:220px;padding:12px;}.home-ring-wrap{width:104px;height:104px;flex-basis:104px;}.home-ring-core{inset:15px;}.home-metric-cpu .home-metric-main{flex-direction:column;align-items:flex-start;}.home-metric-cpu .home-metric-text{flex:1;min-width:0;}.home-metric-cpu .home-temp-block{width:100%;}.home-source-actions{flex-direction:column;}.home-source-btn{width:100%;justify-content:center;}}\
');

		var node = E('div', { 'class': 'home-dashboard' }, [
			style,
			E('section', { 'class': 'home-hero' }, [
				E('div', { 'class': 'home-hero-inner' }, [
					E('div', {}, [
						E('div', { 'class': 'home-eyebrow' }, productLabel),
						E('div', { 'class': 'home-title' }, routerName),
						E('div', { 'class': 'home-subtitle' }, [
							_('固件版本') + ' ' + firmware,
							' · ',
							_('系统架构') + ' ' + arch,
							' · ',
							_('机型') + ' ' + model
						])
					]),
					E('div', { 'class': 'home-summary-grid' }, [
						E('div', { 'class': 'home-summary-card' }, [
							E('div', { 'class': 'home-summary-key' }, _('固件版本')),
							E('div', { 'class': 'home-summary-value' }, firmware)
						]),
						E('div', { 'class': 'home-summary-card' }, [
							E('div', { 'class': 'home-summary-key' }, _('系统架构')),
							E('div', { 'class': 'home-summary-value' }, arch)
						]),
						E('div', { 'class': 'home-summary-card' }, [
							E('div', { 'class': 'home-summary-key' }, _('内核版本')),
							E('div', { 'class': 'home-summary-value' }, kernel)
						]),
						E('div', { 'class': 'home-summary-card' }, [
							E('div', { 'class': 'home-summary-key' }, _('在线时长')),
							E('div', { 'class': 'home-summary-value' }, uptimeLabel)
						])
					])
				])
			]),
			E('div', { 'class': 'home-main-grid' }, [
				E('section', { 'class': 'home-panel home-traffic-panel' }, [
					E('div', { 'class': 'home-panel-head' }, [
						E('h3', { 'class': 'home-panel-title' }, _('实时流量')),
						E('div', { 'class': 'home-traffic-rate' }, [
							E('div', { 'class': 'home-wifi-info-chip' }, [
								E('span', { 'class': 'home-wifi-info-key' }, _('下行')),
								rxRateEl
							]),
							E('div', { 'class': 'home-wifi-info-chip' }, [
								E('span', { 'class': 'home-wifi-info-key' }, _('上行')),
								txRateEl
							])
						])
					]),
					E('div', { 'class': 'home-chart-wrap' }, [
						chartEmptyEl,
						chartCanvas
					]),
					E('div', { 'class': 'home-chart-label' }, _('最近 60 秒'))
				]),
				E('div', { 'class': 'home-side-stack' }, [
					cpuMetric.node,
					memMetric.node
				])
			]),
			E('section', { 'class': 'home-source-panel' }, [
				E('div', { 'class': 'home-source-head' }, [
					E('div', {}, [
						E('div', { 'class': 'home-source-title' }, _('软件源快捷切换')),
						E('div', { 'class': 'home-source-value' }, [ sourceValue ])
					]),
					E('div', { 'class': 'home-panel-note' }, '')
				]),
				E('div', { 'class': 'home-source-actions' }, [
					ustcBtn,
					officialBtn
				]),
				sourceHint
					])
		]);

		function tick() {
			var cpuThermalJob = cpuThermalSensor ? fs.read(cpuThermalSensor.path).catch(function() { return null; }) : Promise.resolve(null);

			return Promise.all([
				callIfaceStatus('wan').catch(function() { return {}; }),
				callIfaceStatus('lan').catch(function() { return {}; }),
				callIfaceStatus('wan6').catch(function() { return {}; }),
				callIfaceStatus('wwan').catch(function() { return {}; }),
				callSystemInfo().catch(function() { return {}; }),
				fs.read('/proc/stat').catch(function() { return ''; }),
				cpuThermalJob
			]).then(function(nextData) {
				var nextStatuses = {
					wan: nextData[0] || {},
					lan: nextData[1] || {},
					wan6: nextData[2] || {},
					wwan: nextData[3] || {}
				};
				var nextInfo = nextData[4] || {};
				var nextCpu = parseCpuStat(nextData[5] || '');
				var nextCpuTemp = normalizeTemp(nextData[6]);
				var nextMem = formatMemory(nextInfo);
				var usage = calcCpuPercent(cpuSnapshot, nextCpu);
				var now = Date.now();
				var dt = (now - lastTs) / 1000;

				if (!cpuSnapshot && nextCpu)
					cpuSnapshot = nextCpu;

				if (usage != null) {
					cpuSnapshot = nextCpu;
					setMetric(cpuMetric, usage, usage + '%', '');
				}

				setMetric(memMetric, nextMem.percent, nextMem.label, nextMem.subtitle);
				updateTemp(nextCpuTemp);

				return resolveTrafficCounters(nextStatuses, trafficDevicesCache).then(function(curCounters) {
					trafficDevicesCache = curCounters.devices || trafficDevicesCache;

					if (!lastCounters) {
						lastCounters = curCounters;
						lastTs = now;
						repaintChart(0, 0);
						return;
					}

					if (dt > 0.2 && curCounters.rx >= lastCounters.rx && curCounters.tx >= lastCounters.tx)
						repaintChart((curCounters.rx - lastCounters.rx) / dt, (curCounters.tx - lastCounters.tx) / dt);
					else
						repaintChart(0, 0);

					lastCounters = curCounters;
					lastTs = now;
				});
			}).catch(function() {
				repaintChart(0, 0);
			});
		}

		resolveTrafficCounters(statuses, trafficDevicesCache).then(function(counters) {
			trafficDevicesCache = counters.devices || trafficDevicesCache;
			lastCounters = counters;
			lastTs = Date.now();
		}).catch(function() {
			lastCounters = { rx: 0, tx: 0 };
			lastTs = Date.now();
		});

		drawChart([], [], []);
		tick();
		timer = window.setInterval(tick, 2000);
		node.addEventListener('remove', function() {
			if (chartAnimFrame)
				window.cancelAnimationFrame(chartAnimFrame);
			if (tempAnimFrame)
				window.cancelAnimationFrame(tempAnimFrame);
			if (timer)
				window.clearInterval(timer);
		});

		return node;
	}
});

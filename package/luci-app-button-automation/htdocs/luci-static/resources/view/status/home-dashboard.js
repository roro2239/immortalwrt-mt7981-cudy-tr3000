'use strict';
'require view';
'require rpc';

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

var callEthInfo = rpc.declare({
	object: 'luci',
	method: 'getETHInfo',
	expect: { '': {} }
});

var callTempInfo = rpc.declare({
	object: 'luci',
	method: 'getTempInfo',
	expect: { '': {} }
});

function formatUptime(sec) {
	sec = parseInt(sec || 0, 10);
	if (!sec || sec < 0)
		return '-';

	var d = Math.floor(sec / 86400);
	var h = Math.floor((sec % 86400) / 3600);
	var m = Math.floor((sec % 3600) / 60);

	if (d > 0)
		return d + '天 ' + h + '小时';

	return h + '小时 ' + m + '分钟';
}

function formatMemoryUsage(info) {
	if (!info || !info.memory || !info.memory.total)
		return '-';

	var total = parseInt(info.memory.total, 10);
	var free = parseInt(info.memory.free || 0, 10);
	var buffered = parseInt(info.memory.buffered || 0, 10);
	var shared = parseInt(info.memory.shared || 0, 10);
	var used = total - free - buffered - shared;

	if (total <= 0)
		return '-';

	return Math.max(0, Math.min(100, Math.round((used * 100) / total))) + '%';
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

function parseTemp(data) {
	if (!data || !Array.isArray(data.tempinfo) || !data.tempinfo.length)
		return '-';

	var t = data.tempinfo[0];
	if (t == null)
		return '-';

	if (typeof t === 'string')
		return t;

	if (typeof t === 'number')
		return t + '°C';

	if (t.temp != null)
		return String(t.temp) + '°C';

	if (t.value != null)
		return String(t.value) + '°C';

	return '-';
}

function card(title, value, extra) {
	return E('div', { 'class': 'home-card' }, [
		E('div', { 'class': 'home-card-title' }, title),
		E('div', { 'class': 'home-card-value' }, value),
		extra ? E('div', { 'class': 'home-card-extra' }, extra) : null
	]);
}

function itemRow(k, v) {
	return E('div', { 'class': 'home-kv-row' }, [
		E('span', { 'class': 'home-k' }, k),
		E('span', { 'class': 'home-v' }, v)
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			callSystemBoard().catch(function() { return {}; }),
			callSystemInfo().catch(function() { return {}; }),
			callIfaceStatus('wan').catch(function() { return {}; }),
			callIfaceStatus('lan').catch(function() { return {}; }),
			callEthInfo().catch(function() { return {}; }),
			callTempInfo().catch(function() { return {}; })
		]);
	},

	render: function(data) {
		var board = data[0] || {};
		var info = data[1] || {};
		var wan = data[2] || {};
		var lan = data[3] || {};
		var eth = data[4] || {};
		var temp = data[5] || {};

		var load = Array.isArray(info.load) && info.load.length ? (info.load[0] / 65535).toFixed(2) : '-';
		var memUsed = formatMemoryUsage(info);
		var uptime = formatUptime(info.uptime);
		var cpuTemp = parseTemp(temp);
		var ethRows = Array.isArray(eth.ethinfo) ? eth.ethinfo : [];

		var style = E('style', {}, '\
.home-dashboard{display:flex;flex-direction:column;gap:14px;}\
.home-hero{padding:16px 18px;border:1px solid var(--border-color-medium,#d8d8d8);border-radius:12px;background:var(--card-bg,#fff);box-shadow:0 2px 8px rgba(0,0,0,.04);}\
.home-hero-title{font-size:22px;font-weight:700;line-height:1.2;}\
.home-hero-sub{margin-top:6px;color:var(--text-color-low,#666);font-size:13px;}\
.home-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;}\
.home-card{padding:12px 14px;border:1px solid var(--border-color-medium,#d8d8d8);border-radius:12px;background:var(--card-bg,#fff);box-shadow:0 2px 8px rgba(0,0,0,.03);}\
.home-card-title{font-size:12px;color:var(--text-color-low,#777);}\
.home-card-value{margin-top:6px;font-size:24px;font-weight:700;}\
.home-card-extra{margin-top:4px;font-size:12px;color:var(--text-color-low,#777);}\
.home-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;}\
.home-panel{padding:12px 14px;border:1px solid var(--border-color-medium,#d8d8d8);border-radius:12px;background:var(--card-bg,#fff);}\
.home-panel-title{margin:0 0 10px 0;font-size:15px;font-weight:700;}\
.home-kv{display:flex;flex-direction:column;gap:8px;}\
.home-kv-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}\
.home-k{font-size:12px;color:var(--text-color-low,#777);}\
.home-v{font-size:13px;word-break:break-all;}\
.home-actions{display:flex;flex-wrap:wrap;gap:8px;}\
.home-btn{display:inline-flex;align-items:center;justify-content:center;padding:6px 12px;border:1px solid var(--border-color-medium,#d8d8d8);border-radius:8px;background:var(--btn-bg,#fff);text-decoration:none;color:inherit;}\
.home-link-up{color:#1a8f3a;font-weight:600;}\
.home-link-down{color:#a94442;font-weight:600;}\
.home-table th,.home-table td{padding:8px 10px;}\
@media (max-width: 640px){.home-hero-title{font-size:19px;}.home-panels{grid-template-columns:1fr;}}\
');

		var ethTable = E('table', { 'class': 'table home-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('端口')),
				E('th', { 'class': 'th' }, _('链路')),
				E('th', { 'class': 'th' }, _('速率')),
				E('th', { 'class': 'th' }, _('双工'))
			])
		]);

		cbi_update_table(ethTable, ethRows.map(function(r) {
			var up = (r && r.status === 'yes');
			return [
				r.name || '-',
				E('span', { 'class': up ? 'home-link-up' : 'home-link-down' }, up ? _('已连接') : _('未连接')),
				r.speed || '-',
				r.duplex || '-'
			];
		}), E('em', {}, _('暂无数据')));

		return E('div', { 'class': 'home-dashboard' }, [
			style,
			E('div', { 'class': 'home-hero' }, [
				E('div', { 'class': 'home-hero-title' }, board.hostname || board.model || _('路由器首页')),
				E('div', { 'class': 'home-hero-sub' }, [
					(board.release && board.release.description) ? board.release.description : '-',
					' | ',
					_('内核') + ': ' + (board.kernel || '-'),
					' | ',
					_('在线时长') + ': ' + uptime
				])
			]),

			E('div', { 'class': 'home-grid' }, [
				card(_('CPU 负载'), load),
				card(_('内存占用'), memUsed),
				card(_('WAN 状态'), wan.up ? _('在线') : _('离线'), firstAddr(wan)),
				card(_('温度'), cpuTemp)
			]),

			E('div', { 'class': 'home-panels' }, [
				E('div', { 'class': 'home-panel' }, [
					E('h3', { 'class': 'home-panel-title' }, _('网络信息')),
					E('div', { 'class': 'home-kv' }, [
						itemRow(_('WAN IPv4'), firstAddr(wan)),
						itemRow(_('WAN 网关'), firstGateway(wan)),
						itemRow(_('WAN DNS'), firstDns(wan)),
						itemRow(_('LAN IPv4'), firstAddr(lan)),
						itemRow(_('LAN IPv6'), firstIpv6(lan))
					])
				]),
				E('div', { 'class': 'home-panel' }, [
					E('h3', { 'class': 'home-panel-title' }, _('快捷入口')),
					E('div', { 'class': 'home-actions' }, [
						E('a', { 'class': 'home-btn', 'href': L.url('admin/network/network') }, _('网络接口')),
						E('a', { 'class': 'home-btn', 'href': L.url('admin/network/wireless') }, _('无线设置')),
						E('a', { 'class': 'home-btn', 'href': L.url('admin/network/firewall') }, _('防火墙')),
						E('a', { 'class': 'home-btn', 'href': L.url('admin/status/logs/syslog') }, _('系统日志'))
					])
				])
			]),

			E('div', { 'class': 'home-panel' }, [
				E('h3', { 'class': 'home-panel-title' }, _('网口状态')),
				ethTable
			])
		]);
	}
});

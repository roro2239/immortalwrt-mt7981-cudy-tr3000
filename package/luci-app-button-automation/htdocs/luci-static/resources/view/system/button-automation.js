'use strict';
'require view';
'require form';
'require fs';
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

return view.extend({
	load: function() {
		return Promise.all([
			fs.list('/sys/class/leds').catch(function() {
				return [];
			}),
			fs.list('/etc/rc.button').catch(function() {
				return [];
			}),
			fs.read('/tmp/button-automation/events.log').catch(function() {
				return '';
			}),
			fs.read('/etc/config/button_automation').catch(function() {
				return '';
			}),
			fs.read('/proc/meminfo').catch(function() {
				return '';
			}),
			fs.read('/proc/loadavg').catch(function() {
				return '';
			}),
			fs.read('/proc/uptime').catch(function() {
				return '';
			}),
			fs.read('/proc/net/route').catch(function() {
				return '';
			}),
			callSystemBoard().catch(function() {
				return {};
			}),
			callSystemInfo().catch(function() {
				return {};
			})
		]);
	},

	render: function(loadData) {
		var m, s, o;
		var ledNames = [];
		var buttonNames = [];
		var monitorFile = '/tmp/button-automation/events.log';
		var monitorTimer = null;
		var overviewTimer = null;
		var monitorRunning = false;
		var ledEntries = loadData[0] || [];
		var rcButtonEntries = loadData[1] || [];
		var monitorLog = loadData[2] || '';
		var configText = loadData[3] || '';
		var memInfoText = loadData[4] || '';
		var loadAvgText = loadData[5] || '';
		var uptimeText = loadData[6] || '';
		var routeText = loadData[7] || '';
		var boardInfo = loadData[8] || {};
		var systemInfo = loadData[9] || {};
		var networkLatency = null;
		var networkTarget = '-';

		if (Array.isArray(ledEntries)) {
			ledEntries.forEach(function(entry) {
				if (entry && entry.name)
					ledNames.push(entry.name);
			});
		}

		if (Array.isArray(rcButtonEntries)) {
			rcButtonEntries.forEach(function(entry) {
				if (entry && entry.name && buttonNames.indexOf(entry.name) === -1)
					buttonNames.push(entry.name);
			});
		}

		if (monitorLog) {
			monitorLog.split('\n').forEach(function(line) {
				var m = line.match(/button=([A-Za-z0-9_.-]+)/);
				if (m && m[1] && buttonNames.indexOf(m[1]) === -1)
					buttonNames.push(m[1]);
			});
		}

		if (buttonNames.indexOf('BTN_0') !== -1) {
			buttonNames = ['BTN_0'].concat(buttonNames.filter(function(name) {
				return name !== 'BTN_0';
			}));
		}

		m = new form.Map('button_automation', _('设备概览与按键自动化'), _('现代化概览面板，保留原有规则配置与实时监测。'));

		s = m.section(form.TypedSection, 'global', _('全局设置'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('启用自动化'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'debounce_ms', _('去抖动毫秒'));
		o.datatype = 'uinteger';
		o.placeholder = '500';
		o.rmempty = false;

		o = s.option(form.Flag, 'allow_custom_command', _('允许自定义命令'));
		o.default = '0';
		o.rmempty = false;

		s = m.section(form.GridSection, 'rule', _('规则'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;

		o = s.option(form.Flag, 'enabled', _('启用'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.ListValue, 'button', _('按钮名'));
		buttonNames.forEach(function(name) {
			o.value(name, name);
		});
		o.description = buttonNames.length ? _('自动检测到系统按钮，直接选择即可。') : _('未检测到按钮，请先拨动一次开关再刷新页面。');
		o.rmempty = false;

		o = s.option(form.ListValue, 'action', _('动作事件'));
		o.value('pressed', _('pressed（拨到上侧）'));
		o.value('released', _('released（拨到下侧）'));
		o.rmempty = false;

		o = s.option(form.ListValue, 'op_type', _('执行类型'));
		o.value('wifi', _('WiFi 总开关'));
		o.value('led', _('LED 开关'));
		o.value('command', _('自定义命令'));
		o.rmempty = false;

		o = s.option(form.ListValue, 'wifi_state', _('WiFi 状态'));
		o.value('on', _('开'));
		o.value('off', _('关'));
		o.depends('op_type', 'wifi');
		o.rmempty = false;

		o = s.option(form.ListValue, 'led_name', _('LED 名称'));
		ledNames.forEach(function(name) {
			o.value(name, name);
		});
		o.depends('op_type', 'led');
		o.rmempty = false;

		o = s.option(form.ListValue, 'led_state', _('LED 状态'));
		o.value('on', _('开'));
		o.value('off', _('关'));
		o.depends('op_type', 'led');
		o.rmempty = false;

		o = s.option(form.Value, 'command', _('自定义命令'));
		o.depends('op_type', 'command');
		o.placeholder = 'service network restart';
		o.rmempty = false;

		function parseConfig(text) {
			var lines = (text || '').split('\n');
			var rules = [];
			var current = null;

			lines.forEach(function(line) {
				var l = line.trim();
				var mConfig, mOption;
				if (!l || l.charAt(0) === '#')
					return;

				mConfig = l.match(/^config\s+(\S+)(?:\s+'([^']+)')?/);
				if (mConfig) {
					current = {
						type: mConfig[1],
						name: mConfig[2] || ''
					};
					if (current.type === 'rule')
						rules.push(current);
					return;
				}

				mOption = l.match(/^option\s+(\S+)\s+'([^']*)'/);
				if (mOption && current && current.type === 'rule')
					current[mOption[1]] = mOption[2];
			});

			return rules;
		}

		function parseEvents(text) {
			var events = [];
			(text || '').split('\n').forEach(function(line) {
				var tsMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
				if (!tsMatch)
					return;

				var ev = {
					raw: line,
					ts: tsMatch[1]
				};

				var button = line.match(/button=([A-Za-z0-9_.-]+)/);
				var action = line.match(/action=([A-Za-z0-9_.-]+)/);
				var code = line.match(/code=([0-9]+)/);
				var section = line.match(/section=([A-Za-z0-9_.-]+)/);

				ev.button = button ? button[1] : '-';
				ev.action = action ? action[1] : '-';
				ev.code = code ? code[1] : '';
				ev.section = section ? section[1] : '';
				events.push(ev);
			});
			return events;
		}

		function parseMemUsage(text) {
			var total = text.match(/MemTotal:\s+([0-9]+)/);
			var avail = text.match(/MemAvailable:\s+([0-9]+)/);
			if (!total || !avail)
				return null;
			var t = parseInt(total[1], 10);
			var a = parseInt(avail[1], 10);
			if (!t || t <= 0)
				return null;
			return Math.round((t - a) * 100 / t);
		}

		function parseLoadAvg(text) {
			var parts = String(text || '').trim().split(/\s+/);
			return parts.length ? parts[0] : '-';
		}

		function parseUptime(text) {
			var sec = parseInt((String(text || '').trim().split(/\s+/)[0] || '0'), 10);
			if (!sec || sec < 0)
				return '-';
			var d = Math.floor(sec / 86400);
			var h = Math.floor((sec % 86400) / 3600);
			var m = Math.floor((sec % 3600) / 60);
			if (d > 0)
				return d + '天 ' + h + '小时';
			return h + '小时 ' + m + '分钟';
		}

		function hexToIp(hex) {
			if (!hex || hex.length !== 8)
				return '';
			var b1 = parseInt(hex.slice(6, 8), 16);
			var b2 = parseInt(hex.slice(4, 6), 16);
			var b3 = parseInt(hex.slice(2, 4), 16);
			var b4 = parseInt(hex.slice(0, 2), 16);
			return [b1, b2, b3, b4].join('.');
		}

		function parseDefaultRoute(text) {
			var lines = (text || '').split('\n');
			for (var i = 1; i < lines.length; i++) {
				var p = lines[i].trim().split(/\s+/);
				if (p.length > 2 && p[1] === '00000000' && p[2] !== '00000000')
					return hexToIp(p[2]);
			}
			return '';
		}

		function actionLabel(action) {
			var map = {
				pressed: _('滑动上拨'),
				released: _('滑动下拨'),
				click: _('单击'),
				double: _('双击'),
				long: _('长按')
			};
			return map[action] || action || '-';
		}

		function opLabel(op) {
			var map = {
				wifi: _('WiFi 开关'),
				led: _('LED 开关'),
				command: _('自定义命令')
			};
			return map[op] || op || '-';
		}

		function buildDonut(title, value, total, color) {
			var percent = 0;
			if (total > 0)
				percent = Math.round(value * 100 / total);
			var radius = 36;
			var circumference = 2 * Math.PI * radius;
			var offset = circumference - (percent / 100) * circumference;

			return E('div', { 'class': 'ba-donut-card' }, [
				E('div', { 'class': 'ba-donut-title' }, title),
				E('svg', { 'class': 'ba-donut', 'viewBox': '0 0 100 100' }, [
					E('circle', {
						'class': 'ba-donut-bg',
						'cx': '50',
						'cy': '50',
						'r': radius
					}),
					E('circle', {
						'class': 'ba-donut-fg',
						'cx': '50',
						'cy': '50',
						'r': radius,
						'stroke': color,
						'stroke-dasharray': circumference.toFixed(2),
						'stroke-dashoffset': offset.toFixed(2)
					}),
					E('text', { 'x': '50', 'y': '46', 'class': 'ba-donut-main' }, percent + '%'),
					E('text', { 'x': '50', 'y': '62', 'class': 'ba-donut-sub' }, value + '/' + total)
				])
			]);
		}

		function summarizeRules(rules) {
			var stats = {
				total: rules.length,
				enabled: 0,
				byAction: {},
				byOp: {},
				matrix: {}
			};
			rules.forEach(function(r, idx) {
				if (r.enabled === '1')
					stats.enabled++;
				var a = r.action || 'unknown';
				var op = r.op_type || 'unknown';
				stats.byAction[a] = (stats.byAction[a] || 0) + 1;
				stats.byOp[op] = (stats.byOp[op] || 0) + 1;
				if (r.button) {
					if (!stats.matrix[r.button])
						stats.matrix[r.button] = {};
					stats.matrix[r.button][a] = opLabel(op) + (r.enabled === '1' ? '' : _('（停用）'));
				}
				if (!r.name)
					r.name = 'rule_' + idx;
			});
			return stats;
		}

		function eventsIn24h(events) {
			var now = Date.now();
			var dayMs = 24 * 3600 * 1000;
			return events.filter(function(ev) {
				var ts = Date.parse(ev.ts.replace(' ', 'T'));
				return !isNaN(ts) && (now - ts) <= dayMs;
			}).length;
		}

		function buildOverview(configRaw, logRaw, memRaw, loadRaw, upRaw, routeRaw, boardRaw, sysRaw) {
			var rules = parseConfig(configRaw);
			var ruleStats = summarizeRules(rules);
			var events = parseEvents(logRaw);
			var event24h = eventsIn24h(events);
			var lastEvent = events.length ? events[events.length - 1].ts : _('暂无');
			var memUsage = parseMemUsage(memRaw);
			var loadValue = parseLoadAvg(loadRaw);
			var uptimeValue = parseUptime(upRaw || ((sysRaw || {}).uptime || ''));
			var host = boardRaw.hostname || boardRaw.model || _('未知设备');
			var kernel = boardRaw.kernel || '-';
			var defGw = parseDefaultRoute(routeRaw);
			networkTarget = defGw || '223.5.5.5';

			var top = E('div', { 'class': 'ba-hero' }, [
				E('div', { 'class': 'ba-hero-title' }, _('设备概览')),
				E('div', { 'class': 'ba-hero-sub' }, host + ' · ' + kernel),
				E('div', { 'class': 'ba-hero-sub' }, _('在线时长') + '：' + uptimeValue + ' · ' + _('负载') + '：' + loadValue + ' · ' + _('内存占用') + '：' + (memUsage == null ? '-' : memUsage + '%'))
			]);

			var cards = E('div', { 'class': 'ba-cards' }, [
				E('div', { 'class': 'ba-card' }, [E('div', { 'class': 'ba-k' }, _('总规则')), E('div', { 'class': 'ba-v' }, String(ruleStats.total))]),
				E('div', { 'class': 'ba-card' }, [E('div', { 'class': 'ba-k' }, _('启用规则')), E('div', { 'class': 'ba-v' }, String(ruleStats.enabled))]),
				E('div', { 'class': 'ba-card' }, [E('div', { 'class': 'ba-k' }, _('24小时触发')), E('div', { 'class': 'ba-v' }, String(event24h))]),
				E('div', { 'class': 'ba-card' }, [E('div', { 'class': 'ba-k' }, _('网络延迟')), E('div', { 'class': 'ba-v', 'id': 'ba-latency' }, networkLatency == null ? _('检测中...') : networkLatency + ' ms')]),
				E('div', { 'class': 'ba-card ba-card-wide' }, [E('div', { 'class': 'ba-k' }, _('最近触发')), E('div', { 'class': 'ba-v ba-v-sm' }, lastEvent)])
			]);

			var donuts = E('div', { 'class': 'ba-donuts' }, [
				buildDonut(_('规则启用率'), ruleStats.enabled, Math.max(ruleStats.total, 1), '#22c55e'),
				buildDonut(_('滑动上拨占比'), ruleStats.byAction.pressed || 0, Math.max(ruleStats.total, 1), '#3b82f6'),
				buildDonut(_('滑动下拨占比'), ruleStats.byAction.released || 0, Math.max(ruleStats.total, 1), '#f59e0b')
			]);

			var matrix = E('table', { 'class': 'table cbi-section-table ba-matrix' }, [
				E('thead', {}, [
					E('tr', {}, [
						E('th', {}, _('按钮')),
						E('th', {}, _('单击')),
						E('th', {}, _('双击')),
						E('th', {}, _('长按')),
						E('th', {}, _('滑动上拨')),
						E('th', {}, _('滑动下拨'))
					])
				]),
				E('tbody', {}, Object.keys(ruleStats.matrix).sort().map(function(button) {
					var row = ruleStats.matrix[button] || {};
					return E('tr', {}, [
						E('td', {}, button),
						E('td', {}, row.click || _('未绑定')),
						E('td', {}, row.double || _('未绑定')),
						E('td', {}, row.long || _('未绑定')),
						E('td', {}, row.pressed || _('未绑定')),
						E('td', {}, row.released || _('未绑定'))
					]);
				}))
			]);

			var timeline = E('div', { 'class': 'ba-timeline' }, (events.slice(-8).reverse().map(function(ev) {
				var codeText = ev.code ? (' · code=' + ev.code) : '';
				return E('div', { 'class': 'ba-line' }, [
					E('div', { 'class': 'ba-line-ts' }, ev.ts),
					E('div', { 'class': 'ba-line-main' }, (ev.button || '-') + ' · ' + actionLabel(ev.action) + codeText)
				]);
			})));
			if (!events.length)
				timeline.appendChild(E('div', { 'class': 'ba-line' }, [E('div', { 'class': 'ba-line-main' }, _('暂无触发记录'))]));

			return E('div', { 'class': 'ba-overview-wrap', 'id': 'ba-overview-wrap' }, [
				top,
				cards,
				donuts,
				E('div', { 'class': 'ba-block' }, [E('h3', {}, _('触发器绑定矩阵')), matrix]),
				E('div', { 'class': 'ba-block' }, [E('h3', {}, _('最近事件时间线')), timeline])
			]);
		}

		function renderStyle() {
			return E('style', {}, '\
.ba-overview-wrap{margin-bottom:16px;}\
.ba-hero{padding:14px 16px;border-radius:12px;background:linear-gradient(120deg,#1f2937,#334155);color:#fff;margin-bottom:12px;}\
.ba-hero-title{font-size:20px;font-weight:700;line-height:1.3;}\
.ba-hero-sub{opacity:.9;margin-top:4px;font-size:13px;}\
.ba-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:12px;}\
.ba-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;box-shadow:0 2px 8px rgba(15,23,42,.05);}\
.ba-card-wide{grid-column:span 2;}\
.ba-k{font-size:12px;color:#64748b;}\
.ba-v{margin-top:6px;font-size:24px;font-weight:700;color:#0f172a;}\
.ba-v-sm{font-size:15px;font-weight:600;word-break:break-all;}\
.ba-donuts{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:12px;}\
.ba-donut-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px;text-align:center;box-shadow:0 2px 8px rgba(15,23,42,.05);}\
.ba-donut-title{font-size:13px;color:#334155;margin-bottom:6px;}\
.ba-donut{width:130px;height:130px;}\
.ba-donut-bg{fill:none;stroke:#e2e8f0;stroke-width:10;}\
.ba-donut-fg{fill:none;stroke-width:10;stroke-linecap:round;transform:rotate(-90deg);transform-origin:50% 50%;}\
.ba-donut-main{font-size:16px;font-weight:700;fill:#0f172a;text-anchor:middle;}\
.ba-donut-sub{font-size:11px;fill:#64748b;text-anchor:middle;}\
.ba-block{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;margin-bottom:12px;box-shadow:0 2px 8px rgba(15,23,42,.05);}\
.ba-matrix th,.ba-matrix td{padding:8px 10px;font-size:12px;}\
.ba-timeline{display:flex;flex-direction:column;gap:8px;}\
.ba-line{padding:8px 10px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;}\
.ba-line-ts{font-size:11px;color:#64748b;}\
.ba-line-main{font-size:13px;color:#0f172a;margin-top:2px;}\
@media (max-width: 768px){.ba-card-wide{grid-column:span 1;}}\
');
		}

		function updateLatency(node) {
			return fs.exec('/bin/ping', ['-c', '1', '-W', '1', networkTarget]).then(function(res) {
				var out = ((res && res.stdout) || '') + ' ' + ((res && res.stderr) || '');
				var m = out.match(/time=([0-9.]+)/);
				var text = '-';
				if (m && m[1]) {
					networkLatency = Math.round(parseFloat(m[1]));
					text = networkLatency + ' ms';
				}
				var n = node.querySelector('#ba-latency');
				if (n)
					n.textContent = text;
			}).catch(function() {
				var n = node.querySelector('#ba-latency');
				if (n)
					n.textContent = '-';
			});
		}

		return m.render().then(function(node) {
			node.prepend(renderStyle());
			var overview = buildOverview(configText, monitorLog, memInfoText, loadAvgText, uptimeText, routeText, boardInfo, systemInfo);
			node.prepend(overview);

			var panel = E('div', {
				'class': 'cbi-section'
			}, [
				E('h3', {}, _('事件监测')),
				E('div', {
					'style': 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;'
				}, [
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'id': 'btn-monitor-toggle',
						'click': function(ev) {
							ev.preventDefault();
							toggleMonitor();
						}
					}, _('开始监测')),
					E('button', {
						'class': 'btn cbi-button',
						'id': 'btn-monitor-clear',
						'click': function(ev) {
							ev.preventDefault();
							clearMonitor();
						}
					}, _('清空日志')),
					E('span', {
						'id': 'btn-monitor-status',
						'style': 'opacity:.8;'
					}, _('未启动'))
				]),
				E('pre', {
					'id': 'btn-monitor-log',
					'style': 'max-height:320px;overflow:auto;background:#111;color:#d7f3d1;padding:10px;white-space:pre-wrap;word-break:break-word;'
				}, _('暂无日志'))
			]);

			function setStatus(text) {
				var status = node.querySelector('#btn-monitor-status');
				if (status)
					status.textContent = text;
			}

			function setToggleText(text) {
				var btn = node.querySelector('#btn-monitor-toggle');
				if (btn)
					btn.textContent = text;
			}

			function refreshMonitor() {
				return fs.read(monitorFile).then(function(content) {
					var box = node.querySelector('#btn-monitor-log');
					if (!box)
						return;

					if (!content || !content.trim())
						box.textContent = _('暂无日志');
					else
						box.textContent = content;

					box.scrollTop = box.scrollHeight;
				}).catch(function() {
					var box = node.querySelector('#btn-monitor-log');
					if (box)
						box.textContent = _('暂无日志');
				});
			}

			function toggleMonitor() {
				if (monitorRunning) {
					if (monitorTimer)
						window.clearInterval(monitorTimer);
					monitorTimer = null;
					monitorRunning = false;
					setStatus(_('已停止'));
					setToggleText(_('开始监测'));
					return;
				}

				monitorRunning = true;
				setStatus(_('监测中（每 1.5 秒刷新）'));
				setToggleText(_('停止监测'));
				refreshMonitor();
				monitorTimer = window.setInterval(refreshMonitor, 1500);
			}

			function clearMonitor() {
				fs.write(monitorFile, '').then(function() {
					refreshMonitor();
					setStatus(_('已清空'));
				}).catch(function() {
					setStatus(_('清空失败（检查权限）'));
				});
			}

			node.appendChild(panel);
			updateLatency(node);
			overviewTimer = window.setInterval(function() {
				updateLatency(node);
			}, 10000);

			node.addEventListener('remove', function() {
				if (monitorTimer)
					window.clearInterval(monitorTimer);
				if (overviewTimer)
					window.clearInterval(overviewTimer);
			});

			return node;
		});
	}
});

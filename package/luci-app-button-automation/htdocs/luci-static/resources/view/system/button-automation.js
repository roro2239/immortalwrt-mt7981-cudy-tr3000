'use strict';
'require view';
'require form';
'require fs';
'require rpc';
'require ui';
'require dom';

var callSystemBoard = rpc.declare({
	object: 'system',
	method: 'board',
	expect: { '': {} }
});

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return Promise.all([
			callSystemBoard().catch(function() {
				return {};
			}),
			fs.list('/sys/class/leds').catch(function() {
				return [];
			}),
			fs.read('/tmp/button-automation/events.log').catch(function() {
				return '';
			})
		]);
	},

	render: function(loadData) {
		var m, s, o;
		var ledNames = [];
		var monitorFile = '/tmp/button-automation/events.log';
		var monitorTimer = null;
		var monitorRunning = false;
		var saveTimer = null;
		var saveRunning = false;
		var saveQueued = false;
		var board = loadData[0] || {};
		var ledEntries = loadData[1] || [];
		var routerModel = String(board.model || '').trim() || _('路由器设备');

		if (Array.isArray(ledEntries)) {
			ledEntries.forEach(function(entry) {
				if (entry && entry.name)
					ledNames.push(entry.name);
			});
		}

		m = new form.Map('button_automation', '', '');

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

		o = s.option(form.HiddenValue, 'button');
		o.default = 'BTN_0';
		o.rmempty = false;
		o.cfgvalue = function() {
			return 'BTN_0';
		};

		o = s.option(form.ListValue, 'action', _('推动方向'));
		o.value('pressed', _('往前推'));
		o.value('released', _('往后推'));
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

		return m.render().then(function(node) {
			var style = E('style', {}, "\
.button-auto-shell{display:flex;flex-direction:column;gap:20px;color:#0f172a;}\
.button-auto-hero{position:relative;overflow:hidden;border-radius:28px;padding:28px 30px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 55%,#38bdf8 100%);box-shadow:0 20px 48px rgba(15,23,42,.18);color:#fff;}\
.button-auto-hero:before{content:'';position:absolute;right:-56px;top:-56px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.22),rgba(255,255,255,0));pointer-events:none;}\
.button-auto-eyebrow{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.72;}\
.button-auto-title{margin-top:10px;font-size:34px;line-height:1.1;font-weight:800;}\
.button-auto-subtitle{margin-top:10px;max-width:760px;font-size:14px;line-height:1.75;color:rgba(255,255,255,.82);}\
.button-auto-shell .cbi-map{background:transparent;border:none;box-shadow:none;margin:0;}\
.button-auto-shell .cbi-map > h2,.button-auto-shell .cbi-map > .cbi-map-descr{display:none;}\
.button-auto-shell .cbi-section{margin:0 0 18px;border-radius:24px;border:1px solid rgba(148,163,184,.18);background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%);box-shadow:0 18px 40px rgba(15,23,42,.07);padding:22px 22px 18px;}\
.button-auto-shell .cbi-section:last-child{margin-bottom:0;}\
.button-auto-shell .cbi-section > h3:first-child,.button-auto-shell .cbi-section legend{margin:0 0 14px;font-size:20px;font-weight:800;color:#0f172a;}\
.button-auto-shell .cbi-section-descr{margin:-4px 0 14px;color:#475569;}\
.button-auto-shell .cbi-value{padding:12px 0;border-top:1px solid rgba(226,232,240,.7);}\
.button-auto-shell .cbi-value:first-of-type{border-top:none;padding-top:2px;}\
.button-auto-shell .cbi-value-title{font-weight:700;color:#0f172a;}\
.button-auto-shell .cbi-value-description{color:#64748b;}\
.button-auto-shell input,.button-auto-shell select,.button-auto-shell textarea{min-height:42px;border-radius:14px;border:1px solid rgba(148,163,184,.28);background:#fff;box-shadow:none;}\
.button-auto-shell input:focus,.button-auto-shell select:focus,.button-auto-shell textarea:focus{border-color:#2563eb;box-shadow:0 0 0 4px rgba(37,99,235,.12);}\
.button-auto-shell .cbi-button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;border-radius:999px;padding:0 16px;border:none;box-shadow:inset 0 0 0 1px rgba(15,23,42,.08);background:rgba(255,255,255,.92);color:#0f172a;font-weight:700;line-height:1;}\
.button-auto-shell .cbi-button-action,.button-auto-shell .cbi-button-add{background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;box-shadow:0 10px 24px rgba(37,99,235,.18);}\
.button-auto-shell .cbi-section-table{overflow:hidden;border-radius:18px;border:1px solid rgba(226,232,240,.9);}\
.button-auto-shell .table{margin:0;}\
.button-auto-shell .table .tr{background:#fff;}\
.button-auto-shell .table .tr:nth-child(even){background:#f8fafc;}\
.button-auto-shell .table .th,.button-auto-shell .table .td{padding:12px 14px;border-bottom:1px solid rgba(226,232,240,.78);vertical-align:middle;}\
.button-auto-shell .table .th{font-weight:800;color:#334155;background:#f8fbff;}\
.button-auto-monitor{border-radius:24px;border:1px solid rgba(148,163,184,.18);background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%);box-shadow:0 18px 40px rgba(15,23,42,.07);padding:22px;}\
.button-auto-monitor h3{margin:0 0 14px;font-size:20px;font-weight:800;color:#0f172a;}\
.button-auto-monitor-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;}\
.button-auto-monitor-status{font-size:13px;font-weight:700;color:#475569;}\
.button-auto-monitor-log{max-height:320px;overflow:auto;margin:0;border-radius:18px;background:#0f172a;color:#d7f3d1;padding:14px;white-space:pre-wrap;word-break:break-word;box-shadow:inset 0 0 0 1px rgba(255,255,255,.04);}\
@media (max-width: 768px){.button-auto-hero{padding:24px 20px;border-radius:24px;}.button-auto-title{font-size:28px;}.button-auto-shell .cbi-section,.button-auto-monitor{padding:18px;}.button-auto-shell .table .th,.button-auto-shell .table .td{padding:10px 12px;}}\
");
			var panel = E('div', {
				'class': 'button-auto-monitor'
			}, [
				E('h3', {}, _('事件监测')),
				E('div', {
					'class': 'button-auto-monitor-toolbar'
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
						'class': 'button-auto-monitor-status'
					}, _('未启动'))
				]),
				E('pre', {
					'id': 'btn-monitor-log',
					'class': 'button-auto-monitor-log'
				}, _('暂无日志'))
			]);
			var shell = E('div', { 'class': 'button-auto-shell' }, [
				style,
				E('section', { 'class': 'button-auto-hero' }, [
					E('div', { 'class': 'button-auto-eyebrow' }, _('系统 · 按键自动化')),
					E('div', { 'class': 'button-auto-title' }, _('按键自动化')),
					E('div', { 'class': 'button-auto-subtitle' }, routerModel)
				]),
				node,
				panel
			]);

			function saveNow() {
				if (saveRunning) {
					saveQueued = true;
					return Promise.resolve();
				}

				saveRunning = true;

				return dom.callClassMethod(node, 'save').then(function() {
				}).catch(function(err) {
					ui.addNotification(null, E('p', {}, _('自动保存失败：') + (err && err.message ? err.message : err)), 'danger');
				}).finally(function() {
					saveRunning = false;
					if (saveQueued) {
						saveQueued = false;
						saveNow();
					}
				});
			}

			function scheduleSave(delay) {
				if (saveTimer)
					window.clearTimeout(saveTimer);

				saveTimer = window.setTimeout(function() {
					saveTimer = null;
					saveNow();
				}, delay || 220);
			}

			function setStatus(text) {
				var status = shell.querySelector('#btn-monitor-status');
				if (status)
					status.textContent = text;
			}

			function setToggleText(text) {
				var btn = shell.querySelector('#btn-monitor-toggle');
				if (btn)
					btn.textContent = text;
			}

			function refreshMonitor() {
				return fs.read(monitorFile).then(function(content) {
					var box = shell.querySelector('#btn-monitor-log');
					if (!box)
						return;

					if (!content || !content.trim())
						box.textContent = _('暂无日志');
					else
						box.textContent = content;

					box.scrollTop = box.scrollHeight;
				}).catch(function() {
					var box = shell.querySelector('#btn-monitor-log');
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

			node.addEventListener('change', function(ev) {
				var target = ev.target;
				if (!target || target.closest('.button-auto-monitor'))
					return;
				scheduleSave(180);
			}, true);

			node.addEventListener('blur', function(ev) {
				var target = ev.target;
				if (!target || target.closest('.button-auto-monitor'))
					return;
				if (target.matches('input[type=\"text\"], input[type=\"number\"], textarea'))
					scheduleSave(120);
			}, true);

			node.addEventListener('click', function(ev) {
				var target = ev.target && ev.target.closest('.cbi-button');
				if (!target || target.closest('.button-auto-monitor'))
					return;
				window.setTimeout(function() {
					scheduleSave(120);
				}, 0);
			}, true);

			shell.addEventListener('remove', function() {
				if (monitorTimer)
					window.clearInterval(monitorTimer);
				if (saveTimer)
					window.clearTimeout(saveTimer);
			});

			return shell;
		});
	}
});

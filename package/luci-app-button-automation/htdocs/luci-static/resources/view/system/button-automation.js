'use strict';
'require view';
'require form';
'require fs';

return view.extend({
	load: function() {
		return Promise.all([
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
		var ledEntries = loadData[0] || [];

		if (Array.isArray(ledEntries)) {
			ledEntries.forEach(function(entry) {
				if (entry && entry.name)
					ledNames.push(entry.name);
			});
		}

		m = new form.Map('button_automation', _('cudytr3000'), _('专用'));

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

		o = s.option(form.DummyValue, '_button_fixed', _('按钮名'));
		o.textvalue = function() {
			return 'BTN_0';
		};

		o = s.option(form.HiddenValue, 'button');
		o.default = 'BTN_0';
		o.rmempty = false;
		o.cfgvalue = function() {
			return 'BTN_0';
		};

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

		return m.render().then(function(node) {
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
			node.addEventListener('remove', function() {
				if (monitorTimer)
					window.clearInterval(monitorTimer);
			});

			return node;
		});
	}
});

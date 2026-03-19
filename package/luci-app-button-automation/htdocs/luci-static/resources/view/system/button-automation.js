'use strict';
'require view';
'require form';
'require fs';

return view.extend({
	load: function() {
		return fs.list('/sys/class/leds').catch(function() {
			return [];
		});
	},

	render: function(ledEntries) {
		var m, s, o;
		var ledNames = [];

		if (Array.isArray(ledEntries)) {
			ledEntries.forEach(function(entry) {
				if (entry && entry.name)
					ledNames.push(entry.name);
			});
		}

		m = new form.Map('button_automation', _('按键自动化'), _('为滑动开关的 pressed/released 事件绑定动作。'));

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

		o = s.option(form.Value, 'button', _('按钮名'));
		o.placeholder = 'mode_switch';
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

		return m.render();
	}
});

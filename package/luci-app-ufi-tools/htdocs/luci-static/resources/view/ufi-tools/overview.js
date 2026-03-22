'use strict';
'require view';
'require form';

function normalizeUrl(raw) {
	raw = String(raw || '').trim();

	if (!raw)
		raw = 'http://192.168.0.1:2333/';

	if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw))
		raw = 'http://' + raw.replace(/^\/+/, '');

	return raw;
}

return view.extend({
	render: function() {
		var defaultUrl = normalizeUrl('http://192.168.0.1:2333/');
		var m = new form.Map('ufi-tools', _('UFI-TOOLS'),
			_('外层保持 LuCI 风格，内容区直接承载 UFI-TOOLS 原版后台。修改地址后可先点“加载地址”即时切换，确认可用后再保存。'));
		var s = m.section(form.NamedSection, 'main', 'main', _('连接设置'));
		var o = s.option(form.Value, 'url', _('后台地址'));

		s.anonymous = true;
		s.addremove = false;

		o.rmempty = false;
		o.default = defaultUrl;
		o.placeholder = defaultUrl;
		o.datatype = 'string';
		o.validate = function(section_id, value) {
			return String(value || '').trim() ? true : _('请输入后台地址');
		};

		return m.render().then(function(node) {
			var frame = E('iframe', {
				'class': 'ufi-tools-frame',
				'src': defaultUrl
			});
			var status = E('div', {
				'class': 'ufi-tools-status'
			}, _('首次进入将自动加载已保存地址'));
			var currentUrl = E('code', {
				'class': 'ufi-tools-url'
			}, defaultUrl);
			var applyBtn = E('button', {
				'class': 'btn cbi-button cbi-button-action'
			}, _('加载地址'));
			var refreshBtn = E('button', {
				'class': 'btn cbi-button'
			}, _('刷新内嵌页'));
			var openBtn = E('button', {
				'class': 'btn cbi-button'
			}, _('新窗口打开'));

			function getUrl() {
				var input = node.querySelector('input[name="cbid.ufi-tools.main.url"]');
				return normalizeUrl(input ? input.value : defaultUrl);
			}

			function updateFrame(message) {
				var url = getUrl();
				frame.src = url;
				currentUrl.textContent = url;
				status.textContent = message;
			}

			applyBtn.addEventListener('click', function(ev) {
				ev.preventDefault();
				updateFrame(_('已按当前输入地址更新内嵌页'));
			});

			refreshBtn.addEventListener('click', function(ev) {
				ev.preventDefault();
				updateFrame(_('已刷新内嵌页'));
			});

			openBtn.addEventListener('click', function(ev) {
				ev.preventDefault();
				window.open(getUrl(), '_blank', 'noopener');
			});

			frame.addEventListener('load', function() {
				status.textContent = _('页面已加载；如内容为空，请检查目标地址或直接使用“新窗口打开”。');
			});

			window.setTimeout(function() {
				updateFrame(_('已自动加载保存地址'));
			}, 0);

			var input = node.querySelector('input[name="cbid.ufi-tools.main.url"]');
			if (input) {
				input.addEventListener('keydown', function(ev) {
					if (ev.key === 'Enter') {
						ev.preventDefault();
						updateFrame(_('已按当前输入地址更新内嵌页'));
					}
				});
			}

			var section = E('div', {
				'class': 'cbi-section ufi-tools-shell'
			}, [
				E('style', {}, '\
.ufi-tools-shell{display:flex;flex-direction:column;gap:14px;}\
.ufi-tools-toolbar{display:flex;gap:10px;flex-wrap:wrap;}\
.ufi-tools-meta{display:grid;gap:8px;padding:12px 14px;border:1px solid #d9d9d9;border-radius:8px;background:#fff;}\
.ufi-tools-url{display:block;padding:8px 10px;border-radius:6px;background:#f5f5f5;word-break:break-all;font-family:Consolas,Monaco,monospace;}\
.ufi-tools-status{color:#666;line-height:1.5;}\
.ufi-tools-frame-wrap{border:1px solid #d9d9d9;border-radius:8px;overflow:hidden;background:#fff;}\
.ufi-tools-frame{display:block;width:100%;height:calc(100vh - 19rem);min-height:760px;border:0;background:#fff;}\
@media (max-width: 768px){.ufi-tools-frame{height:calc(100vh - 16rem);min-height:680px;}}\
'),
				E('h3', {}, _('内嵌后台')),
				E('div', {
					'class': 'cbi-section-descr'
				}, _('此页面不改造 UFI-TOOLS 内部界面，只在 LuCI 中提供统一入口与地址配置。修改地址后，使用页面底部“保存并应用”可持久化到下次打开。')),
				E('div', {
					'class': 'ufi-tools-toolbar'
				}, [
					applyBtn,
					refreshBtn,
					openBtn
				]),
				E('div', {
					'class': 'ufi-tools-meta'
				}, [
					E('strong', {}, _('当前内嵌地址')),
					currentUrl,
					status
				]),
				E('div', {
					'class': 'ufi-tools-frame-wrap'
				}, [
					frame
				])
			]);

			var actions = node.querySelector('.cbi-page-actions');
			if (actions)
				node.insertBefore(section, actions);
			else
				node.appendChild(section);

			return node;
		});
	}
});

'use strict';
'require view';

var APP_RELEASE = 'r73';
var STANDALONE_SRC = '/ufi-tools/redraw/index.html?v=' + APP_RELEASE;

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	render: function() {
		return E('div', { class: 'ufi-standalone-shell' }, [
			E('style', {}, ''
				+ '.ufi-standalone-shell{display:grid;gap:12px;}'
				+ '.ufi-standalone-note{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid #d9e5ea;border-radius:16px;background:#f8fbfd;color:#334155;font-size:13px;}'
				+ '.ufi-standalone-note strong{color:#0f172a;}'
				+ '.ufi-standalone-frame{display:block;width:100%;min-height:calc(100vh - 160px);border:0;border-radius:24px;background:#eef4f7;box-shadow:0 18px 42px rgba(15,23,42,.08);}'
				+ '@media (max-width:640px){.ufi-standalone-note{align-items:flex-start;flex-direction:column;}.ufi-standalone-frame{min-height:calc(100vh - 120px);border-radius:18px;}}'
			),
			E('div', { class: 'ufi-standalone-note' }, [
				E('strong', {}, 'UFI-TOOLS 独立前端'),
				E('span', {}, '当前构建：' + APP_RELEASE)
			]),
			E('iframe', {
				class: 'ufi-standalone-frame',
				src: STANDALONE_SRC,
				referrerpolicy: 'same-origin',
				loading: 'eager'
			})
		]);
	}
});

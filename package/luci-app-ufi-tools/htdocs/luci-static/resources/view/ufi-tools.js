'use strict';
'require view';

var APP_RELEASE = 'r88';
var STANDALONE_SRC = '/ufi-tools/redraw/index.html?v=' + APP_RELEASE;

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	render: function() {
		return E('div', { class: 'ufi-standalone-shell' }, [
			E('style', {}, ''
				+ '.ufi-standalone-shell{display:grid;}'
				+ '.ufi-standalone-frame{display:block;width:100%;min-height:calc(100vh - 160px);border:0;border-radius:24px;background:#eef4f7;box-shadow:0 18px 42px rgba(15,23,42,.08);}'
				+ '@media (max-width:640px){.ufi-standalone-frame{min-height:calc(100vh - 120px);border-radius:18px;}}'
			),
			E('iframe', {
				class: 'ufi-standalone-frame',
				src: STANDALONE_SRC,
				referrerpolicy: 'same-origin',
				loading: 'eager'
			})
		]);
	}
});

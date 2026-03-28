/*
??????????
??????? toast?????????????????????????????
??????????????????????????????
*/


function showToast(message, kind) {
	var toast = document.createElement('div');
	var palette = {
		success: '#0f766e',
		error: '#b91c1c',
		info: '#1d4ed8'
	};

	toast.className = 'ufi-toast';
	toast.textContent = message;
	toast.style.background = palette[kind || 'info'] || palette.info;
	els.toast.appendChild(toast);

	setTimeout(function() {
		toast.classList.add('is-leaving');
		setTimeout(function() { toast.remove(); }, 280);
	}, 2600);
}

function openPanel(name) {
	Array.prototype.forEach.call(rootEl.querySelectorAll('.ufi-panel'), function(panel) {
		panel.hidden = panel.dataset.panel !== name;
	});
	rootEl.querySelector('.ufi-modal-wrap').hidden = false;
	if (els.logPanelTitle && name === 'logs')
		els.logPanelTitle.textContent = text(state.logSessionTitle, '功能日志');
	if (name === 'sms') {
		loadSms().catch(function(err) {
			showToast(text(err && err.message, '读取短信失败'), 'error');
		});
		startSmsRefresh();
	} else if (name === 'cellular') {
		stopSmsRefresh();
		loadCellularPanel().catch(function(err) {
			showToast(text(err && err.message, '读取蜂窝状态失败'), 'error');
		});
	} else {
		stopSmsRefresh();
	}
}

function closePanels() {
	stopSmsRefresh();
	rootEl.querySelector('.ufi-modal-wrap').hidden = true;
	Array.prototype.forEach.call(rootEl.querySelectorAll('.ufi-panel'), function(panel) {
		panel.hidden = true;
	});
}

function initPluginCompatCollapses() {
	if (els.collapse_status)
		pluginCompatCreateCollapseObserver(els.collapse_status);

	if (els.collapse_smsforward)
		pluginCompatCreateCollapseObserver(els.collapse_smsforward);

	try {
		pluginCompatCollapseGen('#collapse_status_btn', '#collapse_status', 'plugin_compat_collapse_status');
	}
	catch (err) {}

	try {
		pluginCompatCollapseGen('#collapse_smsforward_btn', '#collapse_smsforward', 'plugin_compat_collapse_smsforward');
	}
	catch (err) {}
}

function getPluginCompatSnapshot() {
	return JSON.stringify({
		container: els.pluginCompatContainer ? els.pluginCompatContainer.innerHTML : '',
		dialogBody: els.pluginCompatDialogBody ? els.pluginCompatDialogBody.innerHTML : '',
		menuCollapse: els.collapse_status ? (els.collapse_status.innerHTML + '|' + els.collapse_status.getAttribute('data-name')) : '',
		smsModal: els.smsList ? (els.smsList.innerHTML + '|' + els.smsList.style.display) : '',
		smsForwardCollapse: els.collapse_smsforward ? (els.collapse_smsforward.innerHTML + '|' + els.collapse_smsforward.getAttribute('data-name')) : '',
		status: els.STATUS ? els.STATUS.innerHTML : '',
		body: els.pluginCompatBody ? els.pluginCompatBody.innerHTML : '',
		pluginButton: els.PLUGIN_SETTING ? els.PLUGIN_SETTING.outerHTML : '',
		smsButton: els.SMS ? els.SMS.outerHTML : '',
		atButton: els.AT ? els.AT.outerHTML : '',
		advanceButton: els.ADVANCE ? els.ADVANCE.outerHTML : '',
		pluginModal: els.PluginModal ? (els.PluginModal.innerHTML + '|' + els.PluginModal.style.display + '|' + els.PluginModal.style.opacity) : '',
		storeModal: els.plugin_store ? (els.plugin_store.innerHTML + '|' + els.plugin_store.style.display + '|' + els.plugin_store.style.opacity) : '',
		atModal: els.ATModal ? (els.ATModal.innerHTML + '|' + els.ATModal.style.display + '|' + els.ATModal.style.opacity) : '',
		advanceModal: els.advanceModal ? (els.advanceModal.innerHTML + '|' + els.advanceModal.style.display + '|' + els.advanceModal.style.opacity) : '',
		smsForwardModal: els.smsForwardModal ? (els.smsForwardModal.innerHTML + '|' + els.smsForwardModal.style.display + '|' + els.smsForwardModal.style.opacity) : '',
		atResult: els.AT_RESULT ? els.AT_RESULT.textContent : '',
		adResult: els.AD_RESULT ? els.AD_RESULT.textContent : ''
	});
}

function pluginCompatSnapshotChanged(beforeSnapshot) {
	return beforeSnapshot !== getPluginCompatSnapshot();
}

function pluginCompatShowModal(selector, time, opacity) {
	var el = document.querySelector(selector);
	var displayMode;

	if (!el)
		return;

	normalizePluginCompatModalNode(el);
	el.style.opacity = '0';
	displayMode = shouldCapturePluginModalNode(el) ? 'flex' : '';
	el.style.display = displayMode;
	window.setTimeout(function() {
		el.style.opacity = text(opacity, '1');
	}, Number(time) > 10 ? 10 : 0);
}

function pluginCompatCloseModal(selector, time, callback) {
	var el = document.querySelector(selector);

	if (!el)
		return;

	el.style.opacity = '0';
	window.setTimeout(function() {
		el.style.display = 'none';
		if (typeof callback === 'function')
			callback();
	}, Number(time) || 300);
}

function pluginCompatDebounce(fn, delay) {
	var timer = null;

	return function() {
		var args = arguments;
		var self = this;

		if (timer)
			window.clearTimeout(timer);

		timer = window.setTimeout(function() {
			fn.apply(self, args);
		}, Number(delay) || 0);
	};
}

function pluginCompatCreateSwitch(options) {
	var config = options || {};
	var container = E('button', {
		type: 'button',
		'class': 'ufi-plugin-compat-switch'
	});
	var knob = E('span', { 'class': 'ufi-plugin-compat-switch-knob' });
	var checked = !!config.value;

	function update(next) {
		checked = !!next;
		container.setAttribute('aria-pressed', checked ? 'true' : 'false');
		container.className = 'ufi-plugin-compat-switch' + (checked ? ' is-on' : '');
	}

	container.appendChild(knob);
	container.addEventListener('click', function() {
		update(!checked);
		if (typeof config.onChange === 'function')
			config.onChange(checked);
	});
	container.update = update;
	update(checked);

	return container;
}

function pluginCompatCreateCollapseObserver(boxEl) {
	var box;
	var resizeObserver;
	var mutationObserver;

	if (!boxEl)
		return null;

	box = boxEl.querySelector('.collapse_box');
	if (!box)
		return { el: boxEl };

	function applyState() {
		var opened = boxEl.getAttribute('data-name') === 'open';

		boxEl.style.overflow = 'hidden';
		boxEl.style.height = opened ? (box.getBoundingClientRect().height + 'px') : '0';
	}

	if (typeof ResizeObserver !== 'undefined') {
		resizeObserver = new ResizeObserver(function() {
			if (boxEl.getAttribute('data-name') === 'open')
				applyState();
		});
		resizeObserver.observe(box);
	}

	if (typeof MutationObserver !== 'undefined') {
		mutationObserver = new MutationObserver(function(records) {
			(records || []).forEach(function(record) {
				if (record.type === 'attributes' && record.attributeName === 'data-name')
					applyState();
			});
		});
		mutationObserver.observe(boxEl, {
			attributes: true,
			attributeFilter: ['data-name']
		});
	}

	applyState();

	return {
		el: boxEl,
		destroy: function() {
			if (resizeObserver)
				resizeObserver.disconnect();
			if (mutationObserver)
				mutationObserver.disconnect();
		}
	};
}

function pluginCompatCollapseGen(btnId, collapseId, storName, callback) {
	var observed = pluginCompatCreateCollapseObserver(document.querySelector(collapseId));
	var collapseEl;
	var collapseBtn;
	var switchComponent;
	var syncObserver;
	var stored;

	if (!observed || !observed.el)
		throw new Error('缺少页面节点：' + collapseId);

	collapseEl = observed.el;
	collapseBtn = document.querySelector(btnId);
	if (!collapseBtn)
		throw new Error('缺少页面节点：' + btnId);

	stored = storName ? localStorage.getItem(storName) : '';
	collapseEl.dataset.name = stored || 'close';
	if (storName && !stored)
		localStorage.setItem(storName, 'close');

	if (collapseBtn.querySelector('.ufi-plugin-compat-switch'))
		collapseBtn.innerHTML = '';

	switchComponent = pluginCompatCreateSwitch({
		value: collapseEl.dataset.name === 'open',
		onChange: function(newVal) {
			collapseEl.dataset.name = newVal ? 'open' : 'close';
			if (typeof callback === 'function')
				callback(collapseEl.dataset.name);
			if (storName)
				localStorage.setItem(storName, collapseEl.dataset.name);
		}
	});

	if (typeof MutationObserver !== 'undefined') {
		syncObserver = new MutationObserver(function() {
			switchComponent.update(collapseEl.dataset.name === 'open');
		});
		syncObserver.observe(collapseEl, {
			attributes: true,
			attributeFilter: ['data-name']
		});
	}

	collapseBtn.appendChild(switchComponent);

	return {
		el: collapseEl,
		destroy: function() {
			if (syncObserver)
				syncObserver.disconnect();
			if (observed && observed.destroy)
				observed.destroy();
		}
	};
}

function normalizePluginCompatModalNode(node) {
	var inner;
	var widthText;
	var isWide;
	var hasFooter;

	if (!node || node.nodeType !== 1 || node.getAttribute('data-ufi-modal-ready') === '1')
		return node;

	node.setAttribute('data-ufi-modal-ready', '1');

	if (shouldCapturePluginModalNode(node)) {
		node.classList.add('ufi-plugin-compat-captured-modal');

		if (/\bmask\b/.test(String(node.className || '')) || /Modal$/i.test(String(node.id || '')) || String(node.tagName || '').toUpperCase() === 'DIALOG') {
			node.style.position = 'fixed';
			node.style.left = '0';
			node.style.top = '0';
			node.style.right = '0';
			node.style.bottom = '0';
			node.style.padding = '24px';
			node.style.alignItems = 'center';
			node.style.justifyContent = 'center';
			node.style.zIndex = '2600';
			node.style.background = 'linear-gradient(180deg,rgba(15,23,42,.44) 0%,rgba(15,23,42,.30) 100%)';
			node.style.backdropFilter = 'blur(10px)';
			node.style.opacity = node.style.opacity || '1';
		}

		inner = node.firstElementChild;
		if (inner) {
			widthText = String(inner.getAttribute('style') || '') + ' ' + String(inner.style && inner.style.maxWidth || '') + ' ' + String(inner.style && inner.style.width || '');
			isWide = /800px|720px|700px|680px|600px/i.test(widthText);
			hasFooter = !!inner.querySelector('.btn,[data-i18n="close_btn"],button[type="submit"],button[type="button"]');

			inner.classList.add('ufi-plugin-compat-captured-modal-inner');
			if (isWide)
				inner.classList.add('is-wide');
			if (hasFooter)
				inner.classList.add('has-footer');
			inner.classList.add('ufi-plugin-compat-captured-modal-card');
			inner.classList.add('ufi-plugin-compat-ufi-panel');
			inner.style.position = 'relative';
			inner.style.margin = '0 auto';
			inner.style.width = isWide ? 'min(840px, calc(100vw - 48px))' : 'min(560px, calc(100vw - 48px))';
			inner.style.maxWidth = isWide ? 'min(840px, calc(100vw - 48px))' : 'min(560px, calc(100vw - 48px))';
			inner.style.maxHeight = 'calc(100vh - 48px)';
			inner.style.overflow = 'auto';
			inner.style.display = 'grid';
			inner.style.gap = '16px';
			inner.style.padding = '18px';
			inner.style.borderRadius = '28px';
			inner.style.border = '1px solid var(--ufi-line)';
			inner.style.background = '#f8fbfd';
			inner.style.boxShadow = '0 32px 64px rgba(15,23,42,.25)';
			inner.style.color = 'var(--ufi-text)';
			inner.style.opacity = '1';
			inner.style.left = 'auto';
			inner.style.top = 'auto';
			inner.style.right = 'auto';
			inner.style.bottom = 'auto';
			inner.style.transform = 'none';
			inner.style.backdropFilter = 'none';
			inner.style.boxSizing = 'border-box';
		}
	}

	return node;
}

function writePluginCompatResult(id, value, isError) {
	var target = els[id];

	if (!target)
		return;

	target.textContent = text(value, '');
	target.className = 'ufi-plugin-compat-result' + (isError ? ' is-error' : '');
}

function normalizePluginRuntimeErrorMessage(reason) {
	var message = text(reason && reason.message, '');
	var raw = message || text(reason, '');
	var match;
	var domNames = {
		collapseBtn_menu: '#collapseBtn_menu',
		collapse_status_btn: '#collapse_status_btn',
		collapse_status: '#collapse_status',
		collapse_smsforward_btn: '#collapse_smsforward_btn',
		collapse_smsforward: '#collapse_smsforward',
		smsList: '#smsList',
		PhoneInput: '#PhoneInput',
		SMSInput: '#SMSInput',
		STATUS: '#STATUS',
		SMS: '#SMS',
		AT: '#AT',
		ADVANCE: '#ADVANCE',
		PLUGIN_SETTING: '#PLUGIN_SETTING',
		ATModal: '#ATModal',
		advanceModal: '#advanceModal',
		smsForwardModal: '#smsForwardModal',
		AT_RESULT: '#AT_RESULT',
		AD_RESULT: '#AD_RESULT',
		USBStatusManagement: '#USBStatusManagement',
		UNREAD_SMS: '#UNREAD_SMS'
	};

	if (!raw)
		return '';

	match = raw.match(/^([A-Za-z_$][A-Za-z0-9_$]*) is not defined$/);
	if (match)
		return domNames[match[1]] ? ('缺少页面节点：' + domNames[match[1]]) : ('缺少 helper：' + match[1]);

	if (/Cannot read properties of null|Cannot set properties of null|Cannot read properties of undefined|Cannot set properties of undefined/.test(raw))
		return '缺少页面节点或上下文：' + raw;

	if (/Failed to fetch|请求失败|HTTP \d+|响应解析失败|请求超时/.test(raw))
		return '接口失败：' + raw;

	if (/脚本加载失败|资源加载失败/.test(raw))
		return raw;

	return '执行报错：' + raw;
}

function capturePluginRuntimeDiagnostics(run) {
	var errors = [];

	function push(reason) {
		var message = normalizePluginRuntimeErrorMessage(reason);

		if (!message || errors.indexOf(message) >= 0)
			return;

		errors.push(message);
	}

	function handleError(event) {
		if (event && event.error)
			push(event.error);
		else if (event && event.message)
			push(event.message);
		else if (event && event.target && event.target !== window)
			push('资源加载失败：' + text(event.target.src || event.target.href || event.target.tagName, '未知资源'));
	}

	function handleRejection(event) {
		push(event && event.reason);
	}

	window.addEventListener('error', handleError, true);
	window.addEventListener('unhandledrejection', handleRejection);

	return Promise.resolve().then(run).then(function(result) {
		return new Promise(function(resolve) {
			window.setTimeout(function() {
				resolve({
					result: result,
					errors: errors.slice()
				});
			}, 80);
		});
	}).catch(function(err) {
		push(err);
		err.__pluginRuntimeErrors = errors.slice();
		throw err;
	}).finally(function() {
		window.removeEventListener('error', handleError, true);
		window.removeEventListener('unhandledrejection', handleRejection);
	});
}

function shouldCapturePluginBodyNode(node) {
	if (!node || node.nodeType !== 1)
		return false;

	if (node === rootEl || node === document.body || node === document.documentElement)
		return false;

	if (/^(SCRIPT|STYLE|LINK|META)$/i.test(String(node.tagName || '')))
		return false;

	if (node.closest && node.closest('.ufi-redraw-root'))
		return false;

	return true;
}

function shouldCapturePluginModalNode(node) {
	var tagName;
	var className;
	var id;

	if (!node || node.nodeType !== 1)
		return false;

	tagName = String(node.tagName || '').toUpperCase();
	className = String(node.className || '');
	id = String(node.id || '');

	if (tagName === 'DIALOG')
		return true;

	if (/\bmask\b/.test(className) || /\bmodal\b/.test(className))
		return true;

	if (/Modal$/i.test(id))
		return true;

	return false;
}

function appendPluginCompatNode(node) {
	var modalBody = els.pluginCompatDialogBody;
	var compatBody = els.pluginCompatBody;

	if (!node)
		return node;

	if (shouldCapturePluginModalNode(node) && modalBody)
		return modalBody.appendChild(normalizePluginCompatModalNode(node));

	if (node.querySelectorAll) {
		Array.prototype.forEach.call(node.querySelectorAll('.collapse'), function(collapseNode) {
			pluginCompatCreateCollapseObserver(collapseNode);
		});
		Array.prototype.forEach.call(node.querySelectorAll('.mask,.modal,[id$=\"Modal\"]'), function(modalNode) {
			normalizePluginCompatModalNode(modalNode);
		});
	}

	if (compatBody)
		return compatBody.appendChild(node);

	return node;
}

function withPluginCompatBodyBridge(run) {
	var body = document.body;
	var originalAppendChild;
	var originalInsertBefore;

	if (!body || (!els.pluginCompatBody && !els.pluginCompatDialogBody))
		return Promise.resolve().then(run);

	originalAppendChild = body.appendChild;
	originalInsertBefore = body.insertBefore;

	body.appendChild = function(node) {
		if (shouldCapturePluginBodyNode(node))
			return appendPluginCompatNode(node);
		return originalAppendChild.call(body, node);
	};
	body.insertBefore = function(node, refNode) {
		if (shouldCapturePluginBodyNode(node))
			return appendPluginCompatNode(node);
		return originalInsertBefore.call(body, node, refNode);
	};

	return Promise.resolve().then(run).finally(function() {
		body.appendChild = originalAppendChild;
		body.insertBefore = originalInsertBefore;
	});
}

function runPluginWithCompatibilityTracking(name, run) {
	var beforeSnapshot = getPluginCompatSnapshot();
	var compatChanged = false;
	var observer = null;
	var observedRoots = [els.pluginCompatRoot, els.STATUS, els.pluginCompatBody, els.pluginCompatDialogBody, els.PluginModal, els.plugin_store, els.ATModal, els.advanceModal, els.smsForwardModal].filter(Boolean);

	if (window.MutationObserver && observedRoots.length) {
		observer = new MutationObserver(function(records) {
			if (records && records.length)
				compatChanged = true;
		});
		observedRoots.forEach(function(target) {
			observer.observe(target, {
				childList: true,
				subtree: true,
				attributes: true,
				characterData: true
			});
		});
	}

	return capturePluginRuntimeDiagnostics(function() {
		return withPluginCompatBodyBridge(run);
	}).then(function(meta) {
		return new Promise(function(resolve) {
			window.setTimeout(function() {
				resolve({
					result: meta.result,
					runtimeErrors: meta.errors || [],
					compatChanged: compatChanged || pluginCompatSnapshotChanged(beforeSnapshot)
				});
			}, 48);
		});
	}).finally(function() {
		if (observer)
			observer.disconnect();
	});
}

function normalizePluginCompatRemotePath(path) {
	var value = text(path, '').trim();
	var purePath;
	var queryIndex;

	if (!value)
		return '';

	queryIndex = value.indexOf('?');
	purePath = queryIndex >= 0 ? value.slice(0, queryIndex) : value;

	if (purePath.indexOf('/goform/') === 0)
		return value;

	if (purePath.indexOf('/api/') === 0)
		return purePath.slice(4) + (queryIndex >= 0 ? value.slice(queryIndex) : '');

	if (purePath.charAt(0) === '/')
		return value;

	return '/' + value;
}

function normalizePluginCompatSignPath(remotePath) {
	var value = normalizePluginCompatRemotePath(remotePath);
	var purePath = value.split('?')[0];

	if (!purePath)
		return '/api';

	if (purePath.indexOf('/goform/') === 0)
		return purePath;

	return '/api' + purePath;
}

function translatePluginCompatFetchInput(input) {
	var raw = '';
	var url;
	var remotePath = '';

	if (typeof input === 'string')
		raw = input;
	else if (input && typeof input.url === 'string')
		raw = input.url;

	if (!raw)
		return {
			input: input,
			remotePath: ''
		};

	try {
		url = new URL(raw, window.location.origin);
	}
	catch (err) {
		return {
			input: input,
			remotePath: ''
		};
	}

	if (url.pathname === PROXY_BASE && url.searchParams.has('ufi_path')) {
		remotePath = normalizePluginCompatRemotePath(url.searchParams.get('ufi_path'));
		return {
			input: url.toString(),
			remotePath: remotePath
		};
	}

	if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/goform/') === 0) {
		remotePath = normalizePluginCompatRemotePath(url.pathname + url.search);
		return {
			input: PROXY_BASE + '?ufi_path=' + encodeURIComponent(remotePath),
			remotePath: remotePath
		};
	}

	return {
		input: input,
		remotePath: ''
	};
}

function ensurePluginCompatFetchBridge() {
	window.originFetch = NATIVE_FETCH;
	window.__UFI_PLUGIN_NATIVE_FETCH__ = NATIVE_FETCH;
	return pluginCompatFetch;
}

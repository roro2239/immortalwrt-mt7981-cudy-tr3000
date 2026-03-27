'use strict';
'require view';

var PROXY_BASE = '/cgi-bin/ufi-tools-proxy';
var CRYPTO_SRC = '/ufi-tools/script/lib/crypto.js';
var AUTH_TOKEN_KEY = 'ufi_tools_token_hash';
var TOKEN_MODE_KEY = 'ufi_tools_token_mode';
var PASSWORD_KEY = 'ufi_tools_backend_pwd';
var LOGIN_METHOD_KEY = 'ufi_tools_login_method';
var APP_RELEASE = 'r62';
var NATIVE_FETCH = window.fetch.bind(window);
var REFRESH_MS = 5000;
var DEFAULT_REQUEST_TIMEOUT = 15000;
var CONNECT_TIMEOUT = 20000;
var CELL_REFRESH_MS = REFRESH_MS + 1500;
var NETWORK_TYPE_OPTIONS = ['WL_AND_5G', 'LTE_AND_5G', 'Only_5G', 'WCDMA_AND_LTE', 'Only_LTE', 'Only_WCDMA'];
var BAND_OPTIONS = [
	{ type: '4G', band: '1', label: 'B1', freq: '2100', mode: 'FDD-LTE', operator: '联通/电信' },
	{ type: '4G', band: '3', label: 'B3', freq: '1800', mode: 'FDD-LTE', operator: '三大运营商' },
	{ type: '4G', band: '5', label: 'B5', freq: '850', mode: 'FDD-LTE', operator: '电信' },
	{ type: '4G', band: '8', label: 'B8', freq: '900', mode: 'FDD-LTE', operator: '移动' },
	{ type: '4G', band: '34', label: 'B34', freq: '2000', mode: 'TD-LTE', operator: '移动' },
	{ type: '4G', band: '38', label: 'B38', freq: '2600', mode: 'TD-LTE', operator: '移动' },
	{ type: '4G', band: '39', label: 'B39', freq: '1900', mode: 'TD-LTE', operator: '移动' },
	{ type: '4G', band: '40', label: 'B40', freq: '2300', mode: 'TD-LTE', operator: '移动' },
	{ type: '4G', band: '41', label: 'B41', freq: '2500-2690', mode: 'TD-LTE', operator: '移动' },
	{ type: '5G', band: '1', label: 'N1', freq: '1920-1980 / 2110-2170', mode: 'FDD', operator: '联通/电信' },
	{ type: '5G', band: '5', label: 'N5', freq: '824-849 / 869-894', mode: 'FDD', operator: '电信' },
	{ type: '5G', band: '8', label: 'N8', freq: '880-915 / 925-960', mode: 'FDD', operator: '移动' },
	{ type: '5G', band: '28', label: 'N28', freq: '703-748 / 758-803', mode: 'FDD', operator: '广电/移动' },
	{ type: '5G', band: '41', label: 'N41', freq: '2515-2675', mode: 'TDD', operator: '移动' },
	{ type: '5G', band: '78', label: 'N78', freq: '3300-3600', mode: 'TDD', operator: '联通/电信' }
];

function ensureScript(src) {
	if (window.CryptoJS)
		return Promise.resolve();

	return new Promise(function(resolve, reject) {
		var existing = document.querySelector('script[data-ufi-script="' + src + '"]');

		if (existing) {
			existing.addEventListener('load', function() { resolve(); }, { once: true });
			existing.addEventListener('error', function() { reject(new Error('脚本加载失败：' + src)); }, { once: true });
			return;
		}

		var script = document.createElement('script');
		script.src = src;
		script.async = true;
		script.dataset.ufiScript = src;
		script.onload = function() { resolve(); };
		script.onerror = function() { reject(new Error('脚本加载失败：' + src)); };
		document.head.appendChild(script);
	});
}

function text(v, fallback) {
	if (v === undefined || v === null || v === '')
		return fallback != null ? fallback : '-';

	return String(v);
}

function hasText(v) {
	return v !== undefined && v !== null && String(v).trim() !== '';
}

function decodeBase64(base64String) {
	if (!hasText(base64String))
		return '';

	var normalized = String(base64String);
	var padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
	normalized += '='.repeat(padding);

	var binary = window.atob(normalized);
	var bytes = new Uint8Array(binary.length);
	var i;

	for (i = 0; i < binary.length; i++)
		bytes[i] = binary.charCodeAt(i);

	return new TextDecoder('utf-8').decode(bytes);
}

function gsmEncode(content) {
	var encoded = [];
	var i;

	for (i = 0; i < content.length; i++) {
		var codePoint = content.codePointAt(i);

		if (codePoint <= 0xFFFF) {
			encoded.push((codePoint >> 8) & 0xFF);
			encoded.push(codePoint & 0xFF);
		}
		else {
			var high = 0xD800 + ((codePoint - 0x10000) >> 10);
			var low = 0xDC00 + ((codePoint - 0x10000) & 0x3FF);
			encoded.push((high >> 8) & 0xFF, high & 0xFF, (low >> 8) & 0xFF, low & 0xFF);
			i++;
		}
	}

	return encoded.map(function(byte) {
		return byte.toString(16).padStart(2, '0');
	}).join('');
}

function formatBytes(bytes) {
	var value = Number(bytes);
	var units = ['B', 'KB', 'MB', 'GB', 'TB'];
	var index = 0;

	if (!isFinite(value) || value <= 0)
		return '0 B';

	while (value >= 1024 && index < units.length - 1) {
		value = value / 1024;
		index++;
	}

	return value.toFixed(2) + ' ' + units[index];
}

function formatTemp(raw) {
	var value = Number(raw);

	if (!isFinite(value))
		return '-';

	if (Math.abs(value) > 1000)
		value = value / 1000;

	return value.toFixed(2) + ' °C';
}

function formatPercent(raw) {
	var value = Number(raw);

	if (!isFinite(value))
		return '-';

	return value.toFixed(0) + '%';
}

function parseDateText(raw) {
	if (!hasText(raw))
		return '-';

	return String(raw).split(',').slice(0, 6).join('-');
}

function parseProfiles(apnData) {
	var profiles = [];
	var i;

	for (i = 0; i < 20; i++) {
		if (!hasText(apnData['APN_config' + i]))
			continue;

		var ipv4 = String(apnData['APN_config' + i]).split('($)');
		var ipv6 = hasText(apnData['ipv6_APN_config' + i]) ? String(apnData['ipv6_APN_config' + i]).split('($)') : [];

		profiles.push({
			index: i,
			name: text(ipv4[0], 'APN-' + i),
			apn: text(ipv4[1], ''),
			auth: text(ipv4[4], 'none'),
			username: text(ipv4[5], ''),
			password: text(ipv4[6], ''),
			pdp: text(ipv4[7], text(ipv6[7], 'IPv4v6'))
		});
	}

	return profiles;
}

function hmacSignature(secret, data) {
	var hmacMd5 = window.CryptoJS.HmacMD5(data, secret);
	var hmacMd5Bytes = window.CryptoJS.enc.Hex.parse(hmacMd5.toString());
	var mid = Math.floor(hmacMd5Bytes.sigBytes / 2);
	var part1 = window.CryptoJS.lib.WordArray.create(hmacMd5Bytes.words.slice(0, mid / 4), mid);
	var part2 = window.CryptoJS.lib.WordArray.create(hmacMd5Bytes.words.slice(mid / 4), mid);
	var sha1 = window.CryptoJS.SHA256(part1);
	var sha2 = window.CryptoJS.SHA256(part2);
	var finalHash = window.CryptoJS.SHA256(sha1.concat(sha2));

	return finalHash.toString(window.CryptoJS.enc.Hex);
}

function sha256Hex(value) {
	return window.CryptoJS.SHA256(String(value)).toString(window.CryptoJS.enc.Hex).toLowerCase();
}

function sha256HexUpper(value) {
	return window.CryptoJS.SHA256(String(value)).toString(window.CryptoJS.enc.Hex).toUpperCase();
}

function stateFactory() {
	return {
		needToken: true,
		versionInfo: null,
		tokenHash: window.localStorage.getItem(AUTH_TOKEN_KEY) || '',
		tokenMode: window.localStorage.getItem(TOKEN_MODE_KEY) || 'auto',
		backendPassword: window.localStorage.getItem(PASSWORD_KEY) || '',
		loginMethod: window.localStorage.getItem(LOGIN_METHOD_KEY) || '0',
		cookie: '',
		connected: false,
		connecting: false,
		ufiData: null,
		dataUsage: null,
		connInfo: null,
		adbAlive: false,
		apnData: null,
		smsList: [],
		pluginList: [],
		pluginText: '',
		pluginExtraText: '',
		pluginLoading: false,
		pluginSaving: false,
		pluginSelectedIndex: -1,
		pluginEditorName: '',
		pluginEditorContent: '',
		pluginEditorDisabled: false,
		pluginStoreItems: [],
		pluginStoreDownloadUrl: '',
		pluginStoreLoading: false,
		pluginStoreKeyword: '',
		pluginStorePage: 0,
		pluginHostSource: '',
		pluginHostLoading: false,
		pluginHostReady: false,
		pluginHostError: '',
		pluginHostMountedCount: 0,
		bandLockData: null,
		neighborCells: [],
		lockedCells: [],
		error: '',
		logs: [],
		rawLogs: [],
		logSessionTitle: '',
		interactiveLogActive: false,
		timer: null,
		smsTimer: null,
		cellTimer: null,
		cellRefreshPaused: false
	};
}

var state = stateFactory();
var rootEl = null;
var els = {};
var pluginHostSlots = {};
var pluginHostCleanups = {};
var pluginDataListeners = [];

function pushLog(level, message) {
	if (!state.interactiveLogActive)
		return;

	var item = {
		time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
		level: String(level || 'INFO').toUpperCase(),
		message: text(message, '')
	};

	state.logs.unshift(item);
	if (state.logs.length > 120)
		state.logs.length = 120;

	renderLogs();
}

function pushRawLog(action, status, raw) {
	if (!state.interactiveLogActive)
		return;

	var item = {
		time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
		action: text(action, '-'),
		status: text(status, '-'),
		raw: text(raw, '')
	};

	state.rawLogs.unshift(item);
	if (state.rawLogs.length > 80)
		state.rawLogs.length = 80;

	renderRawLogs();
}

function startInteractiveLog(title) {
	state.logs = [];
	state.rawLogs = [];
	state.logSessionTitle = text(title, '功能日志');
	state.interactiveLogActive = true;
	pushLog('INFO', '当前前端版本：' + APP_RELEASE);
	pushRawLog('前端版本', 'BUILD', APP_RELEASE);
	renderLogs();
	renderRawLogs();
	openPanel('logs');
}

function stopInteractiveLog() {
	state.interactiveLogActive = false;
}

function buildHeaders(method, signPath, extra) {
	var headers = Object.assign({}, extra || {});
	var timestamp = Date.now();
	var signature;

	try {
		signature = hmacSignature('minikano_kOyXz0Ciz4V7wR0IeKmJFYFQ20jd', 'minikano' + method + signPath + timestamp);
	}
	catch (err) {
		pushLog('WARN', '构造请求头失败：' + method + ' ' + signPath + ' -> ' + text(err && err.message, '未知错误'));
		throw err;
	}

	headers['kano-t'] = String(timestamp);
	headers['kano-sign'] = signature;

	if (state.tokenMode !== 'no_token' && state.tokenHash)
		headers.Authorization = state.tokenHash;

	if (state.cookie)
		headers['kano-cookie'] = state.cookie;

	return headers;
}

function request(path, options) {
	var opts = options || {};
	var method = String(opts.method || 'GET').toUpperCase();
	var headers;
	var controller = new AbortController();
	var requestLabel = method + ' ' + path;
	var timeout = window.setTimeout(function() {
		controller.abort();
	}, Number(opts.timeout || DEFAULT_REQUEST_TIMEOUT));

	pushLog('INFO', '准备请求：' + requestLabel);
	headers = buildHeaders(method, opts.signPath || path, opts.headers);
	pushLog('INFO', '请求开始：' + requestLabel);

	return NATIVE_FETCH(PROXY_BASE + '?ufi_path=' + encodeURIComponent(path), {
		method: method,
		headers: headers,
		body: opts.body,
		cache: 'no-store',
		credentials: 'same-origin',
		signal: controller.signal
	}).then(function(res) {
		pushLog('INFO', '请求完成：' + requestLabel + ' -> HTTP ' + res.status);
		return res;
	}).catch(function(err) {
		if (err && err.name === 'AbortError')
			err = new Error('请求超时');
		pushLog('WARN', '请求失败：' + requestLabel + ' -> ' + text(err && err.message, '未知错误'));
		throw err;
	}).finally(function() {
		window.clearTimeout(timeout);
	});
}

function requestJson(path, options) {
	return request(path, options).then(function(res) {
		if (!res.ok)
			return res.text().then(function(body) {
				pushLog('WARN', '响应异常：' + path + ' -> ' + text(body, '请求失败'));
				throw new Error(text(body, '请求失败'));
			});

		return res.text().then(function(body) {
			if (!body) {
				pushRawLog(path, 'HTTP ' + res.status, '[EMPTY]');
				if (path.indexOf('cmd=LD') >= 0)
					pushLog('WARN', 'LD 响应为空');
				return {};
			}

			try {
				var data = JSON.parse(body);
				pushRawLog(path, 'HTTP ' + res.status, body.slice(0, 320));

				if (path.indexOf('cmd=LD') >= 0) {
					if (data && data.LD)
						pushLog('INFO', 'LD 响应已返回');
					else
						pushLog('WARN', 'LD 响应缺少字段，内容：' + body.slice(0, 240));
				}

				return data;
			}
			catch (err) {
				pushLog('WARN', 'JSON 解析失败：' + path + ' -> ' + body.slice(0, 240));
				throw new Error('响应解析失败：' + body.slice(0, 240));
			}
		});
	});
}

function parseOptionalJsonResponse(res, actionLabel) {
	return res.text().then(function(body) {
		if (actionLabel)
			pushLog('INFO', actionLabel + '：HTTP ' + res.status);

		if (!res.ok) {
			pushRawLog(actionLabel || '写操作', 'HTTP ' + res.status, text(body, '[EMPTY]').slice(0, 320));
			if (actionLabel)
				pushLog('WARN', actionLabel + '：响应异常 -> ' + text(body, 'HTTP ' + res.status));
			throw new Error(text(body, 'HTTP ' + res.status));
		}

		if (!body) {
			pushRawLog(actionLabel || '写操作', 'HTTP ' + res.status, '[EMPTY]');
			if (actionLabel)
				pushLog('INFO', actionLabel + '：响应为空');
			return { __empty: true, __status: res.status, __raw: '' };
		}

		try {
			var data = JSON.parse(body);
			pushRawLog(actionLabel || '写操作', 'HTTP ' + res.status, body.slice(0, 320));

			if (data && typeof data === 'object') {
				data.__status = res.status;
				data.__raw = body;
			}

			if (actionLabel)
				pushLog('INFO', actionLabel + '：响应摘要 -> ' + body.slice(0, 240));

			return data;
		}
		catch (err) {
			if (actionLabel)
				pushLog('WARN', actionLabel + '：响应解析失败 -> ' + body.slice(0, 240));
			throw new Error('响应解析失败：' + body.slice(0, 240));
		}
	});
}

function needToken() {
	return requestJson('/need_token', {
		signPath: '/api/need_token'
	}).then(function(res) {
		state.needToken = !!(res && res.need_token);
		pushLog('INFO', '口令需求：' + (state.needToken ? '需要口令' : '无需口令'));
		return res;
	});
}

function versionInfo() {
	return requestJson('/version_info', {
		signPath: '/api/version_info'
	}).then(function(res) {
		state.versionInfo = res || null;
		pushLog('INFO', '版本信息已加载');
		return res;
	});
}

function getCustomHead() {
	return requestJson('/get_custom_head', {
		signPath: '/api/get_custom_head'
	}).then(function(res) {
		return text(res && res.text, '');
	});
}

function setCustomHead(content) {
	return request('/set_custom_head', {
		method: 'POST',
		signPath: '/api/set_custom_head',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			text: text(content, '')
		})
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '保存插件');
	});
}

function getPluginStore() {
	return requestJson('/plugins_store', {
		signPath: '/api/plugins_store'
	}).then(function(res) {
		return res || {};
	});
}

function proxyText(url) {
	var remote = text(url, '').trim();
	var path = '/proxy/--' + remote;

	return request(path, {
		method: 'GET',
		signPath: '/api/proxy/--' + remote
	}).then(function(res) {
		if (!res.ok)
			return res.text().then(function(body) {
				throw new Error(text(body, '下载插件失败'));
			});

		return res.text();
	});
}

function buildPluginCompatCommonHeaders() {
	return {
		referer: '/api/index.html',
		host: '/api',
		origin: '/api',
		authorization: state.tokenMode !== 'no_token' ? text(state.tokenHash, '') : ''
	};
}

function normalizePluginCompatHeaders(headers) {
	var normalized = {};

	if (!headers)
		return normalized;

	if (typeof Headers !== 'undefined' && headers instanceof Headers) {
		headers.forEach(function(value, key) {
			normalized[key] = value;
		});
		return normalized;
	}

	if (Array.isArray(headers)) {
		headers.forEach(function(entry) {
			if (Array.isArray(entry) && entry.length >= 2)
				normalized[entry[0]] = entry[1];
		});
		return normalized;
	}

	Object.keys(headers).forEach(function(key) {
		normalized[key] = headers[key];
	});

	return normalized;
}

function pluginCompatFetch(input, init) {
	var translated = translatePluginCompatFetchInput(input);
	var opts = Object.assign({}, init || {});
	var method = String(opts.method || 'GET').toUpperCase();
	var headers = normalizePluginCompatHeaders(opts.headers);

	if (translated.remotePath)
		headers = buildHeaders(method, normalizePluginCompatSignPath(translated.remotePath), headers);

	opts.headers = headers;
	return NATIVE_FETCH(translated.input, opts);
}

function pluginCompatFetchWithTimeout(url, options, timeout) {
	var controller = new AbortController();
	var opts = Object.assign({}, options || {});
	var headers = Object.assign({}, buildPluginCompatCommonHeaders(), normalizePluginCompatHeaders(opts.headers));
	var timer = window.setTimeout(function() {
		controller.abort();
	}, Number(timeout) || 10000);

	opts.signal = controller.signal;
	opts.headers = headers;

	return pluginCompatFetch(url, opts).finally(function() {
		window.clearTimeout(timer);
	});
}

function adbKeepAliveForPlugin() {
	return requestJson('/adb_alive', {
		signPath: '/api/adb_alive'
	}).then(function(res) {
		return String(res && res.result) === 'true';
	}).catch(function() {
		return false;
	});
}

function runShellWithRootForPlugin(cmd, timeout) {
	return requestJson('/root_shell', {
		method: 'POST',
		signPath: '/api/root_shell',
		headers: {
			'Content-Type': 'application/json'
		},
		timeout: Number(timeout) || 10000,
		body: JSON.stringify({
			command: text(cmd, '').trim(),
			timeout: Number(timeout) || 10000
		})
	}).then(function(res) {
		return res && res.error ? {
			success: false,
			content: text(res.error, '')
		} : {
			success: true,
			content: text(res && res.result, '')
		};
	}).catch(function(err) {
		return {
			success: false,
			content: text(err && err.message, '请求失败')
		};
	});
}

function runShellWithUserForPlugin(cmd, timeout) {
	return requestJson('/user_shell', {
		method: 'POST',
		signPath: '/api/user_shell',
		headers: {
			'Content-Type': 'application/json'
		},
		timeout: Number(timeout) || 10000,
		body: JSON.stringify({
			command: text(cmd, '').trim(),
			timeout: Number(timeout) || 10000
		})
	}).then(function(res) {
		return res && res.error ? {
			success: false,
			content: text(res.error, '')
		} : {
			success: true,
			content: text(res && res.result, '')
		};
	}).catch(function(err) {
		return {
			success: false,
			content: text(err && err.message, '请求失败')
		};
	});
}

function checkAdvancedFuncForPlugin() {
	return runShellWithRootForPlugin('whoami').then(function(res) {
		return !!(res && res.content && String(res.content).indexOf('root') >= 0);
	});
}

function requestIntervalForPlugin(callback, interval) {
	var lastTime = 0;
	var rafId = null;

	function loop(timestamp) {
		if (!lastTime)
			lastTime = timestamp;

		if (timestamp - lastTime >= (Number(interval) || 0)) {
			try {
				callback();
			}
			catch (err) {}
			lastTime = timestamp;
		}

		rafId = window.requestAnimationFrame(loop);
	}

	rafId = window.requestAnimationFrame(loop);

	return function() {
		if (rafId)
			window.cancelAnimationFrame(rafId);
	};
}

function getLD() {
	return requestJson('/goform/goform_get_cmd_process?isTest=false&cmd=LD&_=' + Date.now(), {
		signPath: '/goform/goform_get_cmd_process'
	});
}

function getRD(cookie) {
	return requestJson('/goform/goform_get_cmd_process?isTest=false&cmd=RD&_=' + Date.now(), {
		signPath: '/goform/goform_get_cmd_process',
		headers: { 'kano-cookie': cookie }
	});
}

function getUFIInfo() {
	return requestJson('/goform/goform_get_cmd_process?isTest=false&cmd=Language,cr_version,wa_inner_version&multi_data=1&_=' + Date.now(), {
		signPath: '/goform/goform_get_cmd_process'
	});
}

function processAD(cookie) {
	return Promise.all([getUFIInfo(), getRD(cookie)]).then(function(results) {
		var info = results[0] || {};
		var rdData = results[1] || {};

		if (!info.wa_inner_version || !info.cr_version || !rdData.RD)
			throw new Error('无法生成 AD');

		return sha256HexUpper(sha256HexUpper(info.wa_inner_version + info.cr_version) + rdData.RD);
	});
}

function login() {
	pushLog('INFO', '开始登录，当前方式：' + (state.loginMethod === '1' ? '登录方式 2' : '登录方式 1'));
	return getLD().then(function(ldData) {
		if (!ldData || !ldData.LD)
			throw new Error('无法获取 LD');

		var passwordHash = sha256HexUpper(sha256HexUpper(state.backendPassword) + ldData.LD);
		var body = new URLSearchParams({
			goformId: state.loginMethod === '1' ? 'LOGIN_MULTI_USER' : 'LOGIN',
			isTest: 'false',
			password: passwordHash,
			user: 'admin'
		});

		if (state.loginMethod === '1')
			body.append('IP', 'localhost');

		pushLog('INFO', '提交登录请求：goformId=' + body.get('goformId') + (state.loginMethod === '1' ? '，附带 IP=localhost' : ''));

		return request('/goform/goform_set_cmd_process', {
			method: 'POST',
			signPath: '/goform/goform_set_cmd_process',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
			body: body
		}).then(function(res) {
			var cookie = res.headers.get('kano-cookie');

			return res.text().then(function(raw) {
				var data;

				pushLog('INFO', '登录响应摘要：' + text(raw, '').slice(0, 240));
				pushLog('INFO', '登录响应 cookie：' + (cookie ? '已返回' : '未返回'));

				try {
					data = raw ? JSON.parse(raw) : {};
				}
				catch (err) {
					pushLog('WARN', '登录响应解析失败：' + text(err && err.message, '未知错误'));
					throw new Error('登录响应解析失败');
				}

				pushLog('INFO', '登录响应 result=' + text(data && data.result, 'undefined'));

				if (!data || String(data.result) === '3')
					throw new Error('登录失败，请检查后台密码');

				if (!cookie)
					throw new Error('登录成功但未返回会话');

				state.cookie = cookie.split(';')[0];
				pushLog('INFO', '后台登录成功');
				return state.cookie;
			});
		});
	});
}

function logout() {
	if (!state.cookie)
		return Promise.resolve();

	return processAD(state.cookie).then(function(ad) {
		var body = new URLSearchParams({
			goformId: 'LOGOUT',
			isTest: 'false',
			AD: ad
		});

		return request('/goform/goform_set_cmd_process', {
			method: 'POST',
			signPath: '/goform/goform_set_cmd_process',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'kano-cookie': state.cookie },
			body: body
		});
	}).catch(function() {
		return null;
	}).finally(function() {
		state.cookie = '';
		state.connected = false;
		stopRefresh();
		stopSmsRefresh();
		stopCellRefresh();
		pushLog('INFO', '后台已断开');
	});
}

function logoutWithCookie(cookie) {
	if (!cookie)
		return Promise.resolve();

	return processAD(cookie).then(function(ad) {
		var body = new URLSearchParams({
			goformId: 'LOGOUT',
			isTest: 'false',
			AD: ad
		});

		return request('/goform/goform_set_cmd_process', {
			method: 'POST',
			signPath: '/goform/goform_set_cmd_process',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'kano-cookie': cookie },
			body: body
		});
	}).catch(function() {
		return null;
	});
}

function getData(params) {
	var query = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});
	query.append('isTest', 'false');
	query.append('_', Date.now());

	return requestJson('/goform/goform_get_cmd_process?' + query.toString(), {
		signPath: '/goform/goform_get_cmd_process'
	});
}

function postData(data) {
	return processAD(state.cookie).then(function(ad) {
		var body = new URLSearchParams(Object.assign({}, data, {
			isTest: 'false',
			AD: ad
		}));

		if (data && data.goformId === 'SEND_SMS') {
			pushRawLog('发送短信请求', 'FORM', body.toString().slice(0, 400));
			pushLog('INFO', '发送短信：表单已构造');
		}

		return request('/goform/goform_set_cmd_process', {
			method: 'POST',
			signPath: '/goform/goform_set_cmd_process',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'kano-cookie': state.cookie
			},
			body: body
		});
	});
}

function getBaseDeviceInfo() {
	return requestJson('/baseDeviceInfo', {
		signPath: '/api/baseDeviceInfo'
	});
}

function getConnInfo() {
	return requestJson('/connInfo', {
		signPath: '/api/connInfo'
	}).then(function(res) {
		return res && res.result === 'success' ? res.data : null;
	});
}

function getUFIData() {
	var params = new URLSearchParams();
	var cmd = 'usb_port_switch,battery_charging,sms_received_flag,sms_unread_num,sms_sim_unread_num,sim_msisdn,data_volume_limit_switch,battery_value,battery_vol_percent,network_signalbar,network_rssi,cr_version,iccid,imei,imsi,ipv6_wan_ipaddr,lan_ipaddr,mac_address,msisdn,network_information,Lte_ca_status,rssi,Z5g_rsrp,lte_rsrp,wifi_access_sta_num,loginfo,data_volume_alert_percent,data_volume_limit_size,realtime_rx_thrpt,realtime_tx_thrpt,realtime_time,monthly_tx_bytes,monthly_rx_bytes,monthly_time,network_type,network_provider,ppp_status,Nr_bands,Nr_bands_widths,Nr_pci,Nr_cell_id,Nr_fcn,Nr_snr,nr_rsrq,Lte_bands,Lte_bands_widths,Lte_pci,Lte_cell_id,Lte_fcn,Lte_snr,lte_rsrq';
	params.append('multi_data', '1');
	params.append('isTest', 'false');
	params.append('cmd', cmd);
	params.append('_', Date.now());

	return Promise.all([
		requestJson('/goform/goform_get_cmd_process?' + params.toString(), {
			signPath: '/goform/goform_get_cmd_process'
		}),
		getBaseDeviceInfo().catch(function() { return {}; })
	]).then(function(results) {
		var resData = results[0] || {};
		var baseInfo = results[1] || {};

		if (!resData.msisdn && resData.sim_msisdn)
			resData.msisdn = resData.sim_msisdn;

		return Object.assign({}, resData, baseInfo, {
			battery: resData.battery_value || resData.battery_vol_percent || baseInfo.battery
		});
	});
}

function getDataUsage() {
	return getData({
		cmd: 'flux_data_volume_limit_switch,data_volume_limit_switch,data_volume_limit_unit,data_volume_limit_size,data_volume_alert_percent,monthly_tx_bytes,monthly_rx_bytes,monthly_time,wan_auto_clear_flow_data_switch,traffic_clear_date,',
		multi_data: '1'
	}).catch(function() {
		return null;
	});
}

function getBandLockData() {
	return getData({
		cmd: 'lte_band_lock,nr_band_lock'
	});
}

function getCellLockData() {
	return getData({
		cmd: 'neighbor_cell_info,locked_cell_info'
	});
}

function parseBandLock(value) {
	if (!hasText(value))
		return [];

	return String(value).split(',').map(function(item) {
		return String(item || '').trim();
	}).filter(Boolean);
}

function getCurrentCellInfo(data) {
	var source = data || {};

	if (hasText(source.Nr_pci) && hasText(source.Nr_fcn)) {
		return {
			rat: '16',
			ratLabel: '5G',
			band: hasText(source.Nr_bands) ? 'N' + source.Nr_bands : '5G',
			pci: text(source.Nr_pci, ''),
			earfcn: text(source.Nr_fcn, ''),
			rsrp: text(source.Z5g_rsrp, '-'),
			sinr: text(source.Nr_snr, '-'),
			rsrq: text(source.nr_rsrq, '-')
		};
	}

	if (hasText(source.Lte_pci) && hasText(source.Lte_fcn)) {
		return {
			rat: '12',
			ratLabel: '4G',
			band: hasText(source.Lte_bands) ? 'B' + source.Lte_bands : '4G',
			pci: text(source.Lte_pci, ''),
			earfcn: text(source.Lte_fcn, ''),
			rsrp: text(source.lte_rsrp, '-'),
			sinr: text(source.Lte_snr, '-'),
			rsrq: text(source.lte_rsrq, '-')
		};
	}

	return null;
}

function resolveCellRat(item) {
	var rat = text(item && item.rat, '');
	var band = String(text(item && item.band, '')).toUpperCase();

	if (rat === '16')
		return '16';
	if (rat === '12')
		return '12';
	if (band.indexOf('N') === 0)
		return '16';

	return '12';
}

function loadBandLockData() {
	return getBandLockData().then(function(res) {
		state.bandLockData = res || {};
		renderNetworkLock();
		return state.bandLockData;
	});
}

function loadCellLockData() {
	return getCellLockData().then(function(res) {
		state.neighborCells = Array.isArray(res && res.neighbor_cell_info) ? res.neighbor_cell_info : [];
		state.lockedCells = Array.isArray(res && res.locked_cell_info) ? res.locked_cell_info : [];
		renderNetworkLock();
		return res || {};
	});
}

function loadNetworkLock() {
	return Promise.all([
		loadBandLockData(),
		loadCellLockData(),
		loadCurrentCellData()
	]);
}

function loadCurrentCellData() {
	return getUFIData().then(function(res) {
		if (res)
			state.ufiData = res;

		renderSummary();
		renderNetworkLock();
		return state.ufiData;
	});
}

function toggleAllBandBoxes(checked) {
	if (!els.bandLockTable)
		return;

	Array.prototype.forEach.call(els.bandLockTable.querySelectorAll('input[type="checkbox"]'), function(input) {
		input.checked = !!checked;
	});

	updateBandSelectAll();
}

function updateBandSelectAll() {
	if (!els.bandSelectAll || !els.bandLockTable)
		return;

	var boxes = els.bandLockTable.querySelectorAll('input[type="checkbox"]');
	var checkedCount = 0;

	Array.prototype.forEach.call(boxes, function(input) {
		if (input.checked)
			checkedCount++;
	});

	els.bandSelectAll.checked = !!boxes.length && checkedCount === boxes.length;
	els.bandSelectAll.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
}

function collectSelectedBands() {
	var lteBands = [];
	var nrBands = [];

	if (!els.bandLockTable)
		return { lteBands: lteBands, nrBands: nrBands };

	Array.prototype.forEach.call(els.bandLockTable.querySelectorAll('input[type="checkbox"]:checked'), function(input) {
		var type = input.dataset.type;
		var band = input.dataset.band;

		if (!type || !band)
			return;

		if (type === '4G')
			lteBands.push(band);
		else if (type === '5G')
			nrBands.push(band);
	});

	return {
		lteBands: lteBands,
		nrBands: nrBands
	};
}

function isFormSuccess(res) {
	var result = text(res && res.result, '');

	return result === 'success' || result === '0' || result === '0.0';
}

function isFormAccepted(res) {
	return !!res && (isFormSuccess(res) || !!res.__empty);
}

function normalizeBandList(list) {
	return (Array.isArray(list) ? list : []).map(function(item) {
		return String(item || '').trim();
	}).filter(Boolean).sort(function(a, b) {
		var na = Number(a);
		var nb = Number(b);

		if (isFinite(na) && isFinite(nb) && na !== nb)
			return na - nb;

		return a.localeCompare(b);
	});
}

function sameBandSelection(actual, expected) {
	var left = normalizeBandList(actual);
	var right = normalizeBandList(expected);

	return JSON.stringify(left) === JSON.stringify(right);
}

function verifyBandLocks(lteBands, nrBands) {
	return getBandLockData().then(function(res) {
		var actualLte = parseBandLock(res && res.lte_band_lock);
		var actualNr = parseBandLock(res && res.nr_band_lock);
		var expectedLte = normalizeBandList(lteBands);
		var expectedNr = normalizeBandList(nrBands);

		pushRawLog('锁频段校验', '回读', JSON.stringify({
			lte_expected: expectedLte,
			lte_actual: normalizeBandList(actualLte),
			nr_expected: expectedNr,
			nr_actual: normalizeBandList(actualNr)
		}));

		if (!sameBandSelection(actualLte, expectedLte) || !sameBandSelection(actualNr, expectedNr))
			throw new Error('锁定频段失败：回读结果与目标频段不一致');

		state.bandLockData = res || {};
		renderNetworkLock();
		pushLog('INFO', '锁频段：回读确认成功');
		return state.bandLockData;
	});
}

function sameCellLock(item, rat, pci, earfcn) {
	return text(resolveCellRat(item), '').trim() === text(rat, '').trim()
		&& text(item && item.pci, '').trim() === text(pci, '').trim()
		&& text(item && item.earfcn, '').trim() === text(earfcn, '').trim();
}

function verifyCellLock(rat, pci, earfcn) {
	return getCellLockData().then(function(res) {
		var list = Array.isArray(res && res.locked_cell_info) ? res.locked_cell_info : [];
		var found = list.find(function(item) {
			return sameCellLock(item, rat, pci, earfcn);
		});

		pushRawLog('锁基站校验', found ? '匹配' : '未匹配', JSON.stringify({
			rat: rat,
			pci: pci,
			earfcn: earfcn,
			lockedCount: list.length
		}));

		if (!found)
			throw new Error('锁定基站失败：回读未发现目标基站');

		state.lockedCells = list;
		renderNetworkLock();
		pushLog('INFO', '锁基站：回读确认成功');
		return found;
	});
}

function verifyUnlockAllCells() {
	return getCellLockData().then(function(res) {
		var list = Array.isArray(res && res.locked_cell_info) ? res.locked_cell_info : [];

		pushRawLog('解除基站锁定校验', list.length ? '仍有锁定' : '已清空', JSON.stringify({
			lockedCount: list.length
		}));

		if (list.length)
			throw new Error('解除锁定基站失败：回读仍存在已锁基站');

		state.lockedCells = list;
		renderNetworkLock();
		pushLog('INFO', '解除基站锁定：回读确认成功');
		return null;
	});
}

function bounceBearerPreference() {
	return getData({
		cmd: 'net_select'
	}).then(function(res) {
		var current = text(res && res.net_select, '');
		var temp = NETWORK_TYPE_OPTIONS.find(function(item) {
			return item !== current;
		});

		if (!current || !temp)
			return null;

		pushLog('INFO', '锁频段：开始切网应用配置');
		return postData({
			goformId: 'SET_BEARER_PREFERENCE',
			BearerPreference: temp
		}).then(function(resp) {
			return parseOptionalJsonResponse(resp, '切换网络类型');
		}).then(function() {
			return delay(800);
		}).then(function() {
			return postData({
				goformId: 'SET_BEARER_PREFERENCE',
				BearerPreference: current
			});
		}).then(function(resp) {
			return parseOptionalJsonResponse(resp, '恢复网络类型');
		}).then(function() {
			pushLog('INFO', '锁频段：切网应用完成');
			return null;
		});
	}).catch(function(err) {
		pushLog('WARN', '锁频段：切网应用失败，已跳过。' + text(err && err.message, ''));
		return null;
	});
}

function saveBandLocks(lteBands, nrBands) {
	var targetLte = normalizeBandList(lteBands);
	var targetNr = normalizeBandList(nrBands);

	pushLog('INFO', '锁频段：开始提交 4G 频段');
	return postData({
		goformId: 'LTE_BAND_LOCK',
		lte_band_lock: targetLte.join(',')
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '锁定 4G 频段');
	}).then(function(res) {
		if (!isFormAccepted(res))
			throw new Error('锁定 4G 频段失败');

		pushLog('INFO', '锁频段：开始提交 5G 频段');
		return postData({
			goformId: 'NR_BAND_LOCK',
			nr_band_lock: targetNr.join(',')
		});
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '锁定 5G 频段');
	}).then(function(res) {
		if (!isFormAccepted(res))
			throw new Error('锁定 5G 频段失败');

		return bounceBearerPreference();
	}).then(function() {
		return verifyBandLocks(targetLte, targetNr);
	}).then(function() {
		return loadNetworkLock();
	});
}

function restoreAllBands() {
	var lteBands = BAND_OPTIONS.filter(function(item) {
		return item.type === '4G';
	}).map(function(item) {
		return item.band;
	});
	var nrBands = BAND_OPTIONS.filter(function(item) {
		return item.type === '5G';
	}).map(function(item) {
		return item.band;
	});

	return saveBandLocks(lteBands, nrBands);
}

function fillCellLockForm(cell) {
	if (!cell || !els.cellRatSelect || !els.lockCellPci || !els.lockCellEarfcn)
		return;

	els.cellRatSelect.value = text(cell.rat, '16');
	els.lockCellPci.value = text(cell.pci, '');
	els.lockCellEarfcn.value = text(cell.earfcn, '');
}

function lockSelectedCell() {
	var rat = text(els.cellRatSelect && els.cellRatSelect.value, '').trim();
	var pci = text(els.lockCellPci && els.lockCellPci.value, '').trim();
	var earfcn = text(els.lockCellEarfcn && els.lockCellEarfcn.value, '').trim();

	if (!rat || !pci || !earfcn)
		return Promise.reject(new Error('请完整填写 RAT、PCI 和频率'));

	return postData({
		goformId: 'CELL_LOCK',
		rat: rat,
		pci: pci,
		earfcn: earfcn
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '锁定基站');
	}).then(function(res) {
		if (!isFormAccepted(res))
			throw new Error('锁定基站失败');

		els.lockCellPci.value = '';
		els.lockCellEarfcn.value = '';
		return verifyCellLock(rat, pci, earfcn);
	}).then(function() {
		return loadCellLockData();
	});
}

function unlockAllCells() {
	return postData({
		goformId: 'UNLOCK_ALL_CELL'
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '解除锁定基站');
	}).then(function(res) {
		if (!isFormAccepted(res))
			throw new Error('解除锁定基站失败');

		return verifyUnlockAllCells();
	}).then(function() {
		return loadCellLockData();
	});
}

function startCellRefresh() {
	stopCellRefresh();
	state.cellRefreshPaused = false;
	renderNetworkLock();
	state.cellTimer = window.setInterval(function() {
		var panel = rootEl && rootEl.querySelector('.ufi-panel[data-panel="network"]');

		if (!state.connected || state.cellRefreshPaused || !panel || panel.hidden)
			return;

		Promise.all([
			loadCellLockData(),
			loadCurrentCellData()
		]).catch(function() {});
	}, CELL_REFRESH_MS);
}

function stopCellRefresh() {
	if (state.cellTimer) {
		window.clearInterval(state.cellTimer);
		state.cellTimer = null;
	}
}

function toggleCellRefresh() {
	state.cellRefreshPaused = !state.cellRefreshPaused;
	renderNetworkLock();

	if (!state.cellRefreshPaused) {
		Promise.all([
			loadCellLockData(),
			loadCurrentCellData()
		]).catch(function() {});
	}
}

function getSmsInfo(page, pageSize) {
	var p = page || 0;
	var size = pageSize || 200;

	return requestJson('/goform/goform_get_cmd_process?multi_data=1&isTest=false&cmd=sms_data_total&page=' + p + '&data_per_page=' + size + '&mem_store=1&tags=100&order_by=order by id desc&_=' + Date.now(), {
		signPath: '/goform/goform_get_cmd_process'
	});
}

function delay(ms) {
	return new Promise(function(resolve) {
		window.setTimeout(resolve, Number(ms) || 0);
	});
}

function normalizePhoneNumber(number) {
	return text(number, '')
		.replace(/[\s\-()]/g, '')
		.replace(/^\+86/, '')
		.replace(/^86/, '')
		.trim();
}

function getSmsTagMeta(tag) {
	var value = text(tag, '');

	if (value === '3') {
		return {
			direction: 'out',
			status: 'failed',
			label: '发送失败'
		};
	}

	if (value === '2') {
		return {
			direction: 'out',
			status: 'sent',
			label: '已发送'
		};
	}

	if (value === '1') {
		return {
			direction: 'in',
			status: 'received',
			label: '未读'
		};
	}

	return {
		direction: 'in',
		status: 'recorded',
		label: '已记录'
	};
}

function verifySmsSendResult(number, content) {
	var attempts = 5;
	var index = 0;
	var targetNumber = normalizePhoneNumber(number);
	var targetContent = text(content, '').trim();

	function inspectMessages(messages) {
		var list = Array.isArray(messages) ? messages : [];
		var matched = list.find(function(item) {
			var itemNumber = normalizePhoneNumber(item && item.number);
			var itemContent = text(decodeBase64(item && item.content || ''), '').trim();
			return itemNumber === targetNumber && itemContent === targetContent;
		});

		if (!matched)
			return null;

		return {
			id: matched.id,
			tag: text(matched.tag, ''),
			number: text(matched.number, ''),
			content: text(decodeBase64(matched.content || ''), '')
		};
	}

	function run() {
		index += 1;
		pushLog('INFO', '发送短信：响应为空，开始校验结果，第 ' + index + ' 次');
		return getSmsInfo(0, 50).then(function(res) {
			var matched = inspectMessages(res && res.messages);

			if (matched) {
				var meta = getSmsTagMeta(matched.tag);

				pushRawLog('发送短信校验', '匹配短信', JSON.stringify({
					id: matched.id,
					tag: matched.tag,
					status: meta.status,
					number: matched.number,
					content: matched.content
				}));

				if (meta.status === 'failed')
					throw new Error('短信发送失败：设备标记为发送失败');

				if (meta.status === 'sent') {
					pushLog('INFO', '发送短信：已确认成功');
					return {
						result: 'success',
						verified: true,
						tag: matched.tag
					};
				}

				pushLog('WARN', '发送短信：设备已记录短信，但未最终确认');
				return {
					result: 'pending',
					verified: true,
					tag: matched.tag,
					message: '设备已记录短信，但未最终确认'
				};
			}

			pushRawLog('发送短信校验', '未匹配', JSON.stringify({
				attempt: index,
				targetNumber: targetNumber,
				targetContent: targetContent.slice(0, 80),
				messageCount: Array.isArray(res && res.messages) ? res.messages.length : 0
			}));

			if (index >= attempts)
				throw new Error('短信接口返回空响应，且未确认到发送结果');

			return delay(1000).then(run);
		});
	}

	return run();
}

function sendSms(number, content) {
	var originalCookie = state.cookie;
	var tempCookie = '';

	pushLog('INFO', '发送短信：开始建立临时会话');
	return login().then(function(cookie) {
		var previousCookie = originalCookie;
		var body;

		tempCookie = cookie || state.cookie;
		if (!tempCookie)
			throw new Error('短信发送前登录失败');

		pushLog('INFO', '发送短信：临时会话已建立');
		state.cookie = tempCookie;
		body = {
			goformId: 'SEND_SMS',
			Number: number,
			MessageBody: gsmEncode(content)
		};

		return postData(body).then(function(res) {
			return parseOptionalJsonResponse(res, '发送短信');
		}).then(function(result) {
			if (result && result.__empty)
				return verifySmsSendResult(number, content);
			return result;
		}).finally(function() {
			state.cookie = previousCookie;
		});
	}).finally(function() {
		state.cookie = originalCookie;
		return logoutWithCookie(tempCookie).finally(function() {
			state.cookie = originalCookie;
		});
	});
}

function deleteSms(id) {
	return postData({
		goformId: 'DELETE_SMS',
		msg_id: id,
		notCallback: true
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '删除短信');
	});
}

function markSmsRead(ids) {
	var jobs = (ids || []).map(function(id) {
		return postData({
			goformId: 'SET_MSG_READ',
			msg_id: id,
			notCallback: true
		}).then(function(res) {
			return parseOptionalJsonResponse(res, '短信标已读');
		}).catch(function() { return null; });
	});

	return Promise.all(jobs);
}

function adbAlive() {
	return requestJson('/adb_alive', {
		signPath: '/api/adb_alive'
	}).then(function(res) {
		return res && String(res.result) === 'true';
	}).catch(function() {
		return false;
	});
}

function adbWifiSettingGet() {
	return requestJson('/adb_wifi_setting', {
		signPath: '/api/adb_wifi_setting'
	});
}

function adbWifiSettingSet(enabled) {
	return requestJson('/adb_wifi_setting', {
		method: 'POST',
		signPath: '/api/adb_wifi_setting',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			enabled: !!enabled,
			password: state.backendPassword
		})
	});
}

function getAPNData() {
	return getData({
		cmd: 'apn_interface_version,APN_config0,APN_config1,APN_config2,APN_config3,APN_config4,APN_config5,APN_config6,APN_config7,APN_config8,APN_config9,APN_config10,APN_config11,APN_config12,APN_config13,APN_config14,APN_config15,APN_config16,APN_config17,APN_config18,APN_config19,ipv6_APN_config0,ipv6_APN_config1,ipv6_APN_config2,ipv6_APN_config3,ipv6_APN_config4,ipv6_APN_config5,ipv6_APN_config6,ipv6_APN_config7,ipv6_APN_config8,ipv6_APN_config9,ipv6_APN_config10,ipv6_APN_config11,ipv6_APN_config12,ipv6_APN_config13,ipv6_APN_config14,ipv6_APN_config15,ipv6_APN_config16,ipv6_APN_config17,ipv6_APN_config18,ipv6_APN_config19,apn_m_profile_name,profile_name,apn_wan_dial,apn_select,apn_pdp_type,apn_pdp_select,apn_pdp_addr,index,apn_Current_index,apn_auto_config,apn_ipv6_apn_auto_config,apn_mode,apn_wan_apn,apn_ppp_auth_mode,apn_ppp_username,apn_ppp_passwd,dns_mode,prefer_dns_manual,standby_dns_manual,apn_ipv6_wan_apn,apn_ipv6_pdp_type,apn_ipv6_ppp_auth_mode,apn_ipv6_ppp_username,apn_ipv6_ppp_passwd,ipv6_dns_mode,ipv6_prefer_dns_manual,ipv6_standby_dns_manual,apn_num_preset,wan_apn_ui,profile_name_ui,pdp_type_ui,ppp_auth_mode_ui,ppp_username_ui,ppp_passwd_ui,dns_mode_ui,prefer_dns_manual_ui,standby_dns_manual_ui,ipv6_wan_apn_ui,ipv6_ppp_auth_mode_ui,ipv6_ppp_username_ui,ipv6_ppp_passwd_ui,ipv6_dns_mode_ui,ipv6_prefer_dns_manual_ui,ipv6_standby_dns_manual_ui',
		multi_data: '1'
	});
}

function saveAPNProfile(formData) {
	return postData(Object.assign({
		goformId: 'APN_PROC_EX',
		apn_mode: 'manual',
		apn_action: 'save'
	}, formData));
}

function deleteAPNProfile(index) {
	return postData({
		goformId: 'APN_PROC_EX',
		index: index,
		apn_mode: 'manual',
		apn_action: 'delete'
	});
}

function switchAPNMode(isAuto, index) {
	var data = {
		goformId: 'APN_PROC_EX',
		apn_mode: isAuto ? 'auto' : 'manual'
	};

	if (!isAuto) {
		data.apn_action = 'set_default';
		data.set_default_flag = '1';
		data.apn_pdp_type = '';
		data.index = index;
	}

	return postData(data);
}

function makeAPNFormData(index) {
	var profileName = els.apnProfileName.value.trim();
	var apn = els.apnName.value.trim();
	var username = els.apnUsername.value.trim();
	var password = els.apnPassword.value.trim();
	var auth = els.apnAuth.value;
	var pdp = els.apnPdp.value;
	var base = {
		profile_name: profileName,
		wan_dial: '*99#',
		apn_wan_dial: '*99#',
		apn_select: 'manual',
		apn_pdp_type: pdp,
		pdp_type: pdp,
		apn_pdp_select: 'auto',
		apn_pdp_addr: '',
		pdp_select: 'auto',
		pdp_addr: '',
		index: index
	};
	var ipv4 = {
		apn_wan_apn: apn,
		apn_ppp_auth_mode: auth,
		apn_ppp_username: username,
		apn_ppp_passwd: password,
		wan_apn: apn,
		ppp_auth_mode: auth,
		ppp_username: username,
		ppp_passwd: password,
		dns_mode: 'auto',
		prefer_dns_manual: '',
		standby_dns_manual: ''
	};
	var ipv6 = {
		apn_ipv6_wan_apn: apn,
		apn_ipv6_ppp_auth_mode: auth,
		apn_ipv6_ppp_username: username,
		apn_ipv6_ppp_passwd: password,
		ipv6_wan_apn: apn,
		ipv6_ppp_auth_mode: auth,
		ipv6_ppp_username: username,
		ipv6_ppp_passwd: password,
		ipv6_dns_mode: 'auto',
		ipv6_prefer_dns_manual: '',
		ipv6_standby_dns_manual: ''
	};

	if (!profileName || !apn)
		throw new Error('APN 配置名称和 APN 不能为空');

	if (pdp === 'IPv6')
		return Object.assign({}, base, ipv6);

	if (pdp === 'IP')
		return Object.assign({}, base, ipv4);

	return Object.assign({}, base, ipv4, ipv6);
}

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
		stopCellRefresh();
	} else if (name === 'plugin') {
		stopSmsRefresh();
		stopCellRefresh();
		renderPluginPanel();
		if (!state.pluginStoreItems.length && !state.pluginStoreLoading) {
			loadPluginStoreData().catch(function(err) {
				showToast(text(err && err.message, '读取插件商店失败'), 'error');
			});
		}
	} else if (name === 'network') {
		loadNetworkLock().catch(function(err) {
			showToast(text(err && err.message, '读取网络锁定信息失败'), 'error');
		});
		stopSmsRefresh();
		startCellRefresh();
	} else {
		stopSmsRefresh();
		stopCellRefresh();
	}
}

function closePanels() {
	stopSmsRefresh();
	stopCellRefresh();
	rootEl.querySelector('.ufi-modal-wrap').hidden = true;
	Array.prototype.forEach.call(rootEl.querySelectorAll('.ufi-panel'), function(panel) {
		panel.hidden = true;
	});
}

function setSummaryItem(id, value) {
	if (els[id])
		els[id].textContent = text(value, '-');
}

function syncExtraSummary() {
	if (els.sumModel2)
		els.sumModel2.textContent = els.sumModel.textContent;
	if (els.sumNetwork2)
		els.sumNetwork2.textContent = els.sumNetwork.textContent;
	if (els.sumProvider2)
		els.sumProvider2.textContent = els.sumProvider.textContent;
	if (els.sumSpeed2)
		els.sumSpeed2.textContent = els.sumSpeed.textContent;
}

function renderBandLockTable() {
	var body = els.bandLockTable;
	var bandData = state.bandLockData || {};
	var lteBands = parseBandLock(bandData.lte_band_lock);
	var nrBands = parseBandLock(bandData.nr_band_lock);

	if (!body)
		return;

	body.innerHTML = '';
	BAND_OPTIONS.forEach(function(item) {
		var checked = item.type === '4G' ? lteBands.indexOf(item.band) >= 0 : nrBands.indexOf(item.band) >= 0;
		var input = E('input', {
			type: 'checkbox',
			'data-type': item.type,
			'data-band': item.band
		});

		input.checked = checked;
		input.addEventListener('change', updateBandSelectAll);
		body.appendChild(E('tr', {}, [
			E('td', {}, input),
			E('td', {}, item.label),
			E('td', {}, item.freq),
			E('td', {}, item.mode),
			E('td', {}, item.operator)
		]));
	});

	updateBandSelectAll();
}

function renderLockedCellTable() {
	var body = els.lockedCellTable;
	var rows = state.lockedCells || [];

	if (!body)
		return;

	body.innerHTML = '';
	if (!rows.length) {
		body.appendChild(E('tr', {}, [
			E('td', { colspan: '3', 'class': 'ufi-empty-cell' }, '当前没有已锁基站')
		]));
		return;
	}

	rows.forEach(function(item) {
		var rat = resolveCellRat(item);
		body.appendChild(E('tr', {}, [
			E('td', {}, rat === '16' ? '5G' : '4G'),
			E('td', {}, text(item.pci, '-')),
			E('td', {}, text(item.earfcn, '-'))
		]));
	});
}

function renderCurrentCellTable() {
	var body = els.currentCellTable;
	var summary = els.currentCellSummary;
	var currentCell = getCurrentCellInfo(state.ufiData);

	if (!body || !summary)
		return;

	body.innerHTML = '';
	if (!currentCell) {
		summary.innerHTML = '当前未识别到可锁定的 4G / 5G 基站信息。';
		body.appendChild(E('tr', {}, [
			E('td', { colspan: '6', 'class': 'ufi-empty-cell' }, '暂无当前基站信息')
		]));
		return;
	}

	summary.innerHTML = '当前基站：<strong>' + currentCell.ratLabel + '</strong> / <strong>' + text(currentCell.band, '-') + '</strong>，可直接填入锁定表单。';
	body.appendChild(E('tr', {}, [
		E('td', {}, text(currentCell.band, '-')),
		E('td', {}, text(currentCell.earfcn, '-')),
		E('td', {}, text(currentCell.pci, '-')),
		E('td', {}, text(currentCell.rsrp, '-')),
		E('td', {}, text(currentCell.sinr, '-')),
		E('td', {}, text(currentCell.rsrq, '-'))
	]));
}

function renderNeighborCellTable() {
	var body = els.neighborCellTable;
	var rows = state.neighborCells || [];

	if (!body)
		return;

	body.innerHTML = '';
	if (!rows.length) {
		body.appendChild(E('tr', {}, [
			E('td', { colspan: '6', 'class': 'ufi-empty-cell' }, '暂无可用邻区信息')
		]));
		return;
	}

	rows.forEach(function(item) {
		var cell = {
			rat: resolveCellRat(item),
			pci: text(item.pci, ''),
			earfcn: text(item.earfcn, ''),
			band: text(item.band, '-'),
			rsrp: text(item.rsrp, '-'),
			sinr: text(item.sinr, '-'),
			rsrq: text(item.rsrq, '-')
		};
		var row = E('tr', { 'class': 'is-selectable' }, [
			E('td', {}, cell.band),
			E('td', {}, cell.earfcn),
			E('td', {}, cell.pci),
			E('td', {}, cell.rsrp),
			E('td', {}, cell.sinr),
			E('td', {}, cell.rsrq)
		]);

		row.addEventListener('click', function() {
			fillCellLockForm(cell);
			showToast('已选择基站：PCI ' + cell.pci + ' / 频率 ' + cell.earfcn, 'success');
		});
		body.appendChild(row);
	});
}

function renderNetworkLock() {
	if (!els.bandLockTable)
		return;

	renderBandLockTable();
	renderLockedCellTable();
	renderCurrentCellTable();
	renderNeighborCellTable();

	if (els.cellRefreshBtn)
		els.cellRefreshBtn.textContent = state.cellRefreshPaused ? '开始刷新' : '停止刷新';
}

function renderSummary() {
	var data = state.ufiData || {};
	var usage = state.dataUsage || {};
	var signal = data.network_signalbar || data.network_rssi || data.rssi || '-';
	var batteryText = hasText(data.battery_value) ? data.battery_value : (hasText(data.battery_vol_percent) ? data.battery_vol_percent : '');
	var dailyText = hasText(data.daily_data) ? formatBytes(data.daily_data) : '-';
	var monthlyTotal = hasText(data.monthly_data) ? formatBytes(data.monthly_data) : formatBytes((Number(data.monthly_tx_bytes) || 0) + (Number(data.monthly_rx_bytes) || 0));

	setSummaryItem('sumModel', data.MODEL || data.model || data.hardware_version || (state.versionInfo && state.versionInfo.model));
	setSummaryItem('sumNetwork', data.network_type || data.network_information);
	setSummaryItem('sumProvider', data.network_provider);
	setSummaryItem('sumSpeed', formatBytes(data.realtime_rx_thrpt) + '/s ↓  ' + formatBytes(data.realtime_tx_thrpt) + '/s ↑');
	setSummaryItem('sumTemp', formatTemp(data.cpu_temp));
	setSummaryItem('sumCpu', formatPercent(data.cpu_usage));
	setSummaryItem('sumMem', formatPercent(data.mem_usage));
	setSummaryItem('sumBattery', hasText(batteryText) ? batteryText + '%' : '-');
	setSummaryItem('sumSignal', signal);
	setSummaryItem('sumWifi', data.wifi_access_sta_num);
	setSummaryItem('sumDaily', dailyText);
	setSummaryItem('sumMonthly', monthlyTotal);
	setSummaryItem('sumAdb', state.adbAlive ? '已就绪' : '等待中');
	setSummaryItem('statusText', state.connected ? '已连接' : '未连接');
	setSummaryItem('statusHint', state.error || '');
	els.connectBtn.textContent = state.connected ? '断开后台' : (state.connecting ? '连接中...' : '连接后台');
	els.connectBtn.disabled = !!state.connecting;
	els.tokenField.style.display = (state.needToken && state.tokenMode !== 'no_token') ? '' : 'none';
	els.needTokenTag.textContent = state.tokenMode === 'no_token' ? '无口令模式' : (state.needToken ? '需要口令' : '无需口令');
	syncExtraSummary();
	syncPluginGlobals();
}

function renderSms() {
	var list = els.smsThreadList;
	var smsList = state.smsList || [];

	list.innerHTML = '';

	if (!smsList.length) {
		list.appendChild(E('div', { 'class': 'ufi-empty' }, '暂无短信'));
		return;
	}

	smsList.slice().sort(function(a, b) {
		return String(b.date || '').localeCompare(String(a.date || ''));
	}).forEach(function(item) {
		var meta = getSmsTagMeta(item.tag);
		var row = E('div', { 'class': 'ufi-sms-item ' + (meta.direction === 'in' ? 'is-in' : 'is-out') }, [
			E('div', { 'class': 'ufi-sms-head' }, [
				E('strong', {}, text(item.number, '-') + (meta.label ? ' · ' + meta.label : '')),
				E('span', {}, parseDateText(item.date))
			]),
			E('div', { 'class': 'ufi-sms-body' }, decodeBase64(item.content || '')),
			E('div', { 'class': 'ufi-sms-actions' }, [
				E('button', {
					'class': 'cbi-button cbi-button-remove',
					'click': function() {
						deleteSms(item.id).then(function(res) {
							if (res && res.result === 'success') {
								showToast('短信已删除', 'success');
								loadSms();
							}
							else {
								showToast('删除短信失败', 'error');
							}
						}).catch(function(err) {
							showToast(text(err.message, '删除短信失败'), 'error');
						});
					}
				}, '删除')
			])
		]);

		list.appendChild(row);
	});
}

function fillApnForm(profile) {
	if (!profile)
		return;

	els.apnProfileName.value = text(profile.name, '');
	els.apnName.value = text(profile.apn, '');
	els.apnUsername.value = text(profile.username, '');
	els.apnPassword.value = text(profile.password, '');
	els.apnAuth.value = text(profile.auth, 'none');
	els.apnPdp.value = text(profile.pdp, 'IPv4v6');
}

function renderApn() {
	var data = state.apnData || {};
	var profiles = parseProfiles(data);

	els.apnMode.textContent = data.apn_mode === 'auto' ? '自动' : '手动';
	els.apnCurrent.textContent = hasText(data.apn_wan_apn) ? (data.apn_wan_apn + ' (' + text(data.profile_name || data.m_profile_name || data.profile_name_ui, '-') + ')') : '-';
	els.apnProfileSelect.innerHTML = '';

	profiles.forEach(function(profile) {
		var option = document.createElement('option');
		option.value = String(profile.index);
		option.textContent = profile.name;
		els.apnProfileSelect.appendChild(option);
	});

	if (!profiles.length) {
		els.apnProfileSelect.innerHTML = '<option value="">暂无配置</option>';
		return;
	}

	var currentName = data.m_profile_name || data.profile_name;
	var selected = profiles.find(function(profile) { return profile.name === currentName; }) || profiles[0];
	els.apnProfileSelect.value = String(selected.index);
	fillApnForm(selected);
}

function renderAdb() {
	var data = state.ufiData || {};
	els.adbAlive.textContent = state.adbAlive ? '已就绪' : '等待中';
	els.adbUsb.textContent = String(data.usb_port_switch) === '1' ? '已启用' : '未启用';
}

function loadSms() {
	pushLog('INFO', '开始读取短信列表');
	return getSmsInfo(0, 200).then(function(res) {
		state.smsList = Array.isArray(res && res.messages) ? res.messages : [];
		renderSms();
		pushLog('INFO', '短信列表已加载，共 ' + state.smsList.length + ' 条');

		var unread = state.smsList.filter(function(item) { return String(item.tag) === '1'; }).map(function(item) { return item.id; });
		if (unread.length)
			markSmsRead(unread);
	});
}

function loadApn() {
	pushLog('INFO', '开始读取 APN 配置');
	return getAPNData().then(function(res) {
		state.apnData = res || null;
		renderApn();
		pushLog('INFO', 'APN 配置已加载');
	});
}

function loadAdb() {
	pushLog('INFO', '开始读取 ADB 状态');
	return Promise.all([
		adbAlive(),
		getData({ cmd: 'usb_port_switch' })
	]).then(function(results) {
		state.adbAlive = !!results[0];
		state.ufiData = Object.assign({}, state.ufiData || {}, results[1] || {});
		renderAdb();
		renderSummary();
		pushLog('INFO', 'ADB 状态已加载');
	});
}

function loadDashboard() {
	pushLog('INFO', '开始读取设备状态');
	return Promise.all([
		getUFIData(),
		getDataUsage().catch(function() { return null; }),
		getConnInfo().catch(function() { return null; }),
		adbAlive().catch(function() { return false; })
	]).then(function(results) {
		state.ufiData = results[0];
		state.dataUsage = results[1];
		state.connInfo = results[2];
		state.adbAlive = !!results[3];
		state.error = '';
		renderSummary();
		renderAdb();
		pushLog('INFO', '设备状态已加载');
	});
}

function startRefresh() {
	stopRefresh();
	state.timer = window.setInterval(function() {
		if (state.connected)
			loadDashboard().catch(function() {});
	}, REFRESH_MS);
}

function stopRefresh() {
	if (state.timer) {
		window.clearInterval(state.timer);
		state.timer = null;
	}
}

function startSmsRefresh() {
	stopSmsRefresh();
	state.smsTimer = window.setInterval(function() {
		if (state.connected && !rootEl.querySelector('.ufi-panel[data-panel="sms"]').hidden)
			loadSms().catch(function() {});
	}, 2000);
}

function stopSmsRefresh() {
	if (state.smsTimer) {
		window.clearInterval(state.smsTimer);
		state.smsTimer = null;
	}
}

function withTimeout(promise, ms, message) {
	return new Promise(function(resolve, reject) {
		var done = false;
		var timer = window.setTimeout(function() {
			if (done)
				return;
			done = true;
			reject(new Error(message || '请求超时'));
		}, ms);

		promise.then(function(result) {
			if (done)
				return;
			done = true;
			window.clearTimeout(timer);
			resolve(result);
		}).catch(function(err) {
			if (done)
				return;
			done = true;
			window.clearTimeout(timer);
			reject(err);
		});
	});
}

function connectBackend() {
	var job;

	startInteractiveLog('连接后台日志');
	state.connecting = true;
	state.error = '';
	pushLog('INFO', '开始连接后台');
	renderSummary();

	state.backendPassword = els.password.value.trim();
	state.loginMethod = els.loginMethod.value;
	state.tokenMode = els.tokenMode.value;
	window.localStorage.setItem(PASSWORD_KEY, state.backendPassword);
	window.localStorage.setItem(LOGIN_METHOD_KEY, state.loginMethod);
	window.localStorage.setItem(TOKEN_MODE_KEY, state.tokenMode);

	if (!state.backendPassword) {
		state.connecting = false;
		state.error = '请输入某兴后台密码';
		pushLog('WARN', state.error);
		renderSummary();
		return Promise.resolve(null);
	}

	if (state.tokenMode === 'no_token') {
		state.tokenHash = '';
		window.localStorage.removeItem(AUTH_TOKEN_KEY);
	}
	else if (state.needToken) {
		var token = els.token.value.trim();
		if (!token && !state.tokenHash) {
			state.connecting = false;
			state.error = '请输入 UFI-TOOLS 口令';
			pushLog('WARN', state.error);
			renderSummary();
			return Promise.resolve(null);
		}
		if (token) {
			state.tokenHash = sha256Hex(token);
			window.localStorage.setItem(AUTH_TOKEN_KEY, state.tokenHash);
		}
	}
	else {
		state.tokenHash = '';
		window.localStorage.removeItem(AUTH_TOKEN_KEY);
	}

	job = withTimeout(Promise.resolve().then(function() {
		return login();
	}).then(function() {
		state.connected = true;
		pushLog('INFO', '登录成功，开始同步数据');
		return Promise.all([
			loadDashboard(),
			loadSms(),
			loadApn()
		]);
	}), CONNECT_TIMEOUT, '连接超时').then(function() {
		return loadPluginHost(true).catch(function(err) {
			pushLog('WARN', '后台连接后插件重载失败：' + text(err && err.message, '未知错误'));
			return null;
		});
	}).then(function() {
		pushLog('INFO', '后台连接完成');
		showToast('后台连接成功', 'success');
		startRefresh();
	}).catch(function(err) {
		state.connected = false;
		state.cookie = '';
		state.error = text(err.message, '后台连接失败');
		pushLog('WARN', '后台连接失败：' + state.error);
		showToast(state.error, 'error');
	}).finally(function() {
		state.connecting = false;
		stopInteractiveLog();
		renderSummary();
	});

	return job;
}

function disconnectBackend() {
	logout().finally(function() {
		showToast('后台已断开', 'info');
		renderSummary();
	});
}

function bindEvents() {
	els.connectBtn.addEventListener('click', function() {
		if (state.connected)
			disconnectBackend();
		else
			connectBackend();
	});

	els.refreshBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		Promise.all([loadDashboard(), loadSms(), loadApn()]).then(function() {
			showToast('数据已刷新', 'success');
		}).catch(function(err) {
			showToast(text(err.message, '刷新失败'), 'error');
		});
	});

	Array.prototype.forEach.call(rootEl.querySelectorAll('[data-open-panel]'), function(button) {
		button.addEventListener('click', function() {
			if (!state.connected && button.dataset.openPanel !== 'plugin') {
				showToast('请先连接后台', 'error');
				return;
			}
			openPanel(button.dataset.openPanel);
		});
	});

	Array.prototype.forEach.call(rootEl.querySelectorAll('[data-close-panel]'), function(button) {
		button.addEventListener('click', closePanels);
	});

	rootEl.querySelector('.ufi-modal-wrap').addEventListener('click', function(ev) {
		if (ev.target === this)
			closePanels();
	});

	els.smsSendBtn.addEventListener('click', function() {
		startInteractiveLog('短信发送日志');
		var number = els.smsPhone.value.trim();
		var content = els.smsContent.value.trim();

		if (!number || !content) {
			stopInteractiveLog();
			showToast('手机号和短信内容不能为空', 'error');
			return;
		}

		sendSms(number, content).then(function(res) {
			if (res && res.result === 'success') {
				els.smsContent.value = '';
				showToast('短信发送成功', 'success');
				return loadSms();
			}

			if (res && res.result === 'pending') {
				els.smsContent.value = '';
				showToast(text(res.message, '设备已记录短信，但未最终确认'), 'info');
				return loadSms();
			}

			if (res && res.message)
				throw new Error('短信发送失败：' + res.message);

			if (res && hasText(res.result))
				throw new Error('短信发送失败：result=' + res.result);

			if (res && hasText(res.__raw))
				throw new Error('短信发送失败：' + String(res.__raw).slice(0, 120));

			throw new Error('短信发送失败：未返回有效结果');
		}).catch(function(err) {
			showToast(text(err.message, '短信发送失败'), 'error');
		}).finally(function() {
			stopInteractiveLog();
		});
	});

	if (els.pluginStoreReloadBtn) {
		els.pluginStoreReloadBtn.addEventListener('click', function() {
			startInteractiveLog('插件商店日志');
			loadPluginStoreData().catch(function(err) {
				showToast(text(err && err.message, '读取插件商店失败'), 'error');
			}).finally(function() {
				stopInteractiveLog();
			});
		});
	}

	if (els.pluginStoreSearch) {
		els.pluginStoreSearch.addEventListener('input', function() {
			state.pluginStoreKeyword = text(els.pluginStoreSearch.value, '').trim();
			state.pluginStorePage = 0;
			renderPluginPanel();
		});
	}

	if (els.pluginStorePrevBtn) {
		els.pluginStorePrevBtn.addEventListener('click', function() {
			if (state.pluginStorePage <= 0)
				return;
			state.pluginStorePage--;
			renderPluginPanel();
		});
	}

	if (els.pluginStoreNextBtn) {
		els.pluginStoreNextBtn.addEventListener('click', function() {
			var pageCount = Math.max(1, Math.ceil(filterPluginStoreItems().length / 10));

			if (state.pluginStorePage >= pageCount - 1)
				return;
			state.pluginStorePage++;
			renderPluginPanel();
		});
	}

	if (els.pluginReloadBtn) {
		els.pluginReloadBtn.addEventListener('click', function() {
			if (!state.connected) {
				showToast('请先连接后台', 'error');
				return;
			}

			startInteractiveLog('插件加载日志');
			loadPluginHost(true).catch(function(err) {
				showToast(text(err && err.message, '插件加载失败'), 'error');
			}).finally(function() {
				stopInteractiveLog();
			});
		});
	}

	els.bandSelectAll.addEventListener('change', function() {
		toggleAllBandBoxes(els.bandSelectAll.checked);
	});

	els.bandApplyBtn.addEventListener('click', function() {
		startInteractiveLog('锁频段日志');
		var selected = collectSelectedBands();

		if (!selected.lteBands.length && !selected.nrBands.length) {
			stopInteractiveLog();
			showToast('请至少选择一个频段', 'error');
			return;
		}

		saveBandLocks(selected.lteBands, selected.nrBands).then(function() {
			showToast('频段锁定已应用', 'success');
		}).catch(function(err) {
			showToast(text(err && err.message, '锁定频段失败'), 'error');
		}).finally(function() {
			stopInteractiveLog();
		});
	});

	els.bandUnlockBtn.addEventListener('click', function() {
		startInteractiveLog('恢复全频段日志');
		restoreAllBands().then(function() {
			showToast('已恢复全频段', 'success');
		}).catch(function(err) {
			showToast(text(err && err.message, '恢复全频段失败'), 'error');
		}).finally(function() {
			stopInteractiveLog();
		});
	});

	els.useCurrentCellBtn.addEventListener('click', function() {
		var currentCell = getCurrentCellInfo(state.ufiData);

		if (!currentCell) {
			showToast('当前没有可用的基站信息', 'error');
			return;
		}

		fillCellLockForm(currentCell);
		showToast('已填入当前基站信息', 'success');
	});

	els.cellRefreshBtn.addEventListener('click', function() {
		toggleCellRefresh();
	});

	els.cellLockBtn.addEventListener('click', function() {
		startInteractiveLog('锁基站日志');
		lockSelectedCell().then(function() {
			showToast('基站锁定已应用', 'success');
		}).catch(function(err) {
			showToast(text(err && err.message, '锁定基站失败'), 'error');
		}).finally(function() {
			stopInteractiveLog();
		});
	});

	els.cellUnlockBtn.addEventListener('click', function() {
		startInteractiveLog('解除基站锁定日志');
		unlockAllCells().then(function() {
			showToast('已解除全部基站锁定', 'success');
		}).catch(function(err) {
			showToast(text(err && err.message, '解除基站锁定失败'), 'error');
		}).finally(function() {
			stopInteractiveLog();
		});
	});

	els.apnLoadBtn.addEventListener('click', function() {
		var profiles = parseProfiles(state.apnData || {});
		var selected = profiles.find(function(profile) {
			return String(profile.index) === String(els.apnProfileSelect.value);
		});
		fillApnForm(selected);
	});

	els.apnApplyBtn.addEventListener('click', function() {
		startInteractiveLog('APN 模式日志');
		var isAuto = els.apnModeSelect.value === 'auto';
		var index = Number(els.apnProfileSelect.value || 0);

		switchAPNMode(isAuto, index).then(function(res) {
			return parseOptionalJsonResponse(res, '切换 APN 模式');
		}).then(function(res) {
			if (res && res.result === 'success') {
				showToast('APN 模式已应用', 'success');
				return loadApn();
			}

			throw new Error('APN 模式应用失败');
		}).catch(function(err) {
			showToast(text(err.message, 'APN 模式应用失败'), 'error');
		}).finally(function() {
			stopInteractiveLog();
		});
	});

	els.apnSaveBtn.addEventListener('click', function() {
		startInteractiveLog('APN 保存日志');
		var index = Number(els.apnProfileSelect.value || parseProfiles(state.apnData || {}).length);
		var data;

		try {
			data = makeAPNFormData(index);
		}
		catch (err) {
			stopInteractiveLog();
			showToast(text(err.message, 'APN 保存失败'), 'error');
			return;
		}

		saveAPNProfile(data).then(function(res) {
			return parseOptionalJsonResponse(res, '保存 APN 配置');
		}).then(function(res) {
			if (res && res.result === 'success') {
				showToast('APN 已保存', 'success');
				return loadApn();
			}

			throw new Error('APN 保存失败');
		}).catch(function(err) {
			showToast(text(err.message, 'APN 保存失败'), 'error');
		}).finally(function() {
			stopInteractiveLog();
		});
	});

	els.apnDeleteBtn.addEventListener('click', function() {
		startInteractiveLog('APN 删除日志');
		var index = Number(els.apnProfileSelect.value || 0);

		deleteAPNProfile(index).then(function(res) {
			return parseOptionalJsonResponse(res, '删除 APN 配置');
		}).then(function(res) {
			if (res && res.result === 'success') {
				showToast('APN 已删除', 'success');
				return loadApn();
			}

			throw new Error('APN 删除失败');
		}).catch(function(err) {
			showToast(text(err.message, 'APN 删除失败'), 'error');
		}).finally(function() {
			stopInteractiveLog();
		});
	});

	els.adbUsbBtn.addEventListener('click', function() {
		startInteractiveLog('USB 调试日志');
		getData({ cmd: 'usb_port_switch' }).then(function(res) {
			return postData({
				goformId: 'USB_PORT_SETTING',
				usb_port_switch: String(res.usb_port_switch) === '1' ? '0' : '1'
			});
		}).then(function(res) {
			return parseOptionalJsonResponse(res, '切换 USB 调试');
		}).then(function(res) {
			if (res && res.result === 'success') {
				showToast('USB 调试状态已切换', 'success');
				return loadAdb();
			}

			throw new Error('USB 调试切换失败');
		}).catch(function(err) {
			showToast(text(err.message, 'USB 调试切换失败'), 'error');
		}).finally(function() {
			stopInteractiveLog();
		});
	});

	els.adbWifiBtn.addEventListener('click', function() {
		startInteractiveLog('网络 ADB 日志');
		Promise.all([
			adbWifiSettingGet(),
			getData({ cmd: 'usb_port_switch' })
		]).then(function(results) {
			var adbWifi = results[0] || {};
			var usbState = results[1] || {};
			var enable = !(adbWifi.enabled === true || adbWifi.enabled === 'true');
			var prep = Promise.resolve();

			if (String(usbState.usb_port_switch) !== '1') {
				prep = postData({
					goformId: 'USB_PORT_SETTING',
					usb_port_switch: '1'
				});
			}

			return prep.then(function() {
				return adbWifiSettingSet(enable);
			});
		}).then(function(res) {
			if (res && res.result === 'success') {
				showToast('网络 ADB 状态已切换', 'success');
				return loadAdb();
			}

			throw new Error('网络 ADB 切换失败');
		}).catch(function(err) {
			showToast(text(err.message, '网络 ADB 切换失败'), 'error');
		}).finally(function() {
			stopInteractiveLog();
		});
	});

	els.apnProfileSelect.addEventListener('change', function() {
		var profiles = parseProfiles(state.apnData || {});
		var selected = profiles.find(function(profile) {
			return String(profile.index) === String(els.apnProfileSelect.value);
		});
		fillApnForm(selected);
	});
}

function collectEls() {
	[
		'tokenField', 'token', 'tokenMode', 'password', 'loginMethod', 'connectBtn', 'refreshBtn', 'toast', 'needTokenTag',
		'sumModel', 'sumNetwork', 'sumProvider', 'sumSpeed', 'sumTemp', 'sumCpu', 'sumMem', 'sumBattery', 'sumSignal', 'sumWifi', 'sumDaily', 'sumMonthly', 'sumAdb',
		'statusText', 'statusHint',
		'smsThreadList', 'smsPhone', 'smsContent', 'smsSendBtn',
		'pluginStoreStatus', 'pluginStoreReloadBtn', 'pluginStoreSearch', 'pluginStoreSummary', 'pluginStorePrevBtn', 'pluginStorePageText', 'pluginStoreNextBtn', 'pluginStoreList',
		'pluginReloadBtn', 'pluginHostNote', 'pluginHostCount', 'pluginHostStatus', 'pluginHostList', 'pluginCompatStatus', 'pluginCompatBody', 'pluginCompatRoot', 'pluginCompatContainer', 'pluginCompatDialogBody', 'pluginCompatHidden', 'BG', 'BG_OVERLAY', 'MAIN_TITLE', 'MODEL', 'collapseBtn_menu', 'collapse_status_btn', 'collapse_status', 'collapse_smsforward_btn', 'collapse_smsforward', 'STATUS', 'SMS', 'AT', 'ADVANCE', 'PLUGIN_SETTING', 'USBStatusManagement', 'UNREAD_SMS', 'smsList', 'sms-list', 'PhoneInput', 'SMSInput', 'PluginModal', 'plugin_store', 'ATModal', 'AT_INPUT', 'advanceModal', 'smsForwardModal', 'toastContainer', 'custom_head', 'sortable-list', 'AT_RESULT', 'AD_RESULT',
		'bandSelectAll', 'bandLockTable', 'bandApplyBtn', 'bandUnlockBtn', 'lockedCellTable', 'currentCellSummary', 'currentCellTable', 'cellRefreshBtn', 'neighborCellTable', 'cellRatSelect', 'lockCellPci', 'lockCellEarfcn', 'useCurrentCellBtn', 'cellLockBtn', 'cellUnlockBtn',
		'apnMode', 'apnCurrent', 'apnProfileSelect', 'apnProfileName', 'apnName', 'apnUsername', 'apnPassword', 'apnAuth', 'apnPdp', 'apnModeSelect', 'apnLoadBtn', 'apnApplyBtn', 'apnSaveBtn', 'apnDeleteBtn',
		'adbAlive', 'adbUsb', 'adbUsbBtn', 'adbWifiBtn', 'logPanelTitle', 'logList', 'rawLogList'
	].forEach(function(id) {
		els[id] = rootEl.querySelector('#' + id);
	});
}

function renderLogs() {
	var list = els.logList;

	if (!list)
		return;

	list.innerHTML = '';

	if (!state.logs.length) {
		list.appendChild(E('div', { 'class': 'ufi-empty' }, '暂无日志'));
		return;
	}

	state.logs.forEach(function(item) {
		list.appendChild(E('div', { 'class': 'ufi-log-item is-' + item.level.toLowerCase() }, [
			E('span', { 'class': 'ufi-log-meta' }, '[' + item.time + '] [' + item.level + ']'),
			E('div', { 'class': 'ufi-log-text' }, item.message)
		]));
	});
}

function renderRawLogs() {
	var list = els.rawLogList;

	if (!list)
		return;

	list.innerHTML = '';

	if (!state.rawLogs.length) {
		list.appendChild(E('div', { 'class': 'ufi-empty' }, '暂无功能调用日志'));
		return;
	}

	state.rawLogs.forEach(function(item) {
		list.appendChild(E('div', { 'class': 'ufi-log-item' }, [
			E('div', { 'class': 'ufi-log-meta' }, item.time + ' [' + item.status + '] ' + item.action),
			E('div', { 'class': 'ufi-log-body' }, item.raw || '[EMPTY]')
		]));
	});
}

function createPluginEntryButton() {
	return E('button', {
		'class': 'ufi-function-btn',
		'data-open-panel': 'plugin'
	}, [
		document.createTextNode('插件下载 '),
		E('span', {}, '↗')
	]);
}

function sanitizePluginName(name, fallback) {
	var value = text(name, fallback || '未命名插件').replace(/-->/g, '').trim();
	return value || text(fallback, '未命名插件');
}

function unwrapPluginContent(content) {
	var raw = text(content, '').trim();
	var match = raw.match(/^<!--\s*\[kano_disabled\]\s*[\r\n]*([\s\S]*?)[\r\n]*\[kano_disabled\]\s*-->\s*$/i);

	if (match)
		return {
			content: text(match[1], '').trim(),
			disabled: true
		};

	return {
		content: raw,
		disabled: false
	};
}

function wrapPluginContent(content, disabled) {
	var raw = text(content, '').trim();

	if (!disabled)
		return raw;

	return '<!-- [kano_disabled]\n' + raw + '\n[kano_disabled] -->';
}

function parsePluginSource(rawText) {
	var source = text(rawText, '');
	var regex = /<!--\s*\[KANO_PLUGIN_START\]\s*(.*?)\s*-->([\s\S]*?)<!--\s*\[KANO_PLUGIN_END\]\s*\1\s*-->/g;
	var plugins = [];
	var extras = [];
	var segments = [];
	var match;
	var lastIndex = 0;

	while ((match = regex.exec(source)) !== null) {
		var before = source.slice(lastIndex, match.index);
		var meta = unwrapPluginContent(match[2]);

		if (hasText(before)) {
			extras.push(before.trim());
			segments.push({
				type: 'extra',
				content: before.trim()
			});
		}

		plugins.push({
			name: sanitizePluginName(match[1], '未命名插件'),
			content: meta.content,
			disabled: meta.disabled
		});
		segments.push({
			type: 'plugin',
			name: sanitizePluginName(match[1], '未命名插件'),
			content: meta.content,
			disabled: meta.disabled
		});

		lastIndex = regex.lastIndex;
	}

	if (hasText(source.slice(lastIndex))) {
		extras.push(source.slice(lastIndex).trim());
		segments.push({
			type: 'extra',
			content: source.slice(lastIndex).trim()
		});
	}

	return {
		plugins: plugins,
		extraText: extras.join('\n\n').trim(),
		rawText: source,
		segments: segments
	};
}

function composePluginSource(list, extraText) {
	var sections = (list || []).map(function(item) {
		return '<!-- [KANO_PLUGIN_START] ' + sanitizePluginName(item && item.name, '未命名插件') + ' -->\n'
			+ wrapPluginContent(text(item && item.content, ''), !!(item && item.disabled)) + '\n'
			+ '<!-- [KANO_PLUGIN_END] ' + sanitizePluginName(item && item.name, '未命名插件') + ' -->';
	});

	if (hasText(extraText))
		sections.push(String(extraText).trim());

	return sections.join('\n\n\n\n').trim();
}

function syncPluginText() {
	state.pluginText = composePluginSource(state.pluginList, state.pluginExtraText);
	return state.pluginText;
}

function mergePluginTextIntoState(content, sourceName) {
	var parsed = parsePluginSource(content);
	var addedNames = [];
	var replacedNames = [];

	if (parsed.plugins.length) {
		parsed.plugins.forEach(function(item) {
			var index = state.pluginList.findIndex(function(existing) {
				return sanitizePluginName(existing && existing.name, '') === sanitizePluginName(item && item.name, '');
			});

			if (index >= 0) {
				state.pluginList[index] = item;
				replacedNames.push(item.name);
			}
			else {
				state.pluginList.push(item);
				addedNames.push(item.name);
			}
		});
	}
	else if (hasText(content)) {
		var pluginName = sanitizePluginName(sourceName, '新插件');
		var replaceIndex = state.pluginList.findIndex(function(existing) {
			return sanitizePluginName(existing && existing.name, '') === pluginName;
		});

		if (replaceIndex >= 0) {
			state.pluginList[replaceIndex] = {
				name: pluginName,
				content: text(content, '').trim(),
				disabled: false
			};
			replacedNames.push(pluginName);
		}
		else {
			state.pluginList.push({
				name: pluginName,
				content: text(content, '').trim(),
				disabled: false
			});
			addedNames.push(pluginName);
		}
	}

	syncPluginText();
	return {
		addedNames: addedNames,
		replacedNames: replacedNames,
		parsed: parsed
	};
}

function exportPluginText() {
	var content = syncPluginText();
	var blob;
	var url;
	var link;
	var timeText;

	if (!hasText(content)) {
		showToast('当前没有可导出的插件内容', 'error');
		return;
	}

	blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
	url = URL.createObjectURL(blob);
	link = document.createElement('a');
	timeText = new Date().toLocaleString('zh-CN').replace(/[\\/: ]/g, '_');
	link.href = url;
	link.download = 'UFI-TOOLS_Plugins_' + timeText + '.txt';
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

function loadPluginData() {
	state.pluginLoading = true;
	renderPluginPanel();
	renderPluginHost();

	return getCustomHead().then(function(rawText) {
		var parsed = parsePluginSource(rawText);
		state.pluginList = parsed.plugins;
		state.pluginExtraText = parsed.extraText;
		state.pluginText = rawText;
		state.pluginHostSource = rawText;

		pushLog('INFO', '插件内容已加载，共 ' + state.pluginList.length + ' 个插件');
		return parsed;
	}).finally(function() {
		state.pluginLoading = false;
		renderPluginPanel();
		renderPluginHost();
	});
}

function savePluginData() {
	var content = syncPluginText();
	var size = new TextEncoder().encode(content).length;

	if (size > 1145 * 1024)
		return Promise.reject(new Error('插件内容超出限制：' + Math.ceil(size / 1024) + 'KB / 1145KB'));

	state.pluginSaving = true;
	renderPluginPanel();

	return setCustomHead(content).then(function(res) {
		if (String(res && res.result) !== 'success')
			throw new Error(text(res && (res.error || res.message), '插件保存失败'));

		pushLog('INFO', '插件内容已保存');
		showToast('插件保存成功', 'success');
		return loadPluginData();
	}).finally(function() {
		state.pluginSaving = false;
		renderPluginPanel();
		renderPluginHost();
	});
}

function loadPluginStoreData() {
	state.pluginStoreLoading = true;
	renderPluginPanel();

	return getPluginStore().then(function(res) {
		var data = res && res.res && res.res.data ? res.res.data : {};
		state.pluginStoreItems = Array.isArray(data.content) ? data.content : [];
		state.pluginStoreDownloadUrl = text(res && res.download_url, '');
		state.pluginStorePage = 0;
		pushLog('INFO', '插件商店已加载，共 ' + state.pluginStoreItems.length + ' 项');
		return state.pluginStoreItems;
	}).finally(function() {
		state.pluginStoreLoading = false;
		renderPluginPanel();
	});
}

function filterPluginStoreItems() {
	var keyword = text(state.pluginStoreKeyword, '').trim().toLowerCase();

	if (!keyword)
		return state.pluginStoreItems || [];

	return (state.pluginStoreItems || []).filter(function(item) {
		return text(item && item.name, '').toLowerCase().indexOf(keyword) >= 0;
	});
}

function currentPluginStorePageItems() {
	var items = filterPluginStoreItems();
	var start = state.pluginStorePage * 10;
	return items.slice(start, start + 10);
}

function getPluginStoreItemUrl(item) {
	var base = text(state.pluginStoreDownloadUrl, '');
	var name = text(item && item.name, '');
	return base && name ? (base + '/' + name) : '';
}

function downloadPluginText(url, name) {
	var fileName;
	if (!hasText(url))
		return Promise.reject(new Error('插件下载地址为空'));

	return proxyText(url).then(function(content) {
		var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
		var link = document.createElement('a');
		var objectUrl = URL.createObjectURL(blob);

		fileName = sanitizePluginName(name, 'plugin');
		if (!/\.txt$/i.test(fileName))
			fileName += '.txt';
		link.href = objectUrl;
		link.download = fileName;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(objectUrl);
	});
}

function installPluginFromStore(item) {
	var name = text(item && item.name, '');
	var url = getPluginStoreItemUrl(item);

	if (!hasText(url))
		return Promise.reject(new Error('插件商店下载地址为空'));

	startInteractiveLog('插件商店安装日志');
	pushRawLog('插件商店安装', 'URL', url);

	return loadPluginData().then(function() {
		return proxyText(url);
	}).then(function(content) {
		var merged = mergePluginTextIntoState(content, name);
		var touched = merged.addedNames.concat(merged.replacedNames);

		if (!touched.length)
			throw new Error('未识别到可安装的插件内容');

		return savePluginData().then(function() {
			return loadPluginHost(true).then(function() {
				showToast((merged.replacedNames.length ? '已更新插件：' : '已安装插件：') + touched.join('、'), 'success');
			});
		});
	}).finally(function() {
		stopInteractiveLog();
	});
}

function normalizePluginAssetUrl(url) {
	var raw = text(url, '').trim();

	if (!raw || /^(?:[a-z]+:|\/\/|\/)/i.test(raw))
		return raw;

	return '/ufi-tools/' + raw.replace(/^\.?\//, '');
}

function getPluginSlotCount() {
	return Object.keys(pluginHostSlots).length;
}

function updatePluginDataListeners() {
	var snapshot = Object.assign({}, window.UFI_DATA || {});

	pluginDataListeners.slice().forEach(function(listener) {
		try {
			listener(snapshot);
		}
		catch (err) {}
	});
}

function syncPluginGlobals() {
	var snapshot = Object.assign(
		{},
		state.versionInfo || {},
		state.ufiData || {},
		state.dataUsage || {},
		state.connInfo || {},
		{
			adb_alive: state.adbAlive ? 'true' : 'false',
			connected: !!state.connected,
			app_release: APP_RELEASE
		}
	);
	var target;

	if (!window.UFI_DATA || typeof window.UFI_DATA !== 'object')
		window.UFI_DATA = {};

	target = window.UFI_DATA;
	Object.keys(target).forEach(function(key) {
		delete target[key];
	});
	Object.keys(snapshot).forEach(function(key) {
		target[key] = snapshot[key];
	});

	syncPluginCompatGlobals();
	updatePluginDataListeners();
}

function removeManagedPluginAssets() {
	Array.prototype.forEach.call(document.querySelectorAll('[data-ufi-plugin-managed="1"]'), function(node) {
		node.remove();
	});
}

function clearPluginHostDom() {
	if (els.pluginHostList)
		els.pluginHostList.innerHTML = '';

	pluginHostSlots = {};
	state.pluginHostMountedCount = 0;
}

function updatePluginMountedCount() {
	state.pluginHostMountedCount = Object.keys(pluginHostSlots).filter(function(key) {
		return pluginHostSlots[key] && pluginHostSlots[key].registered;
	}).length;
}

function resetPluginCompatDom() {
	if (els.pluginCompatBody)
		els.pluginCompatBody.innerHTML = '';

	if (els.pluginCompatDialogBody)
		els.pluginCompatDialogBody.innerHTML = '';

	if (els['sms-list'])
		els['sms-list'].innerHTML = '';

	if (els.smsList)
		els.smsList.style.display = 'none';

	if (els.PhoneInput)
		els.PhoneInput.value = '';

	if (els.SMSInput)
		els.SMSInput.value = '';

	if (els.collapse_status)
		els.collapse_status.setAttribute('data-name', 'open');

	if (els.collapse_smsforward)
		els.collapse_smsforward.setAttribute('data-name', 'close');

	if (els.STATUS) {
		els.STATUS.innerHTML = '';
		els.STATUS.appendChild(E('li', { 'class': 'ufi-plugin-compat-empty' }, '旧插件兼容页面已就绪，等待插件接管'));
	}

	if (els.toastContainer)
		els.toastContainer.innerHTML = '';

	if (els.AT_RESULT)
		els.AT_RESULT.textContent = '';

	if (els.AD_RESULT)
		els.AD_RESULT.textContent = '';

	['PluginModal', 'plugin_store', 'ATModal', 'advanceModal', 'smsForwardModal'].forEach(function(id) {
		var modal = els[id];

		if (!modal)
			return;

		modal.style.display = 'none';
		modal.style.opacity = '0';
	});

	if (els.pluginCompatStatus)
		els.pluginCompatStatus.textContent = '兼容宿主已就绪';
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

	if (!el)
		return;

	el.style.opacity = '0';
	el.style.display = '';
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
		return modalBody.appendChild(node);

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

function syncPluginCompatGlobals() {
	var compatGlobals = [
		'pluginCompatContainer',
		'BG',
		'BG_OVERLAY',
		'MAIN_TITLE',
		'MODEL',
		'collapseBtn_menu',
		'collapse_status_btn',
		'collapse_status',
		'collapse_smsforward_btn',
		'collapse_smsforward',
		'PLUGIN_SETTING',
		'SMS',
		'AT',
		'ADVANCE',
		'USBStatusManagement',
		'UNREAD_SMS',
		'STATUS',
		'smsList',
		'PhoneInput',
		'SMSInput',
		'ATModal',
		'AT_INPUT',
		'AT_RESULT',
		'advanceModal',
		'AD_RESULT',
		'smsForwardModal',
		'custom_head',
		'sortable-list',
		'plugin_store',
		'PluginModal'
	];

	window.KANO_baseURL = '/api';
	window.KANO_PASSWORD = state.backendPassword || null;
	window.KANO_TOKEN = state.tokenHash || '';
	window.KANO_COOKIE = state.cookie || '';
	window.ACCEPT_TERMS = false;
	window.common_headers = buildPluginCompatCommonHeaders();
	window.originFetch = NATIVE_FETCH;
	window.pluginFetch = pluginCompatFetch;
	window.__UFI_PLUGIN_FETCH__ = pluginCompatFetch;
	window.fetchWithTimeout = pluginCompatFetchWithTimeout;

	compatGlobals.forEach(function(key) {
		window[key] = els[key] || null;
	});
}

function resetPluginHostRuntime() {
	Object.keys(pluginHostCleanups).forEach(function(name) {
		try {
			if (typeof pluginHostCleanups[name] === 'function')
				pluginHostCleanups[name]();
		}
		catch (err) {}
	});

	pluginHostCleanups = {};
	pluginDataListeners = [];
	removeManagedPluginAssets();
	clearPluginHostDom();
	resetPluginCompatDom();

	if (window.KANO_PLUGIN_HOST && window.KANO_PLUGIN_HOST.__ufiBridge) {
		window.KANO_PLUGIN_HOST.root = null;
		window.KANO_PLUGIN_HOST.current = null;
	}
}

function ensurePluginHostSlot(name, options) {
	var pluginName = sanitizePluginName(name, '未命名插件');
	var slot = pluginHostSlots[pluginName];
	var body;
	var status;
	var mount;
	var card;

	if (slot)
		return slot;

	if (!els.pluginHostList)
		return null;

	if (els.pluginHostList.querySelector('.ufi-empty'))
		els.pluginHostList.innerHTML = '';
	body = E('div', { 'class': 'ufi-plugin-slot-body' });
	status = E('span', { 'class': 'ufi-plugin-slot-status' }, text(options && options.status, '等待加载'));
	mount = E('div', {
		'class': 'ufi-plugin-slot-mount',
		'data-plugin-name': pluginName
	});
	card = E('article', { 'class': 'ufi-plugin-slot' + ((options && options.disabled) ? ' is-disabled' : '') }, [
		E('div', { 'class': 'ufi-plugin-slot-head' }, [
			E('strong', {}, pluginName),
			status
		]),
		body,
		mount
	]);
	els.pluginHostList.appendChild(card);

	slot = {
		name: pluginName,
		card: card,
		body: body,
		status: status,
		mount: mount,
		registered: false
	};
	pluginHostSlots[pluginName] = slot;
	return slot;
}

function setPluginHostSlotBody(name, message, kind) {
	var slot = ensurePluginHostSlot(name);

	if (!slot)
		return;

	slot.body.innerHTML = '';
	slot.body.appendChild(E('div', { 'class': 'ufi-note' + (kind ? ' is-' + kind : '') }, text(message, '-')));
}

function setPluginHostSlotStatus(name, message, kind) {
	var slot = ensurePluginHostSlot(name);

	if (!slot)
		return;

	slot.status.textContent = text(message, '-');
	slot.card.classList.remove('is-ready', 'is-error', 'is-loading', 'is-disabled');
	if (kind)
		slot.card.classList.add('is-' + kind);
}

function createPluginHostApi(name) {
	var slot = ensurePluginHostSlot(name);

	return {
		name: sanitizePluginName(name, '未命名插件'),
		root: slot ? slot.mount : null,
		compatRoot: els.pluginCompatBody || null,
		compatStatusRoot: els.STATUS || null,
		showToast: showToast,
		showModal: pluginCompatShowModal,
		closeModal: pluginCompatCloseModal,
		debounce: pluginCompatDebounce,
		fetchWithTimeout: pluginCompatFetchWithTimeout,
		requestJson: requestJson,
		getData: getData,
		postData: postData,
		adbKeepAlive: adbKeepAliveForPlugin,
		runShellWithRoot: runShellWithRootForPlugin,
		runShellWithUser: runShellWithUserForPlugin,
		checkAdvancedFunc: checkAdvancedFuncForPlugin,
		requestInterval: requestIntervalForPlugin,
		getCustomHead: getCustomHead,
		setCustomHead: setCustomHead,
		readData: function() {
			return Object.assign({}, window.UFI_DATA || {});
		},
		clear: function() {
			if (slot)
				slot.mount.innerHTML = '';
		},
		setStatus: function(message, kind) {
			setPluginHostSlotStatus(name, message, kind || 'ready');
		},
		createSection: function(title) {
			var box = E('section', { 'class': 'ufi-plugin-section' }, [
				E('div', { 'class': 'ufi-plugin-section-title' }, text(title, '插件区块')),
				E('div', { 'class': 'ufi-plugin-section-body' })
			]);

			if (slot)
				slot.mount.appendChild(box);
			return box.lastChild;
		},
		onDataChange: function(listener) {
			if (typeof listener !== 'function')
				return function() {};

			pluginDataListeners.push(listener);
			return function() {
				pluginDataListeners = pluginDataListeners.filter(function(item) {
					return item !== listener;
				});
			};
		}
	};
}

function registerPluginComponent(config) {
	var current = window.__UFI_ACTIVE_PLUGIN__ || {};
	var pluginName = sanitizePluginName(
		config && typeof config === 'object' ? (config.name || config.title) : '',
		current.name || '未命名插件'
	);
	var slot = ensurePluginHostSlot(pluginName);
	var api = createPluginHostApi(pluginName);
	var cleanup = null;
	var shouldClear = !(config && typeof config === 'object' && config.append);

	if (!slot)
		return api;

	try {
		if (shouldClear)
			slot.mount.innerHTML = '';

		if (pluginHostCleanups[pluginName]) {
			try {
				pluginHostCleanups[pluginName]();
			}
			catch (err) {}
			delete pluginHostCleanups[pluginName];
		}

		if (typeof config === 'function')
			cleanup = config(slot.mount, api);
		else if (config && typeof config.mount === 'function')
			cleanup = config.mount(slot.mount, api);
		else if (config && typeof config.render === 'function')
			cleanup = config.render(slot.mount, api);
		else if (config && typeof config.setup === 'function')
			cleanup = config.setup(slot.mount, api);
		else if (config && typeof config.init === 'function')
			cleanup = config.init(slot.mount, api);
		else if (config && config.element && typeof config.element === 'object' && typeof config.element.nodeType === 'number')
			slot.mount.appendChild(config.element);
		else if (config && config.node && typeof config.node === 'object' && typeof config.node.nodeType === 'number')
			slot.mount.appendChild(config.node);
		else if (config && hasText(config.html))
			slot.mount.innerHTML = String(config.html);

		if (typeof cleanup === 'function')
			pluginHostCleanups[pluginName] = cleanup;

		slot.registered = true;
		updatePluginMountedCount();
		setPluginHostSlotStatus(pluginName, text(config && config.status, slot.mount.childNodes.length ? '组件已挂载' : '插件已注册'), 'ready');
		if (hasText(config && config.description))
			setPluginHostSlotBody(pluginName, config.description);
		renderPluginHost();
		return api;
	}
	catch (err) {
		setPluginHostSlotStatus(pluginName, '组件挂载失败', 'error');
		setPluginHostSlotBody(pluginName, text(err && err.message, '插件执行失败'), 'error');
		renderPluginHost();
		throw err;
	}
}

function ensurePluginHostBridge() {
	var host;

	if (window.KANO_PLUGIN_HOST && window.KANO_PLUGIN_HOST.__ufiBridge)
		return window.KANO_PLUGIN_HOST;

	host = {
		__ufiBridge: true,
		root: null,
		current: null,
		register: registerPluginComponent,
		getRoot: function(name) {
			var slot = ensurePluginHostSlot(name || (window.__UFI_ACTIVE_PLUGIN__ && window.__UFI_ACTIVE_PLUGIN__.name));
			return slot ? slot.mount : null;
		},
		getApi: function(name) {
			return createPluginHostApi(name || (window.__UFI_ACTIVE_PLUGIN__ && window.__UFI_ACTIVE_PLUGIN__.name));
		},
		showToast: showToast,
		showModal: pluginCompatShowModal,
		closeModal: pluginCompatCloseModal,
		debounce: pluginCompatDebounce,
		fetch: pluginCompatFetch,
		fetchWithTimeout: pluginCompatFetchWithTimeout,
		requestJson: requestJson,
		getData: getData,
		postData: postData,
		adbKeepAlive: adbKeepAliveForPlugin,
		runShellWithRoot: runShellWithRootForPlugin,
		runShellWithUser: runShellWithUserForPlugin,
		checkAdvancedFunc: checkAdvancedFuncForPlugin,
		requestInterval: requestIntervalForPlugin,
		getCustomHead: getCustomHead,
		setCustomHead: setCustomHead,
		readData: function() {
			return Object.assign({}, window.UFI_DATA || {});
		},
		onDataChange: function(listener) {
			return createPluginHostApi('插件宿主').onDataChange(listener);
		}
	};

	window.KANO_PLUGIN_HOST = host;
	syncPluginCompatGlobals();
	window.requestJson = requestJson;
	window.getData = getData;
	window.postData = postData;
	window.showToast = showToast;
	window.showModal = pluginCompatShowModal;
	window.closeModal = pluginCompatCloseModal;
	window.debounce = pluginCompatDebounce;
	window.pluginFetch = pluginCompatFetch;
	window.adbKeepAlive = adbKeepAliveForPlugin;
	window.runShellWithRoot = runShellWithRootForPlugin;
	window.runShellWithUser = runShellWithUserForPlugin;
	window.checkAdvancedFunc = checkAdvancedFuncForPlugin;
	window.requestInterval = requestIntervalForPlugin;
	window.createToast = function(message, color, delay, callback) {
		var kind = color === 'red' ? 'error' : (color === 'green' ? 'success' : 'info');

		showToast(text(message, ''), kind);
		if (typeof callback === 'function')
			window.setTimeout(callback, Number(delay) || 2600);
	};
	if (typeof window.t !== 'function') {
		window.t = function(key) {
			return text(key, '');
		};
	}
	if (!window.UFI_DATA || typeof window.UFI_DATA !== 'object')
		window.UFI_DATA = {};

	return host;
}

function executeManagedPluginScript(name, scriptEl) {
	return new Promise(function(resolve, reject) {
		var prelude = ''
			+ 'var BG = window.BG;'
			+ 'var BG_OVERLAY = window.BG_OVERLAY;'
			+ 'var MAIN_TITLE = window.MAIN_TITLE;'
			+ 'var MODEL = window.MODEL;'
			+ 'var collapseBtn_menu = window.collapseBtn_menu;'
			+ 'var collapse_status_btn = window.collapse_status_btn;'
			+ 'var collapse_status = window.collapse_status;'
			+ 'var collapse_smsforward_btn = window.collapse_smsforward_btn;'
			+ 'var collapse_smsforward = window.collapse_smsforward;'
			+ 'var PLUGIN_SETTING = window.PLUGIN_SETTING;'
			+ 'var SMS = window.SMS;'
			+ 'var AT = window.AT;'
			+ 'var ADVANCE = window.ADVANCE;'
			+ 'var USBStatusManagement = window.USBStatusManagement;'
			+ 'var UNREAD_SMS = window.UNREAD_SMS;'
			+ 'var STATUS = window.STATUS;'
			+ 'var smsList = window.smsList;'
			+ 'var PhoneInput = window.PhoneInput;'
			+ 'var SMSInput = window.SMSInput;'
			+ 'var ATModal = window.ATModal;'
			+ 'var AT_INPUT = window.AT_INPUT;'
			+ 'var AT_RESULT = window.AT_RESULT;'
			+ 'var advanceModal = window.advanceModal;'
			+ 'var AD_RESULT = window.AD_RESULT;'
			+ 'var smsForwardModal = window.smsForwardModal;'
			+ 'var plugin_store = window.plugin_store;'
			+ 'var PluginModal = window.PluginModal;'
			+ '\n';
		var node = document.createElement('script');
		var src = text(scriptEl.getAttribute('src'), '').trim();
		var host = ensurePluginHostBridge();
		var finish = function(fn) {
			window.__UFI_ACTIVE_PLUGIN__ = null;
			host.root = null;
			host.current = null;
			fn();
		};

		node.dataset.ufiPluginManaged = '1';
		node.dataset.ufiPluginName = sanitizePluginName(name, '插件');

		if (scriptEl.type)
			node.type = scriptEl.type;

		window.__UFI_ACTIVE_PLUGIN__ = {
			name: sanitizePluginName(name, '插件')
		};
		host.root = host.getRoot(name);
		host.current = window.__UFI_ACTIVE_PLUGIN__;

		if (src) {
			node.src = normalizePluginAssetUrl(src);
			node.async = false;
			node.onload = function() {
				finish(resolve);
			};
			node.onerror = function() {
				finish(function() {
					reject(new Error('脚本加载失败：' + node.src));
				});
			};
			document.head.appendChild(node);
			return;
		}

		node.textContent = prelude + text(scriptEl.textContent, '');
		try {
			document.head.appendChild(node);
			window.setTimeout(function() {
				finish(resolve);
			}, 0);
		}
		catch (err) {
			finish(function() {
				reject(err);
			});
		}
	});
}

function applyManagedPluginNode(name, node) {
	var tag = String(node.tagName || '').toLowerCase();
	var clone;

	if (tag === 'script')
		return executeManagedPluginScript(name, node);

	clone = node.cloneNode(true);
	clone.dataset.ufiPluginManaged = '1';
	clone.dataset.ufiPluginName = sanitizePluginName(name, '插件');

	if (tag === 'link' && clone.getAttribute('href'))
		clone.setAttribute('href', normalizePluginAssetUrl(clone.getAttribute('href')));

	document.head.appendChild(clone);
	return Promise.resolve();
}

function executePluginPayload(name, content, options) {
	var parser = new DOMParser();
	var doc = parser.parseFromString(text(content, ''), 'text/html');
	var nodes = Array.prototype.slice.call(doc.querySelectorAll('style, link, meta, script'));
	var chain = Promise.resolve();
	var slot = options && !options.globalOnly ? ensurePluginHostSlot(name, options) : null;

	if (slot && !slot.registered) {
		setPluginHostSlotStatus(name, '组件加载中', 'loading');
		setPluginHostSlotBody(name, '插件已加载，正在等待组件挂载');
	}

	if (!nodes.length && slot && hasText(content)) {
		slot.mount.innerHTML = text(content, '');
		slot.registered = true;
		updatePluginMountedCount();
		setPluginHostSlotStatus(name, '已挂载静态内容', 'ready');
		setPluginHostSlotBody(name, '插件未注册脚本组件，已直接渲染原始内容');
		return Promise.resolve();
	}

	nodes.forEach(function(node) {
		chain = chain.then(function() {
			return applyManagedPluginNode(name, node);
		});
	});

	if (!slot)
		return chain;

	return runPluginWithCompatibilityTracking(name, function() {
		return chain;
	}).then(function(meta) {
		if (slot.registered) {
			if (meta.runtimeErrors && meta.runtimeErrors.length)
				setPluginHostSlotBody(name, meta.runtimeErrors.join('；'), 'error');
			return meta.result;
		}

		if (meta.runtimeErrors && meta.runtimeErrors.length) {
			setPluginHostSlotStatus(name, meta.compatChanged ? '兼容内容异常' : '执行报错', 'error');
			setPluginHostSlotBody(name, meta.runtimeErrors.join('；'), 'error');
		}
		else if (meta.compatChanged) {
			slot.registered = true;
			updatePluginMountedCount();
			setPluginHostSlotStatus(name, '已挂载兼容内容', 'ready');
			setPluginHostSlotBody(name, '插件未显式注册组件，已按旧版兼容模式接管下方兼容页面');
		}
		else {
			setPluginHostSlotStatus(name, '等待交互', 'loading');
			setPluginHostSlotBody(name, '插件脚本已执行，但当前尚未生成可见组件。若插件绑定了旧页面按钮，请在兼容页面区域继续操作');
		}

		if (els.pluginCompatStatus)
			els.pluginCompatStatus.textContent = '兼容脚本已加载：' + sanitizePluginName(name, '插件');

		return meta.result;
	});
}

function applyPluginSegments(parsed) {
	var segments = parsed && Array.isArray(parsed.segments) ? parsed.segments : [];
	var chain = Promise.resolve();
	var failed = [];

	segments.forEach(function(segment, index) {
		chain = chain.then(function() {
			if (!segment || !hasText(segment.content))
				return null;

			if (segment.type === 'plugin') {
				if (segment.disabled) {
					ensurePluginHostSlot(segment.name, { disabled: true, status: '已停用' });
					setPluginHostSlotBody(segment.name, '插件已停用，当前不会加载组件');
					setPluginHostSlotStatus(segment.name, '已停用', 'disabled');
					return null;
				}

				return executePluginPayload(segment.name, segment.content, {
					status: '组件加载中'
				});
			}

			return executePluginPayload('附加扩展-' + (index + 1), segment.content, {
				globalOnly: true
			});
		}).catch(function(err) {
			failed.push({
				name: segment && segment.type === 'plugin' ? sanitizePluginName(segment.name, '未命名插件') : ('附加扩展-' + (index + 1)),
				message: text(err && err.message, '插件加载失败')
			});

			if (segment && segment.type === 'plugin') {
				ensurePluginHostSlot(segment.name);
				setPluginHostSlotStatus(segment.name, '加载失败', 'error');
				setPluginHostSlotBody(segment.name, text(err && err.message, '插件加载失败'), 'error');
			}
			return null;
		});
	});

	return chain.then(function() {
		return failed;
	});
}

function loadPluginHost(force) {
	if (state.pluginHostLoading && !force)
		return Promise.resolve();

	ensurePluginHostBridge();
	state.pluginHostLoading = true;
	state.pluginHostReady = false;
	state.pluginHostError = '';
	renderPluginHost();
	renderPluginPanel();

	return loadPluginData().then(function(parsed) {
		resetPluginHostRuntime();
		ensurePluginHostBridge();
		syncPluginCompatGlobals();
		syncPluginGlobals();
		return applyPluginSegments(parsed).then(function(failed) {
			state.pluginHostReady = true;
			state.pluginHostError = failed.length ? ('部分插件加载失败：' + failed.map(function(item) { return item.name; }).join('、')) : '';
			renderPluginHost();
			renderPluginPanel();
			return parsed;
		});
	}).catch(function(err) {
		state.pluginHostReady = false;
		state.pluginHostError = text(err && err.message, '插件加载失败');
		renderPluginHost();
		renderPluginPanel();
		throw err;
	}).finally(function() {
		state.pluginHostLoading = false;
		renderPluginHost();
		renderPluginPanel();
	});
}

function createPluginPanel() {
	var panel = E('section', { 'class': 'ufi-panel ufi-plugin-store-panel', 'data-panel': 'plugin' }, [
		E('div', { 'class': 'ufi-panel-head' }, [
			E('h3', {}, '插件下载'),
			E('button', { 'class': 'cbi-button cbi-button-neutral', 'data-close-panel': '1' }, '关闭')
		]),
		E('div', { 'class': 'ufi-stack' }, [
			E('div', { 'class': 'ufi-card' }, [
				E('div', { 'class': 'ufi-panel-head' }, [
					E('h3', {}, '插件商店')
				]),
				E('div', { 'class': 'ufi-note' }, '这里仅保留插件下载安装入口。插件安装完成后，会直接在当前页面最下方的“插件加载区”中挂载自己的组件。'),
				E('div', { 'class': 'ufi-plugin-store-actions' }, [
					E('div', { 'class': 'ufi-plugin-store-status', id: 'pluginStoreStatus' }, '未加载'),
					E('div', { 'class': 'ufi-actions' }, [
						E('button', { 'class': 'cbi-button cbi-button-neutral', id: 'pluginStoreReloadBtn' }, '刷新商店')
					])
				]),
				E('div', { 'class': 'ufi-plugin-store-bar' }, [
					E('input', {
						id: 'pluginStoreSearch',
						type: 'text',
						placeholder: '搜索插件名称'
					}),
					E('div', { 'class': 'ufi-plugin-store-summary', id: 'pluginStoreSummary' }, '已安装 0 个插件'),
					E('div', { 'class': 'ufi-plugin-store-page' }, [
						E('button', { 'class': 'cbi-button cbi-button-neutral', id: 'pluginStorePrevBtn' }, '上一页'),
						E('span', { id: 'pluginStorePageText' }, '第 1 页'),
						E('button', { 'class': 'cbi-button cbi-button-neutral', id: 'pluginStoreNextBtn' }, '下一页')
					])
				]),
				E('div', { 'class': 'ufi-plugin-store-list', id: 'pluginStoreList' }, [
					E('div', { 'class': 'ufi-empty' }, '暂无插件商店数据')
				])
			])
		])
	]);

	panel.hidden = true;
	return panel;
}

function createPluginHostSection() {
	return E('section', { 'class': 'ufi-card ufi-plugin-host-shell' }, [
		E('div', { 'class': 'ufi-panel-head' }, [
			E('h3', {}, '插件加载区'),
			E('div', { 'class': 'ufi-actions' }, [
				E('button', { 'class': 'cbi-button cbi-button-neutral', id: 'pluginReloadBtn' }, '重新加载插件')
			])
		]),
		E('div', { 'class': 'ufi-note', id: 'pluginHostNote' }, '已安装插件会在这里自动挂载自己的组件。插件下载入口在上方“功能入口”里。'),
		E('div', { 'class': 'ufi-plugin-host-meta' }, [
			E('div', {}, [
				E('span', {}, '已安装插件'),
				E('strong', { id: 'pluginHostCount' }, '0')
			]),
			E('div', {}, [
				E('span', {}, '加载状态'),
				E('strong', { id: 'pluginHostStatus' }, '未加载')
			])
		]),
		E('section', { 'class': 'ufi-plugin-compat-shell', id: 'pluginCompatRoot', 'data-ufi-plugin-compat': '1' }, [
			E('div', { 'class': 'ufi-plugin-compat-head' }, [
				E('strong', {}, '兼容页面区域'),
				E('span', { id: 'pluginCompatStatus' }, '兼容宿主已就绪')
			]),
			E('div', { id: 'BG', 'class': 'ufi-plugin-compat-bg' }, [
				E('div', { id: 'BG_OVERLAY', 'class': 'ufi-plugin-compat-overlay' }, [
					E('section', { 'class': 'ufi-plugin-compat-container container', id: 'pluginCompatContainer' }, [
						E('div', { 'class': 'title main-title ufi-plugin-compat-main-title' }, [
							E('strong', { id: 'MAIN_TITLE' }, 'UFI-TOOLS'),
							E('span', {}, '设备:'),
							E('strong', { id: 'MODEL' }, text((state.versionInfo && state.versionInfo.model) || (state.baseInfo && state.baseInfo.model), ''))
						]),
				E('section', { 'class': 'kano_function_main func_list_container' }, [
					E('div', { 'class': 'title ufi-plugin-compat-title', id: 'collapseBtn_menu' }, [
						E('strong', {}, '功能列表')
					]),
					E('div', { 'class': 'functions-container actions collapse collapse_menu', 'data-name': 'close' }, [
						E('div', { 'class': 'collapse_box actions-buttons' }, [
							E('button', { 'class': 'btn ufi-plugin-compat-btn', id: 'PLUGIN_SETTING', type: 'button' }, '插件功能'),
							E('button', { 'class': 'btn ufi-plugin-compat-btn', id: 'ADVANCE', type: 'button' }, '高级功能'),
							E('div', { 'class': 'btn ufi-plugin-compat-btn', id: 'USBStatusManagement' }, 'USB 调试')
						])
					])
				]),
				E('section', { 'class': 'kano_function_main status-container' }, [
					E('div', { 'class': 'title ufi-plugin-compat-title' }, [
						E('strong', {}, '状态区'),
						E('div', { style: 'display:inline-block;', id: 'collapse_status_btn' })
					]),
					E('div', { 'class': 'collapse', id: 'collapse_status', 'data-name': 'open' }, [
						E('div', { 'class': 'collapse_box' }, [
							E('ul', { 'class': 'deviceList ufi-plugin-compat-status-list', id: 'STATUS' }, [
								E('li', { 'class': 'ufi-plugin-compat-empty' }, '旧插件兼容页面已就绪，等待插件接管')
							])
						])
					])
				]),
				E('div', { 'class': 'ufi-plugin-compat-body', id: 'pluginCompatBody' }),
				E('div', { 'class': 'modal ufi-plugin-compat-sms-modal', id: 'smsList', style: 'display:none;' }, [
					E('div', { 'class': 'title ufi-plugin-compat-title' }, '短信列表'),
					E('div', { 'class': 'ufi-plugin-compat-input-row' }, [
						E('input', { id: 'PhoneInput', type: 'number', placeholder: '手机号' })
					]),
					E('ul', { id: 'sms-list', 'class': 'ufi-plugin-compat-sms-items' }),
					E('div', { 'class': 'ufi-plugin-compat-input-row' }, [
						E('input', { id: 'SMSInput', type: 'text', placeholder: '输入短信内容' })
					])
				]),
				E('div', { id: 'pluginCompatHidden', style: 'display:none;' }, [
					E('button', { 'class': 'btn ufi-plugin-compat-btn', id: 'SMS', type: 'button' }, '短信收发'),
					E('button', { 'class': 'btn ufi-plugin-compat-btn', id: 'AT', type: 'button' }, 'AT 指令'),
					E('div', { 'class': 'btn ufi-plugin-compat-btn', id: 'UNREAD_SMS' }, '未读短信')
				])
					])
				])
			]),
			E('div', { 'class': 'ufi-plugin-compat-dialog-shell', id: 'pluginCompatDialogBody' }),
			E('div', { 'class': 'mask ufi-plugin-compat-modal', id: 'PluginModal', style: 'display:none;opacity:0;' }, [
				E('div', { 'class': 'inner ufi-plugin-compat-modal-inner' }, [
					E('strong', {}, '插件兼容弹层'),
					E('textarea', { id: 'custom_head', hidden: 'hidden' }),
					E('ul', { id: 'sortable-list', hidden: 'hidden' })
				])
			]),
			E('div', { 'class': 'mask ufi-plugin-compat-modal', id: 'plugin_store', style: 'display:none;opacity:0;' }, [
				E('div', { 'class': 'inner ufi-plugin-compat-modal-inner' }, [
					E('strong', {}, '插件商店兼容弹层'),
					E('div', { 'class': 'plugin-items' })
				])
			]),
			E('div', { 'class': 'mask ufi-plugin-compat-modal', id: 'ATModal', style: 'display:none;opacity:0;' }, [
				E('div', { 'class': 'inner ufi-plugin-compat-modal-inner' }, [
					E('strong', {}, 'AT / 高级功能兼容弹层'),
					E('div', { 'class': 'ufi-plugin-compat-input-row' }, [
						E('input', { id: 'AT_INPUT', type: 'text', placeholder: '输入 AT 指令' })
					]),
					E('div', { 'class': 'ufi-plugin-compat-result-group' }, [
						E('span', {}, 'AT 执行结果'),
						E('p', { id: 'AT_RESULT', 'class': 'ufi-plugin-compat-result' }, '')
					])
				])
			]),
			E('div', { 'class': 'mask ufi-plugin-compat-modal', id: 'advanceModal', style: 'display:none;opacity:0;' }, [
				E('div', { 'class': 'inner ufi-plugin-compat-modal-inner' }, [
					E('strong', {}, '高级功能兼容弹层'),
					E('div', { 'class': 'ufi-plugin-compat-result-group' }, [
						E('span', {}, '高级功能执行结果'),
						E('p', { id: 'AD_RESULT', 'class': 'ufi-plugin-compat-result' }, '')
					])
				])
			]),
			E('div', { 'class': 'mask ufi-plugin-compat-modal', id: 'smsForwardModal', style: 'display:none;opacity:0;' }, [
				E('div', { 'class': 'inner ufi-plugin-compat-modal-inner' }, [
					E('strong', {}, '短信转发兼容弹层'),
					E('div', { style: 'display:inline-block;', id: 'collapse_smsforward_btn' }),
					E('div', { 'class': 'collapse', id: 'collapse_smsforward', 'data-name': 'close' }, [
						E('div', { 'class': 'collapse_box' }, [
							E('div', { id: 'smsForward' }, '短信转发区域已就绪')
						])
					])
				])
			]),
			E('div', { id: 'toastContainer', 'class': 'ufi-plugin-compat-toast' })
		]),
		E('div', { 'class': 'ufi-plugin-host-list', id: 'pluginHostList' }, [
			E('div', { 'class': 'ufi-empty' }, '暂无已安装插件')
		])
	]);
}

function renderPluginHost() {
	if (els.pluginHostCount)
		els.pluginHostCount.textContent = String((state.pluginList || []).length);

	if (els.pluginHostStatus) {
		if (state.pluginHostError)
			els.pluginHostStatus.textContent = state.pluginHostError;
		else if (state.pluginHostLoading || state.pluginLoading)
			els.pluginHostStatus.textContent = '插件加载中';
		else if (!state.connected)
			els.pluginHostStatus.textContent = '等待后台连接';
		else if (state.pluginHostReady)
			els.pluginHostStatus.textContent = '已接管 ' + state.pluginHostMountedCount + ' 个插件';
		else
			els.pluginHostStatus.textContent = '未加载';
	}

	if (els.pluginCompatStatus) {
		if (state.pluginHostError)
			els.pluginCompatStatus.textContent = state.pluginHostError;
		else if (state.pluginHostLoading || state.pluginLoading)
			els.pluginCompatStatus.textContent = '兼容宿主加载中';
		else if (!state.connected)
			els.pluginCompatStatus.textContent = '等待后台连接后加载插件';
		else if (state.pluginHostReady)
			els.pluginCompatStatus.textContent = '兼容宿主已接管旧插件';
		else
			els.pluginCompatStatus.textContent = '兼容宿主已就绪';
	}

	if (els.pluginHostNote) {
		if (!state.connected)
			els.pluginHostNote.textContent = '请先连接后台。连接成功后，已安装插件会在这里自动挂载自己的组件。插件下载入口在上方“功能入口”里。';
		else
			els.pluginHostNote.textContent = '已安装插件会在这里自动挂载自己的组件。插件下载入口在上方“功能入口”里。';
	}

	if (!els.pluginHostList)
		return;

	if (!getPluginSlotCount()) {
		els.pluginHostList.innerHTML = '';
		els.pluginHostList.appendChild(E('div', { 'class': 'ufi-empty' }, state.pluginHostLoading || state.pluginLoading ? '插件加载中' : (!state.connected ? '请先连接后台，插件将在连接成功后自动加载' : ((state.pluginList || []).length ? '已安装插件暂未生成独立卡片，可先查看上方兼容页面区域' : '暂无已安装插件'))));
	}
}

function renderPluginPanel() {
	var total = filterPluginStoreItems().length;
	var pageCount = Math.max(1, Math.ceil(total / 10));
	var list = els.pluginStoreList;
	var items;

	if (state.pluginStorePage > pageCount - 1)
		state.pluginStorePage = pageCount - 1;

	items = currentPluginStorePageItems();

	if (els.pluginStoreSearch && els.pluginStoreSearch.value !== state.pluginStoreKeyword)
		els.pluginStoreSearch.value = state.pluginStoreKeyword;

	if (els.pluginStoreSummary)
		els.pluginStoreSummary.textContent = '已安装 ' + (state.pluginList || []).length + ' 个插件，已接管 ' + state.pluginHostMountedCount + ' 个插件';

	if (els.pluginStoreStatus) {
		if (state.pluginStoreLoading)
			els.pluginStoreStatus.textContent = '插件商店加载中';
		else if (state.pluginHostError)
			els.pluginStoreStatus.textContent = state.pluginHostError;
		else
			els.pluginStoreStatus.textContent = '插件商店共 ' + (state.pluginStoreItems || []).length + ' 项';
	}

	if (els.pluginStorePageText)
		els.pluginStorePageText.textContent = '第 ' + (state.pluginStorePage + 1) + ' / ' + pageCount + ' 页';

	if (els.pluginStorePrevBtn)
		els.pluginStorePrevBtn.disabled = state.pluginStorePage <= 0;

	if (els.pluginStoreNextBtn)
		els.pluginStoreNextBtn.disabled = state.pluginStorePage >= pageCount - 1;

	if (!list)
		return;

	list.innerHTML = '';

	if (state.pluginStoreLoading) {
		list.appendChild(E('div', { 'class': 'ufi-empty' }, '插件商店加载中'));
		return;
	}

	if (!items.length) {
		list.appendChild(E('div', { 'class': 'ufi-empty' }, total ? '当前页没有可显示的插件' : '暂无可用插件'));
		return;
	}

	items.forEach(function(item) {
		var name = text(item && item.name, '未命名插件');
		var desc = text(item && (item.description || item.desc || item.note), '暂无插件说明');
		var downloadUrl = getPluginStoreItemUrl(item);
		var installed = (state.pluginList || []).some(function(plugin) {
			return sanitizePluginName(plugin && plugin.name, '') === sanitizePluginName(name, '');
		});
		var card = E('article', { 'class': 'ufi-plugin-store-item' }, [
			E('div', { 'class': 'ufi-plugin-store-item-head' }, [
				E('strong', {}, name),
				E('span', { 'class': 'ufi-plugin-store-item-tag' }, installed ? '已安装' : '未安装')
			]),
			E('div', { 'class': 'ufi-note' }, desc),
			E('div', { 'class': 'ufi-plugin-store-item-actions' }, [
				E('button', { 'class': 'cbi-button cbi-button-action' }, installed ? '更新安装' : '安装插件'),
				E('button', { 'class': 'cbi-button cbi-button-neutral' }, '仅下载')
			])
		]);
		var buttons = card.querySelectorAll('button');

		buttons[0].addEventListener('click', function() {
			installPluginFromStore(item).catch(function(err) {
				showToast(text(err && err.message, '插件安装失败'), 'error');
			});
		});
		buttons[1].addEventListener('click', function() {
			downloadPluginText(downloadUrl, name).catch(function(err) {
				showToast(text(err && err.message, '插件下载失败'), 'error');
			});
		});
		list.appendChild(card);
	});
}

function createNetworkEntryButton() {
	return E('button', {
		'class': 'ufi-function-btn',
		'data-open-panel': 'network'
	}, [
		document.createTextNode('网络锁定 '),
		E('span', {}, '↗')
	]);
}

function createNetworkLockPanel() {
	var panel = E('section', { 'class': 'ufi-panel', 'data-panel': 'network' }, [
		E('div', { 'class': 'ufi-panel-head' }, [
			E('h3', {}, '网络锁定'),
			E('button', { 'class': 'cbi-button cbi-button-neutral', 'data-close-panel': '1' }, '关闭')
		]),
		E('div', { 'class': 'ufi-stack ufi-network-grid' }, [
			E('div', { 'class': 'ufi-card ufi-network-card' }, [
				E('div', { 'class': 'ufi-panel-head' }, [
					E('h3', {}, '锁定频段')
				]),
				E('div', { 'class': 'ufi-network-note' }, '按原项目 goform 语义提交 4G / 5G 频段锁定，提交成功后会自动切网一次以应用配置。'),
				E('label', { 'class': 'ufi-network-inline' }, [
					E('input', { id: 'bandSelectAll', type: 'checkbox' }),
					E('span', {}, '全选频段')
				]),
				E('table', { 'class': 'ufi-network-table' }, [
					E('thead', {}, E('tr', {}, [
						E('th', {}, '选择'),
						E('th', {}, 'Band'),
						E('th', {}, '频率范围'),
						E('th', {}, '制式'),
						E('th', {}, '运营商')
					])),
					E('tbody', { id: 'bandLockTable' })
				]),
				E('div', { 'class': 'ufi-actions' }, [
					E('button', { 'class': 'cbi-button cbi-button-action', id: 'bandApplyBtn' }, '锁定频段'),
					E('button', { 'class': 'cbi-button cbi-button-neutral', id: 'bandUnlockBtn' }, '恢复全频段')
				])
			]),
			E('div', { 'class': 'ufi-card ufi-network-card' }, [
				E('div', { 'class': 'ufi-panel-head' }, [
					E('h3', {}, '锁定基站')
				]),
				E('div', { 'class': 'ufi-network-note' }, '锁错基站可能导致无信号。建议先观察邻区信息，再用“选择当前基站”或手动填写 PCI / 频率。'),
				E('div', { 'class': 'ufi-panel-head' }, [
					E('h3', {}, '已锁基站'),
					E('button', { 'class': 'cbi-button cbi-button-neutral', id: 'cellUnlockBtn' }, '解除全部锁定')
				]),
				E('table', { 'class': 'ufi-network-table' }, [
					E('thead', {}, E('tr', {}, [
						E('th', {}, '类型'),
						E('th', {}, 'PCI'),
						E('th', {}, '频率')
					])),
					E('tbody', { id: 'lockedCellTable' })
				]),
				E('div', { 'class': 'ufi-network-headline' }, [
					E('h3', {}, '当前基站'),
					E('button', { 'class': 'cbi-button cbi-button-neutral', id: 'useCurrentCellBtn' }, '选择当前基站')
				]),
				E('div', { 'class': 'ufi-network-status', id: 'currentCellSummary' }, '-'),
				E('table', { 'class': 'ufi-network-table' }, [
					E('thead', {}, E('tr', {}, [
						E('th', {}, '频段'),
						E('th', {}, '频率'),
						E('th', {}, 'PCI'),
						E('th', {}, 'RSRP'),
						E('th', {}, 'SINR'),
						E('th', {}, 'RSRQ')
					])),
					E('tbody', { id: 'currentCellTable' })
				]),
				E('div', { 'class': 'ufi-network-headline' }, [
					E('h3', {}, '邻区列表'),
					E('button', { 'class': 'cbi-button cbi-button-neutral', id: 'cellRefreshBtn' }, '停止刷新')
				]),
				E('table', { 'class': 'ufi-network-table' }, [
					E('thead', {}, E('tr', {}, [
						E('th', {}, '频段'),
						E('th', {}, '频率'),
						E('th', {}, 'PCI'),
						E('th', {}, 'RSRP'),
						E('th', {}, 'SINR'),
						E('th', {}, 'RSRQ')
					])),
					E('tbody', { id: 'neighborCellTable' })
				]),
				E('div', { 'class': 'ufi-network-form' }, [
					E('label', { 'class': 'ufi-field' }, [
						E('span', {}, '网络类型'),
						E('select', { id: 'cellRatSelect' }, [
							E('option', { value: '12' }, '4G'),
							E('option', { value: '16' }, '5G')
						])
					]),
					E('label', { 'class': 'ufi-field' }, [
						E('span', {}, 'PCI'),
						E('input', { id: 'lockCellPci', type: 'text', placeholder: 'PCI' })
					]),
					E('label', { 'class': 'ufi-field' }, [
						E('span', {}, '频率'),
						E('input', { id: 'lockCellEarfcn', type: 'text', placeholder: 'EARFCN' })
					])
				]),
				E('div', { 'class': 'ufi-actions' }, [
					E('button', { 'class': 'cbi-button cbi-button-action', id: 'cellLockBtn' }, '锁定基站')
				])
			])
		])
	]);

	panel.hidden = true;
	return panel;
}

function appendNetworkLockUi(root) {
	var functionGrid = root.querySelector('.ufi-function-grid');
	var modalWrap = root.querySelector('.ufi-modal-wrap');
	var style = document.createElement('style');

	style.textContent = ''
		+ '.ufi-network-grid{display:grid;gap:14px;}'
		+ '.ufi-network-card{display:grid;gap:12px;}'
		+ '.ufi-network-note{font-size:12px;color:var(--ufi-muted);line-height:1.7;}'
		+ '.ufi-network-inline{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ufi-muted);}'
		+ '.ufi-network-headline{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;}'
		+ '.ufi-network-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}'
		+ '.ufi-network-status{padding:12px 14px;border-radius:16px;background:#fff;border:1px solid var(--ufi-line);font-size:13px;line-height:1.7;color:var(--ufi-muted);}'
		+ '.ufi-network-status strong{color:var(--ufi-text);}'
		+ '.ufi-network-table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid var(--ufi-line);border-radius:18px;overflow:hidden;}'
		+ '.ufi-network-table th,.ufi-network-table td{padding:10px 12px;border-bottom:1px solid #edf2f5;text-align:left;font-size:13px;vertical-align:middle;}'
		+ '.ufi-network-table thead th{background:#f4f8fb;font-size:12px;color:var(--ufi-muted);font-weight:700;}'
		+ '.ufi-network-table tbody tr:last-child td{border-bottom:none;}'
		+ '.ufi-network-table tbody tr.is-selectable{cursor:pointer;}'
		+ '.ufi-network-table tbody tr.is-selectable:hover{background:#f7fffd;}'
		+ '.ufi-empty-cell{text-align:center;color:var(--ufi-muted);padding:20px 12px !important;}'
		+ '@media (max-width:640px){.ufi-network-form{grid-template-columns:1fr;}}';

	root.appendChild(style);
	if (functionGrid)
		functionGrid.appendChild(createNetworkEntryButton());
	if (modalWrap)
		modalWrap.appendChild(createNetworkLockPanel());
}

function appendPluginUi(root) {
	var functionGrid = root.querySelector('.ufi-function-grid');
	var modalWrap = root.querySelector('.ufi-modal-wrap');
	var shell = root.querySelector('.ufi-shell');
	var style = document.createElement('style');

	style.textContent = ''
		+ '.ufi-plugin-store-panel{width:min(1080px,100%);}'
		+ '.ufi-plugin-store-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px;}'
		+ '.ufi-plugin-store-status{padding:12px 14px;border-radius:16px;background:#fff;border:1px solid var(--ufi-line);font-size:13px;color:var(--ufi-muted);}'
		+ '.ufi-plugin-store-bar{display:grid;grid-template-columns:minmax(220px,1fr) auto auto;gap:12px;align-items:center;margin-top:12px;}'
		+ '.ufi-plugin-store-summary{font-size:13px;color:var(--ufi-muted);}'
		+ '.ufi-plugin-store-page{display:flex;align-items:center;gap:8px;white-space:nowrap;}'
		+ '.ufi-plugin-store-list{display:grid;gap:12px;margin-top:14px;}'
		+ '.ufi-plugin-store-item{padding:14px 16px;border-radius:18px;background:#fff;border:1px solid var(--ufi-line);display:grid;gap:10px;}'
		+ '.ufi-plugin-store-item-head{display:flex;justify-content:space-between;align-items:center;gap:10px;}'
		+ '.ufi-plugin-store-item-tag{padding:4px 10px;border-radius:999px;background:#eef6ec;color:#0f766e;font-size:12px;font-weight:700;}'
		+ '.ufi-plugin-store-item-actions{display:flex;gap:10px;flex-wrap:wrap;}'
		+ '.ufi-plugin-host-shell{margin-top:16px;}'
		+ '.ufi-plugin-host-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px;}'
		+ '.ufi-plugin-host-meta div{padding:12px 14px;border-radius:16px;background:#fff;border:1px solid var(--ufi-line);}'
		+ '.ufi-plugin-host-meta span{display:block;font-size:12px;color:var(--ufi-muted);margin-bottom:8px;}'
		+ '.ufi-plugin-host-meta strong{font-size:16px;}'
		+ '.ufi-plugin-compat-shell{margin-top:14px;padding:14px 16px;border-radius:18px;border:1px solid var(--ufi-line);background:linear-gradient(180deg,#fdfefe 0%,#f7fbff 100%);display:grid;gap:12px;}'
		+ '.ufi-plugin-compat-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;}'
		+ '.ufi-plugin-compat-head span{font-size:12px;color:var(--ufi-muted);}'
		+ '.ufi-plugin-compat-container{display:grid;gap:12px;padding:12px;border:1px solid var(--ufi-line);border-radius:16px;background:#fff;}'
		+ '.ufi-plugin-compat-bg,.ufi-plugin-compat-overlay{display:grid;gap:12px;}'
		+ '.ufi-plugin-compat-title{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0;}'
		+ '.functions-container.actions.collapse.collapse_menu{display:flex;gap:10px;flex-wrap:wrap;}'
		+ '.collapse_box.actions-buttons{display:flex;gap:10px;flex-wrap:wrap;}'
		+ '.kano_function_main.func_list_container,.kano_function_main.status-container{display:grid;gap:10px;}'
		+ '.ufi-plugin-compat-btn{margin:0;}'
		+ '.ufi-plugin-compat-status-list{margin:0;padding:0;list-style:none;border:1px solid var(--ufi-line);border-radius:16px;background:#fff;min-height:72px;}'
		+ '.ufi-plugin-compat-status-list li{padding:12px 14px;border-bottom:1px solid #edf2f5;}'
		+ '.ufi-plugin-compat-status-list li:last-child{border-bottom:none;}'
		+ '.ufi-plugin-compat-empty{color:var(--ufi-muted);font-size:13px;}'
		+ '.ufi-plugin-compat-body{min-height:64px;display:grid;gap:12px;}'
		+ '.ufi-plugin-compat-input-row{display:flex;gap:10px;align-items:center;}'
		+ '.ufi-plugin-compat-input-row input{width:100%;padding:10px 12px;border:1px solid var(--ufi-line);border-radius:12px;background:#fff;color:var(--ufi-text);}'
		+ '.ufi-plugin-compat-sms-modal{display:grid;gap:10px;padding:12px;border:1px solid var(--ufi-line);border-radius:16px;background:#fbfdff;}'
		+ '.ufi-plugin-compat-sms-items{margin:0;padding:0;list-style:none;display:grid;gap:8px;min-height:24px;}'
		+ '.ufi-plugin-compat-sms-items li{padding:10px 12px;border:1px solid var(--ufi-line);border-radius:12px;background:#fff;}'
		+ '.ufi-plugin-compat-dialog-shell{display:grid;gap:12px;}'
		+ '.ufi-plugin-compat-modal{position:relative;border:1px dashed var(--ufi-line);border-radius:16px;background:rgba(255,255,255,.92);padding:12px;}'
		+ '.ufi-plugin-compat-modal-inner{display:grid;gap:10px;font-size:13px;color:var(--ufi-muted);}'
		+ '.ufi-plugin-compat-result-group{display:grid;gap:8px;}'
		+ '.ufi-plugin-compat-result{margin:0;padding:12px 14px;border-radius:14px;background:#fff;border:1px solid var(--ufi-line);color:var(--ufi-text);white-space:pre-wrap;word-break:break-word;min-height:44px;}'
		+ '.ufi-plugin-compat-toast{display:grid;gap:8px;}'
		+ '.ufi-plugin-host-list{display:grid;gap:12px;margin-top:14px;}'
		+ '.ufi-plugin-slot{padding:14px 16px;border-radius:18px;background:#fff;border:1px solid var(--ufi-line);display:grid;gap:10px;}'
		+ '.ufi-plugin-slot-head{display:flex;justify-content:space-between;align-items:center;gap:10px;}'
		+ '.ufi-plugin-slot-status{font-size:12px;color:var(--ufi-muted);}'
		+ '.ufi-plugin-slot.is-ready{border-color:#b6d5d1;background:#f7fffd;}'
		+ '.ufi-plugin-slot.is-error{border-color:#ef9a9a;background:#fff7f7;}'
		+ '.ufi-plugin-slot.is-loading{border-color:#d7e4ef;}'
		+ '.ufi-plugin-slot.is-disabled{opacity:.8;background:#fbfcfd;}'
		+ '.ufi-plugin-slot-body .ufi-note.is-error{color:#b91c1c;}'
		+ '.ufi-plugin-slot-mount{display:grid;gap:12px;}'
		+ '.ufi-plugin-section{border:1px dashed var(--ufi-line);border-radius:16px;padding:12px;background:#fbfdff;}'
		+ '.ufi-plugin-section-title{font-size:13px;font-weight:700;margin-bottom:8px;}'
		+ '.ufi-plugin-section-body{display:grid;gap:10px;}'
		+ '@media (max-width:900px){.ufi-plugin-store-bar{grid-template-columns:1fr;}.ufi-plugin-host-meta{grid-template-columns:1fr;}.ufi-plugin-compat-head{align-items:flex-start;}}';

	root.appendChild(style);
	if (functionGrid)
		functionGrid.appendChild(createPluginEntryButton());
	if (modalWrap)
		modalWrap.appendChild(createPluginPanel());
	if (shell)
		shell.appendChild(createPluginHostSection());
}

function renderSkeleton() {
	var root = E('div', { 'class': 'ufi-redraw-root' });

	root.innerHTML = ''
		+ '<style>'
		+ '.ufi-redraw-root{--ufi-bg:#f4f7f1;--ufi-panel:#ffffff;--ufi-text:#18212f;--ufi-muted:#617180;--ufi-accent:#0f766e;--ufi-accent-soft:#dff5ef;--ufi-line:#dce4ea;--ufi-danger:#b91c1c;min-height:calc(100vh - 60px);padding:16px 0 28px;background:linear-gradient(180deg,#eef6ec 0%,#f5f7fb 60%,#edf3f8 100%);}'
		+ '.ufi-shell{max-width:1280px;margin:0 auto;padding:0 16px;color:var(--ufi-text);font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}'
		+ '.ufi-hero{display:grid;grid-template-columns:1.3fr .9fr;gap:16px;margin-bottom:16px;}.ufi-card{background:rgba(255,255,255,.92);border:1px solid var(--ufi-line);border-radius:24px;box-shadow:0 18px 50px rgba(23,37,84,.08);padding:18px 20px;backdrop-filter:blur(10px);}'
		+ '.ufi-hero-title{font-size:28px;font-weight:800;letter-spacing:.02em;margin:0 0 8px;}.ufi-hero-sub{color:var(--ufi-muted);font-size:14px;line-height:1.7;}.ufi-badge{display:inline-flex;align-items:center;gap:8px;border-radius:999px;background:var(--ufi-accent-soft);color:var(--ufi-accent);padding:8px 12px;font-size:12px;font-weight:700;}'
		+ '.ufi-login-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}.ufi-field{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--ufi-muted);}.ufi-field input,.ufi-field select,.ufi-field textarea{width:100%;border:1px solid var(--ufi-line);border-radius:14px;padding:11px 12px;background:#fff;color:var(--ufi-text);font:inherit;box-sizing:border-box;}'
		+ '.ufi-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;}.ufi-toolbar{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:16px;}.ufi-stat{min-height:108px;}.ufi-stat-label{font-size:12px;color:var(--ufi-muted);margin-bottom:10px;}.ufi-stat-value{font-size:24px;font-weight:800;line-height:1.2;}'
		+ '.ufi-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:16px;margin-bottom:16px;}.ufi-stack{display:grid;gap:16px;}.ufi-summary-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}.ufi-summary-item{padding:14px;border-radius:18px;background:#f8fbfc;border:1px solid #edf2f5;}.ufi-summary-item strong{display:block;font-size:12px;color:var(--ufi-muted);margin-bottom:8px;}.ufi-summary-item span{font-size:16px;font-weight:700;}'
		+ '.ufi-function-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}.ufi-function-btn{display:flex;align-items:center;justify-content:space-between;border:1px solid var(--ufi-line);background:#fff;padding:14px 16px;border-radius:18px;font-size:14px;font-weight:700;color:var(--ufi-text);cursor:pointer;}.ufi-function-btn:hover{border-color:#b6d5d1;background:#f7fffd;}'
		+ '.ufi-status-pill{display:inline-flex;padding:8px 12px;border-radius:999px;background:#0f766e;color:#fff;font-size:12px;font-weight:700;}.ufi-modal-wrap{position:fixed;inset:0;background:rgba(15,23,42,.35);display:flex;align-items:flex-end;justify-content:center;padding:24px;z-index:2000;}.ufi-modal-wrap[hidden]{display:none !important;pointer-events:none !important;}.ufi-panel{width:min(980px,100%);max-height:90vh;overflow:auto;background:#f8fbfd;border-radius:28px;padding:18px;box-shadow:0 32px 64px rgba(15,23,42,.25);}.ufi-panel[hidden]{display:none !important;}'
		+ '.ufi-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;}.ufi-panel-head h3{margin:0;font-size:22px;}.ufi-sms-list{display:grid;gap:12px;}.ufi-sms-item{padding:14px 16px;border-radius:18px;background:#fff;border:1px solid var(--ufi-line);}.ufi-sms-item.is-in{border-left:5px solid #0f766e;}.ufi-sms-item.is-out{border-left:5px solid #d97706;}.ufi-sms-head,.ufi-sms-actions{display:flex;justify-content:space-between;align-items:center;gap:8px;}.ufi-sms-body{margin:10px 0 12px;line-height:1.7;white-space:pre-wrap;word-break:break-word;}'
		+ '.ufi-empty{padding:32px 12px;text-align:center;color:var(--ufi-muted);}.ufi-apn-grid{display:grid;grid-template-columns:.8fr 1.2fr;gap:14px;}.ufi-apn-side{display:grid;gap:10px;}.ufi-note{font-size:12px;color:var(--ufi-muted);line-height:1.7;}.ufi-toast-wrap{position:fixed;top:82px;right:18px;display:grid;gap:10px;z-index:3000;}.ufi-toast{min-width:220px;max-width:360px;color:#fff;padding:12px 14px;border-radius:14px;box-shadow:0 16px 30px rgba(15,23,42,.18);transition:all .28s ease;}.ufi-toast.is-leaving{opacity:0;transform:translateY(-8px);}.ufi-kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}.ufi-kv div{padding:12px 14px;border-radius:16px;background:#fff;border:1px solid var(--ufi-line);}.ufi-kv span{display:block;font-size:12px;color:var(--ufi-muted);margin-bottom:8px;}.ufi-kv strong{font-size:16px;}.ufi-log-list{display:grid;gap:10px;max-height:280px;overflow:auto;}.ufi-log-item{padding:12px 14px;border-radius:16px;background:#fff;border:1px solid var(--ufi-line);}.ufi-log-item.is-warn{border-left:4px solid #d97706;}.ufi-log-item.is-error{border-left:4px solid #b91c1c;}.ufi-log-item.is-info{border-left:4px solid #0f766e;}.ufi-log-meta{display:block;font-size:12px;color:var(--ufi-muted);margin-bottom:8px;}.ufi-log-text{font-size:13px;line-height:1.6;word-break:break-all;}'
		+ '@media (max-width:1080px){.ufi-hero,.ufi-grid,.ufi-apn-grid{grid-template-columns:1fr;}.ufi-toolbar,.ufi-function-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}@media (max-width:640px){.ufi-shell{padding:0 10px;}.ufi-toolbar,.ufi-function-grid,.ufi-summary-list,.ufi-login-grid,.ufi-kv{grid-template-columns:1fr;}.ufi-modal-wrap{padding:10px;align-items:flex-end;}.ufi-panel{padding:14px;border-radius:22px;}.ufi-hero-title{font-size:24px;}}'
		+ '</style>'
		+ '<div class="ufi-shell"><section class="ufi-hero"><div class="ufi-card"><h1 class="ufi-hero-title">UFI-TOOLS</h1></div><div class="ufi-card"><div class="ufi-login-grid"><label class="ufi-field" id="tokenField"><span>UFI-TOOLS 口令</span><input id="token" type="password" autocomplete="current-password" placeholder=""></label><label class="ufi-field"><span>口令模式</span><select id="tokenMode"><option value="auto">自动判断</option><option value="no_token">无 UFI-TOOLS 口令</option></select></label><label class="ufi-field"><span>某兴后台密码</span><input id="password" type="password" autocomplete="current-password" placeholder=""></label><label class="ufi-field"><span>登录方式</span><select id="loginMethod"><option value="0">登录方式 1</option><option value="1">登录方式 2</option></select></label><div class="ufi-field"><span>口令模式</span><div class="ufi-badge" id="needTokenTag">检测中</div></div></div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="connectBtn">连接后台</button><button class="cbi-button cbi-button-neutral" id="refreshBtn">刷新数据</button></div></div></section><section class="ufi-toolbar"><div class="ufi-card ufi-stat"><div class="ufi-stat-label">设备型号</div><div class="ufi-stat-value" id="sumModel">-</div></div><div class="ufi-card ufi-stat"><div class="ufi-stat-label">网络类型</div><div class="ufi-stat-value" id="sumNetwork">-</div></div><div class="ufi-card ufi-stat"><div class="ufi-stat-label">实时速率</div><div class="ufi-stat-value" id="sumSpeed">-</div></div><div class="ufi-card ufi-stat"><div class="ufi-stat-label">连接状态</div><div class="ufi-stat-value" id="statusText">未连接</div><div class="ufi-note" id="statusHint"></div></div></section><section class="ufi-grid"><div class="ufi-stack"><div class="ufi-card"><div class="ufi-panel-head"><h3>核心状态</h3></div><div class="ufi-summary-list"><div class="ufi-summary-item"><strong>运营商</strong><span id="sumProvider">-</span></div><div class="ufi-summary-item"><strong>信号</strong><span id="sumSignal">-</span></div><div class="ufi-summary-item"><strong>CPU 温度</strong><span id="sumTemp">-</span></div><div class="ufi-summary-item"><strong>电量</strong><span id="sumBattery">-</span></div><div class="ufi-summary-item"><strong>CPU 占用</strong><span id="sumCpu">-</span></div><div class="ufi-summary-item"><strong>内存占用</strong><span id="sumMem">-</span></div><div class="ufi-summary-item"><strong>WiFi 终端</strong><span id="sumWifi">-</span></div><div class="ufi-summary-item"><strong>ADB 状态</strong><span id="sumAdb">-</span></div></div></div><div class="ufi-card"><div class="ufi-panel-head"><h3>流量摘要</h3></div><div class="ufi-kv"><div><span>今日流量</span><strong id="sumDaily">-</strong></div><div><span>本月流量</span><strong id="sumMonthly">-</strong></div></div></div></div><div class="ufi-stack"><div class="ufi-card"><div class="ufi-panel-head"><h3>功能入口</h3></div><div class="ufi-function-grid"><button class="ufi-function-btn" data-open-panel="sms">短信面板 <span>↗</span></button><button class="ufi-function-btn" data-open-panel="apn">APN 管理 <span>↗</span></button><button class="ufi-function-btn" data-open-panel="adb">ADB 设置 <span>↗</span></button></div></div><div class="ufi-card"><div class="ufi-panel-head"><h3>设备摘要</h3></div><div class="ufi-kv"><div><span>设备型号</span><strong id="sumModel2">-</strong></div><div><span>网络类型</span><strong id="sumNetwork2">-</strong></div><div><span>运营商</span><strong id="sumProvider2">-</strong></div><div><span>连接速率</span><strong id="sumSpeed2">-</strong></div></div></div></div></section></div>'
		+ '<div class="ufi-modal-wrap" hidden><section class="ufi-panel" data-panel="sms" hidden><div class="ufi-panel-head"><h3>短信收发</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-field"><span>收件号码</span><input id="smsPhone" type="text" placeholder="手机号"></div><div class="ufi-field"><span>短信内容</span><textarea id="smsContent" rows="4" placeholder="输入短信内容"></textarea></div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="smsSendBtn">发送短信</button></div><div class="ufi-sms-list" id="smsThreadList"></div></section><section class="ufi-panel" data-panel="apn" hidden><div class="ufi-panel-head"><h3>APN 管理</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-apn-grid"><div class="ufi-apn-side"><div class="ufi-kv"><div><span>当前模式</span><strong id="apnMode">-</strong></div><div><span>当前 APN</span><strong id="apnCurrent">-</strong></div></div><label class="ufi-field"><span>模式切换</span><select id="apnModeSelect"><option value="auto">自动</option><option value="manual">手动</option></select></label><label class="ufi-field"><span>配置列表</span><select id="apnProfileSelect"></select></label><div class="ufi-actions"><button class="cbi-button cbi-button-neutral" id="apnLoadBtn">载入配置</button><button class="cbi-button cbi-button-action" id="apnApplyBtn">应用模式</button></div></div><div class="ufi-stack"><div class="ufi-field"><span>配置名称</span><input id="apnProfileName" type="text"></div><div class="ufi-field"><span>APN</span><input id="apnName" type="text"></div><div class="ufi-field"><span>用户名</span><input id="apnUsername" type="text"></div><div class="ufi-field"><span>密码</span><input id="apnPassword" type="text"></div><div class="ufi-login-grid"><label class="ufi-field"><span>鉴权方式</span><select id="apnAuth"><option value="none">NONE</option><option value="chap">CHAP</option><option value="pap">PAP</option></select></label><label class="ufi-field"><span>PDP 类型</span><select id="apnPdp"><option value="IP">IPv4</option><option value="IPv6">IPv6</option><option value="IPv4v6">IPv4v6</option></select></label></div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="apnSaveBtn">保存配置</button><button class="cbi-button cbi-button-remove" id="apnDeleteBtn">删除配置</button></div></div></div></section><section class="ufi-panel" data-panel="adb" hidden><div class="ufi-panel-head"><h3>ADB 设置</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-kv"><div><span>ADB 就绪</span><strong id="adbAlive">-</strong></div><div><span>USB 调试</span><strong id="adbUsb">-</strong></div></div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="adbUsbBtn">切换 USB 调试</button><button class="cbi-button cbi-button-neutral" id="adbWifiBtn">切换网络 ADB</button></div></section><section class="ufi-panel" data-panel="logs" hidden><div class="ufi-panel-head"><h3 id="logPanelTitle">功能日志</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-card"><div class="ufi-panel-head"><h3>连接日志</h3></div><div class="ufi-log-list" id="logList"></div></div><div class="ufi-card"><div class="ufi-panel-head"><h3>功能调用日志</h3></div><div class="ufi-log-list" id="rawLogList"></div></div></section></div><div class="ufi-toast-wrap" id="toast"></div>';

	appendNetworkLockUi(root);
	appendPluginUi(root);
	rootEl = root;
	collectEls();
	els.sumModel2 = root.querySelector('#sumModel2');
	els.sumNetwork2 = root.querySelector('#sumNetwork2');
	els.sumProvider2 = root.querySelector('#sumProvider2');
	els.sumSpeed2 = root.querySelector('#sumSpeed2');
	bindEvents();

	return root;
}

function renderAll() {
	renderSummary();
	renderSms();
	renderPluginPanel();
	renderPluginHost();
	renderNetworkLock();
	renderApn();
	renderAdb();
	renderLogs();
	renderRawLogs();
}

function boot() {
	els.password.value = state.backendPassword;
	els.loginMethod.value = state.loginMethod;
	els.tokenMode.value = state.tokenMode;
	if (state.tokenHash)
		els.token.placeholder = '已保存口令摘要，如需修改请重新输入';

	return Promise.all([
		versionInfo().catch(function() { return null; }),
		needToken().catch(function() { return { need_token: true }; })
	]).then(function() {
		pushLog('INFO', '页面初始化完成');
		renderAll();
		if (state.backendPassword && (!state.needToken || state.tokenHash))
			return connectBackend();
		pushLog('INFO', '等待后台连接后再加载插件');
		renderPluginHost();
		renderPluginPanel();
		return null;
	}).catch(function(err) {
		state.error = text(err.message, '初始化失败');
		pushLog('WARN', state.error);
		renderSummary();
		showToast(state.error, 'error');
	});
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return ensureScript(CRYPTO_SRC);
	},

	render: function() {
		var root = renderSkeleton();
		window.setTimeout(function() {
			boot();
		}, 0);
		return root;
	}
});

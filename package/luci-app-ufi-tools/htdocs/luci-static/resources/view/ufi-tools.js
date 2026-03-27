'use strict';
'require view';

var PROXY_BASE = '/cgi-bin/ufi-tools-proxy';
var CRYPTO_SRC = '/ufi-tools/script/lib/crypto.js';
var AUTH_TOKEN_KEY = 'ufi_tools_token_hash';
var TOKEN_MODE_KEY = 'ufi_tools_token_mode';
var PASSWORD_KEY = 'ufi_tools_backend_pwd';
var LOGIN_METHOD_KEY = 'ufi_tools_login_method';
var REFRESH_MS = 5000;
var DEFAULT_REQUEST_TIMEOUT = 15000;
var CONNECT_TIMEOUT = 20000;

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
		error: '',
		logs: [],
		rawLogs: [],
		logSessionTitle: '',
		interactiveLogActive: false,
		timer: null
	};
}

var state = stateFactory();
var rootEl = null;
var els = {};

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

	return fetch(PROXY_BASE + '?ufi_path=' + encodeURIComponent(path), {
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
	var cmd = 'usb_port_switch,battery_charging,sms_received_flag,sms_unread_num,sms_sim_unread_num,sim_msisdn,data_volume_limit_switch,battery_value,battery_vol_percent,network_signalbar,network_rssi,cr_version,iccid,imei,imsi,ipv6_wan_ipaddr,lan_ipaddr,mac_address,msisdn,network_information,Lte_ca_status,rssi,Z5g_rsrp,lte_rsrp,wifi_access_sta_num,loginfo,data_volume_alert_percent,data_volume_limit_size,realtime_rx_thrpt,realtime_tx_thrpt,realtime_time,monthly_tx_bytes,monthly_rx_bytes,monthly_time,network_type,network_provider,ppp_status';
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
}

function closePanels() {
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

function renderSummary() {
	var data = state.ufiData || {};
	var usage = state.dataUsage || {};
	var signal = data.network_signalbar || data.network_rssi || data.rssi || '-';
	var batteryText = hasText(data.battery_value) ? data.battery_value : (hasText(data.battery_vol_percent) ? data.battery_vol_percent : data.battery);

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
	setSummaryItem('sumDaily', hasText(data.daily_data) ? data.daily_data : formatBytes((Number(usage.monthly_tx_bytes) || 0) + (Number(usage.monthly_rx_bytes) || 0)));
	setSummaryItem('sumMonthly', formatBytes((Number(data.monthly_tx_bytes) || 0) + (Number(data.monthly_rx_bytes) || 0)));
	setSummaryItem('sumAdb', state.adbAlive ? '已就绪' : '等待中');
	setSummaryItem('statusText', state.connected ? '已连接' : '未连接');
	setSummaryItem('statusHint', state.error || '');
	els.connectBtn.textContent = state.connected ? '断开后台' : (state.connecting ? '连接中...' : '连接后台');
	els.connectBtn.disabled = !!state.connecting;
	els.tokenField.style.display = (state.needToken && state.tokenMode !== 'no_token') ? '' : 'none';
	els.needTokenTag.textContent = state.tokenMode === 'no_token' ? '无口令模式' : (state.needToken ? '需要口令' : '无需口令');
	syncExtraSummary();
}

function renderSms() {
	var list = els.smsList;
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
					'class': 'cbi-button cbi-button-neutral',
					'click': function() {
						els.smsPhone.value = text(item.number, '');
						els.smsContent.value = decodeBase64(item.content || '');
						closePanels();
					}
				}, '重发'),
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
		state.smsList = Array.isArray(res) ? res : [];
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
		return;
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
			return;
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

	withTimeout(Promise.resolve().then(function() {
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
			if (!state.connected) {
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
		'smsList', 'smsPhone', 'smsContent', 'smsSendBtn',
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
		+ '<div class="ufi-modal-wrap" hidden><section class="ufi-panel" data-panel="sms" hidden><div class="ufi-panel-head"><h3>短信收发</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-field"><span>收件号码</span><input id="smsPhone" type="text" placeholder="手机号"></div><div class="ufi-field"><span>短信内容</span><textarea id="smsContent" rows="4" placeholder="输入短信内容"></textarea></div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="smsSendBtn">发送短信</button></div><div class="ufi-sms-list" id="smsList"></div></section><section class="ufi-panel" data-panel="apn" hidden><div class="ufi-panel-head"><h3>APN 管理</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-apn-grid"><div class="ufi-apn-side"><div class="ufi-kv"><div><span>当前模式</span><strong id="apnMode">-</strong></div><div><span>当前 APN</span><strong id="apnCurrent">-</strong></div></div><label class="ufi-field"><span>模式切换</span><select id="apnModeSelect"><option value="auto">自动</option><option value="manual">手动</option></select></label><label class="ufi-field"><span>配置列表</span><select id="apnProfileSelect"></select></label><div class="ufi-actions"><button class="cbi-button cbi-button-neutral" id="apnLoadBtn">载入配置</button><button class="cbi-button cbi-button-action" id="apnApplyBtn">应用模式</button></div></div><div class="ufi-stack"><div class="ufi-field"><span>配置名称</span><input id="apnProfileName" type="text"></div><div class="ufi-field"><span>APN</span><input id="apnName" type="text"></div><div class="ufi-field"><span>用户名</span><input id="apnUsername" type="text"></div><div class="ufi-field"><span>密码</span><input id="apnPassword" type="text"></div><div class="ufi-login-grid"><label class="ufi-field"><span>鉴权方式</span><select id="apnAuth"><option value="none">NONE</option><option value="chap">CHAP</option><option value="pap">PAP</option></select></label><label class="ufi-field"><span>PDP 类型</span><select id="apnPdp"><option value="IP">IPv4</option><option value="IPv6">IPv6</option><option value="IPv4v6">IPv4v6</option></select></label></div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="apnSaveBtn">保存配置</button><button class="cbi-button cbi-button-remove" id="apnDeleteBtn">删除配置</button></div></div></div></section><section class="ufi-panel" data-panel="adb" hidden><div class="ufi-panel-head"><h3>ADB 设置</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-kv"><div><span>ADB 就绪</span><strong id="adbAlive">-</strong></div><div><span>USB 调试</span><strong id="adbUsb">-</strong></div></div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="adbUsbBtn">切换 USB 调试</button><button class="cbi-button cbi-button-neutral" id="adbWifiBtn">切换网络 ADB</button></div></section><section class="ufi-panel" data-panel="logs" hidden><div class="ufi-panel-head"><h3 id="logPanelTitle">功能日志</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-card"><div class="ufi-panel-head"><h3>连接日志</h3></div><div class="ufi-log-list" id="logList"></div></div><div class="ufi-card"><div class="ufi-panel-head"><h3>功能调用日志</h3></div><div class="ufi-log-list" id="rawLogList"></div></div></section></div><div class="ufi-toast-wrap" id="toast"></div>';

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
	renderApn();
	renderAdb();
	renderLogs();
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
			connectBackend();
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

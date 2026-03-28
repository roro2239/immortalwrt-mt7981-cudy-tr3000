/*
????????
??????? DOM ???????????????????????????
??????????????????????????????
*/


'use strict';

function E(tagName, attrs, children) {
	var el = document.createElement(tagName);
	var list = [];

	function append(child) {
		if (child == null || child === false)
			return;
		if (Array.isArray(child)) {
			child.forEach(append);
			return;
		}
		if (child instanceof Node) {
			el.appendChild(child);
			return;
		}
		el.appendChild(document.createTextNode(String(child)));
	}

	if (attrs && typeof attrs === 'object' && !Array.isArray(attrs) && !(attrs instanceof Node)) {
		Object.keys(attrs).forEach(function(key) {
			var value = attrs[key];
			if (value == null || value === false)
				return;
			if (key === 'class') {
				el.className = value;
				return;
			}
			if (key === 'style') {
				if (typeof value === 'string')
					el.style.cssText = value;
				else if (value && typeof value === 'object')
					Object.assign(el.style, value);
				return;
			}
			if (key.slice(0, 2) === 'on' && typeof value === 'function') {
				el.addEventListener(key.slice(2), value);
				return;
			}
			if (value === true) {
				el.setAttribute(key, key);
				return;
			}
			if (key in el && ['list', 'type', 'id', 'value'].indexOf(key) < 0) {
				try {
					el[key] = value;
					return;
				}
				catch {}
			}
			el.setAttribute(key, String(value));
		});
	}
	else if (arguments.length > 1) {
		children = attrs;
	}

	if (arguments.length > 2) {
		list = children;
	}
	else {
		if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs) || attrs instanceof Node) {
			list = attrs;
		}
	}

	append(list);
	return el;
}

var PROXY_BASE = '/cgi-bin/ufi-tools-proxy';
var CRYPTO_SRC = '/ufi-tools/script/lib/crypto.js';
var AUTH_TOKEN_KEY = 'ufi_tools_token_hash';
var TOKEN_MODE_KEY = 'ufi_tools_token_mode';
var PASSWORD_KEY = 'ufi_tools_backend_pwd';
var LOGIN_METHOD_KEY = 'ufi_tools_login_method';
var APP_RELEASE = 'r73';
var NATIVE_FETCH = window.fetch.bind(window);
var FAST_REFRESH_MS = 1000;
var REFRESH_MS = 5000;
var DEFAULT_REQUEST_TIMEOUT = 15000;
var CONNECT_TIMEOUT = 20000;
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

function wait(ms) {
	return new Promise(function(resolve) {
		window.setTimeout(resolve, Number(ms) || 0);
	});
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
		smsList: [],
		cellularMode: '',
		cellularBusy: false,
		advancedBusy: false,
		advancedError: false,
		error: '',
		logs: [],
		rawLogs: [],
		logSessionTitle: '',
		interactiveLogActive: false,
		timer: null,
		fastTimer: null,
		smsTimer: null
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
	pushLog('INFO', '当前前端版本：' + APP_RELEASE);
	pushRawLog('前端版本', 'BUILD', APP_RELEASE);
	renderLogs();
	renderRawLogs();
	openPanel('logs');
}

function stopInteractiveLog() {
	state.interactiveLogActive = false;
}

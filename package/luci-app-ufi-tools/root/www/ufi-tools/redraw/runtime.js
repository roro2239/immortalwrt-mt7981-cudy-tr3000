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

	if (arguments.length > 2)
		list = children;
	else if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs) || attrs instanceof Node)
		list = attrs;

	append(list);
	return el;
}

var PROXY_BASE = '/cgi-bin/ufi-tools-proxy';
var CRYPTO_SRC = '/ufi-tools/script/lib/crypto.js';
var AUTH_TOKEN_KEY = 'ufi_tools_token_hash';
var TOKEN_MODE_KEY = 'ufi_tools_token_mode';
var PASSWORD_KEY = 'ufi_tools_backend_pwd';
var LOGIN_METHOD_KEY = 'ufi_tools_login_method';
var APP_RELEASE = 'r81';
var NATIVE_FETCH = window.fetch.bind(window);
var FAST_REFRESH_MS = 1000;
var REFRESH_MS = 5000;
var DEFAULT_REQUEST_TIMEOUT = 15000;
var CONNECT_TIMEOUT = 20000;

function ensureScript(src) {
	if (window.CryptoJS)
		return Promise.resolve();

	return new Promise(function(resolve, reject) {
		var existing = document.querySelector('script[data-ufi-script="' + src + '"]');
		var script;

		if (existing) {
			existing.addEventListener('load', function() {
				resolve();
			}, { once: true });
			existing.addEventListener('error', function() {
				reject(new Error('脚本加载失败：' + src));
			}, { once: true });
			return;
		}

		script = document.createElement('script');
		script.src = src;
		script.async = true;
		script.dataset.ufiScript = src;
		script.onload = function() {
			resolve();
		};
		script.onerror = function() {
			reject(new Error('脚本加载失败：' + src));
		};
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
	var normalized;
	var padding;
	var binary;
	var bytes;
	var i;

	if (!hasText(base64String))
		return '';

	normalized = String(base64String);
	padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
	normalized += '='.repeat(padding);

	binary = window.atob(normalized);
	bytes = new Uint8Array(binary.length);

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

function formatDuration(raw) {
	var total = Number(raw);
	var days;
	var hours;
	var minutes;
	var seconds;
	var parts = [];

	if (!isFinite(total) || total < 0)
		return '-';

	total = Math.floor(total);
	days = Math.floor(total / 86400);
	hours = Math.floor((total % 86400) / 3600);
	minutes = Math.floor((total % 3600) / 60);
	seconds = total % 60;

	if (days)
		parts.push(days + '天');
	if (hours || parts.length)
		parts.push(hours + '时');
	if (minutes || parts.length)
		parts.push(minutes + '分');
	if (!parts.length || seconds)
		parts.push(seconds + '秒');

	return parts.join(' ');
}

function formatFrequencyMHz(raw) {
	var value = Number(raw);

	if (!isFinite(value) || value < 0)
		return '-';

	return value.toFixed(0) + ' MHz';
}

function parseDateText(raw) {
	if (!hasText(raw))
		return '-';

	return String(raw).split(',').slice(0, 6).join('-');
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
		simInfo: null,
		qciInfo: null,
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
	var item;

	if (!state.interactiveLogActive)
		return;

	item = {
		time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
		level: String(level || 'INFO').toUpperCase(),
		message: text(message, '')
	};

	state.logs.unshift(item);
	if (state.logs.length > 120)
		state.logs.length = 120;
}

function pushRawLog(action, status, raw) {
	var item;

	if (!state.interactiveLogActive)
		return;

	item = {
		time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
		action: text(action, '-'),
		status: text(status, '-'),
		raw: text(raw, '')
	};

	state.rawLogs.unshift(item);
	if (state.rawLogs.length > 80)
		state.rawLogs.length = 80;
}

function startInteractiveLog(title) {
	state.logs = [];
	state.rawLogs = [];
	state.logSessionTitle = text(title, '功能日志');
	state.interactiveLogActive = true;
	pushLog('INFO', '当前前端版本：' + APP_RELEASE);
	pushRawLog('前端版本', 'BUILD', APP_RELEASE);
}

function stopInteractiveLog() {
	state.interactiveLogActive = false;
}

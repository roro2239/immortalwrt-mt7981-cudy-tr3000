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
	var requestLabel = method + ' ' + path;
	var controller = new AbortController();
	var timeout = window.setTimeout(function() {
		controller.abort();
	}, Number(opts.timeout || DEFAULT_REQUEST_TIMEOUT));
	var headers;

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
		if (!res.ok) {
			return res.text().then(function(body) {
				pushLog('WARN', '响应异常：' + path + ' -> ' + text(body, '请求失败'));
				throw new Error(text(body, '请求失败'));
			});
		}

		return res.text().then(function(body) {
			var data;

			if (!body) {
				pushRawLog(path, 'HTTP ' + res.status, '[EMPTY]');
				return {};
			}

			try {
				data = JSON.parse(body);
				pushRawLog(path, 'HTTP ' + res.status, body.slice(0, 320));
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
		var data;

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
			return {
				__empty: true,
				__status: res.status,
				__raw: ''
			};
		}

		try {
			data = JSON.parse(body);
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
		headers: {
			'kano-cookie': cookie
		}
	});
}

function getUFIInfo() {
	return requestJson('/goform/goform_get_cmd_process?isTest=false&cmd=Language,cr_version,wa_inner_version&multi_data=1&_=' + Date.now(), {
		signPath: '/goform/goform_get_cmd_process'
	});
}

function processAD(cookie) {
	return Promise.all([
		getUFIInfo(),
		getRD(cookie)
	]).then(function(results) {
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
		var passwordHash;
		var body;

		if (!ldData || !ldData.LD)
			throw new Error('无法获取 LD');

		passwordHash = sha256HexUpper(sha256HexUpper(state.backendPassword) + ldData.LD);
		body = new URLSearchParams({
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
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
			},
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

function logout(source) {
	var reason = text(source, 'unknown');

	if (!state.cookie)
		return Promise.resolve();

	pushLog('INFO', '开始断开后台，来源：' + reason);

	return processAD(state.cookie).then(function(ad) {
		var body = new URLSearchParams({
			goformId: 'LOGOUT',
			isTest: 'false',
			AD: ad
		});

		return request('/goform/goform_set_cmd_process', {
			method: 'POST',
			signPath: '/goform/goform_set_cmd_process',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
				'kano-cookie': state.cookie
			},
			body: body
		});
	}).catch(function() {
		return null;
	}).finally(function() {
		state.cookie = '';
		state.connected = false;
		stopRefresh();
		stopRealtimeRefresh();
		stopSmsRefresh();
		pushLog('INFO', '后台已断开，来源：' + reason);
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
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
				'kano-cookie': cookie
			},
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

function getCellularMode() {
	return getData({
		cmd: 'net_select'
	}).then(function(res) {
		return text(res && res.net_select, '');
	});
}

function buildSimOptions(modelName, slot, dualSimSupport) {
	var model = text(modelName, '').trim().toUpperCase();
	var currentSlot = text(slot, '').trim();
	var enabled = !!dualSimSupport;
	var options = [];
	var seen = {};

	function pushOption(value, label) {
		var key = text(value, '').trim();

		if (!key || seen[key])
			return;

		seen[key] = true;
		options.push({
			value: key,
			label: label
		});
	}

	if (model === 'V50') {
		pushOption('0', '移动');
		pushOption('1', '电信');
		pushOption('2', '联通');
		pushOption('11', '外置');
		return options;
	}

	pushOption('0', 'SIM 1');
	pushOption('1', 'SIM 2');

	if (enabled || currentSlot === '11')
		pushOption('11', '外置卡');

	if (currentSlot === '2')
		pushOption('2', 'SIM 3');

	if (currentSlot === '12')
		pushOption('12', 'SIM 1');

	return options;
}

function getSimInfo() {
	return getData({
		multi_data: '1',
		cmd: 'sim_slot,dual_sim_support'
	}).then(function(res) {
		var slot = text(res && res.sim_slot, '').trim();
		var support = text(res && res.dual_sim_support, '').trim();
		var modelName = text((state.ufiData && (state.ufiData.MODEL || state.ufiData.model || state.ufiData.hardware_version)) || (state.versionInfo && state.versionInfo.model), '').trim();
		var enabled = support ? support === '1' : !!slot;

		return {
			slot: slot,
			model: modelName,
			dualSimSupport: enabled,
			options: buildSimOptions(modelName, slot, enabled)
		};
	});
}

function setSimSlot(slot) {
	return postData({
		goformId: 'SET_SIM_SLOT',
		sim_slot: text(slot, '').trim()
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '切换 SIM 卡');
	});
}

function resolveQciSlot(simInfo, modelName) {
	var rawSlot = text(simInfo && simInfo.slot, '').trim();
	var dualSimSupport = !!(simInfo && simInfo.dualSimSupport);
	var model = text(modelName, '').trim().toUpperCase();

	if (!rawSlot && !dualSimSupport)
		return '0';

	if (rawSlot === '11')
		return model === 'MU3356' ? '1' : '0';

	if (rawSlot === '12')
		return '0';

	if (rawSlot === '2')
		return '1';

	if ((rawSlot === '0' || rawSlot === '1') && model === 'MU3356')
		return rawSlot === '1' ? '0' : '1';

	if (!rawSlot)
		return '0';

	return rawSlot;
}

function parseQciInfo(raw) {
	var input = text(raw, '').trim();
	var match;
	var parts;

	if (!input)
		return null;

	match = input.match(/\+CGEQOSRDP:\s*(.+?)\s*OK/i);
	if (!match) {
		return {
			text: input,
			qci: '',
			downlink: '',
			uplink: ''
		};
	}

	parts = match[1].split(',').map(function(part) {
		return Number(String(part).trim());
	});

	if (parts.length < 8) {
		return {
			text: input,
			qci: '',
			downlink: '',
			uplink: ''
		};
	}

	return {
		text: 'QCI ' + parts[1] + ' / 下行 ' + (parts[6] / 1000).toFixed(2) + ' Mbps / 上行 ' + (parts[7] / 1000).toFixed(2) + ' Mbps',
		qci: String(parts[1]),
		downlink: (parts[6] / 1000).toFixed(2) + ' Mbps',
		uplink: (parts[7] / 1000).toFixed(2) + ' Mbps'
	};
}

function requestAtCommand(command, slot) {
	var query = new URLSearchParams({
		command: text(command, '').trim(),
		slot: text(slot, '0').trim()
	});

	return requestJson('/AT?' + query.toString(), {
		signPath: '/api/AT'
	});
}

function getQciInfo(simInfo) {
	var modelName = text((state.ufiData && (state.ufiData.MODEL || state.ufiData.model || state.ufiData.hardware_version)) || (state.versionInfo && state.versionInfo.model), '');
	var slot = resolveQciSlot(simInfo, modelName);

	return requestAtCommand('AT+CGEQOSRDP=1', slot).then(function(res) {
		if (res && res.error)
			throw new Error(text(res.error, '读取 QCI 失败'));

		return parseQciInfo(res && res.result);
	});
}

function setCellularMode(mode) {
	return postData({
		goformId: 'SET_BEARER_PREFERENCE',
		BearerPreference: text(mode, '').trim()
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '设置蜂窝模式');
	});
}

function setCellularConnection(enable) {
	return postData({
		goformId: enable ? 'CONNECT_NETWORK' : 'DISCONNECT_NETWORK'
	}).then(function(res) {
		return parseOptionalJsonResponse(res, enable ? '连接蜂窝网络' : '断开蜂窝网络');
	});
}

function runRootShellCommand(command, timeout) {
	return requestJson('/root_shell', {
		method: 'POST',
		signPath: '/api/root_shell',
		headers: {
			'Content-Type': 'application/json'
		},
		timeout: Number(timeout) || 10000,
		body: JSON.stringify({
			command: text(command, '').trim(),
			timeout: Number(timeout) || 10000
		})
	}).then(function(res) {
		if (res && res.error) {
			return {
				success: false,
				content: text(res.error, '')
			};
		}

		return {
			success: true,
			content: text(res && res.result, '')
		};
	});
}

function checkAdvancedAvailable() {
	return runRootShellCommand('whoami').then(function(res) {
		return !!(res && res.success && String(res.content).indexOf('root') >= 0);
	}).catch(function() {
		return false;
	});
}

function getBaseDeviceInfo() {
	return requestJson('/baseDeviceInfo', {
		signPath: '/api/baseDeviceInfo'
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
		getBaseDeviceInfo().catch(function() {
			return {};
		})
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

function getSmsInfo(page, pageSize) {
	var p = page || 0;
	var size = pageSize || 200;

	return requestJson('/goform/goform_get_cmd_process?multi_data=1&isTest=false&cmd=sms_data_total&page=' + p + '&data_per_page=' + size + '&mem_store=1&tags=100&order_by=order by id desc&_=' + Date.now(), {
		signPath: '/goform/goform_get_cmd_process'
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
			var meta;

			if (matched) {
				meta = getSmsTagMeta(matched.tag);

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

			return wait(1000).then(run);
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
		}).catch(function() {
			return null;
		});
	});

	return Promise.all(jobs);
}

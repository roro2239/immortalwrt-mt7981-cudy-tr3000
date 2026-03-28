/*
?????
????????????????????????????
??????????????????????
*/

function canAutoConnect() {
	return !!(
		state.backendPassword &&
		!state.connecting &&
		!state.connected &&
		!state.autoReconnectPaused &&
		(
			state.tokenMode === 'no_token' ||
			!state.needToken ||
			!!state.tokenHash
		)
	);
}

function scheduleReconnect(reason, delay) {
	var waitMs = Number(delay) || 1200;

	if (state.autoReconnectPaused || state.connecting || state.connected)
		return;

	if (state.reconnectTimer)
		window.clearTimeout(state.reconnectTimer);

	state.lastDisconnectReason = text(reason, 'auto');
	state.reconnectTimer = window.setTimeout(function() {
		state.reconnectTimer = null;
		if (!canAutoConnect())
			return;
		connectBackend();
	}, waitMs);
}

function clearReconnectTimer() {
	if (state.reconnectTimer) {
		window.clearTimeout(state.reconnectTimer);
		state.reconnectTimer = null;
	}
}

function resumeAutoConnect(reason) {
	if (state.connected || state.connecting)
		return;

	if (state.autoReconnectPaused && state.lastDisconnectReason !== 'manual')
		state.autoReconnectPaused = false;

	if (canAutoConnect())
		scheduleReconnect(reason || 'resume', 200);
}

function bindResumeEvents() {
	window.addEventListener('pageshow', function() {
		resumeAutoConnect('pageshow');
	});

	window.addEventListener('focus', function() {
		resumeAutoConnect('focus');
	});

	document.addEventListener('visibilitychange', function() {
		if (!document.hidden)
			resumeAutoConnect('visibilitychange');
	});
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
		if (canAutoConnect())
			return connectBackend();
		return null;
	}).catch(function(err) {
		state.error = text(err.message, '初始化失败');
		pushLog('WARN', state.error);
		renderSummary();
		showToast(state.error, 'error');
	});
}

function mountStandaloneApp() {
	var existing = document.getElementById('ufi-standalone-root');
	var root;

	if (existing)
		existing.remove();

	root = renderSkeleton();
	root.id = 'ufi-standalone-root';
	document.body.innerHTML = '';
	document.body.appendChild(root);
	return root;
}

function bootStandalone() {
	return ensureScript(CRYPTO_SRC).then(function() {
		mountStandaloneApp();
		bindResumeEvents();
		return boot();
	});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', function() {
		bootStandalone().catch(function(err) {
			console.error(err);
		});
	}, { once: true });
}
else {
	bootStandalone().catch(function(err) {
		console.error(err);
	});
}

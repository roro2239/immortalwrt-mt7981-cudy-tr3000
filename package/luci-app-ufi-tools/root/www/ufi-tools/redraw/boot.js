/*
?????
????????????????????????????
??????????????????????
*/


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

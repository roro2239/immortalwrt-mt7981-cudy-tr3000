function showToast(message, kind) {
	var toast;
	var palette = {
		success: '#0f766e',
		error: '#b91c1c',
		info: '#1d4ed8'
	};

	if (!els.toast)
		return;

	toast = document.createElement('div');
	toast.className = 'ufi-toast';
	toast.textContent = text(message, '');
	toast.style.background = palette[kind || 'info'] || palette.info;
	els.toast.appendChild(toast);

	window.setTimeout(function() {
		toast.classList.add('is-leaving');
		window.setTimeout(function() {
			toast.remove();
		}, 280);
	}, 2600);
}

function openPanel(name) {
	var wrap;

	if (!rootEl)
		return;

	wrap = rootEl.querySelector('.ufi-modal-wrap');

	Array.prototype.forEach.call(rootEl.querySelectorAll('.ufi-panel'), function(panel) {
		panel.hidden = panel.dataset.panel !== name;
	});

	if (wrap)
		wrap.hidden = false;

	if (name === 'sms') {
		loadSms().catch(function(err) {
			showToast(text(err && err.message, '读取短信失败'), 'error');
		});
		startSmsRefresh();
		return;
	}

	stopSmsRefresh();

	if (name === 'cellular') {
		loadCellularPanel().catch(function(err) {
			showToast(text(err && err.message, '读取蜂窝状态失败'), 'error');
		});
	}
}

function closePanels() {
	var wrap;

	stopSmsRefresh();

	if (!rootEl)
		return;

	wrap = rootEl.querySelector('.ufi-modal-wrap');
	if (wrap)
		wrap.hidden = true;

	Array.prototype.forEach.call(rootEl.querySelectorAll('.ufi-panel'), function(panel) {
		panel.hidden = true;
	});
}

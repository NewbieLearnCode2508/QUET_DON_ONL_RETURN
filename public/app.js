(function () {
    // ========== DOM elements ==========
    const readerEl = document.getElementById('reader');
    const scannerDot = document.getElementById('scanner-dot');
    const modeLabel = document.getElementById('mode-label');
    const currentOrderBadge = document.getElementById('current-order-badge');
    const btnStartScan = document.getElementById('btn-start-scan');
    const btnStopScan = document.getElementById('btn-stop-scan');
    const btnCompleteOrder = document.getElementById('btn-complete-order');
    const btnAddManual = document.getElementById('btn-add-manual');
    const manualInput = document.getElementById('manual-input');
    const orderListContent = document.getElementById('order-list-content');
    const countTodayEl = document.getElementById('count-today');
    const countTotalEl = document.getElementById('count-total');
    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnCopyAll = document.getElementById('btn-copy-all');
    const btnClearToday = document.getElementById('btn-clear-today');
    const btnClearAll = document.getElementById('btn-clear-all');
    const toastContainer = document.getElementById('toast-container');
    const btnModeNormal = document.getElementById('btn-mode-normal');
    const btnModeReturn = document.getElementById('btn-mode-return');

    // Login elements
    const loginOverlay = document.getElementById('login-overlay');
    const loginUsername = document.getElementById('login-username');
    const loginPassword = document.getElementById('login-password');
    const loginBtn = document.getElementById('login-btn');
    const loginError = document.getElementById('login-error');

    // ========== State ==========
    const API_BASE = '';
    let html5QrCode = null;
    let isScanning = false;
    let ordersData = [];
    let currentMode = 'order';
    let currentOrderId = null;
    let lastScannedCode = '';
    let lastScannedTime = 0;
    const DUPLICATE_THRESHOLD_MS = 2500;
    const pendingCodes = new Set();
    const openDayDates = new Set();
    let hasInitializedOpenDays = false;
    let isReturnMode = false;
    let currentTab = 'online';
    let selectedOrderIds = new Set();
    let currentUser = null;
    let isLoggedIn = false;

    // ========== Audio ==========
    let audioCtx = null;
    function initAudio() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }
    function playBeep(type) {
        // ... (giữ nguyên code cũ)
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        if (type === 'order-success') {
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine'; osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.3, now + i * 0.12);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.2);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(now + i * 0.12); osc.stop(now + i * 0.12 + 0.2);
            });
        } else if (type === 'product-new') {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine'; osc.frequency.value = 1000;
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 0.15);
        } else if (type === 'product-increase') {
            [0, 0.08].forEach(offset => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine'; osc.frequency.value = 1200;
                gain.gain.setValueAtTime(0.25, now + offset);
                gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.1);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(now + offset); osc.stop(now + offset + 0.1);
            });
        } else if (type === 'product-decrease') {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine'; osc.frequency.value = 800;
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 0.15);
        } else if (type === 'error') {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, now);
            osc.frequency.linearRampToValueAtTime(100, now + 0.4);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 0.5);
        } else if (type === 'duplicate') {
            [0, 0.15].forEach((offset, i) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'square'; osc.frequency.value = i === 0 ? 880 : 660;
                gain.gain.setValueAtTime(0.2, now + offset);
                gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.08);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(now + offset); osc.stop(now + offset + 0.1);
            });
        }
    }

    // ========== API ==========
    async function fetchOrders() {
        try {
            const res = await fetch(`${API_BASE}/api/orders`);
            if (!res.ok) throw new Error('Lỗi tải dữ liệu');
            const newOrders = await res.json();
            ordersData = newOrders;
            const activeEl = document.activeElement;
            const isAnyInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
            if (!isAnyInputFocused) {
                renderOrderList();
                updateModeUI();
            } else {
                updateStats();
            }
        } catch (e) { console.error(e); }
    }
    async function createOrder(code, source = 'online') {
        const res = await fetch(`${API_BASE}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, source })
        });
        if (!res.ok) throw new Error('Tạo đơn thất bại');
        return await res.json();
    }
    async function addItemToOrder(orderId, code) {
        const res = await fetch(`${API_BASE}/api/orders/${orderId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        if (!res.ok) throw new Error('Thêm sản phẩm thất bại');
        return await res.json();
    }
    async function updateItemQuantity(orderId, code, quantity) {
        const res = await fetch(`${API_BASE}/api/orders/${orderId}/items/${encodeURIComponent(code)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quantity })
        });
        if (!res.ok) throw new Error('Cập nhật số lượng thất bại');
        return await res.json();
    }
    async function completeOrder(orderId) {
        await fetch(`${API_BASE}/api/orders/${orderId}/complete`, { method: 'PUT' });
    }
    async function deleteOrder(id, role) {
        const res = await fetch(`${API_BASE}/api/orders/${id}`, {
            method: 'DELETE',
            headers: { 'role': role }
        });
        if (!res.ok) throw new Error('Xóa thất bại');
        return res.json();
    }
    async function clearToday(role) {
        const res = await fetch(`${API_BASE}/api/orders/today`, {
            method: 'DELETE',
            headers: { 'role': role }
        });
        return (await res.json()).removed;
    }
    async function clearAll(role) {
        await fetch(`${API_BASE}/api/orders`, {
            method: 'DELETE',
            headers: { 'role': role }
        });
    }

    // ========== Xác thực ==========
    async function login(username, password) {
        try {
            const res = await fetch(`${API_BASE}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (data.success) {
                currentUser = { username: data.username, role: data.role };
                isLoggedIn = true;
                loginOverlay.style.display = 'none';
                showToast(`👋 Chào ${data.username} (${data.role === 'ql' ? 'Quản lý' : 'Nhân viên'})`, 'success');
                updateUIBasedOnRole();
                fetchOrders();
                if (window._fetchInterval) clearInterval(window._fetchInterval);
                window._fetchInterval = setInterval(fetchOrders, 2000);
            } else {
                loginError.textContent = data.message || 'Sai tài khoản hoặc mật khẩu';
                loginError.style.display = 'block';
            }
        } catch (e) {
            loginError.textContent = 'Lỗi kết nối server';
            loginError.style.display = 'block';
        }
    }

    function updateUIBasedOnRole() {
        const isQL = currentUser && currentUser.role === 'ql';
        const adminButtons = [btnClearToday, btnClearAll];
        adminButtons.forEach(btn => {
            if (btn) {
                btn.style.display = isQL ? 'inline-flex' : 'none';
            }
        });
    }

    async function verifyPassword() {
        const pwd = prompt('🔒 Nhập mật khẩu quản trị:');
        if (!pwd) return false;
        try {
            const res = await fetch(`${API_BASE}/api/verify-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd })
            });
            const result = await res.json();
            return result.valid === true;
        } catch {
            return false;
        }
    }

    // ========== UI helpers ==========
    function showToast(msg, type = 'info') {
        const t = document.createElement('div');
        t.className = `toast toast-${type}`;
        t.textContent = msg;
        toastContainer.appendChild(t);
        setTimeout(() => t.remove(), 2300);
    }
    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    let filterCode = '';
    let filterMinQty = '';
    let filterMaxQty = '';

    function renderFilterBar() {
        const ordersToShow = ordersData.filter(o => o.source === currentTab);
        const dates = [...new Set(ordersToShow.map(o => o.date))].sort((a, b) => b.localeCompare(a));
        const today = new Date().toISOString().split('T')[0];
        return `
        <div class="filter-bar">
            <input type="text" id="filter-code" placeholder="Lọc mã đơn..." value="${escapeHtml(filterCode)}">
            <input type="number" id="filter-min-qty" placeholder="SL tối thiểu..." min="0" value="${filterMinQty}">
            <input type="number" id="filter-max-qty" placeholder="SL tối đa..." min="0" value="${filterMaxQty}">
            <button class="btn btn-xs btn-outline" id="btn-apply-filter">🔍 Lọc</button>
            <button class="btn btn-xs btn-outline" id="btn-clear-filter">❌ Xóa lọc</button>
        </div>
        <div class="select-all-bar">
            ${dates.map(date => {
            const isToday = date === today;
            const label = isToday ? 'Hôm nay' : date;
            return `<button class="btn btn-xs btn-outline select-all-day" data-date="${date}">✓ ${label}</button>`;
        }).join('')}
        </div>`;
    }

    function updateModeUI() {
        if (isReturnMode) {
            modeLabel.textContent = '🔄 Quét hàng trả';
            if (currentMode === 'product') {
                const order = ordersData.find(o => o.id === currentOrderId);
                if (order) {
                    const totalItems = order.items.reduce((sum, it) => sum + it.quantity, 0);
                    currentOrderBadge.textContent = `📦 ${order.code} (${totalItems} SP)`;
                    currentOrderBadge.style.display = 'inline-block';
                }
                btnCompleteOrder.style.display = 'inline-flex';
                manualInput.placeholder = 'Nhập mã sản phẩm...';
            } else {
                currentOrderBadge.style.display = 'none';
                btnCompleteOrder.style.display = 'none';
                manualInput.placeholder = 'Nhập mã đơn hàng...';
            }
            return;
        }
        if (currentMode === 'order') {
            modeLabel.textContent = 'Quét mã đơn hàng';
            currentOrderBadge.style.display = 'none';
            btnCompleteOrder.style.display = 'none';
            manualInput.placeholder = 'Nhập mã đơn hàng...';
        } else {
            modeLabel.textContent = 'Quét sản phẩm cho đơn';
            const order = ordersData.find(o => o.id === currentOrderId);
            if (order) {
                const totalItems = order.items.reduce((sum, it) => sum + it.quantity, 0);
                currentOrderBadge.textContent = `📦 ${order.code} (${totalItems} SP)`;
                currentOrderBadge.style.display = 'inline-block';
            }
            btnCompleteOrder.style.display = 'inline-flex';
            manualInput.placeholder = 'Nhập mã sản phẩm...';
        }
    }

    function updateStats() {
        const today = new Date().toISOString().split('T')[0];
        const onlineCount = ordersData.filter(o => o.date === today && o.source === 'online').length;
        const returnCount = ordersData.filter(o => o.date === today && o.source === 'return').length;
        countTodayEl.textContent = `${onlineCount} (trả: ${returnCount})`;
        countTotalEl.textContent = ordersData.length;
    }

    function groupByDate(orders) {
        const map = {};
        orders.forEach(o => {
            const d = o.date;
            if (!map[d]) map[d] = [];
            map[d].push(o);
        });
        return Object.keys(map).sort((a, b) => b.localeCompare(a)).map(k => ({ date: k, orders: map[k] }));
    }

    // ========== Render ==========
    function renderOrderList() {
        const filteredData = ordersData.filter(o => o.source === currentTab);
        const groups = groupByDate(filteredData);
        const availableDates = new Set(groups.map(group => group.date));
        openDayDates.forEach(date => {
            if (!availableDates.has(date)) openDayDates.delete(date);
        });

        if (!hasInitializedOpenDays) {
            const today = new Date().toISOString().split('T')[0];
            const firstGroup = groups.find(group => group.date === today) || groups[0];
            if (firstGroup) openDayDates.add(firstGroup.date);
            hasInitializedOpenDays = true;
        }

        let html = renderFilterBar();
        if (groups.length === 0) {
            openDayDates.clear();
            hasInitializedOpenDays = false;
            html += '<div class="empty-state" style="padding: 40px 20px; text-align: center;"><div class="icon-empty" style="font-size: 3rem; margin-bottom: 10px;">📭</div><p>Chưa có đơn hàng nào.</p></div>';
        } else {
            groups.forEach((group) => {
                const dateObj = new Date(group.date + 'T00:00:00');
                const today = new Date().toISOString().split('T')[0];
                const isToday = group.date === today;
                const label = isToday ? 'Hôm nay' : dateObj.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
                const isOpen = openDayDates.has(group.date);

                const filteredOrders = group.orders.filter(order => {
                    const totalQty = order.items.reduce((sum, it) => sum + it.quantity, 0);
                    if (filterCode && !order.code.toLowerCase().includes(filterCode.toLowerCase())) return false;
                    if (filterMinQty && totalQty < Number(filterMinQty)) return false;
                    if (filterMaxQty && totalQty > Number(filterMaxQty)) return false;
                    return true;
                });

                html += `<div class="day-group">
                    <div class="day-group-header" data-date="${group.date}" onclick="window.toggleDayGroup(this)">
                        <div class="day-info"><span>📅 ${label}</span><span class="day-badge">${group.orders.length} đơn</span></div>
                        <span class="arrow ${isOpen ? 'open' : ''}">▼</span>
                    </div>
                    <div class="day-group-items ${isOpen ? 'open' : ''}" data-date="${group.date}">`;
                filteredOrders.forEach((order, i) => {
                    const statusClass = order.status === 'completed' ? 'status-completed' : 'status-pending';
                    const isSelected = selectedOrderIds.has(order.id);
                    const totalQty = order.items.reduce((sum, it) => sum + it.quantity, 0);
                    const isQL = currentUser && currentUser.role === 'ql';
                    html += `<div class="order-item" data-order-id="${order.id}">
                        <span class="order-index">${group.orders.length - i}</span>
                        <div style="flex:1;">
                            <input type="checkbox" class="order-select" data-order-id="${order.id}" ${isSelected ? 'checked' : ''} onchange="window.toggleOrderSelect('${order.id}', this.checked)">
                            <span class="order-code">📦 ${escapeHtml(order.code)}</span>
                            <span class="status-badge ${statusClass}" style="margin-left:8px;">${order.status === 'completed' ? 'Đã xong' : 'Đang dở'}</span>
                            <span style="margin-left:8px; font-size:0.75rem; color:var(--text-muted);">(${totalQty} SP)</span>
                            <div class="product-list">`;
                    if (order.items && order.items.length > 0) {
                        order.items.forEach(item => {
                            html += `<div class="product-item">
                                📎 <span class="product-code">${escapeHtml(item.code)}</span>
                                <button class="btn btn-xs btn-outline" onclick="window.changeItemQuantity('${order.id}', '${escapeHtml(item.code)}', -1)" style="padding:2px 6px;">−</button>
                                <input type="number" value="${item.quantity}" min="0" step="1"
                                    data-order-id="${order.id}" data-item-code="${escapeHtml(item.code)}"
                                    class="qty-input" style="width:60px;"
                                    onchange="window.updateItemQuantity(this)" onfocus="this.select()">
                                <button class="btn btn-xs btn-outline" onclick="window.changeItemQuantity('${order.id}', '${escapeHtml(item.code)}', 1)" style="padding:2px 6px;">+</button>
                                <span style="color:#94a3b8; font-size:0.75rem;">${item.time}</span>
                            </div>`;
                        });
                    } else {
                        html += '<div style="color:#94a3b8;">Chưa có sản phẩm</div>';
                    }
                    html += `</div></div>
                        <div class="order-item-right">
                            <span class="order-time">🕐 ${order.time}</span>
                            ${isQL ? `<button class="btn btn-xs btn-danger-outline" onclick="window.deleteOrderById('${order.id}')">✕</button>` : ''}
                        </div>
                    </div>`;
                });
                html += '</div></div>';
            });
        }
        orderListContent.innerHTML = html;
        attachFilterEvents();
        updateStats();
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === currentTab);
        });
    }

    function attachFilterEvents() {
        const filterCodeInput = document.getElementById('filter-code');
        const filterMinQtyInput = document.getElementById('filter-min-qty');
        const filterMaxQtyInput = document.getElementById('filter-max-qty');
        const btnApplyFilter = document.getElementById('btn-apply-filter');
        const btnClearFilter = document.getElementById('btn-clear-filter');
        const selectAllButtons = document.querySelectorAll('.select-all-day');

        const applyFilter = () => {
            filterCode = filterCodeInput ? filterCodeInput.value : '';
            filterMinQty = filterMinQtyInput ? filterMinQtyInput.value : '';
            filterMaxQty = filterMaxQtyInput ? filterMaxQtyInput.value : '';
            renderOrderList();
        };

        if (filterCodeInput) filterCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilter(); });
        if (filterMinQtyInput) filterMinQtyInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilter(); });
        if (filterMaxQtyInput) filterMaxQtyInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilter(); });
        if (btnApplyFilter) btnApplyFilter.addEventListener('click', applyFilter);
        if (btnClearFilter) {
            btnClearFilter.addEventListener('click', () => {
                filterCode = ''; filterMinQty = ''; filterMaxQty = '';
                if (filterCodeInput) filterCodeInput.value = '';
                if (filterMinQtyInput) filterMinQtyInput.value = '';
                if (filterMaxQtyInput) filterMaxQtyInput.value = '';
                renderOrderList();
            });
        }
        selectAllButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const date = btn.dataset.date;
                const ordersOfDay = ordersData.filter(o => o.date === date && o.source === currentTab);
                ordersOfDay.forEach(o => selectedOrderIds.add(o.id));
                renderOrderList();
                showToast(`✓ Đã chọn ${ordersOfDay.length} đơn`, 'success');
            });
        });
    }

    // ========== Exposed functions ==========
    window.toggleDayGroup = function (header) {
        const date = header.dataset.date;
        const items = document.querySelector(`.day-group-items[data-date="${date}"]`);
        const arrow = header.querySelector('.arrow');
        if (items) {
            const willOpen = !items.classList.contains('open');
            items.classList.toggle('open');
            arrow.classList.toggle('open');
            if (willOpen) openDayDates.add(date);
            else openDayDates.delete(date);
        }
    };
    window.toggleOrderSelect = function (orderId, checked) {
        if (checked) selectedOrderIds.add(orderId);
        else selectedOrderIds.delete(orderId);
    };
    window.deleteOrderById = async function (id) {
        if (!currentUser || currentUser.role !== 'ql') {
            showToast('⚠️ Chỉ quản lý mới có quyền xóa', 'warning');
            return;
        }
        if (!confirm('Bạn có chắc muốn xóa đơn hàng này?')) return;
        const ok = await verifyPassword();
        if (!ok) {
            showToast('❌ Mật khẩu sai', 'error');
            return;
        }
        try {
            await deleteOrder(id, currentUser.role);
            await fetchOrders();
            showToast('✅ Đã xóa đơn hàng', 'success');
        } catch (e) {
            showToast('❌ Lỗi xóa đơn', 'error');
        }
    };
    window.changeItemQuantity = async function (orderId, itemCode, delta) {
        const order = ordersData.find(o => o.id === orderId);
        if (!order) return;
        const item = order.items.find(it => it.code === itemCode);
        if (!item) return;
        const newQty = item.quantity + delta;
        if (newQty < 0) return;
        try {
            await updateItemQuantity(orderId, itemCode, newQty);
            await fetchOrders();
            if (newQty === 0) {
                playBeep('product-decrease');
                showToast('🗑 Đã xóa sản phẩm', 'success');
            } else if (delta > 0) {
                playBeep('product-increase');
                showToast(`🔺 ${itemCode}: ${newQty}`, 'info');
            } else {
                playBeep('product-decrease');
                showToast(`🔻 ${itemCode}: ${newQty}`, 'info');
            }
        } catch (e) {
            showToast('❌ Lỗi cập nhật', 'error');
        }
    };
    window.updateItemQuantity = async function (inputEl) {
        const orderId = inputEl.dataset.orderId;
        const itemCode = inputEl.dataset.itemCode;
        let newQty = parseInt(inputEl.value, 10);
        if (isNaN(newQty) || newQty < 0) {
            showToast('⚠️ Số lượng không hợp lệ', 'warning');
            const order = ordersData.find(o => o.id === orderId);
            const item = order?.items.find(it => it.code === itemCode);
            inputEl.value = item ? item.quantity : 0;
            return;
        }
        try {
            await updateItemQuantity(orderId, itemCode, newQty);
            await fetchOrders();
            if (newQty === 0) {
                playBeep('product-decrease');
                showToast('🗑 Đã xóa sản phẩm', 'success');
            } else {
                playBeep('product-increase');
                showToast('✅ Đã cập nhật số lượng', 'success');
            }
        } catch (e) {
            showToast('❌ Lỗi cập nhật', 'error');
            const order = ordersData.find(o => o.id === orderId);
            const item = order?.items.find(it => it.code === itemCode);
            inputEl.value = item ? item.quantity : 0;
        }
    };

    // ========== Xử lý quét/nhập mã ==========
    async function processCode(code) {
        // ... (giữ nguyên)
        const trimmed = code.trim();
        if (!trimmed) return;
        if (currentMode === 'order') {
            if (pendingCodes.has(trimmed)) return;
            pendingCodes.add(trimmed);
            try {
                if (isReturnMode) {
                    if (ordersData.some(o => o.code === trimmed && o.source === 'return')) {
                        playBeep('duplicate');
                        showToast('⚠️ Mã đơn trả hàng đã tồn tại', 'warning');
                        return;
                    }
                    const order = await createOrder(trimmed, 'return');
                    await fetchOrders();
                    playBeep('order-success');
                    showToast(`✅ Đã tạo đơn trả hàng: ${order.code}`, 'success');
                    currentMode = 'product';
                    currentOrderId = order.id;
                    updateModeUI();
                    return;
                }

                if (ordersData.some(o => o.code === trimmed && o.source === 'online')) {
                    playBeep('duplicate');
                    showToast('⚠️ Mã đơn đã tồn tại', 'warning');
                    return;
                }
                const order = await createOrder(trimmed, 'online');
                await fetchOrders();
                playBeep('order-success');
                showToast(`✅ Đã tạo đơn: ${order.code}`, 'success');
                currentMode = 'product';
                currentOrderId = order.id;
                updateModeUI();
            } catch {
                playBeep('error');
                showToast('❌ Lỗi tạo đơn', 'error');
            } finally {
                pendingCodes.delete(trimmed);
            }
            return;
        }

        if (!currentOrderId) {
            showToast('⚠️ Vui lòng quét đơn hàng trước', 'warning');
            return;
        }
        if (pendingCodes.has(trimmed)) return;
        pendingCodes.add(trimmed);
        try {
            const result = await addItemToOrder(currentOrderId, trimmed);
            await fetchOrders();
            if (result.updated) {
                playBeep('product-increase');
                showToast(`🔺 ${trimmed}: số lượng +1 (hiện ${result.quantity})`, 'info');
            } else {
                playBeep('product-new');
                showToast(`📎 Đã thêm SP: ${trimmed}`, 'success');
            }
            if (navigator.vibrate) navigator.vibrate(80);
            updateModeUI();
        } catch {
            playBeep('error');
            showToast('❌ Lỗi thêm sản phẩm', 'error');
        } finally {
            pendingCodes.delete(trimmed);
        }
    }

    function onScanSuccess(decodedText) {
        const now = Date.now();
        const code = decodedText.trim();
        if (code === lastScannedCode && now - lastScannedTime < DUPLICATE_THRESHOLD_MS) {
            if (pendingCodes.has(code)) return;
            if (currentMode === 'order') {
                const source = isReturnMode ? 'return' : 'online';
                if (ordersData.some(o => o.code === code && o.source === source)) {
                    playBeep('duplicate');
                    showToast('⚠️ Mã đơn đã tồn tại', 'warning');
                }
            }
            return;
        }
        lastScannedCode = code;
        lastScannedTime = now;
        processCode(code);
    }
    function onScanError() { }

    async function startScanner() {
        initAudio();
        if (isScanning) return;
        if (!navigator.mediaDevices?.getUserMedia) {
            showToast('❌ Trình duyệt không hỗ trợ camera', 'error');
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(t => t.stop());
        } catch {
            showToast('❌ Không thể truy cập camera', 'error');
            return;
        }
        if (html5QrCode) {
            try {
                await html5QrCode.stop();
                html5QrCode.clear();
            } catch (e) { }
            html5QrCode = null;
        }
        html5QrCode = new Html5Qrcode("reader");
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 180 },
            aspectRatio: 1.0
        };
        try {
            await html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess, onScanError);
        } catch {
            try {
                await html5QrCode.start({ facingMode: "user" }, config, onScanSuccess, onScanError);
            } catch {
                showToast('❌ Không thể khởi động camera', 'error');
                return;
            }
        }
        isScanning = true;
        scannerDot.classList.add('active');
        btnStartScan.disabled = true;
        btnStopScan.disabled = false;
    }

    async function stopScanner() {
        if (html5QrCode && isScanning) {
            try {
                await html5QrCode.stop();
                html5QrCode.clear();
            } catch (e) { }
            isScanning = false;
            scannerDot.classList.remove('active');
            btnStartScan.disabled = false;
            btnStopScan.disabled = true;
            readerEl.innerHTML = '';
            html5QrCode = null;
        }
    }

    async function completeCurrentOrder() {
        if (!currentOrderId) return;
        await completeOrder(currentOrderId);
        await fetchOrders();
        showToast('✅ Đã hoàn tất đơn hàng', 'success');
        currentMode = 'order';
        currentOrderId = null;
        updateModeUI();
    }

    async function manualAdd() {
        const code = manualInput.value.trim();
        if (!code) {
            showToast('⚠️ Nhập mã', 'warning');
            manualInput.focus();
            return;
        }
        if (pendingCodes.has(code)) {
            showToast('⏳ Đang xử lý mã này', 'warning');
            return;
        }
        if (currentMode === 'order') {
            const source = isReturnMode ? 'return' : 'online';
            if (ordersData.some(o => o.code === code && o.source === source)) {
                playBeep('duplicate');
                showToast('⚠️ Mã đơn đã tồn tại', 'warning');
                manualInput.value = '';
                manualInput.focus();
                return;
            }
        }
        initAudio();
        await processCode(code);
        manualInput.value = '';
        manualInput.focus();
    }

    function exportCsv() {
        const ordersToExport = selectedOrderIds.size > 0
            ? ordersData.filter(o => selectedOrderIds.has(o.id))
            : ordersData.filter(o => o.source === currentTab);
        if (ordersToExport.length === 0) return showToast('⚠️ Trống', 'warning');
        let csv = '\uFEFFSTT,Mã đơn,Ngày,Giờ,Trạng thái,Tổng SP,Danh sách SP (code x số lượng)\n';
        ordersToExport.forEach((o, i) => {
            const totalQty = o.items.reduce((sum, it) => sum + it.quantity, 0);
            const spList = o.items.map(it => `${it.code} x${it.quantity}`).join('; ');
            csv += `${i + 1},"${o.code.replace(/"/g, '""')}",${o.date},${o.time},${o.status},${totalQty},"${spList.replace(/"/g, '""')}"\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentTab}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        const exportedCount = ordersToExport.length;
        selectedOrderIds.clear();
        renderOrderList();
        showToast(`📥 Đã xuất ${exportedCount} đơn`, 'success');
    }

    function copyAll() {
        const ordersToCopy = selectedOrderIds.size > 0
            ? ordersData.filter(o => selectedOrderIds.has(o.id))
            : ordersData.filter(o => o.source === currentTab);
        if (ordersToCopy.length === 0) return showToast('⚠️ Trống', 'warning');
        const text = ordersToCopy.map(o => {
            const total = o.items.reduce((s, it) => s + it.quantity, 0);
            return `Đơn: ${o.code} (${total} SP) - ${o.date} ${o.time}`;
        }).join('\n');
        navigator.clipboard.writeText(text)
            .then(() => {
                selectedOrderIds.clear();
                renderOrderList();
                showToast(`📋 Đã sao chép ${ordersToCopy.length} đơn`, 'success');
            })
            .catch(() => {
                const ta = document.createElement('textarea');
                ta.value = text; document.body.appendChild(ta); ta.select();
                document.execCommand('copy'); document.body.removeChild(ta);
                selectedOrderIds.clear();
                renderOrderList();
                showToast(`📋 Đã sao chép ${ordersToCopy.length} đơn`, 'success');
            });
    }

    // ========== Event listeners ==========
    // Login
    loginBtn.addEventListener('click', () => {
        const user = loginUsername.value.trim();
        const pass = loginPassword.value.trim();
        if (!user || !pass) {
            loginError.textContent = 'Vui lòng nhập tài khoản và mật khẩu';
            loginError.style.display = 'block';
            return;
        }
        login(user, pass);
    });
    loginPassword.addEventListener('keydown', e => {
        if (e.key === 'Enter') loginBtn.click();
    });
    loginUsername.addEventListener('keydown', e => {
        if (e.key === 'Enter') loginPassword.focus();
    });

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const tab = this.dataset.tab;
            if (tab === currentTab) return;
            currentTab = tab;
            openDayDates.clear();
            hasInitializedOpenDays = false;
            selectedOrderIds.clear();
            renderOrderList();
            showToast(`Đã chuyển sang danh sách ${tab === 'online' ? 'đơn online' : 'hàng trả'}`, 'info');
        });
    });

    // Chế độ quét
    if (btnModeNormal && btnModeReturn) {
        btnModeNormal.style.borderColor = '#2563eb';
        btnModeNormal.style.color = '#2563eb';
        btnModeNormal.addEventListener('click', () => {
            if (!isReturnMode) return;
            isReturnMode = false;
            updateModeUI();
            btnModeNormal.style.borderColor = '#2563eb';
            btnModeNormal.style.color = '#2563eb';
            btnModeReturn.style.borderColor = 'var(--border)';
            btnModeReturn.style.color = 'var(--text)';
            showToast('Đã chuyển sang chế độ Quét đơn hàng', 'info');
        });
        btnModeReturn.addEventListener('click', () => {
            if (isReturnMode) return;
            isReturnMode = true;
            updateModeUI();
            btnModeReturn.style.borderColor = '#2563eb';
            btnModeReturn.style.color = '#2563eb';
            btnModeNormal.style.borderColor = 'var(--border)';
            btnModeNormal.style.color = 'var(--text)';
            showToast('Đã chuyển sang chế độ Quét hàng trả', 'info');
        });
    }

    // Các sự kiện chính
    if (btnStartScan) btnStartScan.addEventListener('click', startScanner);
    if (btnStopScan) btnStopScan.addEventListener('click', stopScanner);
    if (btnCompleteOrder) btnCompleteOrder.addEventListener('click', completeCurrentOrder);
    if (btnAddManual) btnAddManual.addEventListener('click', manualAdd);
    if (manualInput) {
        manualInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); manualAdd(); }
        });
    }
    if (btnExportCsv) btnExportCsv.addEventListener('click', exportCsv);
    if (btnCopyAll) btnCopyAll.addEventListener('click', copyAll);

    // Xóa hôm nay (QL)
    if (btnClearToday) {
        btnClearToday.addEventListener('click', async () => {
            if (!currentUser || currentUser.role !== 'ql') {
                showToast('⚠️ Chỉ quản lý mới có quyền xóa', 'warning');
                return;
            }
            if (!confirm('Bạn có chắc muốn xóa tất cả đơn ONLINE trong hôm nay?')) return;
            const ok = await verifyPassword();
            if (!ok) {
                showToast('❌ Mật khẩu sai', 'error');
                return;
            }
            const removed = await clearToday(currentUser.role);
            if (!removed) showToast('⚠️ Không có đơn online hôm nay', 'warning');
            else { await fetchOrders(); showToast(`🗑 Đã xóa ${removed} đơn online`, 'success'); }
        });
    }

    // Xóa tất cả (QL)
    if (btnClearAll) {
        btnClearAll.addEventListener('click', async () => {
            if (!currentUser || currentUser.role !== 'ql') {
                showToast('⚠️ Chỉ quản lý mới có quyền xóa', 'warning');
                return;
            }
            if (!ordersData.length) return showToast('⚠️ Trống', 'warning');
            if (!confirm('Bạn có chắc muốn xóa TOÀN BỘ dữ liệu (cả online và hàng trả)?')) return;
            const ok = await verifyPassword();
            if (!ok) {
                showToast('❌ Mật khẩu sai', 'error');
                return;
            }
            await clearAll(currentUser.role);
            await fetchOrders();
            showToast('🗑 Đã xóa tất cả', 'success');
        });
    }

    // Ẩn nút admin ban đầu
    if (btnClearToday) btnClearToday.style.display = 'none';
    if (btnClearAll) btnClearAll.style.display = 'none';

    // Cleanup
    window.addEventListener('beforeunload', () => {
        if (html5QrCode && isScanning) {
            html5QrCode.stop().catch(() => { });
            html5QrCode.clear();
        }
        if (window._fetchInterval) clearInterval(window._fetchInterval);
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && isScanning) {
            stopScanner();
        }
    });

    // Khởi tạo
    updateModeUI();
})();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5500;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ========== Google Sheets Config ==========
const SHEET_ID_ONLINE = process.env.SHEET_ID_ONLINE;
const SHEET_ID_RETURN = process.env.SHEET_ID_RETURN;

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// ========== Helper Functions ==========
function getSheetId(source) {
    return source === 'online' ? SHEET_ID_ONLINE : SHEET_ID_RETURN;
}

async function readOrdersByDate(source, date) {
    const sheetId = getSheetId(source);
    const sheetName = `${source}_${date}`; // e.g., online_2026-06-23
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: `${sheetName}!A:H`,
        });
        const rows = response.data.values;
        if (!rows || rows.length < 2) return [];
        const orders = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            let items = [];
            try { items = row[7] ? JSON.parse(row[7]) : []; } catch (e) { }
            orders.push({
                id: row[0] || '',
                code: row[1] || '',
                date: row[2] || '',
                time: row[3] || '',
                status: row[4] || 'pending',
                source: row[5] || source,
                items: items,
            });
        }
        return orders;
    } catch (e) {
        // Sheet chưa tồn tại -> trả về rỗng
        return [];
    }
}

async function writeOrdersByDate(orders, source, date) {
    const sheetId = getSheetId(source);
    const sheetName = `${source}_${date}`;

    // Tạo sheet nếu chưa tồn tại
    try {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: sheetId,
            requestBody: {
                requests: [
                    {
                        addSheet: {
                            properties: { title: sheetName }
                        }
                    }
                ]
            }
        });
    } catch (e) {
        // Sheet đã tồn tại
    }

    const header = ['id', 'code', 'date', 'time', 'status', 'source', 'items'];
    const rows = orders.map(order => [
        order.id,
        order.code,
        order.date,
        order.time,
        order.status,
        order.source,
        JSON.stringify(order.items)
    ]);
    const data = [header, ...rows];

    await sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId,
        range: `${sheetName}!A:H`,
    });
    await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${sheetName}!A:H`,
        valueInputOption: 'RAW',
        requestBody: { values: data },
    });
}

// ========== Xác thực ==========
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.post('/api/verify-password', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ valid: true });
    } else {
        res.status(401).json({ valid: false });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    // Demo: nếu bạn dùng users.json thì đọc file đó, hoặc hardcode 2 user
    if (username === 'ql' && password === ADMIN_PASSWORD) {
        res.json({ success: true, role: 'ql', username: 'ql' });
    } else if (username === 'nv' && password === '123456') {
        res.json({ success: true, role: 'nv', username: 'nv' });
    } else {
        res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu' });
    }
});

// ========== API ==========
// Lấy tất cả đơn hôm nay (cả online và return)
app.get('/api/orders', async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const onlineOrders = await readOrdersByDate('online', today);
    const returnOrders = await readOrdersByDate('return', today);
    res.json([...onlineOrders, ...returnOrders]);
});

// Tạo đơn mới
app.post('/api/orders', async (req, res) => {
    const { code, source } = req.body;
    if (!code || !code.trim()) {
        return res.status(400).json({ error: 'Mã đơn không được để trống' });
    }
    const today = new Date().toISOString().split('T')[0];
    const orders = await readOrdersByDate(source, today);
    const newOrder = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        code: code.trim(),
        date: today,
        time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        status: 'pending',
        items: [],
        source: source || 'online',
    };
    orders.unshift(newOrder);
    await writeOrdersByDate(orders, source, today);
    res.status(201).json(newOrder);
});

// Thêm sản phẩm
app.post('/api/orders/:id/items', async (req, res) => {
    const { id } = req.params;
    const { code } = req.body;
    if (!code || !code.trim()) {
        return res.status(400).json({ error: 'Mã sản phẩm không được để trống' });
    }
    // Tìm đơn trong cả online và return hôm nay
    const today = new Date().toISOString().split('T')[0];
    let orders = await readOrdersByDate('online', today);
    let order = orders.find(o => o.id === id);
    let source = 'online';
    if (!order) {
        orders = await readOrdersByDate('return', today);
        order = orders.find(o => o.id === id);
        source = 'return';
    }
    if (!order) {
        return res.status(404).json({ error: 'Đơn hàng không tồn tại' });
    }
    const trimmedCode = code.trim();
    const existingItem = order.items.find(item => item.code === trimmedCode);
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        order.items.push({
            code: trimmedCode,
            quantity: 1,
            time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        });
    }
    await writeOrdersByDate(orders, source, today);
    const updatedItem = order.items.find(item => item.code === trimmedCode);
    res.json({ ...updatedItem, updated: !!existingItem });
});

// Cập nhật số lượng
app.put('/api/orders/:id/items/:code', async (req, res) => {
    const { id, code } = req.params;
    const { quantity } = req.body;
    const newQty = Number(quantity);
    if (isNaN(newQty) || newQty < 0) {
        return res.status(400).json({ error: 'Số lượng không hợp lệ' });
    }
    const today = new Date().toISOString().split('T')[0];
    let orders = await readOrdersByDate('online', today);
    let order = orders.find(o => o.id === id);
    let source = 'online';
    if (!order) {
        orders = await readOrdersByDate('return', today);
        order = orders.find(o => o.id === id);
        source = 'return';
    }
    if (!order) {
        return res.status(404).json({ error: 'Đơn hàng không tồn tại' });
    }
    const itemIndex = order.items.findIndex(item => item.code === code);
    if (itemIndex === -1) {
        return res.status(404).json({ error: 'Sản phẩm không tồn tại' });
    }
    if (newQty === 0) {
        order.items.splice(itemIndex, 1);
    } else {
        order.items[itemIndex].quantity = newQty;
    }
    await writeOrdersByDate(orders, source, today);
    res.json(order.items[itemIndex] || { code, quantity: 0 });
});

// Hoàn tất đơn
app.put('/api/orders/:id/complete', async (req, res) => {
    const { id } = req.params;
    const today = new Date().toISOString().split('T')[0];
    let orders = await readOrdersByDate('online', today);
    let order = orders.find(o => o.id === id);
    let source = 'online';
    if (!order) {
        orders = await readOrdersByDate('return', today);
        order = orders.find(o => o.id === id);
        source = 'return';
    }
    if (!order) return res.status(404).json({ error: 'Đơn hàng không tồn tại' });
    order.status = 'completed';
    await writeOrdersByDate(orders, source, today);
    res.json(order);
});

// Xóa đơn (yêu cầu role ql)
app.delete('/api/orders/:id', async (req, res) => {
    const role = req.headers.role;
    if (role !== 'ql') {
        return res.status(403).json({ error: 'Chỉ quản lý mới có quyền xóa' });
    }
    const { id } = req.params;
    const today = new Date().toISOString().split('T')[0];
    let orders = await readOrdersByDate('online', today);
    let source = 'online';
    let found = orders.some(o => o.id === id);
    if (!found) {
        orders = await readOrdersByDate('return', today);
        source = 'return';
        found = orders.some(o => o.id === id);
    }
    if (!found) return res.status(404).json({ error: 'Không tìm thấy' });
    orders = orders.filter(o => o.id !== id);
    await writeOrdersByDate(orders, source, today);
    res.json({ success: true });
});

// Xóa đơn hôm nay (online) – chỉ QL
app.delete('/api/orders/today', async (req, res) => {
    const role = req.headers.role;
    if (role !== 'ql') {
        return res.status(403).json({ error: 'Chỉ quản lý mới có quyền xóa' });
    }
    const today = new Date().toISOString().split('T')[0];
    await writeOrdersByDate([], 'online', today);
    res.json({ removed: 'all online orders today' });
});

// Xóa toàn bộ – chỉ QL
app.delete('/api/orders', async (req, res) => {
    const role = req.headers.role;
    if (role !== 'ql') {
        return res.status(403).json({ error: 'Chỉ quản lý mới có quyền xóa' });
    }
    const today = new Date().toISOString().split('T')[0];
    await writeOrdersByDate([], 'online', today);
    await writeOrdersByDate([], 'return', today);
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5500;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'orders.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ========== Helper functions ==========
function readOrders() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

function writeOrders(orders) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2), 'utf8');
}

function readUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

// ========== Auth ==========
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ success: true, role: user.role, username: user.username });
    } else {
        res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu' });
    }
});

app.post('/api/verify-password', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ valid: true });
    } else {
        res.status(401).json({ valid: false });
    }
});

// ========== Orders API ==========
app.get('/api/orders', (req, res) => {
    res.json(readOrders());
});

app.post('/api/orders', (req, res) => {
    const { code, source } = req.body;
    if (!code || !code.trim()) {
        return res.status(400).json({ error: 'Mã đơn không được để trống' });
    }
    const now = new Date();
    const newOrder = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        code: code.trim(),
        timestamp: now.toISOString(),
        date: now.toISOString().split('T')[0],
        time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        status: 'pending',
        items: [],
        source: source || 'online'
    };
    const orders = readOrders();
    orders.unshift(newOrder);
    writeOrders(orders);
    res.status(201).json(newOrder);
});

app.post('/api/orders/:id/items', (req, res) => {
    const { id } = req.params;
    const { code } = req.body;
    if (!code || !code.trim()) {
        return res.status(400).json({ error: 'Mã sản phẩm không được để trống' });
    }
    const orders = readOrders();
    const order = orders.find(o => o.id === id);
    if (!order) {
        return res.status(404).json({ error: 'Đơn hàng không tồn tại' });
    }
    const trimmedCode = code.trim();
    const existingItem = order.items.find(item => item.code === trimmedCode);
    if (existingItem) {
        existingItem.quantity += 1;
        writeOrders(orders);
        return res.status(200).json({ ...existingItem, updated: true });
    } else {
        const newItem = {
            code: trimmedCode,
            quantity: 1,
            time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };
        order.items.push(newItem);
        writeOrders(orders);
        return res.status(201).json({ ...newItem, updated: false });
    }
});

app.put('/api/orders/:id/items/:code', (req, res) => {
    const { id, code } = req.params;
    const { quantity } = req.body;
    const newQty = Number(quantity);
    if (isNaN(newQty) || newQty < 0) {
        return res.status(400).json({ error: 'Số lượng không hợp lệ' });
    }
    const orders = readOrders();
    const order = orders.find(o => o.id === id);
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
    writeOrders(orders);
    res.json(order.items[itemIndex] || { code, quantity: 0 });
});

app.put('/api/orders/:id/complete', (req, res) => {
    const { id } = req.params;
    const orders = readOrders();
    const order = orders.find(o => o.id === id);
    if (!order) return res.status(404).json({ error: 'Đơn hàng không tồn tại' });
    order.status = 'completed';
    writeOrders(orders);
    res.json(order);
});

// Xóa một đơn – yêu cầu role ql
app.delete('/api/orders/:id', (req, res) => {
    const role = req.headers.role;
    if (role !== 'ql') {
        return res.status(403).json({ error: 'Chỉ quản lý mới có quyền xóa' });
    }
    const { id } = req.params;
    let orders = readOrders();
    const initialLength = orders.length;
    orders = orders.filter(o => o.id !== id);
    if (orders.length === initialLength) return res.status(404).json({ error: 'Không tìm thấy' });
    writeOrders(orders);
    res.json({ success: true });
});

// Xóa đơn hôm nay (online) – yêu cầu role ql
app.delete('/api/orders/today', (req, res) => {
    const role = req.headers.role;
    if (role !== 'ql') {
        return res.status(403).json({ error: 'Chỉ quản lý mới có quyền xóa' });
    }
    const today = new Date().toISOString().split('T')[0];
    let orders = readOrders();
    const before = orders.length;
    orders = orders.filter(o => !(o.date === today && o.source === 'online'));
    const removed = before - orders.length;
    writeOrders(orders);
    res.json({ removed });
});

// Xóa toàn bộ – yêu cầu role ql
app.delete('/api/orders', (req, res) => {
    const role = req.headers.role;
    if (role !== 'ql') {
        return res.status(403).json({ error: 'Chỉ quản lý mới có quyền xóa' });
    }
    writeOrders([]);
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server đang chạy tại http://192.168.1.9:${PORT}`);
});
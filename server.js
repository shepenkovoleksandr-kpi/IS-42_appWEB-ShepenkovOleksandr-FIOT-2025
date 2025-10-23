const express = require('express');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- quick request logger (для діагностики) ---
app.use((req, res, next) => {
    console.log(new Date().toISOString(), req.method, req.url);
    next();
});

// --- CONFIG ---
const MONGO_URI = 'mongodb+srv://shepenkovoleksandr_db_user:rBj2Ofmab6QjYlVy@web.p0b3mqv.mongodb.net/?retryWrites=true&w=majority&appName=WEB';

// Connect to MongoDB
mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ Connected to MongoDB');
    ensureDefaultUsers();
}).catch(err => {
    console.error('❌ MongoDB connection error:', err);
});

// --- Schemas / Models ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // hashed
    name: { type: String, required: true },
    role: { type: String, default: 'user' },
    favorites: { type: [String], default: [] }
}, { timestamps: true });

const listingSchema = new mongoose.Schema({
    title: String,
    price: Number,
    year: Number,
    mileage: Number,
    description: String,
    image: String
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Listing = mongoose.model('Listing', listingSchema);

// --- Middleware ---
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'barysauto-secret-key-2025',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// serve static files (повинен бути раніше за інші маршрути)
app.use(express.static(path.join(__dirname, '.')));

// явне віддання main.html на корені (з логуванням помилок)
app.get(['/', '/main.html'], (req, res) => {
    const filePath = path.join(__dirname, 'main.html');
    console.log('HTTP GET', req.url, '-> sendFile', filePath);
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('sendFile error for', filePath, err);
            // якщо файл не знайдено або інша помилка, вернуть явний текст
            if (!res.headersSent) res.status(err.status || 500).send(`File error: ${err.message}`);
        } else {
            console.log('Sent', filePath, 'to', req.ip || req.connection.remoteAddress);
        }
    });
});

// fallback 404 logger (для діагностики)
app.use((req, res, next) => {
    console.warn('No matching route for', req.method, req.url);
    res.status(404).send('Not Found');
});

// --- Helpers / middlewares ---
async function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        // refresh user from DB to ensure latest favorites/role
        try {
            const u = await User.findById(req.session.user.id).lean();
            if (!u) return res.status(401).json({ error: 'Необхідна авторизація' });
            req.currentUser = u;
            return next();
        } catch (e) {
            return res.status(500).json({ error: 'DB error' });
        }
    }
    return res.status(401).json({ error: 'Необхідна авторизація' });
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'admin') return next();
    return res.status(403).json({ error: 'Доступ заборонено: тільки для адміністратора' });
}

// --- Utilities ---
async function ensureDefaultUsers() {
    try {
        const admin = await User.findOne({ username: 'admin' });
        if (!admin) {
            const hashed = await bcrypt.hash('admin', 10);
            await User.create({ username: 'admin', password: hashed, name: 'Адмін', role: 'admin' });
            console.log('📝 Created default admin/admin');
        }
        const user = await User.findOne({ username: 'user' });
        if (!user) {
            const hashed = await bcrypt.hash('user', 10);
            await User.create({ username: 'user', password: hashed, name: 'Користувач', role: 'user' });
            console.log('📝 Created default user/user');
        }

        // If no listings exist create sample ones (only once)
        const count = await Listing.countDocuments();
        if (count === 0) {
            await Listing.create([
                { title: 'Toyota Corolla 2015', price: 9500, year: 2015, mileage: 120000, description: 'В хорошому стані, пробіг 120k km', image: 'img/main-car.png' },
                { title: 'Honda Civic 2017', price: 11500, year: 2017, mileage: 85000, description: 'Один власник, сервісна книжка', image: 'img/main-car.png' },
                { title: 'Ford Focus 2018', price: 10200, year: 2018, mileage: 95000, description: 'Повна комплектація, максимальна', image: 'img/ford.png' }
            ]);
            console.log('📝 Seeded sample listings');
        }
    } catch (e) {
        console.error('ensureDefaultUsers error:', e);
    }
}

// --- Routes ---
// Status
app.get('/api/status', async (req, res) => {
    if (!req.session.user) return res.json({ user: { role: 'guest', name: 'Гість' } });
    try {
        const u = await User.findById(req.session.user.id).lean();
        if (!u) return res.json({ user: { role: 'guest', name: 'Гість' } });
        const { password, ...safe } = u;
        res.json({ user: { id: safe._id, username: safe.username, role: safe.role, name: safe.name, favorites: safe.favorites || [] } });
    } catch (e) {
        res.status(500).json({ error: 'DB error' });
    }
});

// Register (forbid when already logged in)
app.post('/api/register', async (req, res) => {
    if (req.session && req.session.user) return res.status(400).json({ error: 'Ви вже залогінені' });

    const { username, password, name } = req.body || {};
    if (!username || !password || !name) return res.status(400).json({ error: 'Заповніть всі поля' });
    if (username.length < 3) return res.status(400).json({ error: 'Логін повинен бути мінімум 3 символи' });
    if (password.length < 4) return res.status(400).json({ error: 'Пароль повинен бути мінімум 4 символи' });

    try {
        const exists = await User.findOne({ username });
        if (exists) return res.status(409).json({ error: 'Користувач з таким логіном вже існує' });

        const hashed = await bcrypt.hash(password, 10);
        const newUser = await User.create({ username, password: hashed, name, role: 'user', favorites: [] });
        req.session.user = { id: newUser._id.toString(), username: newUser.username, role: newUser.role, name: newUser.name };
        return res.status(201).json({ user: req.session.user });
    } catch (e) {
        console.error('register error:', e);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Login (forbid when already logged in)
app.post('/api/login', async (req, res) => {
    if (req.session && req.session.user) return res.status(400).json({ error: 'Ви вже залогінені' });

    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Введіть логін та пароль' });

    try {
        const found = await User.findOne({ username });
        if (!found) return res.status(401).json({ error: 'Невірний логін або пароль' });

        const ok = await bcrypt.compare(password, found.password);
        if (!ok) return res.status(401).json({ error: 'Невірний логін або пароль' });

        req.session.user = { id: found._id.toString(), username: found.username, role: found.role, name: found.name };
        return res.json({ user: req.session.user });
    } catch (e) {
        console.error('login error:', e);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: 'Помилка виходу' });
        res.json({ ok: true });
    });
});

// Listings
app.get('/api/listings', async (req, res) => {
    try {
        const listings = await Listing.find().lean();
        let favIds = [];
        if (req.session && req.session.user) {
            const u = await User.findById(req.session.user.id).lean();
            favIds = u ? (u.favorites || []) : [];
        }
        const enriched = listings.map(l => ({ ...l, id: l._id, isFavorite: favIds.includes(String(l._id)) }));
        res.json(enriched);
    } catch (e) {
        console.error('listings error:', e);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

app.get('/api/listings/:id', async (req, res) => {
    try {
        const item = await Listing.findById(req.params.id).lean();
        if (!item) return res.status(404).json({ error: 'Оголошення не знайдено' });
        let isFavorite = false;
        if (req.session && req.session.user) {
            const u = await User.findById(req.session.user.id).lean();
            isFavorite = u ? (u.favorites || []).includes(String(item._id)) : false;
        }
        res.json({ ...item, id: item._id, isFavorite });
    } catch (e) {
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Admin CRUD
app.post('/api/listings', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { title, price, year, mileage, description, image } = req.body || {};
        if (!title || price == null) return res.status(400).json({ error: 'Назва та ціна обов\'язкові' });
        const newItem = await Listing.create({ title, price: Number(price), year: year ? Number(year) : undefined, mileage: mileage ? Number(mileage) : undefined, description, image: image || 'img/main-car.png' });
        res.status(201).json(newItem);
    } catch (e) {
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

app.put('/api/listings/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const item = await Listing.findById(req.params.id);
        if (!item) return res.status(404).json({ error: 'Оголошення не знайдено' });
        Object.assign(item, req.body);
        await item.save();
        res.json(item);
    } catch (e) {
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

app.delete('/api/listings/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const removed = await Listing.findByIdAndDelete(req.params.id);
        if (!removed) return res.status(404).json({ error: 'Оголошення не знайдено' });
        res.json({ ok: true, removed });
    } catch (e) {
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Favorites
app.post('/api/listings/:id/favorite', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        if (!user) return res.status(500).json({ error: 'Користувача не знайдено' });
        const listingId = req.params.id;
        const listing = await Listing.findById(listingId);
        if (!listing) return res.status(404).json({ error: 'Оголошення не знайдено' });

        const idx = user.favorites.indexOf(String(listingId));
        if (idx === -1) {
            user.favorites.push(String(listingId));
            await user.save();
            return res.json({ ok: true, favorited: true });
        } else {
            user.favorites.splice(idx, 1);
            await user.save();
            return res.json({ ok: true, favorited: false });
        }
    } catch (e) {
        console.error('favorite error:', e);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

app.get('/api/me/favorites', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        if (!user) return res.status(500).json({ error: 'Користувача не знайдено' });
        const favs = await Listing.find({ _id: { $in: user.favorites } }).lean();
        res.json({ favorites: favs.map(f => ({ ...f, id: f._id })) });
    } catch (e) {
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Admin users
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const users = await User.find().lean();
        const safe = users.map(u => ({ id: u._id, username: u.username, name: u.name, role: u.role, favorites: u.favorites || [] }));
        res.json(safe);
    } catch (e) {
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚗 BarysAuto server running on http://localhost:${PORT}`);
});
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
require("dotenv").config();
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "kuzenler_firin_gizli_jwt_anahtari_2026";
const ADMIN_RECOVERY_KEY_HASH = process.env.ADMIN_RECOVERY_KEY
  ? crypto.createHash("sha256").update(process.env.ADMIN_RECOVERY_KEY).digest("hex")
  : null;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// XSS Koruması İçin Metin Temizleyici
function sanitizeText(val) {
  if (typeof val !== "string") return "";
  return val.replace(/[<>]/g, "").trim();
}

// IP Bazlı Spam Koruma (Rate Limit) Yardımcıları
const rateLimitStore = new Map();

function createRateLimiter(maxRequests, windowMs, message) {
  return (req, res, next) => {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "unknown";
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const entry = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    rateLimitStore.set(key, entry);

    if (entry.count > maxRequests) {
      return res.status(429).json({ message });
    }
    next();
  };
}

const orderRateLimiter = createRateLimiter(
  5,
  60 * 1000,
  "Çok sık sipariş isteği gönderildi. Lütfen 1 dakika sonra tekrar deneyin."
);

const messageRateLimiter = createRateLimiter(
  5,
  60 * 1000,
  "Çok sık mesaj gönderildi. Lütfen 1 dakika sonra tekrar deneyin."
);

const forgotPasswordRateLimiter = createRateLimiter(
  3,
  10 * 60 * 1000,
  "Çok fazla şifre sıfırlama kodu istediniz. Lütfen 10 dakika sonra tekrar deneyin."
);

// Müşteri Şifre Sıfırlama Kodları (10 Dakika Geçerli)
const passwordResetCodes = new Map();

async function sendResetEmail(toEmail, code) {
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Kuzenler Ekmek Fırını" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: "Şifre Sıfırlama Doğrulama Kodunuz",
      html: `
        <div style="font-family:Arial,sans-serif; padding:20px; color:#2B2825;">
          <h2 style="color:#12383A;">Kuzenler Ekmek Fırını</h2>
          <p>Hesabınız için şifre sıfırlama talebinde bulundunuz.</p>
          <p style="font-size:22px; font-weight:bold; letter-spacing:4px; color:#B83728; background:#FAF7F2; padding:12px 18px; display:inline-block; border-radius:8px;">
            ${code}
          </p>
          <p style="font-size:13px; color:#5C5852;">Bu kod 10 dakika boyunca geçerlidir.</p>
        </div>
      `,
    });
    return true;
  } else {
    console.log(`\n[TEST E-POSTASI] Alıcı: ${toEmail} | Şifre Sıfırlama Kodu: ${code}\n`);
    return false;
  }
}

// Multer Fotoğraf Yükleme Ayarı (Sadece görsel formatlarına izin verir)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "public", "images"));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, "urun-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error("Sadece JPG, PNG veya WEBP formatında görsel yüklenebilir."));
    }
    cb(null, true);
  },
});

// Şifre Hashleme ve Doğrulama Yardımcıları
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, key] = storedHash.split(":");
  const hashBuffer = crypto.scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key, "hex");
  return crypto.timingSafeEqual(hashBuffer, keyBuffer);
}

// İlk Açılışta Veritabanında Varsayılan Admin Yoksa Oluştur
async function ensureDefaultAdmin() {
  try {
    const res = await pool.query("SELECT id FROM admins WHERE username = 'admin'");
    if (res.rows.length === 0) {
      const defaultPass = process.env.ADMIN_PASSWORD || "kuzenler2026";
      const hashed = hashPassword(defaultPass);
      await pool.query("INSERT INTO admins (username, password_hash) VALUES ('admin', $1)", [hashed]);
    }
  } catch (err) {
    console.error("Varsayılan admin kontrolü hatası:", err.message);
  }
}
ensureDefaultAdmin();

// Kurtarma Anahtarı Brute-Force Koruması (Rate Limit)
const recoveryAttempts = { count: 0, lockedUntil: 0 };

// Admin JWT Doğrulama Middleware'i
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.headers["authorization"]?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ message: "Yetkisiz erişim! Lütfen giriş yapın." });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin") throw new Error("Yetki yetersiz");
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Oturum süresi doldu veya geçersiz token." });
  }
}

// Müşteri JWT Doğrulama Middleware'i
function requireUser(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Bu işlem için giriş yapmalısınız." });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "customer") throw new Error("Geçersiz kullanıcı rolü");
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Oturumunuz geçersiz veya süresi dolmuş." });
  }
}

// Misafir veya Giriş Yapmış Kullanıcıyı Ayırt Eden Middleware
function optionalUser(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role === "customer") req.user = decoded;
    } catch (_) {}
  }
  next();
}

// ==========================================
// 1. KULLANICI KAYIT, GİRİŞ & ŞİFRE SIFIRLAMA (MÜŞTERİ AUTH - JWT)
// ==========================================
app.post("/api/auth/register", async (req, res) => {
  const { full_name, phone, email, password, default_address } = req.body;
  const cleanName = sanitizeText(full_name);
  const cleanPhone = sanitizeText(phone);
  const cleanAddress = sanitizeText(default_address);

  if (!cleanName || !cleanPhone || !email || !password || password.length < 6) {
    return res.status(400).json({ message: "Tüm alanları doldurun (Şifre en az 6 karakter olmalı)." });
  }

  try {
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1 OR phone = $2",
      [email.toLowerCase().trim(), cleanPhone]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "Bu e-posta veya telefon numarası zaten kayıtlı." });
    }

    const passwordHash = hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (full_name, phone, email, password_hash, default_address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name, phone, email, default_address`,
      [cleanName, cleanPhone, email.toLowerCase().trim(), passwordHash, cleanAddress]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, role: "customer", email: user.email }, JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Kayıt sırasında sunucu hatası oluştu." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "E-posta ve şifre gereklidir." });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase().trim()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: "E-posta veya şifre hatalı." });
    }

    const user = result.rows[0];
    const isValid = verifyPassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ message: "E-posta veya şifre hatalı." });
    }

    const token = jwt.sign({ id: user.id, role: "customer", email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        default_address: user.default_address,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Giriş sırasında hata oluştu." });
  }
});

// Müşteri Şifremi Unuttum: 6 Haneli Doğrulama Kodu Gönder
app.post("/api/auth/forgot-password", forgotPasswordRateLimiter, async (req, res) => {
  const email = (req.body.email || "").toLowerCase().trim();
  if (!email) {
    return res.status(400).json({ message: "Lütfen kayıtlı e-posta adresinizi girin." });
  }

  try {
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Bu e-posta adresiyle kayıtlı bir hesap bulunamadı." });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    passwordResetCodes.set(email, {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0,
    });

    const sentRealEmail = await sendResetEmail(email, code);
    res.json({
      message: sentRealEmail
        ? "6 haneli doğrulama kodu e-posta adresinize gönderildi."
        : "Doğrulama kodu üretildi (SMTP ayarlı değil, kod sunucu terminaline yazdırıldı).",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Doğrulama kodu gönderilirken hata oluştu." });
  }
});

// Müşteri Şifremi Unuttum: Kodu Doğrula ve Yeni Şifreyi Kaydet
app.post("/api/auth/reset-password", async (req, res) => {
  const email = (req.body.email || "").toLowerCase().trim();
  const code = String(req.body.code || "").trim();
  const newPassword = req.body.newPassword || "";

  if (!email || !code || newPassword.length < 6) {
    return res.status(400).json({ message: "E-posta, 6 haneli kod ve en az 6 karakterlik yeni şifre zorunludur." });
  }

  const record = passwordResetCodes.get(email);
  if (!record || Date.now() > record.expiresAt) {
    passwordResetCodes.delete(email);
    return res.status(400).json({ message: "Doğrulama kodunun süresi dolmuş veya geçersiz. Lütfen yeni kod isteyin." });
  }

  if (record.code !== code) {
    record.attempts += 1;
    if (record.attempts >= 3) {
      passwordResetCodes.delete(email);
      return res.status(400).json({ message: "3 kez hatalı kod girildi. Güvenlik nedeniyle kod iptal edildi." });
    }
    return res.status(400).json({ message: "Doğrulama kodu hatalı!" });
  }

  try {
    const newHash = hashPassword(newPassword);
    await pool.query("UPDATE users SET password_hash = $1 WHERE email = $2", [newHash, email]);
    passwordResetCodes.delete(email);

    res.json({ message: "Şifreniz başarıyla güncellendi. Yeni şifrenizle giriş yapabilirsiniz." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Şifre güncellenirken sunucu hatası oluştu." });
  }
});

// ==========================================
// 2. ADMIN GİRİŞ, ŞİFRE DEĞİŞTİRME & İSTATİSTİKLER
// ==========================================
app.post("/api/admin/login", async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ message: "Şifre gereklidir." });
  }

  try {
    await ensureDefaultAdmin();
    const result = await pool.query("SELECT * FROM admins WHERE username = 'admin'");
    const admin = result.rows[0];

    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ message: "Yönetici şifresi hatalı!" });
    }

    const token = jwt.sign({ role: "admin", username: "admin" }, JWT_SECRET, { expiresIn: "4h" });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Giriş kontrolü sırasında hata oluştu." });
  }
});

// Giriş Yapmış Admin İçin Şifre Değiştirme
app.put("/api/admin/change-password", requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: "Yeni şifre en az 6 karakter olmalıdır." });
  }

  try {
    const result = await pool.query("SELECT * FROM admins WHERE username = 'admin'");
    const admin = result.rows[0];

    if (!admin || !verifyPassword(currentPassword, admin.password_hash)) {
      return res.status(401).json({ message: "Mevcut şifreniz hatalı!" });
    }

    const newHash = hashPassword(newPassword);
    await pool.query("UPDATE admins SET password_hash = $1 WHERE username = 'admin'", [newHash]);
    res.json({ message: "Yönetici şifreniz başarıyla güncellendi." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Şifre güncellenirken hata oluştu." });
  }
});

// Sadece Gizli Fırın Kurtarma Anahtarı + Brute-Force Kilidi ile Şifre Sıfırlama
app.post("/api/admin/recover-password", async (req, res) => {
  const now = Date.now();
  if (recoveryAttempts.lockedUntil > now) {
    const minsLeft = Math.ceil((recoveryAttempts.lockedUntil - now) / 60000);
    return res.status(429).json({
      message: `Çok fazla hatalı kurtarma denemesi! Güvenlik kilidi nedeniyle ${minsLeft} dakika sonra tekrar deneyin.`,
    });
  }

  if (!ADMIN_RECOVERY_KEY_HASH) {
    return res.status(503).json({ message: "Sunucuda kurtarma anahtarı yapılandırılmamış." });
  }

  const { recoveryKey, newPassword } = req.body;
  if (!recoveryKey || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: "Kurtarma anahtarı ve en az 6 karakterlik yeni şifre zorunludur." });
  }

  const inputHash = crypto.createHash("sha256").update(recoveryKey).digest("hex");
  const isMatch = crypto.timingSafeEqual(Buffer.from(inputHash, "hex"), Buffer.from(ADMIN_RECOVERY_KEY_HASH, "hex"));

  if (!isMatch) {
    recoveryAttempts.count += 1;
    if (recoveryAttempts.count >= 3) {
      recoveryAttempts.lockedUntil = now + 15 * 60 * 1000; // 15 dakika kilit
      recoveryAttempts.count = 0;
    }
    return res.status(401).json({ message: "Geçersiz Fırın Kurtarma Anahtarı!" });
  }

  try {
    recoveryAttempts.count = 0;
    recoveryAttempts.lockedUntil = 0;
    await ensureDefaultAdmin();

    const newHash = hashPassword(newPassword);
    await pool.query("UPDATE admins SET password_hash = $1 WHERE username = 'admin'", [newHash]);
    res.json({ message: "Yönetici şifresi kurtarma anahtarı ile başarıyla sıfırlandı." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Şifre sıfırlama sırasında sunucu hatası oluştu." });
  }
});

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  try {
    const todayRevenueRes = await pool.query(`
      SELECT COALESCE(SUM(total_amount), 0) AS today_revenue
      FROM orders
      WHERE status = 'Teslim Edildi'
        AND DATE(pickup_date) = CURRENT_DATE
    `);

    const totalRevenueRes = await pool.query(`
      SELECT COALESCE(SUM(total_amount), 0) AS total_revenue
      FROM orders
      WHERE status = 'Teslim Edildi'
    `);

    const topProductRes = await pool.query(`
      SELECT p.name, SUM(oi.quantity) AS total_qty
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE o.status = 'Teslim Edildi'
      GROUP BY p.name
      ORDER BY total_qty DESC
      LIMIT 1
    `);

    res.json({
      today_revenue: Number(todayRevenueRes.rows[0].today_revenue),
      total_revenue: Number(totalRevenueRes.rows[0].total_revenue),
      top_product: topProductRes.rows.length > 0 ? topProductRes.rows[0].name : "Henüz veri yok",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "İstatistikler alınamadı." });
  }
});

// ==========================================
// 3. KATEGORİLER & ÜRÜNLER (CRUD + FOTOĞRAF YÜKLEME)
// ==========================================
app.get("/api/categories", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM categories ORDER BY display_order ASC, id ASC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Kategoriler alınamadı." });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, c.name AS category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      ORDER BY p.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Ürünler alınamadı." });
  }
});

app.post("/api/products", requireAdmin, upload.single("image"), async (req, res) => {
  const { category_id, name, description, price, unit, tray_price, is_hot_now } = req.body;
  const cleanName = sanitizeText(name);
  const cleanDesc = sanitizeText(description);

  if (!cleanName || !price) {
    return res.status(400).json({ message: "Ürün adı ve fiyatı zorunludur." });
  }

  const imageUrl = req.file ? `/images/${req.file.filename}` : "";
  const hasTray = tray_price !== undefined && tray_price !== "" && Number(tray_price) > 0;
  const isHot = is_hot_now === "true" || is_hot_now === true;

  try {
    const result = await pool.query(
      `INSERT INTO products (category_id, name, description, price, unit, tray_price, is_tray_available, image_url, is_hot_now, last_baked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        category_id || 1,
        cleanName,
        cleanDesc,
        price,
        unit || "Adet",
        hasTray ? tray_price : null,
        hasTray,
        imageUrl,
        isHot,
        isHot ? new Date() : null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Ürün eklenemedi." });
  }
});

app.put("/api/products/:id", requireAdmin, upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { category_id, name, description, price, unit, tray_price, existing_image_url, is_hot_now } = req.body;
  const cleanName = sanitizeText(name);
  const cleanDesc = sanitizeText(description);

  const imageUrl = req.file ? `/images/${req.file.filename}` : (existing_image_url || "");
  const hasTray = tray_price !== undefined && tray_price !== "" && Number(tray_price) > 0;
  const isHot = is_hot_now === "true" || is_hot_now === true;

  try {
    const result = await pool.query(
      `UPDATE products 
       SET category_id=$1, name=$2, description=$3, price=$4, unit=$5, tray_price=$6, is_tray_available=$7, image_url=$8, is_hot_now=$9
       WHERE id=$10 RETURNING *`,
      [
        category_id || 1,
        cleanName,
        cleanDesc,
        price,
        unit || "Adet",
        hasTray ? tray_price : null,
        hasTray,
        imageUrl,
        isHot,
        id,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Ürün güncellenemedi." });
  }
});

app.patch("/api/products/:id/hot", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_hot_now } = req.body;
  try {
    const result = await pool.query(
      "UPDATE products SET is_hot_now = $1, last_baked_at = $2 WHERE id = $3 RETURNING *",
      [Boolean(is_hot_now), is_hot_now ? new Date() : null, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Fırın durumu güncellenemedi." });
  }
});

app.delete("/api/products/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
    res.json({ message: "Ürün silindi." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Ürün silinemedi." });
  }
});

// ==========================================
// 4. SİPARİŞLER (OLUŞTURMA, TAKİP, KULLANICI GEÇMİŞİ, YÖNETİM)
// ==========================================
app.post("/api/orders", orderRateLimiter, optionalUser, async (req, res) => {
  const {
    customer_name,
    customer_phone,
    delivery_type,
    delivery_address,
    pickup_date,
    pickup_time,
    event_note,
    items,
  } = req.body;

  const cleanCustomerName = sanitizeText(customer_name);
  const cleanCustomerPhone = sanitizeText(customer_phone);
  const cleanDeliveryAddress = sanitizeText(delivery_address);
  const cleanEventNote = sanitizeText(event_note);

  if (!cleanCustomerName || !cleanCustomerPhone || !items || !items.length) {
    return res.status(400).json({ message: "Müşteri bilgileri ve sepet ürünleri zorunludur." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let calculatedTotal = 0;
    const verifiedItems = [];

    for (const item of items) {
      const qty = Number(item.quantity);
      if (!item.product_id || isNaN(qty) || qty <= 0) {
        throw new Error("Geçersiz ürün miktarı!");
      }

      const prodRes = await client.query(
        "SELECT price, tray_price, is_tray_available FROM products WHERE id = $1",
        [item.product_id]
      );
      if (prodRes.rows.length === 0) {
        throw new Error("Sepetteki ürün veritabanında bulunamadı.");
      }

      const product = prodRes.rows[0];
      const isTray = Boolean(item.is_tray);

      if (isTray && (!product.is_tray_available || !product.tray_price)) {
        throw new Error("Bu ürün için tepsi satışı mevcut değil.");
      }

      const realUnitPrice = isTray ? Number(product.tray_price) : Number(product.price);
      calculatedTotal += realUnitPrice * qty;

      verifiedItems.push({
        product_id: item.product_id,
        quantity: qty,
        is_tray: isTray,
        unit_price: realUnitPrice,
      });
    }

    const tracking_code = `FRN-${Math.floor(1000 + Math.random() * 9000)}`;
    const userId = req.user ? req.user.id : null;

    const orderRes = await client.query(
      `INSERT INTO orders (user_id, tracking_code, customer_name, customer_phone, delivery_type, delivery_address, pickup_date, pickup_time, event_note, total_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        userId,
        tracking_code,
        cleanCustomerName,
        cleanCustomerPhone,
        delivery_type || "gel-al",
        cleanDeliveryAddress,
        pickup_date,
        pickup_time,
        cleanEventNote,
        calculatedTotal,
      ]
    );

    const order = orderRes.rows[0];

    for (const item of verifiedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, is_tray, unit_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, item.product_id, item.quantity, item.is_tray, item.unit_price]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(order);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(400).json({ message: err.message || "Sipariş kaydedilemedi." });
  } finally {
    client.release();
  }
});

// Giriş Yapan Kullanıcının Sadece Kendi Siparişlerini Getir (Kullanıcıya Özel Veri)
app.get("/api/orders/my-orders", requireUser, async (req, res) => {
  try {
    const ordersRes = await pool.query(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );

    for (const order of ordersRes.rows) {
      const itemsRes = await pool.query(
        `SELECT oi.quantity, oi.is_tray, oi.unit_price, p.name, p.unit 
         FROM order_items oi 
         LEFT JOIN products p ON oi.product_id = p.id 
         WHERE oi.order_id = $1`,
        [order.id]
      );
      order.items = itemsRes.rows;
    }

    res.json(ordersRes.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Sipariş geçmişi alınamadı." });
  }
});

app.get("/api/orders/track/:code", async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  try {
    const orderRes = await pool.query("SELECT * FROM orders WHERE tracking_code = $1", [code]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ message: "Bu takip koduna ait sipariş bulunamadı." });
    }
    const order = orderRes.rows[0];
    const itemsRes = await pool.query(
      `SELECT oi.quantity, oi.is_tray, oi.unit_price, p.name, p.unit 
       FROM order_items oi 
       LEFT JOIN products p ON oi.product_id = p.id 
       WHERE oi.order_id = $1`,
      [order.id]
    );
    order.items = itemsRes.rows;
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Sorgulama sırasında hata oluştu." });
  }
});

app.get("/api/orders/by-phone/:phone", async (req, res) => {
  const cleanPhone = req.params.phone.replace(/\s+/g, "").trim();
  try {
    const ordersRes = await pool.query(
      `SELECT * FROM orders 
       WHERE REPLACE(customer_phone, ' ', '') LIKE $1 
       ORDER BY created_at DESC LIMIT 3`,
      [`%${cleanPhone.slice(-10)}`]
    );

    if (ordersRes.rows.length === 0) {
      return res.status(404).json({ message: "Bu telefon numarasına ait sipariş bulunamadı." });
    }

    for (const order of ordersRes.rows) {
      const itemsRes = await pool.query(
        `SELECT oi.quantity, oi.is_tray, oi.unit_price, p.name, p.unit 
         FROM order_items oi 
         LEFT JOIN products p ON oi.product_id = p.id 
         WHERE oi.order_id = $1`,
        [order.id]
      );
      order.items = itemsRes.rows;
    }

    res.json(ordersRes.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Telefon ile sorgulama sırasında hata oluştu." });
  }
});

app.put("/api/orders/cancel/:code", async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  try {
    const checkRes = await pool.query("SELECT * FROM orders WHERE tracking_code = $1", [code]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ message: "Sipariş bulunamadı." });
    }

    const order = checkRes.rows[0];
    if (order.status !== "Onay Bekliyor") {
      return res.status(400).json({
        message: "Siparişiniz fırında işleme alındığı için iptal edilemez. Lütfen telefonla ulaşın.",
      });
    }

    const updateRes = await pool.query(
      "UPDATE orders SET status = 'İptal Edildi' WHERE id = $1 RETURNING *",
      [order.id]
    );
    res.json(updateRes.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Sipariş iptal edilirken hata oluştu." });
  }
});

app.get("/api/orders", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*,
        COALESCE(
          (SELECT string_agg(
            COALESCE(p.name, 'Ürün') || ' (' || oi.quantity || ' ' || CASE WHEN oi.is_tray THEN 'Tepsi' ELSE COALESCE(p.unit, 'Adet') END || ')',
            ', '
          )
          FROM order_items oi
          LEFT JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = o.id),
          'Detay yok'
        ) AS items_summary
      FROM orders o
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Siparişler alınamadı." });
  }
});

app.put("/api/orders/:id/status", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE orders SET status = $1 WHERE id = $2 RETURNING *",
      [req.body.status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Durum güncellenemedi." });
  }
});

app.delete("/api/orders/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM orders WHERE id = $1", [req.params.id]);
    res.json({ message: "Sipariş silindi." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Sipariş silinemedi." });
  }
});

// ==========================================
// 5. İLETİŞİM MESAJLARI
// ==========================================
app.post("/api/messages", messageRateLimiter, async (req, res) => {
  const { sender_name, sender_phone, subject, message_text } = req.body;
  const cleanName = sanitizeText(sender_name);
  const cleanPhone = sanitizeText(sender_phone);
  const cleanSubject = sanitizeText(subject) || "Genel İletişim";
  const cleanMessage = sanitizeText(message_text);

  if (!cleanName || !cleanPhone || !cleanMessage) {
    return res.status(400).json({ message: "Ad, telefon ve mesaj zorunludur." });
  }
  try {
    const result = await pool.query(
      "INSERT INTO messages (sender_name, sender_phone, subject, message_text) VALUES ($1, $2, $3, $4) RETURNING *",
      [cleanName, cleanPhone, cleanSubject, cleanMessage]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Mesaj gönderilemedi." });
  }
});

app.get("/api/messages", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM messages ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Mesajlar alınamadı." });
  }
});

app.delete("/api/messages/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM messages WHERE id = $1", [req.params.id]);
    res.json({ message: "Mesaj silindi." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Mesaj silinemedi." });
  }
});

app.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ message: err.message || "Geçersiz istek." });
  }
  next();
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Kuzenler Ekmek Fırın sunucusu http://localhost:${PORT} adresinde çalışıyor.`);
  });
}

module.exports = app;
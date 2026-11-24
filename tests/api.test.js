const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const app = require("../server");
const pool = require("../db");

let server;
let baseUrl;
let userToken;
let adminToken;
let createdTrackingCode;
let createdOrderId;
const testEmail = `test_${Date.now()}@kuzenler.com`;
const testPhone = `0555${Math.floor(1000000 + Math.random() * 8999999)}`;

describe("Kuzenler Taş Fırın - Backend API Otomasyon Testleri", () => {
  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address();
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    // Test sırasında oluşturulan geçici kayıtları temizle
    if (createdOrderId) {
      await pool.query("DELETE FROM orders WHERE id = $1", [createdOrderId]);
    }
    await pool.query("DELETE FROM users WHERE email = $1", [testEmail]);

    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  it("1. Kategoriler ve ürünler başarıyla listelenmeli (GET /api/categories & /api/products)", async () => {
    const [catRes, prodRes] = await Promise.all([
      fetch(`${baseUrl}/api/categories`),
      fetch(`${baseUrl}/api/products`),
    ]);

    assert.strictEqual(catRes.status, 200);
    assert.strictEqual(prodRes.status, 200);

    const categories = await catRes.json();
    const products = await prodRes.json();
    assert.ok(Array.isArray(categories) && categories.length > 0, "Kategoriler boş dönmemeli");
    assert.ok(Array.isArray(products) && products.length > 0, "Ürünler boş dönmemeli");
  });

  it("2. Eksik bilgilerle sipariş oluşturma reddedilmeli (400 Bad Request)", async () => {
    const res = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_name: "Eksik Müşteri" }),
    });

    assert.strictEqual(res.status, 400);
  });

  it("3. Yeni müşteri kaydı yapılabilmeli ve JWT dönmeli (POST /api/auth/register)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: "Otomasyon Test Kullanıcısı",
        phone: testPhone,
        email: testEmail,
        password: "testpassword123",
        default_address: "Çavuşlu Merkez Mah.",
      }),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.token, "JWT token üretilmeli");
    assert.strictEqual(data.user.email, testEmail);
    userToken = data.token;
  });

  it("4. Giriş yapmış kullanıcı sipariş verebilmeli ve kendi sipariş geçmişinde görebilmeli", async () => {
    const prodRes = await fetch(`${baseUrl}/api/products`);
    const products = await prodRes.json();
    const firstProduct = products[0];

    const orderRes = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        customer_name: "Otomasyon Test Kullanıcısı",
        customer_phone: testPhone,
        delivery_type: "gel-al",
        pickup_date: new Date().toISOString().split("T")[0],
        pickup_time: "14:30",
        event_note: "[HEMEN] Test siparişi",
        total_amount: Number(firstProduct.price),
        items: [
          {
            product_id: firstProduct.id,
            quantity: 1,
            is_tray: false,
            unit_price: Number(firstProduct.price),
          },
        ],
      }),
    });

    assert.strictEqual(orderRes.status, 201);
    const orderData = await orderRes.json();
    assert.ok(orderData.tracking_code.startsWith("FRN-"));
    createdTrackingCode = orderData.tracking_code;
    createdOrderId = orderData.id;

    // Kullanıcıya özel sipariş geçmişini sorgula
    const myOrdersRes = await fetch(`${baseUrl}/api/orders/my-orders`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(myOrdersRes.status, 200);
    const myOrders = await myOrdersRes.json();
    assert.ok(myOrders.some((o) => o.tracking_code === createdTrackingCode));
  });

  it("5. Tokensız istekler Admin endpoint'lerine erişememeli (401 Unauthorized)", async () => {
    const res = await fetch(`${baseUrl}/api/orders`);
    assert.strictEqual(res.status, 401);
  });

  it("6. Admin girişi JWT üretmeli ve istatistiklere erişebilmeli", async () => {
    const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: process.env.ADMIN_PASSWORD || "kuzenler2026" }),
    });

    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.ok(loginData.token);
    adminToken = loginData.token;

    const statsRes = await fetch(`${baseUrl}/api/admin/stats`, {
      headers: { "x-admin-token": adminToken },
    });
    assert.strictEqual(statsRes.status, 200);
    const stats = await statsRes.json();
    assert.ok(typeof stats.today_revenue === "number");
  });

  it("7. Müşteri 'Onay Bekliyor' durumundaki siparişini iptal edebilmeli", async () => {
    const cancelRes = await fetch(`${baseUrl}/api/orders/cancel/${createdTrackingCode}`, {
      method: "PUT",
    });

    assert.strictEqual(cancelRes.status, 200);
    const updatedOrder = await cancelRes.json();
    assert.strictEqual(updatedOrder.status, "İptal Edildi");
  });
});
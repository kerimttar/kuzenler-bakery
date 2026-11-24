// ==========================================
// 1. ORTAK SEPET YÖNETİMİ (TÜM SAYFALARDA ÇALIŞIR)
// ==========================================
let allProducts = [];
let cart = JSON.parse(localStorage.getItem('kuzenler_cart')) || [];

function saveAndRenderCart() {
  localStorage.setItem('kuzenler_cart', JSON.stringify(cart));
  
  const countEl = document.getElementById('cartCount');
  if (countEl) countEl.textContent = cart.length;

  const container = document.getElementById('cartItemsContainer');
  const totalEl = document.getElementById('cartTotalPrice');
  if (!container || !totalEl) return;

  if (!cart.length) {
    container.innerHTML = `<p style="color:#5C5852; font-size:0.9rem;">Sepetinizde henüz ürün bulunmuyor.</p>`;
    totalEl.textContent = '0.00 TL';
    return;
  }

  let total = 0;
  container.innerHTML = cart.map((item, idx) => {
    const lineTotal = item.quantity * item.unit_price;
    total += lineTotal;
    const qtyDisplay = item.is_tray
      ? `${item.quantity} Tepsi`
      : item.unit === 'Kg'
        ? `${item.quantity} Kg`
        : `${item.quantity} ${item.unit || 'Adet'}`;

    return `
      <div class="cart-item-row" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div style="flex:1;">
          <strong>${item.name}</strong>
          <div style="font-size:0.82rem; color:#5C5852;">${qtyDisplay} — ${lineTotal.toFixed(2)} TL</div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button type="button" onclick="changeCartQty(${idx}, -1)" style="width:26px; height:26px; border:1px solid #D5CEC2; background:#FAF7F2; border-radius:6px; font-weight:700; cursor:pointer;">-</button>
          <span style="font-size:0.85rem; font-weight:600; min-width:22px; text-align:center;">${item.quantity}</span>
          <button type="button" onclick="changeCartQty(${idx}, 1)" style="width:26px; height:26px; border:1px solid #D5CEC2; background:#FAF7F2; border-radius:6px; font-weight:700; cursor:pointer;">+</button>
          <button type="button" onclick="removeFromCart(${idx})" style="background:none; border:none; color:#B83728; font-weight:700; cursor:pointer; margin-left:4px;">Sil</button>
        </div>
      </div>
    `;
  }).join('');

  totalEl.textContent = `${total.toFixed(2)} TL`;
}

window.changeCartQty = function(index, delta) {
  const item = cart[index];
  if (!item) return;

  const step = (!item.is_tray && item.unit === 'Kg') ? 0.25 : 1;
  const nextQty = Number((item.quantity + delta * step).toFixed(2));

  if (nextQty <= 0) {
    cart.splice(index, 1);
  } else {
    item.quantity = nextQty;
  }
  saveAndRenderCart();
};

window.removeFromCart = function(index) {
  cart.splice(index, 1);
  saveAndRenderCart();
};

const openCartBtn = document.getElementById('openCartBtn');
const closeCartBtn = document.getElementById('closeCartBtn');
const cartModal = document.getElementById('cartModal');

if (openCartBtn && cartModal) {
  openCartBtn.addEventListener('click', () => cartModal.classList.remove('hidden'));
}
if (closeCartBtn && cartModal) {
  closeCartBtn.addEventListener('click', () => cartModal.classList.add('hidden'));
}

const deliveryTypeEl = document.getElementById('deliveryType');
if (deliveryTypeEl) {
  deliveryTypeEl.addEventListener('change', (e) => {
    const addrInput = document.getElementById('deliveryAddress');
    if (addrInput) addrInput.classList.toggle('hidden', e.target.value !== 'adres');
  });
}

const orderTimingEl = document.getElementById('orderTiming');
if (orderTimingEl) {
  orderTimingEl.addEventListener('change', (e) => {
    const isScheduled = e.target.value === 'ileri';
    const scheduleFields = document.getElementById('scheduleFields');
    const dateInput = document.getElementById('pickupDate');
    const timeInput = document.getElementById('pickupTime');

    if (scheduleFields) scheduleFields.classList.toggle('hidden', !isScheduled);
    if (dateInput) dateInput.required = isScheduled;
    if (timeInput) timeInput.required = isScheduled;
  });
}

window.copyTrackingCode = function(code, btnEl) {
  navigator.clipboard.writeText(code).then(() => {
    if (btnEl) {
      btnEl.textContent = 'Kopyalandı ✓';
      setTimeout(() => { btnEl.textContent = 'Kodu Kopyala'; }, 2000);
    }
  });
};

const checkoutForm = document.getElementById('checkoutForm');
if (checkoutForm) {
  checkoutForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!cart.length) {
      alert('Lütfen önce sepete ürün ekleyin.');
      return;
    }

    const timing = document.getElementById('orderTiming')?.value || 'hemen';
    let pickupDate = document.getElementById('pickupDate')?.value || '';
    let pickupTime = document.getElementById('pickupTime')?.value || '';

    if (timing === 'hemen') {
      const now = new Date();
      pickupDate = now.toISOString().split('T')[0];
      pickupTime = now.toTimeString().slice(0, 5);
    }

    const userNote = document.getElementById('eventNote')?.value.trim() || '';
    const finalNote = timing === 'hemen'
      ? `[HEMEN] ${userNote}`.trim()
      : userNote;

    const totalAmount = cart.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const payload = {
      customer_name: document.getElementById('custName').value.trim(),
      customer_phone: document.getElementById('custPhone').value.trim(),
      delivery_type: document.getElementById('deliveryType').value,
      delivery_address: document.getElementById('deliveryAddress')?.value.trim() || '',
      pickup_date: pickupDate,
      pickup_time: pickupTime,
      event_note: finalNote,
      total_amount: totalAmount,
      items: cart
    };

    const submitBtn = checkoutForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sipariş Gönderiliyor...';
    }

    try {
      const userToken = localStorage.getItem('kuzenler_user_token');
      const reqHeaders = { 'Content-Type': 'application/json' };
      if (userToken) reqHeaders['Authorization'] = `Bearer ${userToken}`;

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Sipariş oluşturulamadı');

      cart = [];
      saveAndRenderCart();
      checkoutForm.reset();
      document.getElementById('scheduleFields')?.classList.add('hidden');
      document.getElementById('deliveryAddress')?.classList.add('hidden');

      const container = document.getElementById('cartItemsContainer');
      if (container) {
        container.innerHTML = `
          <div style="background:#EEF6F5; border:1px solid #12383A; border-radius:10px; padding:14px; text-align:center;">
            <strong style="color:#12383A; font-size:1rem;">Siparişiniz Alındı!</strong>
            <p style="margin:8px 0; font-size:0.9rem;">Takip Kodunuz: <strong style="font-size:1.1rem; color:#B83728;">${data.tracking_code}</strong></p>
            <button type="button" onclick="copyTrackingCode('${data.tracking_code}', this)" style="background:#12383A; color:#fff; border:none; padding:6px 14px; border-radius:6px; cursor:pointer; font-weight:600;">Kodu Kopyala</button>
            <div style="margin-top:8px;">
              <a href="takip.html" style="font-size:0.85rem; color:#12383A; text-decoration:underline;">Sipariş Takip Sayfasına Git →</a>
            </div>
          </div>
        `;
      }
    } catch (err) {
      alert('Sipariş hatası: ' + err.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Siparişi Tamamla';
      }
    }
  });
}

// ==========================================
// 2. MENÜ SAYFASI (SADECE menu.html AÇIKSA)
// ==========================================
const productsGrid = document.getElementById('productsGrid');
if (productsGrid) {
  async function loadMenuData() {
    try {
      const [catRes, prodRes] = await Promise.all([
        fetch('/api/categories'),
        fetch('/api/products')
      ]);

      if (!catRes.ok || !prodRes.ok) throw new Error('Sunucu yanıt vermedi');

      const categories = await catRes.json();
      allProducts = await prodRes.json();

      renderCategories(categories);
      renderProducts(allProducts);
    } catch (err) {
      console.error(err);
      productsGrid.innerHTML = `<p style="color:#B83728; font-weight:600;">Menü ürünleri yüklenirken veritabanı bağlantısı kurulamadı.</p>`;
    }
  }

  function renderCategories(categories) {
    const tabsEl = document.getElementById('categoryTabs');
    tabsEl.innerHTML = `<button class="tab-btn active" data-cat="all">Tüm Ürünler</button>`;

    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.dataset.cat = cat.id;
      btn.textContent = cat.name;
      tabsEl.appendChild(btn);
    });

    tabsEl.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tabsEl.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterProducts();
      });
    });
  }

  function filterProducts() {
    const activeTab = document.querySelector('.tab-btn.active');
    const selectedCat = activeTab ? activeTab.dataset.cat : 'all';
    const onlyTray = document.getElementById('onlyTrayFilter').checked;

    let filtered = allProducts;
    if (selectedCat !== 'all') {
      filtered = filtered.filter(p => String(p.category_id) === String(selectedCat));
    }
    if (onlyTray) {
      filtered = filtered.filter(p => p.is_tray_available === true);
    }
    renderProducts(filtered);
  }

  document.getElementById('onlyTrayFilter').addEventListener('change', filterProducts);

  function renderProducts(products) {
    if (!products.length) {
      productsGrid.innerHTML = `<p>Bu filtreye uygun ürün bulunamadı.</p>`;
      return;
    }

    productsGrid.innerHTML = products.map(p => {
      let optionsHtml = '';
      if (p.unit === 'Kg') {
        optionsHtml += `
          <option value="0.25|false|${p.price}">250 gr (${(p.price * 0.25).toFixed(2)} TL)</option>
          <option value="0.50|false|${p.price}">500 gr - Yarım Kg (${(p.price * 0.5).toFixed(2)} TL)</option>
          <option value="1.00|false|${p.price}" selected>1 Kg (${Number(p.price).toFixed(2)} TL)</option>
        `;
      } else {
        optionsHtml += `
          <option value="1|false|${p.price}">1 ${p.unit} (${Number(p.price).toFixed(2)} TL)</option>
          <option value="2|false|${p.price}">2 ${p.unit} (${(p.price * 2).toFixed(2)} TL)</option>
          <option value="3|false|${p.price}">3 ${p.unit} (${(p.price * 3).toFixed(2)} TL)</option>
        `;
      }

      if (p.is_tray_available && p.tray_price) {
        optionsHtml += `<option value="1|true|${p.tray_price}">1 Tam Tepsi (${Number(p.tray_price).toFixed(2)} TL)</option>`;
      }

      return `
        <div class="product-card">
          ${p.is_hot_now ? `<span class="hot-badge">Fırından Yeni Çıktı</span>` : ''}
          <div class="product-img-wrap">
            ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" class="product-img" onerror="this.style.display='none'">` : ''}
          </div>
          <div class="product-body">
            <h3>${p.name}</h3>
            <p class="product-desc">${p.description || ''}</p>
            <div class="product-price-box">
              <span class="product-price">${Number(p.price).toFixed(2)} TL <small>/ ${p.unit}</small></span>
              ${p.is_tray_available ? `<span class="tray-tag">Tepsi: ${Number(p.tray_price).toFixed(2)} TL</span>` : ''}
            </div>
            <div class="product-controls">
              <select id="opt-${p.id}">${optionsHtml}</select>
              <button class="add-btn" onclick="addToCart(${p.id})">Sepete Ekle</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  window.addToCart = function(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const selectEl = document.getElementById(`opt-${productId}`);
    const [qtyStr, isTrayStr, unitPriceStr] = selectEl.value.split('|');
    const isTray = isTrayStr === 'true';
    const qty = parseFloat(qtyStr);
    const unitPrice = parseFloat(unitPriceStr);
    const labelText = selectEl.options[selectEl.selectedIndex].text;

    const existing = cart.find(c => c.product_id === product.id && c.is_tray === isTray && c.unit_price === unitPrice);
    if (existing) {
      existing.quantity = Number((existing.quantity + qty).toFixed(2));
    } else {
      cart.push({
        product_id: product.id,
        name: product.name,
        unit: product.unit,
        quantity: qty,
        is_tray: isTray,
        unit_price: unitPrice,
        display_label: labelText
      });
    }

    saveAndRenderCart();
    cartModal.classList.remove('hidden');
  };

  loadMenuData();
}

// ==========================================
// 3. SİPARİŞ TAKİP SAYFASI (SADECE takip.html AÇIKSA)
// ==========================================
function renderOrderCardHtml(data) {
  const isCancelled = data.status === 'İptal Edildi';
  const steps = [
    'Onay Bekliyor',
    'Fırında Hazırlanıyor',
    'Hazır / Yola Çıktı',
    'Teslim Edildi'
  ];
  const currentIdx = steps.indexOf(data.status);

  const stepperHtml = isCancelled
    ? `<div style="background:#FDECEA; color:#B83728; padding:10px; border-radius:8px; font-weight:700; text-align:center; margin:12px 0;">
         ✕ Bu sipariş iptal edilmiştir.
       </div>`
    : `<div style="display:flex; justify-content:space-between; align-items:flex-start; margin:18px 0 22px; gap:6px;">
        ${steps.map((step, i) => {
          const isCompleted = i <= currentIdx;
          const isCurrent = i === currentIdx;
          const circleBg = isCompleted ? '#12383A' : '#E5DFD5';
          const circleColor = isCompleted ? '#FFFFFF' : '#7A746B';
          const borderStyle = isCurrent ? 'box-shadow: 0 0 0 4px rgba(18,56,58,0.2);' : '';
          return `
            <div style="flex:1; text-align:center;">
              <div style="width:30px; height:30px; margin:0 auto 6px; border-radius:50%; background:${circleBg}; color:${circleColor}; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.85rem; ${borderStyle}">
                ${i < currentIdx ? '✓' : i + 1}
              </div>
              <div style="font-size:0.76rem; font-weight:${isCurrent ? '700' : '500'}; color:${isCompleted ? '#12383A' : '#7A746B'}; line-height:1.2;">
                ${step}
              </div>
            </div>
          `;
        }).join('')}
      </div>`;

  const isImmediate = data.event_note && data.event_note.startsWith('[HEMEN]');
  const formattedDate = data.pickup_date ? new Date(data.pickup_date).toLocaleDateString('tr-TR') : '';
  const formattedTime = data.pickup_time ? data.pickup_time.slice(0, 5) : '';
  const deliveryTimeText = isImmediate
    ? 'Gün İçi / Hemen Teslimat'
    : `${formattedDate} - ${formattedTime}`;

  const itemsHtml = (data.items && data.items.length)
    ? `<div style="margin-top:10px; padding-top:10px; border-top:1px dashed #D5CEC2;">
         <strong>Sipariş İçeriği:</strong>
         <ul style="margin:6px 0 0 18px; padding:0; font-size:0.9rem;">
           ${data.items.map(it => `<li>${it.name || 'Ürün'} — ${it.quantity} ${it.is_tray ? 'Tepsi' : (it.unit || 'Adet')}</li>`).join('')}
         </ul>
       </div>`
    : '';

  const cancelBtnHtml = data.status === 'Onay Bekliyor'
    ? `<div style="margin-top:14px; padding-top:10px; border-top:1px solid #E5DFD5; text-align:right;">
         <button type="button" onclick="cancelMyOrder('${data.tracking_code}')" style="background:#B83728; color:#fff; border:none; padding:7px 14px; border-radius:6px; font-size:0.85rem; font-weight:600; cursor:pointer;">
           Siparişi İptal Et
         </button>
       </div>`
    : '';

  return `
    <div style="border:1px solid #E5DFD5; border-radius:10px; padding:14px; margin-bottom:14px; background:#FAF7F2;">
      ${stepperHtml}
      <strong>Takip Kodu:</strong> ${data.tracking_code}<br>
      <strong>Müşteri:</strong> ${data.customer_name}<br>
      <strong>Durum:</strong> <span style="color:${isCancelled ? '#B83728' : '#12383A'}; font-weight:700;">${data.status}</span><br>
      <strong>Teslim Zamanı:</strong> ${deliveryTimeText}<br>
      <strong>Toplam Tutar:</strong> ${Number(data.total_amount).toFixed(2)} TL
      ${itemsHtml}
      ${cancelBtnHtml}
    </div>
  `;
}

window.cancelMyOrder = async function(code) {
  if (!confirm(`${code} kodlu siparişinizi iptal etmek istediğinize emin misiniz?`)) return;
  try {
    const res = await fetch(`/api/orders/cancel/${encodeURIComponent(code)}`, { method: 'PUT' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'İptal işlemi başarısız.');

    alert('Siparişiniz başarıyla iptal edildi.');
    document.getElementById('trackingForm').dispatchEvent(new Event('submit'));
  } catch (err) {
    alert(err.message);
  }
};

const trackingForm = document.getElementById('trackingForm');
if (trackingForm) {
  trackingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawInput = document.getElementById('trackingCodeInput').value.trim();
    const resultBox = document.getElementById('trackingResult');
    const isTrackingCode = rawInput.toUpperCase().startsWith('FRN-');

    try {
      if (isTrackingCode) {
        const res = await fetch(`/api/orders/track/${encodeURIComponent(rawInput.toUpperCase())}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Sipariş bulunamadı');

        resultBox.classList.remove('hidden');
        resultBox.innerHTML = renderOrderCardHtml(data);
      } else {
        const res = await fetch(`/api/orders/by-phone/${encodeURIComponent(rawInput)}`);
        const orders = await res.json();
        if (!res.ok) throw new Error(orders.message || 'Bu numaraya ait sipariş bulunamadı');

        resultBox.classList.remove('hidden');
        resultBox.innerHTML = `
          <p style="font-size:0.88rem; color:#5C5852; margin-bottom:10px;">
            Bu telefon numarasına ait son <strong>${orders.length}</strong> sipariş listeleniyor:
          </p>
          ${orders.map(o => renderOrderCardHtml(o)).join('')}
        `;
      }
    } catch (err) {
      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `<span style="color:#B83728; font-weight:600;">${err.message}</span>`;
    }
  });
}

// ==========================================
// 4. İLETİŞİM SAYFASI (SADECE iletisim.html AÇIKSA)
// ==========================================
const contactForm = document.getElementById('contactForm');
if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      sender_name: document.getElementById('senderName').value.trim(),
      sender_phone: document.getElementById('senderPhone').value.trim(),
      subject: document.getElementById('messageSubject').value,
      message_text: document.getElementById('messageText').value.trim()
    };

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Mesaj gönderilemedi');

      alert('Mesajınız Kuzenler Ekmek Fırınına gönderildi. Teşekkür ederiz.');
      contactForm.reset();
    } catch (err) {
      alert('Mesaj hatası: ' + err.message);
    }
  });
}

// ==========================================
// 5. KULLANICI KAYIT / GİRİŞ / ŞİFREMİ UNUTTUM & HESABIM (JWT)
// ==========================================
(function initCustomerAuth() {
  const navActions = document.querySelector('.nav-actions');
  if (!navActions) return;

  // Navbar'a "Giriş Yap / Hesabım" butonunu otomatik ekle
  const openAuthBtn = document.createElement('button');
  openAuthBtn.id = 'openAuthBtn';
  openAuthBtn.className = 'cart-btn';
  openAuthBtn.type = 'button';
  openAuthBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
    <span id="authBtnLabel">Giriş Yap</span>
  `;
  navActions.insertBefore(openAuthBtn, navActions.firstChild);
  const authBtnLabel = document.getElementById('authBtnLabel');

  // Giriş / Kayıt / Şifre Sıfırlama / Profil Modalını sayfaya dinamik ekle
  const modalWrapper = document.createElement('div');
  modalWrapper.id = 'authModal';
  modalWrapper.className = 'auth-modal-backdrop hidden';
  modalWrapper.innerHTML = `
    <div class="auth-modal-box">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 id="authModalTitle" style="color:var(--sea-deep); font-size:1.4rem;">Müşteri Hesabı</h3>
        <button id="closeAuthModalBtn" class="close-btn">&times;</button>
      </div>

      <div id="authGuestView">
        <div class="auth-tabs" id="authModeTabs">
          <button type="button" class="auth-tab-btn active" data-auth-mode="login">Giriş Yap</button>
          <button type="button" class="auth-tab-btn" data-auth-mode="register">Kayıt Ol</button>
        </div>

        <form id="userLoginForm" class="checkout-form">
          <input type="email" id="loginEmail" placeholder="E-posta Adresiniz" required />
          <input type="password" id="loginPassword" placeholder="Şifreniz" required />
          <button type="submit" class="btn btn-primary full-width">Giriş Yap</button>
          <div style="text-align:right; margin-top:4px;">
            <button type="button" id="showForgotPassBtn" style="background:none; border:none; color:var(--wood-warm); font-size:0.84rem; font-weight:600; cursor:pointer; text-decoration:underline;">
              Şifremi Unuttum
            </button>
          </div>
        </form>

        <form id="userRegisterForm" class="checkout-form hidden">
          <input type="text" id="regFullName" placeholder="Adınız Soyadınız" required />
          <input type="tel" id="regPhone" placeholder="Telefon (05XX...)" required />
          <input type="email" id="regEmail" placeholder="E-posta Adresiniz" required />
          <input type="password" id="regPassword" placeholder="Şifre (En az 6 karakter)" minlength="6" required />
          <input type="text" id="regAddress" placeholder="Varsayılan Teslimat Adresi (İsteğe bağlı)" />
          <button type="submit" class="btn btn-copper full-width">Hesap Oluştur</button>
        </form>

        <!-- ŞİFREMİ UNUTTUM EKRANI -->
        <div id="userForgotView" class="hidden">
          <form id="forgotCodeRequestForm" class="checkout-form">
            <p style="font-size:0.86rem; color:var(--text-muted); margin-bottom:6px;">
              Kayıtlı e-posta adresinizi girin; 6 haneli doğrulama kodunuzu gönderelim.
            </p>
            <input type="email" id="forgotEmailInput" placeholder="Kayıtlı E-posta Adresiniz" required />
            <button type="submit" id="sendResetCodeBtn" class="btn btn-primary full-width">Doğrulama Kodu Gönder</button>
          </form>

          <form id="forgotCodeVerifyForm" class="checkout-form hidden" style="margin-top:10px;">
            <p id="forgotCodeInfo" style="font-size:0.84rem; color:var(--sea-deep); font-weight:600; margin-bottom:6px;"></p>
            <input type="text" id="resetCodeInput" placeholder="6 Haneli Doğrulama Kodu" maxlength="6" required />
            <input type="password" id="resetNewPasswordInput" placeholder="Yeni Şifreniz (En az 6 karakter)" minlength="6" required />
            <button type="submit" class="btn btn-copper full-width">Şifremi Güncelle</button>
          </form>

          <div style="text-align:center; margin-top:10px;">
            <button type="button" id="backToLoginBtn" style="background:none; border:none; color:var(--sea-deep); font-size:0.85rem; font-weight:600; cursor:pointer; text-decoration:underline;">
              ← Giriş Ekranına Dön
            </button>
          </div>
        </div>
      </div>

      <div id="authProfileView" class="hidden">
        <div style="background:var(--sea-soft); padding:12px 14px; border-radius:10px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong id="profileUserName" style="color:var(--sea-deep); display:block;"></strong>
            <small id="profileUserMeta" style="color:var(--text-muted);"></small>
          </div>
          <button type="button" id="userLogoutBtn" class="btn-sm btn-delete">Çıkış</button>
        </div>

        <h4 style="margin-bottom:10px; color:var(--wood-dark);">Geçmiş Siparişlerim</h4>
        <div id="myOrdersContainer" style="max-height:320px; overflow-y:auto;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modalWrapper);

  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem('kuzenler_user'));
    } catch {
      return null;
    }
  }

  function syncAuthUI() {
    const user = getStoredUser();
    const token = localStorage.getItem('kuzenler_user_token');
    const guestView = document.getElementById('authGuestView');
    const profileView = document.getElementById('authProfileView');

    if (user && token) {
      authBtnLabel.textContent = user.full_name.split(' ')[0];
      guestView.classList.add('hidden');
      profileView.classList.remove('hidden');
      document.getElementById('profileUserName').textContent = user.full_name;
      document.getElementById('profileUserMeta').textContent = `${user.phone} • ${user.email}`;

      const nameInput = document.getElementById('custName');
      const phoneInput = document.getElementById('custPhone');
      const addrInput = document.getElementById('deliveryAddress');
      if (nameInput && !nameInput.value) nameInput.value = user.full_name;
      if (phoneInput && !phoneInput.value) phoneInput.value = user.phone;
      if (addrInput && !addrInput.value && user.default_address) addrInput.value = user.default_address;
    } else {
      authBtnLabel.textContent = 'Giriş Yap';
      guestView.classList.remove('hidden');
      profileView.classList.add('hidden');
    }
  }

  async function loadMyOrders() {
    const token = localStorage.getItem('kuzenler_user_token');
    const container = document.getElementById('myOrdersContainer');
    if (!token || !container) return;

    container.innerHTML = `<p style="font-size:0.88rem; color:var(--text-muted);">Siparişleriniz yükleniyor...</p>`;
    try {
      const res = await fetch('/api/orders/my-orders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Oturum süresi dolmuş olabilir.');
      const orders = await res.json();

      if (!orders.length) {
        container.innerHTML = `<p style="font-size:0.88rem; color:var(--text-muted);">Henüz hesabınıza kayıtlı bir siparişiniz bulunmuyor.</p>`;
        return;
      }

      container.innerHTML = orders.map(o => `
        <div style="border:1px solid var(--border); background:var(--bg-parchment); border-radius:8px; padding:10px 12px; margin-bottom:8px; font-size:0.86rem;">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <strong>${o.tracking_code}</strong>
            <span style="font-weight:700; color:var(--sea-deep);">${o.status}</span>
          </div>
          <div style="color:var(--text-muted); margin-bottom:4px;">
            ${(o.items || []).map(i => `${i.name} (${i.quantity} ${i.is_tray ? 'Tepsi' : i.unit})`).join(', ')}
          </div>
          <div style="font-weight:700; color:var(--wood-warm);">Toplam: ${Number(o.total_amount).toFixed(2)} TL</div>
        </div>
      `).join('');
    } catch (err) {
      container.innerHTML = `<p style="color:var(--fire-red); font-size:0.86rem;">${err.message}</p>`;
    }
  }

  openAuthBtn.addEventListener('click', () => {
    syncAuthUI();
    modalWrapper.classList.remove('hidden');
    if (localStorage.getItem('kuzenler_user_token')) {
      loadMyOrders();
    }
  });

  document.getElementById('closeAuthModalBtn').addEventListener('click', () => {
    modalWrapper.classList.add('hidden');
  });

  modalWrapper.querySelectorAll('[data-auth-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      modalWrapper.querySelectorAll('[data-auth-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isLogin = btn.dataset.authMode === 'login';
      document.getElementById('userForgotView').classList.add('hidden');
      document.getElementById('userLoginForm').classList.toggle('hidden', !isLogin);
      document.getElementById('userRegisterForm').classList.toggle('hidden', isLogin);
    });
  });

  // Şifremi Unuttum Ekran Geçişleri
  document.getElementById('showForgotPassBtn').addEventListener('click', () => {
    document.getElementById('authModeTabs').classList.add('hidden');
    document.getElementById('userLoginForm').classList.add('hidden');
    document.getElementById('userRegisterForm').classList.add('hidden');
    document.getElementById('userForgotView').classList.remove('hidden');
    document.getElementById('forgotCodeRequestForm').classList.remove('hidden');
    document.getElementById('forgotCodeVerifyForm').classList.add('hidden');
  });

  document.getElementById('backToLoginBtn').addEventListener('click', () => {
    document.getElementById('userForgotView').classList.add('hidden');
    document.getElementById('authModeTabs').classList.remove('hidden');
    document.getElementById('userLoginForm').classList.remove('hidden');
  });

  let pendingResetEmail = '';

  document.getElementById('forgotCodeRequestForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgotEmailInput').value.trim();
    const btn = document.getElementById('sendResetCodeBtn');
    btn.disabled = true;
    btn.textContent = 'Kod Gönderiliyor...';

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Kod gönderilemedi.');

      pendingResetEmail = email;
      document.getElementById('forgotCodeRequestForm').classList.add('hidden');
      document.getElementById('forgotCodeVerifyForm').classList.remove('hidden');
      document.getElementById('forgotCodeInfo').textContent = data.message;
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Doğrulama Kodu Gönder';
    }
  });

  document.getElementById('forgotCodeVerifyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('resetCodeInput').value.trim();
    const newPassword = document.getElementById('resetNewPasswordInput').value;

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingResetEmail, code, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Şifre güncellenemedi.');

      alert(data.message);
      document.getElementById('forgotCodeRequestForm').reset();
      document.getElementById('forgotCodeVerifyForm').reset();
      document.getElementById('backToLoginBtn').click();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('userRegisterForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      full_name: document.getElementById('regFullName').value.trim(),
      phone: document.getElementById('regPhone').value.trim(),
      email: document.getElementById('regEmail').value.trim(),
      password: document.getElementById('regPassword').value,
      default_address: document.getElementById('regAddress').value.trim(),
    };

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Kayıt başarısız.');

      localStorage.setItem('kuzenler_user_token', data.token);
      localStorage.setItem('kuzenler_user', JSON.stringify(data.user));
      syncAuthUI();
      loadMyOrders();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('userLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      email: document.getElementById('loginEmail').value.trim(),
      password: document.getElementById('loginPassword').value,
    };

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Giriş başarısız.');

      localStorage.setItem('kuzenler_user_token', data.token);
      localStorage.setItem('kuzenler_user', JSON.stringify(data.user));
      syncAuthUI();
      loadMyOrders();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('userLogoutBtn').addEventListener('click', () => {
    localStorage.removeItem('kuzenler_user_token');
    localStorage.removeItem('kuzenler_user');
    syncAuthUI();
    modalWrapper.classList.add('hidden');
  });

  syncAuthUI();
})();

saveAndRenderCart();
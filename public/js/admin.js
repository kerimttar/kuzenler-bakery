document.addEventListener("DOMContentLoaded", () => {
  const loginSection = document.getElementById("loginSection");
  const dashboardSection = document.getElementById("dashboardSection");
  const logoutBtn = document.getElementById("logoutBtn");
  const openChangePassBtn = document.getElementById("openChangePassBtn");
  const changePassModal = document.getElementById("changePassModal");
  const closeChangePassBtn = document.getElementById("closeChangePassBtn");
  const changePassForm = document.getElementById("changePassForm");
  const loginForm = document.getElementById("adminLoginForm");
  const loginErrorMsg = document.getElementById("loginErrorMsg");

  let adminToken = sessionStorage.getItem("kuzenler_admin_token");
  if (adminToken) {
    showDashboard();
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("adminPasswordInput").value.trim();

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();
      if (!res.ok) {
        loginErrorMsg.textContent = data.message || "Hatalı şifre!";
        loginErrorMsg.classList.remove("hidden");
        return;
      }

      adminToken = data.token;
      sessionStorage.setItem("kuzenler_admin_token", adminToken);
      loginErrorMsg.classList.add("hidden");
      showDashboard();
    } catch (err) {
      loginErrorMsg.textContent = "Sunucuya bağlanılamadı.";
      loginErrorMsg.classList.remove("hidden");
    }
  });

  // Gizli URL Parametresi (?kurtarma=1) Varsa Kurtarma Kutusunu Aktifleştir
  const urlParams = new URLSearchParams(window.location.search);
  const recoveryBox = document.getElementById("recoveryBox");
  const adminRecoveryForm = document.getElementById("adminRecoveryForm");

  if (urlParams.get("kurtarma") === "1" && recoveryBox) {
    recoveryBox.classList.remove("hidden");
  }

  if (adminRecoveryForm) {
    adminRecoveryForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const recoveryKey = document.getElementById("recoveryKeyInput").value.trim();
      const newPassword = document.getElementById("recoveryNewPassInput").value;

      try {
        const res = await fetch("/api/admin/recover-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recoveryKey, newPassword }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Kurtarma başarısız.");

        alert("Şifreniz başarıyla sıfırlandı! Şimdi yeni şifrenizle giriş yapabilirsiniz.");
        adminRecoveryForm.reset();
        window.history.replaceState({}, document.title, "admin.html");
        recoveryBox.classList.add("hidden");
      } catch (err) {
        alert(err.message);
      }
    });
  }

  logoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem("kuzenler_admin_token");
    adminToken = null;
    dashboardSection.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    openChangePassBtn.classList.add("hidden");
    loginSection.classList.remove("hidden");
  });

  function showDashboard() {
    loginSection.classList.add("hidden");
    dashboardSection.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    openChangePassBtn.classList.remove("hidden");
    loadAllAdminData();
  }

  // Şifre Değiştirme Modalı Kontrolü
  openChangePassBtn.addEventListener("click", () => {
    changePassForm.reset();
    changePassModal.classList.remove("hidden");
  });

  closeChangePassBtn.addEventListener("click", () => {
    changePassModal.classList.add("hidden");
  });

  changePassForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById("currentAdminPass").value;
    const newPassword = document.getElementById("newAdminPass").value;
    const confirmPassword = document.getElementById("confirmAdminPass").value;

    if (newPassword !== confirmPassword) {
      alert("Yeni şifreler birbiriyle eşleşmiyor!");
      return;
    }

    try {
      const res = await fetch("/api/admin/change-password", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Şifre değiştirilemedi.");

      alert("Yönetici şifreniz başarıyla güncellendi! Bir sonraki girişinizde yeni şifrenizi kullanabilirsiniz.");
      changePassModal.classList.add("hidden");
      changePassForm.reset();
    } catch (err) {
      alert(err.message);
    }
  });

  const tabButtons = document.querySelectorAll("[data-admin-tab]");
  const tabContents = document.querySelectorAll(".admin-tab-content");

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => c.classList.add("hidden"));

      btn.classList.add("active");
      document.getElementById(btn.dataset.adminTab).classList.remove("hidden");
    });
  });

  function authHeaders() {
    return {
      "Content-Type": "application/json",
      "x-admin-token": adminToken,
    };
  }

  async function loadAllAdminData() {
    await Promise.all([
      loadCategoriesSelect(),
      loadOrders(),
      loadProducts(),
      loadMessages(),
      loadAdminStats(),
    ]);
  }

  async function loadAdminStats() {
    try {
      const res = await fetch("/api/admin/stats", { headers: authHeaders() });
      if (!res.ok) return;
      const stats = await res.json();

      const todayEl = document.getElementById("statTodayRevenue");
      const topEl = document.getElementById("statTopProduct");
      if (todayEl) todayEl.textContent = `${stats.today_revenue.toFixed(2)} TL`;
      if (topEl) topEl.textContent = stats.top_product;
    } catch (err) {
      console.error(err);
    }
  }

  async function loadCategoriesSelect() {
    const selectEl = document.getElementById("prodCategory");
    try {
      const res = await fetch("/api/categories");
      const cats = await res.json();
      selectEl.innerHTML = cats.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    } catch (err) {
      console.error(err);
    }
  }

  // ==========================================
  // 1. SİPARİŞLERİ LİSTELE, GÜNCELLE VE SİL
  // ==========================================
  async function loadOrders() {
    const container = document.getElementById("adminOrdersList");
    try {
      const res = await fetch("/api/orders", { headers: authHeaders() });
      const orders = await res.json();

      const activeCount = orders.filter(
        (o) => o.status !== "Teslim Edildi" && o.status !== "İptal Edildi"
      ).length;
      document.getElementById("statActiveOrders").textContent = activeCount;

      if (orders.length === 0) {
        container.innerHTML = "<p>Henüz kayıtlı sipariş bulunmuyor.</p>";
        return;
      }

      container.innerHTML = orders
        .map((order) => {
          const isCancelled = order.status === "İptal Edildi";
          const isImmediate = order.event_note && order.event_note.startsWith("[HEMEN]");
          const cleanNote = isImmediate ? order.event_note.replace("[HEMEN]", "").trim() : (order.event_note || "");
          const formattedDate = order.pickup_date ? new Date(order.pickup_date).toLocaleDateString("tr-TR") : "";
          const formattedTime = order.pickup_time ? order.pickup_time.slice(0, 5) : "";
          const timingBadge = isCancelled
            ? `<span style="background:#FDECEA; color:#B83728; padding:2px 8px; border-radius:6px; font-size:0.8rem; font-weight:700;">✕ İptal Edildi</span>`
            : isImmediate
              ? `<span style="background:#FFF3E0; color:#B85D19; padding:2px 8px; border-radius:6px; font-size:0.8rem; font-weight:700;">⚡ Hemen Teslimat</span>`
              : `<span style="background:#E8F1F2; color:#12383A; padding:2px 8px; border-radius:6px; font-size:0.8rem; font-weight:700;">📅 ${formattedDate} ${formattedTime}</span>`;

          return `
          <div class="admin-item-card" style="${isCancelled ? "opacity:0.75; border-left:4px solid #B83728;" : ""}">
            <div class="admin-item-info">
              <h4>${order.tracking_code} — ${order.customer_name} (${order.customer_phone}) ${timingBadge}</h4>
              <p><strong>Teslimat:</strong> ${order.delivery_type === "adres" ? "Adrese: " + order.delivery_address : "Dükkandan Gel-Al"} | <strong>Tutar:</strong> ${Number(order.total_amount).toFixed(2)} TL</p>
              <p><strong>Ürünler:</strong> ${order.items_summary}</p>
              ${cleanNote ? `<p><strong>Not:</strong> ${cleanNote}</p>` : ""}
            </div>
            <div class="admin-item-actions">
              <select class="admin-select" onchange="updateOrderStatus(${order.id}, this.value)">
                <option value="Onay Bekliyor" ${order.status === "Onay Bekliyor" ? "selected" : ""}>Onay Bekliyor</option>
                <option value="Fırında Hazırlanıyor" ${order.status === "Fırında Hazırlanıyor" ? "selected" : ""}>Fırında Hazırlanıyor</option>
                <option value="Hazır / Yola Çıktı" ${order.status === "Hazır / Yola Çıktı" ? "selected" : ""}>Hazır / Yola Çıktı</option>
                <option value="Teslim Edildi" ${order.status === "Teslim Edildi" ? "selected" : ""}>Teslim Edildi</option>
                <option value="İptal Edildi" ${order.status === "İptal Edildi" ? "selected" : ""}>İptal Edildi</option>
              </select>
              <button class="btn-sm btn-delete" onclick="deleteOrder(${order.id})">Sil</button>
            </div>
          </div>
        `;
        })
        .join("");
    } catch (err) {
      container.innerHTML = "<p>Siparişler yüklenirken hata oluştu.</p>";
    }
  }

  document.getElementById("refreshOrdersBtn").addEventListener("click", () => {
    loadOrders();
    loadAdminStats();
  });

  window.updateOrderStatus = async (id, status) => {
    await fetch(`/api/orders/${id}/status`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    });
    loadOrders();
    loadAdminStats();
  };

  window.deleteOrder = async (id) => {
    if (!confirm("Bu siparişi silmek istediğinize emin misiniz?")) return;
    await fetch(`/api/orders/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    loadOrders();
    loadAdminStats();
  };

  // ==========================================
  // 2. ÜRÜNLERİ LİSTELE, EKLE, GÜNCELLE VE SİL
  // ==========================================
  let cachedProducts = [];

  async function loadProducts() {
    const container = document.getElementById("adminProductsList");
    try {
      const res = await fetch("/api/products");
      cachedProducts = await res.json();

      document.getElementById("statTotalProducts").textContent = cachedProducts.length;
      document.getElementById("statFreshProducts").textContent = cachedProducts.filter((p) => p.is_hot_now).length;

      if (cachedProducts.length === 0) {
        container.innerHTML = "<p>Menüde henüz ürün yok.</p>";
        return;
      }

      container.innerHTML = cachedProducts
        .map(
          (p) => `
          <div class="admin-item-card">
            <div class="admin-item-info">
              <h4>${p.name} <small style="color: var(--wood-copper);">(${p.category_name || "Genel"})</small></h4>
              <p><strong>Fiyat:</strong> ${Number(p.price).toFixed(2)} TL / ${p.unit} ${p.is_tray_available && p.tray_price ? `| <strong>Tepsi:</strong> ${Number(p.tray_price).toFixed(2)} TL` : ""}</p>
              <p>${p.description || ""}</p>
            </div>
            <div class="admin-item-actions">
              <button class="btn-sm ${p.is_hot_now ? "btn-fresh-on" : "btn-fresh-off"}" onclick="toggleHot(${p.id}, ${!p.is_hot_now})">
                ${p.is_hot_now ? "🔥 Fırından Yeni Çıktı (Açık)" : "Yeni Çıktı: Kapalı"}
              </button>
              <button class="btn-sm btn-edit" onclick="editProduct(${p.id})">Düzenle</button>
              <button class="btn-sm btn-delete" onclick="deleteProduct(${p.id})">Sil</button>
            </div>
          </div>
        `
        )
        .join("");
    } catch (err) {
      container.innerHTML = "<p>Ürünler yüklenirken hata oluştu.</p>";
    }
  }

  const productForm = document.getElementById("productForm");
  const cancelEditBtn = document.getElementById("cancelEditBtn");

  productForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("editProductId").value;

    const formData = new FormData();
    formData.append("category_id", document.getElementById("prodCategory").value);
    formData.append("name", document.getElementById("prodName").value.trim());
    formData.append("price", document.getElementById("prodPrice").value);
    formData.append("unit", document.getElementById("prodUnit") ? document.getElementById("prodUnit").value : "Adet");
    formData.append("tray_price", document.getElementById("prodTrayPrice").value || "");
    formData.append("description", document.getElementById("prodDesc").value.trim());
    formData.append("is_hot_now", document.getElementById("prodIsFresh").checked);
    formData.append("existing_image_url", document.getElementById("existingImageUrl").value);

    const fileInput = document.getElementById("prodImageFile");
    if (fileInput.files.length > 0) {
      formData.append("image", fileInput.files[0]);
    }

    const url = id ? `/api/products/${id}` : "/api/products";
    const method = id ? "PUT" : "POST";

    await fetch(url, {
      method,
      headers: { "x-admin-token": adminToken },
      body: formData,
    });

    resetProductForm();
    loadProducts();
  });

  window.editProduct = (id) => {
    const prod = cachedProducts.find((p) => p.id === id);
    if (!prod) return;

    document.getElementById("editProductId").value = prod.id;
    document.getElementById("prodName").value = prod.name;
    document.getElementById("prodCategory").value = prod.category_id;
    document.getElementById("prodPrice").value = prod.price;
    if (document.getElementById("prodUnit")) document.getElementById("prodUnit").value = prod.unit || "Adet";
    document.getElementById("prodTrayPrice").value = prod.tray_price || "";
    document.getElementById("existingImageUrl").value = prod.image_url || "";
    document.getElementById("currentImageText").textContent = prod.image_url
      ? "Mevcut fotoğraf yüklü (Değiştirmek istemiyorsanız boş bırakın)"
      : "Henüz fotoğraf yüklenmemiş";
    document.getElementById("prodDesc").value = prod.description || "";
    document.getElementById("prodIsFresh").checked = prod.is_hot_now;

    document.getElementById("productFormTitle").textContent = "Ürünü Düzenle";
    document.getElementById("saveProductBtn").textContent = "Değişiklikleri Güncelle";
    cancelEditBtn.classList.remove("hidden");
  };

  cancelEditBtn.addEventListener("click", resetProductForm);

  function resetProductForm() {
    productForm.reset();
    document.getElementById("editProductId").value = "";
    document.getElementById("existingImageUrl").value = "";
    document.getElementById("currentImageText").textContent = "";
    document.getElementById("productFormTitle").textContent = "Yeni Ürün Ekle";
    document.getElementById("saveProductBtn").textContent = "Ürünü Kaydet";
    cancelEditBtn.classList.add("hidden");
  }

  window.toggleHot = async (id, newState) => {
    await fetch(`/api/products/${id}/hot`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ is_hot_now: newState }),
    });
    loadProducts();
  };

  window.deleteProduct = async (id) => {
    if (!confirm("Bu ürünü menüden silmek istediğinize emin misiniz?")) return;
    await fetch(`/api/products/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    loadProducts();
  };

  // ==========================================
  // 3. GELEN MESAJLARI LİSTELE VE SİL
  // ==========================================
  async function loadMessages() {
    const container = document.getElementById("adminMessagesList");
    try {
      const res = await fetch("/api/messages", { headers: authHeaders() });
      const messages = await res.json();

      document.getElementById("statTotalMessages").textContent = messages.length;

      if (messages.length === 0) {
        container.innerHTML = "<p>Henüz gelen mesaj bulunmuyor.</p>";
        return;
      }

      container.innerHTML = messages
        .map(
          (m) => `
          <div class="admin-item-card">
            <div class="admin-item-info">
              <h4>${m.sender_name} — <span style="color: var(--wood-copper);">${m.subject}</span></h4>
              <p><strong>Telefon:</strong> ${m.sender_phone}</p>
              <p>${m.message_text}</p>
            </div>
            <div class="admin-item-actions">
              <button class="btn-sm btn-delete" onclick="deleteMessage(${m.id})">Sil</button>
            </div>
          </div>
        `
        )
        .join("");
    } catch (err) {
      container.innerHTML = "<p>Mesajlar yüklenirken hata oluştu.</p>";
    }
  }

  window.deleteMessage = async (id) => {
    if (!confirm("Bu mesajı silmek istediğinize emin misiniz?")) return;
    await fetch(`/api/messages/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    loadMessages();
  };
});
/* ==========================================================
   Live Fruit Juice — স্টোর (Supabase-ব্যাক্ড)
   ------------------------------------------------------------
   কাস্টম লগইন (SHA256), স্টাফের বিল ফিল্টার, ওনারের সম্পূর্ণ
   নিয়ন্ত্রণ, পণ্যের Realtime সাবস্ক্রিপশন। সব ডেটা Supabase-এ;
   ব্রাউজারে শুধু সেশন + স্থানীয় সেটিংস (যেখানে কোনো সেটিংস
   টেবিল নেই)।
   ========================================================== */
(function (global) {
  "use strict";

  const API = global.API;
  const SALT = global.LFJ_CONFIG.passwordSalt;
  const DEFAULT_SETTINGS = {
    ...global.LFJ_CONFIG,
    shop_name: global.LFJ_CONFIG.defaultShopName,
    shop_address: "",
    shop_phone: "",
    auto_print: true,
    show_thankyou: true,
  };

  /* ---------- সামান্য হেল্পার ---------- */
  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  const p2 = (n) => String(n).padStart(2, "0");
  const todayStr = (d = new Date()) =>
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const nowTime = (d = new Date()) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const num = (v) => {
    const n = Number(v);
    return isFinite(n) ? Math.round(n * 100) / 100 : 0;
  };
  const nonNeg = (v) => Math.max(0, num(v));

  /* ---------- লোকালস্টোরেজ: সেশন + সেটিংস ---------- */
  const SESSION_KEY = "lfj_session_v1";
  const SETTINGS_KEY = "lfj_settings_v1";
  function saveSession(u) {
    try {
      localStorage.setItem(SESSION_KEY, u ? JSON.stringify({ username: u.username, role: u.role }) : "");
    } catch (e) {}
  }
  function readSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      return s && s.username ? { username: s.username, role: s.role } : null;
    } catch (e) {
      return null;
    }
  }
  function loadSettings() {
    let raw;
    try {
      raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    } catch (e) {
      raw = null;
    }
    return { ...DEFAULT_SETTINGS, ...(raw || {}) };
  }
  function saveSettings(s) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  /* ---------- স্টেট ---------- */
  let user = readSession();
  let products = [];
  let employees = [];
  let todayInvoices = [];
  let unsubProducts = null;
  let online = navigator.onLine;
  const listeners = new Set();

  function notify(reason) {
    listeners.forEach((fn) => {
      try {
        fn(reason);
      } catch (e) {
        console.error(e);
      }
    });
  }
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /* ---------- কানেকশন স্ট্যাটাস ---------- */
  function isOnline() {
    return online;
  }
  function setOnline(v) {
    if (online === v) return;
    online = v;
    notify("connection");
  }

  /* ---------- লগইন / লগআউট ---------- */
  function currentUser() {
    return user;
  }

  async function login(username, password) {
    let emp;
    try {
      emp = await API.fetchEmployee(username);
    } catch (e) {
      if (API.isOffline(e)) {
        setOnline(false);
        throw new API.OfflineError("সার্ভারের সাথে সংযোগ হচ্ছে না — ইন্টারনেট চেক করুন");
      }
      throw e;
    }
    setOnline(true);
    if (!emp) throw new Error("ইউজারনেম বা পাসওয়ার্ড ভুল");
    const hash = await sha256(SALT + password);
    if (hash !== String(emp.password_hash || "").toLowerCase())
      throw new Error("ইউজারনেম বা পাসওয়ার্ড ভুল");
    user = { username: emp.username, role: emp.role };
    saveSession(user);
    await refreshAll();
    notify("login");
    return user;
  }

  function logout() {
    user = null;
    saveSession(null);
    stopProductsRealtime();
    products = [];
    employees = [];
    todayInvoices = [];
    notify("logout");
  }

  /* ---------- রিফ্রেশ ---------- */
  async function refreshAll() {
    const me = user;
    if (!me) return;
    try {
      products = await API.fetchProducts();
      employees = await API.fetchEmployees();
      todayInvoices = await API.fetchInvoicesOfDay(todayStr(), me.role === "owner" ? null : me.username);
      setOnline(true);
    } catch (e) {
      if (API.isOffline(e)) setOnline(false);
      else throw e;
    }
    startProductsRealtime();
    notify("sync");
  }

  async function refreshProducts() {
    try {
      const list = await API.fetchProducts();
      products = list;
      notify("products");
    } catch (e) {
      if (API.isOffline(e)) setOnline(false);
      else throw e;
    }
  }

  async function refreshInvoices() {
    if (!user) return;
    try {
      todayInvoices = await API.fetchInvoicesOfDay(
        todayStr(),
        user.role === "owner" ? null : user.username
      );
      notify("bills");
    } catch (e) {
      if (API.isOffline(e)) setOnline(false);
      else throw e;
    }
  }

  /* ---------- পণ্য (Realtime) ---------- */
  function products() {
    return products.slice();
  }
  const priceFor = (p, s) => Number(p["price_" + String(s).toLowerCase()] || 0) || 0;

  function startProductsRealtime() {
    if (unsubProducts) unsubProducts();
    unsubProducts = API.subscribeProducts((payload) => {
      const row = payload.new || payload.old || {};
      const ev = (payload.event || "").toUpperCase();
      if (ev === "DELETE") {
        products = products.filter((p) => p.id !== row.id);
      } else {
        const i = products.findIndex((p) => p.id === row.id);
        if (i >= 0) products[i] = { ...row };
        else products.push({ ...row });
      }
      products.sort((a, b) => String(a.name).localeCompare(String(b.name), "bn"));
      notify("products");
    });
    notify("realtime");
  }
  function stopProductsRealtime() {
    if (unsubProducts) {
      unsubProducts();
      unsubProducts = null;
    }
  }

  function localProduct(body, id) {
    const name = String(body.name || "").trim().slice(0, 120);
    if (!name) throw new Error("পণ্যের নাম লিখুন");
    return {
      id: id || crypto.randomUUID(),
      name,
      price_s: nonNeg(body.price_s),
      price_m: nonNeg(body.price_m),
      price_l: nonNeg(body.price_l),
      updated_at: new Date().toISOString(),
    };
  }

  async function addProduct(body) {
    const res = await API.insertProduct(localProduct(body));
    products.push(res);
    products.sort((a, b) => String(a.name).localeCompare(String(b.name), "bn"));
    notify("products");
    return res;
  }
  async function updateProduct(id, body) {
    const res = await API.updateProduct(id, localProduct(body, id));
    const i = products.findIndex((p) => p.id === id);
    if (i >= 0) products[i] = res;
    notify("products");
    return res;
  }
  async function deleteProduct(id) {
    await API.deleteProduct(id);
    products = products.filter((p) => p.id !== id);
    notify("products");
  }

  /* ---------- স্টাফ (তালিকা ও ফিল্টার জন্য; ম্যানেজমেন্ট নেই) ---------- */
  function employees() {
    return employees.slice();
  }

  /* ---------- সেটিংস (স্থানীয়) ---------- */
  function settings() {
    return { ...loadSettings() };
  }
  function saveSettingsChanges(body) {
    const next = { ...loadSettings(), ...body };
    saveSettings(next);
    notify("settings");
    return settings();
  }

  /* ---------- বিল ---------- */
  /** তারিখ + রানিং কাউন্টার দিয়ে ইনভয়েস নম্বর (কনফ্লিক্টে রি-ট্রি) */
  function nextInvoiceNo(dateStr) {
    return `${dateStr.replace(/-/g, "")}-${String(1).padStart(3, "0")}`;
  }

  async function createInvoice({ customer, paid, lines }, seller) {
    const dateStr = todayStr();
    const datePart = dateStr.replace(/-/g, "");
    const total = Math.round(lines.reduce((s, l) => s + l.qty * l.price, 0) * 100) / 100;
    const paidNum = nonNeg(paid);
    const change = Math.round((paidNum - total) * 100) / 100;
    const items = (Array.isArray(lines) ? lines : []).map((l) => ({
      id: crypto.randomUUID(),
      item: String(l.item || "").trim().slice(0, 120),
      size: String(l.size || "").trim().slice(0, 10),
      qty: Math.max(1, Math.round(num(l.qty) || 1)),
      price: nonNeg(l.price),
    }));
    if (!items.length) throw new Error("কার্ট খালি");
    const customerName = String(customer || "").trim().slice(0, 120) || "Walk-in Customer";
    const sellerName = seller;

    let invRow = null;
    let invoiceNo = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      const count = await API.countInvoicesToday(dateStr);
      const seq = (count || 0) + 1;
      invoiceNo = `${datePart}-${String(seq).padStart(3, "0")}`;
      try {
        invRow = await API.insertInvoice({
          invoice_no: invoiceNo,
          date_disp: dateStr,
          time_disp: nowTime(),
          customer: customerName,
          seller: sellerName,
          total,
          paid: paidNum,
          change,
          created_at: new Date().toISOString(),
        });
        break;
      } catch (e) {
        if (e && e.code === "23505" && attempt < 5) continue; // ইউনিক ভিনিয়ালেশন → আবার চেষ্টা
        if (API.isOffline(e)) setOnline(false);
        throw e;
      }
    }
    if (!invRow) throw new Error("বিল নম্বর বরাত্য পারেনি — আবার চেষ্টা করুন");

    // আইটেম ইনসার্ট (ইনভয়েস ঠিক আছে; আইটেম ফেইল হলে তা দেখাওয়া দরকার)
    try {
      await API.insertInvoiceItems(
        items.map((it) => ({ ...it, invoice_no: invoiceNo }))
      );
    } catch (e) {
      throw new Error(
        "বিল নম্বর " + invoiceNo + " সংরক্ষিত হয়েছে, কিন্তু আইটেম যোগ করা যায়নি — এই নম্বরে আইটেম যোগ করুন।"
      );
    }
    todayInvoices.unshift({ ...invRow });
    notify("bills");
    return { invoice: invRow, items };
  }

  /** স্টাফ -> নিজের বিল; ওনার -> সব (ঐচ্ছিক স্টাফ ফিল্টার) */
  function invoices({ seller, username, role } = {}) {
    let rows = todayInvoices;
    const effSeller = role === "owner" ? seller : username;
    if (effSeller && effSeller !== "all") rows = rows.filter((r) => r.seller === effSeller);
    return rows
      .slice()
      .sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)) ||
        String(b.invoice_no).localeCompare(String(a.invoice_no))
      );
  }

  async function invoiceWithItems(invoiceNo, username, role) {
    const inv = await API.fetchInvoice(invoiceNo);
    if (!inv) throw new Error("বিল পাওয়া যায়নি");
    if (role !== "owner" && inv.seller !== username) throw new Error("এই বিলটি আপনার নয়");
    const items = await API.fetchInvoiceItems(invoiceNo);
    return { invoice: inv, items };
  }

  async function deleteInvoice(invoiceNo) {
    const local = todayInvoices.find((r) => r.invoice_no === invoiceNo);
    if (local && local.pending) {
      todayInvoices = todayInvoices.filter((r) => r.invoice_no !== invoiceNo);
      notify("bills");
      return true;
    }
    await API.removeInvoice(invoiceNo);
    todayInvoices = todayInvoices.filter((r) => r.invoice_no !== invoiceNo);
    notify("bills");
    return true;
  }

  function statsToday({ username, role } = {}) {
    const t = todayStr();
    const rows = todayInvoices.filter(
      (r) => r.date_disp === t && (role === "owner" || r.seller === username)
    );
    return {
      date: t,
      count: rows.length,
      total: Math.round(rows.reduce((s, r) => s + Number(r.total || 0), 0) * 100) / 100,
    };
  }

  /* ---------- লাইজনলস্টেনার: অনলাইন/আফলাইন বাটন ---------- */
  if (global.addEventListener) {
    global.addEventListener("online", () => {
      setOnline(true);
      refreshAll();
    });
    global.addEventListener("offline", () => setOnline(false));
  }

  global.Store = {
    DEFAULT_SETTINGS,
    SESSION_KEY, SETTINGS_KEY,
    todayStr, nowTime, num,
    priceFor,
    currentUser,
    login, logout,
    isOnline,
    products, employees,
    addProduct, updateProduct, deleteProduct,
    refreshProducts, refreshInvoices, refreshAll,
    createInvoice, invoices, invoiceWithItems, deleteInvoice, statsToday,
    settings, saveSettingsChanges,
    onChange,
    nextInvoiceNo,
  };
})(typeof window !== "undefined" ? window : this);

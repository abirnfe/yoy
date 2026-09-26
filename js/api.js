/* ==========================================================
   Live Fruit Juice — সাপবেস ডেটা-অ্যাক্সেস স্তর
   ------------------------------------------------------------
   সরাসরি Supabase REST + Realtime-এর উপর থাকা হালকা wrapper।
   সেশন httpOnly কুকি নয় — কাস্টম লগইন (SHA256) ব্যবহার করে,
   তাই এখানে কোনো গোপন কী থাকে না; প্রকাশনযোগ্য অ্যানন কী নিজে থেকে নিরাপদ।
   ========================================================== */
(function (global) {
  "use strict";

  const cfg = global.LFJ_CONFIG.supabase;
  const sb = global.supabase; // UMD CDN থেকে আসে (window.supabase)

  const client = sb
    ? sb.createClient(cfg.url, cfg.anonKey, {
        db: { schema: "public" },
        auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        realtime: { params: { apikey: cfg.anonKey } },
      })
    : null;

  class ApiError extends Error {
    constructor(message, code, status) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.status = status;
    }
  }
  class OfflineError extends Error {
    constructor(message) {
      super(message || "সার্ভারের সাথে সংযোগ হচ্ছে না — ইন্টারনেট চেক করুন");
      this.name = "OfflineError";
      this.offline = true;
    }
  }

  // সার্ভার/নেটওয়ার্ক ভুল আলালকা করে: নেটওয়ার্ক ব্যাধ = OfflineError, সার্ভারের দোষ = ApiError
  function fromSupabase(err) {
    if (!err) return null;
    if (err.offline) return err;
    // supabase-js নেটওয়ার্ক ব্যাধেরূপে কোডবিহীন একটি বাদাল এরর ফেলে
    const noCode = !err.code && !err.details && !err.hint && !err.status;
    if (noCode) return new OfflineError(err.message);
    return new ApiError(err.message || "অনুরোধ ব্যর্থ হয়েছে", err.code, err.status);
  }

  async function ready() {
    if (!client) throw new OfflineError("সাপবেস ক্লায়েন্ট লোড হয়নি");
  }

  /* ---------- লগইন / সেশন ---------- */
  // ইউজারনেম দিয়ে একজন সদস্য আনে (password_hash + role), না পেলে null
  async function fetchEmployee(username) {
    await ready();
    const { data, error } = await client
      .from("employees")
      .select("username,role,password_hash")
      .eq("username", username)
      .maybeSingle();
    if (error) throw fromSupabase(error);
    return data; // null = পাওয়া যায়নি
  }

  // আজকের স্টাফের তালিকা (ওনারের ফিল্টার ড্রপডাউনের জন্য; password_hash বাদে)
  async function fetchEmployees() {
    await ready();
    const { data, error } = await client
      .from("employees")
      .select("username,role")
      .order("username", { ascending: true });
    if (error) throw fromSupabase(error);
    return data || [];
  }

  /* ---------- পণ্য ---------- */
  async function fetchProducts() {
    await ready();
    const { data, error } = await client
      .from("products")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw fromSupabase(error);
    return data || [];
  }

  async function insertProduct(row) {
    await ready();
    const { data, error } = await client.from("products").insert(row).select().single();
    if (error) throw fromSupabase(error);
    return data;
  }
  async function updateProduct(id, row) {
    await ready();
    const { data, error } = await client
      .from("products")
      .update(row)
      .eq("id", id)
      .select()
      .single();
    if (error) throw fromSupabase(error);
    return data;
  }
  async function deleteProduct(id) {
    await ready();
    const { error } = await client.from("products").delete().eq("id", id);
    if (error) throw fromSupabase(error);
    return true;
  }

  // Realtime — স্টাফের স্ক্রিনে পণ্য আপডেট রিয়েলটাইমে দেখা যাক (mid-sale ও)
  // payload.shape = { event, new, old }
  function subscribeProducts(onChange) {
    if (!client) return () => {};
    const channel = client
      .channel("public:products")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        (payload) => onChange(payload)
      )
      .subscribe();
    return () => client.removeChannel(channel);
  }

  /* ---------- বিল ---------- */
  // আজকের বিলের সংখ্যা (রানিং কাউন্টার জন্য)
  async function countInvoicesToday(dateStr) {
    await ready();
    const { count, error } = await client
      .from("invoices")
      .select("*", { count: "exact", head: true })
      .eq("date_disp", dateStr);
    if (error) throw fromSupabase(error);
    return count || 0;
  }

  async function fetchInvoicesOfDay(dateStr, seller) {
    await ready();
    let q = client
      .from("invoices")
      .select("*")
      .eq("date_disp", dateStr)
      .order("created_at", { ascending: false });
    if (seller) q = q.eq("seller", seller);
    const { data, error } = await q;
    if (error) throw fromSupabase(error);
    return data || [];
  }

  async function fetchInvoice(invoiceNo) {
    await ready();
    const { data, error } = await client
      .from("invoices")
      .select("*")
      .eq("invoice_no", invoiceNo)
      .maybeSingle();
    if (error) throw fromSupabase(error);
    return data; // null = পাওয়া যায়নি
  }

  async function fetchInvoiceItems(invoiceNo) {
    await ready();
    const { data, error } = await client
      .from("invoice_items")
      .select("*")
      .eq("invoice_no", invoiceNo)
      .order("id", { ascending: true });
    if (error) throw fromSupabase(error);
    return data || [];
  }

  async function insertInvoice(inv) {
    await ready();
    const { data, error } = await client.from("invoices").insert(inv).select().single();
    if (error) throw fromSupabase(error);
    return data;
  }

  async function insertInvoiceItems(items) {
    await ready();
    const { error } = await client.from("invoice_items").insert(items);
    if (error) throw fromSupabase(error);
    return items;
  }

  async function removeInvoice(invoiceNo) {
    await ready();
    const { error: e1 } = await client
      .from("invoice_items")
      .delete()
      .eq("invoice_no", invoiceNo);
    if (e1) throw fromSupabase(e1);
    const { error: e2 } = await client
      .from("invoices")
      .delete()
      .eq("invoice_no", invoiceNo);
    if (e2) throw fromSupabase(e2);
    return true;
  }

  global.API = {
    ApiError,
    OfflineError,
    isOffline: (e) => e && (e.offline || e instanceof OfflineError),
    fetchEmployee,
    fetchEmployees,
    fetchProducts,
    insertProduct,
    updateProduct,
    deleteProduct,
    subscribeProducts,
    countInvoicesToday,
    fetchInvoicesOfDay,
    fetchInvoice,
    fetchInvoiceItems,
    insertInvoice,
    insertInvoiceItems,
    removeInvoice,
  };
})(typeof window !== "undefined" ? window : this);

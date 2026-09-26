/* ==========================================================
   Live Fruit Juice — সাপবেস কনফিগারেশন
   ------------------------------------------------------------
   Supabase-এর প্রকাশনযোগ্য (anon/publishable) কী ব্যবহার করা হয় —
   এটি ব্রাউজারে রাখার পূর্বনির্ধারিত। একটি আলাদা "ডাটাবেস পাসওয়ার্ড"
   লাগে না। আপনার নিজস্ব Supabase প্রকল্প ব্যবহারে এই মানগুলো বদলে দিন।
   ========================================================== */
window.LFJ_CONFIG = {
  supabase: {
    url: "https://uhochtoeoadownmarnjr.supabase.co",
    anonKey: "sb_publishable_skYkpimFuG4I9Feg9OFCPg_rrquN8gE",
  },
  // কাস্টম অথেনটিকেশন: SHA256(salt + password)
  passwordSalt: "livefruitjuice_salt_",
  defaultShopName: "Live Fruit Juice",
};

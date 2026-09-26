# Live Fruit Juice — স্টাফ বিলিং (v3 সাপবেস)

দোকান কাউন্টারে ফোন/ট্যাবলেটে ব্যবহারের জন্য একটি স্ট্যাটিক, মোবাইল‑ফ্রেন্ডলি POS বিলিং
অ্যাপ। বাংলা ইন্টারফেস, ৫৮mm রিসিট প্রিন্ট — আর ব্যাকএন্ড **Supabase**-এ (আপনার নিজস্ব
প্রকল্প)। কোনো npm প্যাকেজ লাগে না, কোনো build কমান্ড লাগে না।

---

## মূল বৈশিষ্ট্য

| ফিচার | বিবরণ |
|---|---|
| **ব্যাকএন্ড** | Supabase REST + Realtime (প্রকাশনযোগ্য anon কী, সরাসরি ব্রাউজার থেকে) |
| **কাস্টম লগইন** | `SHA256("livefruitjuice_salt_" + password)` → `employees.password_hash`-এর সাথে তুলনা |
| **স্টাফ রোল** | নিজের বিল দেখতে ও প্রিন্ট করতে পারে |
| **ওনার রোল** | সব স্টাফের বিল দেখে, স্টাফ ফিল্টার, পণ্য যোগ/এডিট/ডিলিট |
| **পণ্য রিয়েলটাইম** | ডেস্কটপ অ্যাপে পণ্য বদলালেই স্ক্রিনে তৎক্ষণাৎ আপডেট |
| **বিলিং** | পণ্য + S/M/L, কার্ট, লাইভ টোটাল/ফেরত/বাকি |
| **রিসিট** | ৫৮mm, `window.print()`, অটো‑প্রিন্ট, রিপ্রিন্ট |
| **PWA** | মোবাইলে "Add to Home Screen" করা যায় |

> **দ্রষ্টব্য:** স্টাফ ও পণ্যের ম্যানেজমেন্ট **ডেস্কটপ exe অ্যাপে** করা হয়
> (Supabase‑এর `employees` / `products` টেবিলের উপর সরাসরি লিখে)। এই ওয়েব অ্যাপে
> স্টাফ ম্যানেজমেন্ট নেই; ওনারজন্য পণ্য আপডেটের পৃথক স্ক্রিন আছে।

---

## প্রথমবার ব্যবহার

**লগইন:** `owner` / `owner123`

পাসওয়ার্ড হ্যাশ প্রথমে সঠিকভাবে সেট করা আছে। নতুন স্টাফ যোগ করতে ডেস্কটপ অ্যাপ ব্যবহার করুন।

---

## Supabase সেটাপ

### ১. টেবিল (যেমনা আছে, কাঠামো না বদলে)

```sql
employees (id uuid, username text unique, password_hash text, role text, created_at timestamptz)
products  (id uuid, name text, price_s numeric, price_m numeric, price_l numeric, updated_at timestamptz)
invoices  (invoice_no text primary key, date_disp text, time_disp text,
           customer text, seller text, total numeric, paid numeric, change numeric, created_at timestamptz)
invoice_items (id uuid, invoice_no text references invoices, item text, size text, qty numeric, price numeric)
```

### ২. পাসওয়ার্ড হ্যাশিং (কাস্টম Auth)

ওয়েব অ্যাপের কোনো Supabase Auth নয়। পাসওয়ার্ড হ্যাশ সরাসরি ব্রাউজারে হয়:

```
SHA256("livefruitjuice_salt_" + password)   →   64 অক্ষরের hex
```

ডেস্কটপ অ্যাপও একই সাল্ট+পদ্ধতিতে হ্যাশ করতে হবে। উদাহরণ (owner/owner123):

```sql
INSERT INTO employees (username, role, password_hash)
VALUES ('owner', 'owner', '524038ae127e7d85a35b62829f4b980fc43dcc45af84cb040c7bb11d7243f5ac');
-- 524038ae... = sha256("livefruitjuice_salt_owner123")
```

### ৩. রিয়েলটাইম (পণ্য)

Supabase ড্যাশবোর্ড → **Database → Replication**‑এ যান এবং `products` টেবিলটি
রিয়েলটাইমের জন্য **টগল করুন** (publication সহজ ON করে)। এতে ডেস্কটপ অ্যাপে
পণ্য বদলালেই স্টাফের স্ক্রিন আপডেট পায়। (না টগল করলেও পণ্য পেজ ওপেন‑তেই রিফ্রেশ হয়।)

### ৪. RLS (ঐচ্ছিক, প্রোডাকশনে পরামর্শযোগ্য)

ডিফল্ট `anon` রোল পঢ়তে/লিখতে পারে। আরও নিরাপদ করতে চাইলে স্টাফ‑ভিত্তিক RLS পলিসি যোগ করুন।
লগইন‑এর সময় `password_hash` পড়ে — এটা কাস্টম লগইনের অপরিহার্য অংশ; `password_hash` কাউকে
না দিতে চাইলে সার্ভার‑সাইড ফাংশন দিয়ে অথেন্টিকেট করুন (এই সংস্করণে না রয়েছে)।

### ৫. কনফিগ (ঐচ্ছিক)

`js/config.js`-এ Supabase URL ও anon কী আছে। আপনার নিজস্ব প্রকল্প হলে এগুলো বদলুন।

---

## রোল ও অনুমতি

| রোল | বিলিং | আজকের বিলসমূহ | পণ্য ম্যানেজ | সেটিংস |
|---|---|---|---|---|
| **staff** | ✓ | নিজের বিল শুধুমাত্র | ✗ | ✗ |
| **owner** | ✓ | সব বিল (স্টাফ ফিল্টার) | ✓ | ✓ |

---

## Vercel‑এ ডিপ্লয় (২ ধাপ)

১. এই ফোল্ডারটি GitHub‑এ পুশ করুন।
২. Vercel‑এ **Add New → Project** → রিপো সিলেক্ট → **Deploy**।

কোনো build কমান্ড বা environment variable লাগে না — এটা শুধু স্ট্যাটিক সাইট।
Supabase‑এর anon কীটি `js/config.js`-এ রয়েছে (প্রকাশনযোগ্গ্য)।

---

## ট্রাবলশুটিং

- **"সার্ভারের সাথে সংযোগ হচ্ছে না"** → `js/config.js`-এর URL/কী ঠিক আছে কি, ও Supাবেস
  প্রকল্পের `anon` কী এই মান নিয়ে আছে কি চেক করুন।
- **লগইন হচ্ছে না** → `employees.password_hash`-এ `sha256("livefruitjuice_salt_" + password)`
  সঠিকভাবে আছে কি নিশ্চিত করুন (ডেস্কটপ অ্যাপ যে পদ্ধতিতে হ্যাশ করে সে মতো)।
- **পণ্য আপডেট না হওয়া** → Supabase রিয়েলটাইম publication‑এ `products` টগল করুন।
- **রিসিট পেজে পেজ বাকি আসছে** → প্রিন্ট ডায়ালগে "Paper size" 58mm / Custom সিলেক্ট করুন।

# دليل الترحيل والنشر الكامل على Cloudflare — Rental Gate CRM

يغطي هذا الدليل كل ما يلزم لتشغيل ونشر **Rental Gate CRM** بالكامل على **Cloudflare Workers + Workers Static Assets + Neon PostgreSQL** مع الحفاظ على Google Apps Script وGoogle Sheets والواجهات الحالية دون أي تغيير في التصميم أو الصلاحيات.

---

## ملخص سريع: ما الذي تم تلقائيًا وما الذي يتطلب إعدادًا يدويًا؟

### ✅ تم تجهيزه تلقائيًا في الكود
1. نقطة دخول Cloudflare Worker متكاملة (`backend/worker.ts`) تدعم جميع مسارات الـ API (`/api/health`, `/api/crm`, `/api/sync`) وتخدم الواجهة المبنية (`dist/`) عبر `ASSETS`.
2. محول اتصال Neon PostgreSQL متوافق مع Cloudflare Workers (`backend/cfDb.ts`) عبر `@neondatabase/serverless` مع دعم **Hyperdrive** اختياريًا.
3. تضمين هيكل قاعدة البيانات داخل الباك إند (`backend/schemaSql.ts`) وإزالة الاعتماد على `fs`/`path`/`createRequire` من مسار الـ Worker.
4. توحيد قراءة متغيرات البيئة (`backend/env.ts`) لدعم كل من Cloudflare Worker `env` وNode.js/Vercel `process.env`، وربط المهام الخلفية مع `ctx.waitUntil`.
5. إعداد `wrangler.jsonc` مع `nodejs_compat`، توجيه `/api/*` أولًا للـ Worker، دعم SPA للواجهة، وجدولة Cron Trigger.
6. إعداد قوالب المتغيرات `.dev.vars.example` و`.env.example` وحماية الأسرار عبر `.gitignore`.
7. الحفاظ الكامل على ملفات Express (`server.ts`)، Vercel (`vercel.json` + `api/*`)، GitHub Pages (`.github/workflows/deploy.yml`)، وGoogle Apps Script (`google-apps-script/*`).

### 🔧 يتطلب إعدادًا يدويًا من حسابك
1. إنشاء حساب Cloudflare (مجاني) وربط مستودع GitHub (`za7adalarbi-commits/rentcrm`).
2. إضافة متغيرات البيئة والأسرار (`DATABASE_URL`, `SYNC_API_SECRET`, إلخ) في لوحة Cloudflare Worker.
3. تحديث رابط `NEON_SYNC_URL` في Google Apps Script ليُشير إلى رابط Cloudflare Worker الجديد (`https://<your-worker>.workers.dev/api/sync`).
4. (اختياري) ربط نطاقك المخصص (Custom Domain) من لوحة Cloudflare.

### 💳 خدمات مدفوعة مقابل المجانية (Free-Tier Limitations)
- **Cloudflare Workers Free Plan (مجاني):**
  - يدعم **Static Assets + API Worker** في مشروع واحد، **100,000 طلب يوميًا**، وما يصل إلى **5 Cron Triggers**.
  - **ملاحظة:** حد وقت المعالج (CPU time) في الخطة المجانية هو `10ms` لكل طلب (الوقت المستغرق في انتظار استعلامات Neon PostgreSQL أو fetch لا يُحتسب ضمن الـ 10ms CPU).
  - **ملاحظة Cron:** `wrangler.jsonc` مضبوط افتراضيًا على `*/15 * * * *` (كل 15 دقيقة) لتقليل استهلاك ساعات تشغيل **Neon Free Plan** (`100 CU-hours/شهر` — لأن السيرفر ينام بعد 5 دقائق من عدم النشاط، وتشغيل Cron كل دقيقة يبقيه مستيقظًا 720 ساعة شهريًا!).
- **Cloudflare Hyperdrive (اختياري):** غير مطلوب مع Neon مجانًا لأن `@neondatabase/serverless` يتصل مباشرة عبر WebSockets. إذا أردت تفعيله لاحقًا لتقليل زمن الاتصال عند الأحمال العالية (يتوفر ضمن باقات Cloudflare المدفوعة/Workers Paid أو الحد المتاح في حسابك)، فقط أضف `hyperdrive` في `wrangler.jsonc` وسيتعرف الكود عليه تلقائيًا.
- **Cloudflare R2:** غير مطلوب حاليًا لأن النظام لا يحتوي على رفع ملفات على السيرفر (تصدير Excel/PDF يتم بالكامل داخل المتصفح).

---

## 1. المتغيرات البيئية المطلوبة (Environment Variables)

| المتغير | النوع | أين يُضبط؟ | الوصف |
|---|---|---|---|
| `DATABASE_URL` | **سري (Server Only)** | Cloudflare Secret / `.dev.vars` | رابط اتصال Neon PostgreSQL شامل `?sslmode=require` |
| `SYNC_API_SECRET` | **سري (Server Only)** | Cloudflare Secret / `.dev.vars` | مفتاح مشترك عشوائي (32+ حرف) للمزامنة مع Google Apps Script |
| `GAS_WEBAPP_URL` | **سري (Server Only)** | Cloudflare Secret / `.dev.vars` | رابط نشر Google Apps Script Web App (`/exec`) للمزامنة العكسية مع Sheets |
| `RG_TOKEN` | **سري (Server Only)** | Cloudflare Secret / `.dev.vars` | توكن Rental Gate API (اختياري إذا كان السحب يتم من Apps Script) |
| `RG_API_BASE_URL` | عام | `wrangler.jsonc` (`vars`) | افتراضي: `https://api.rentalgate.net/api` |
| `CORS_ALLOWED_ORIGINS` | **إعداد خادم** | Cloudflare Var / `.dev.vars` | روابط الواجهة المسموح لها بالاتصال (مثال: `https://crm.yourdomain.com`)؛ اتركه فارغًا عند استضافة الواجهة والـ Worker معًا |
| `SEED_ADMIN_PASSWORD` | **سري (اختياري)** | Cloudflare Secret / `.dev.vars` | كلمة مرور المدير الافتراضية عند تهيئة قاعدة فارغة لأول مرة |
| `VITE_BACKEND_API_URL` | عام (Build) | Vite env (اختياري) | اتركه فارغًا عند النشر الموحد (المتصفح يكتشف `/api/crm` تلقائيًا عبر `/api/health`) |
| `VITE_GAS_WEBAPP_URL` | عام (Build) | Vite env (اختياري) | رابط `/exec` احتياطي للواجهة |

> **تحذير أمني:** لا تضف أبدًا `DATABASE_URL` أو `SYNC_API_SECRET` أو `RG_TOKEN` كبادئة `VITE_*` حتى لا تُدمج في ملفات المتصفح.

---

## 2. التشغيل المحلي والاختبار (Local Development with Wrangler)

1. انسخ قالب المتغيرات المحلي وأضف بيانات Neon الحقيقية:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
2. ثبّت الحزم وابنِ الواجهة:
   ```bash
   npm install
   npm run cf:build
   ```
3. شغّل بيئة Cloudflare Worker محليًا عبر Wrangler:
   ```bash
   npx wrangler dev
   ```
4. افتح المتصفح على العنوان الذي يظهره Wrangler (عادةً `http://localhost:8787`) وتحقق من:
   - `http://localhost:8787/api/health` → يعيد `connected: true` و`runtime: "cloudflare-workers"`.
   - تسجيل الدخول واستعراض الحجوزات وتصدير Excel وPDF.

*(ملاحظة: يظل تشغيل Express المحلي متاحًا كما هو عبر `npm run dev` على المنفذ `3000`.)*

---

## 3. خطوات النشر للمبتدئين على Cloudflare (من الصفر)

### الخطوة 1: إنشاء حساب Cloudflare
1. ادخل إلى [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) وأنشئ حسابًا مجانيًا.
2. فعّل الحساب عبر رسالة البريد الإلكتروني.

### الخطوة 2: ربط مستودع GitHub (`za7adalarbi-commits/rentcrm`)
1. من القائمة الجانبية في لوحة Cloudflare، اختر **Compute (Workers & Pages) → Workers & Pages**.
2. اضغط **Create** → اختر **Import a repository** (أو **Continue with GitHub**).
3. امنح Cloudflare صلاحية الوصول لمستودع `za7adalarbi-commits/rentcrm`.
4. في إعدادات البناء (Build Configuration):
   - **Project name:** `rental-gate-crm`
   - **Build command:** `npm run cf:build`
   - **Deploy command:** `npx wrangler deploy`
   - *(ملاحظة: لن تحتاج لتعيين Output Directory بشكل منفصل لأن `wrangler.jsonc` يقرأ `./dist` تلقائيًا عبر Workers Static Assets).*
5. اضغط **Save and Deploy** (أول نشر سيتم بناؤه، ثم نضيف متغيرات البيئة).

### الخطوة 3: ضبط متغيرات البيئة والأسرار في Cloudflare
1. افتح المشروع `rental-gate-crm` داخل **Workers & Pages**.
2. اذهب إلى **Settings → Variables and Secrets**.
3. أضف المتغيرات التالية من نوع **Secret (مشفر)**:
   - `DATABASE_URL` = رابط قاعدة Neon PostgreSQL الخاص بك (نفس الرابط الموجود لديك في Vercel).
   - `SYNC_API_SECRET` = نفس قيمة `SYNC_API_SECRET` المربوطة في Google Apps Script.
   - `GAS_WEBAPP_URL` = رابط `/exec` الخاص بمشروع Google Apps Script (إن وجد).
   - `RG_TOKEN` = توكن Rental Gate (اختياري إذا كان السحب المباشر مفعّلًا).
4. احفظ التغييرات ثم أعد النشر (**Deployments → Retry deployment**) أو من جهازك نفّذ:
   ```bash
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put SYNC_API_SECRET
   npm run cf:deploy
   ```

### الخطوة 4: التأكد من اتصال قاعدة البيانات (Neon PostgreSQL)
- **لا تحذف أو تعيد إنشاء قاعدة Neon!** المشروع متصل بنفس `DATABASE_URL` وبنفس الجداول العشرين وسجلاتك الحالية.
- افتح الرابط `https://rental-gate-crm.<your-subdomain>.workers.dev/api/health`:
  - يجب أن ترى:
    ```json
    {
      "ok": true,
      "service": "RENTAL GATE CRM",
      "runtime": "cloudflare-workers",
      "databaseConfigured": true,
      "connected": true
    }
    ```

### الخطوة 5: تحديث Google Apps Script ليتزامن مع Cloudflare
1. افتح مشروع Google Apps Script الخاص بالنظام.
2. من المحرر، حدّث خاصية `NEON_SYNC_URL` (أو نفّذ الدالة `setNeonSyncProperties` مرة واحدة) بالرابط الجديد:
   ```javascript
   setNeonSyncProperties("https://rental-gate-crm.<your-subdomain>.workers.dev/api/sync", "YOUR_SYNC_API_SECRET");
   ```
3. يظل Google Apps Script قادرًا على سحب الحجوزات كل دقيقة ودفع التحديثات الفورية لقاعدة Neon بنفس الطريقة السابقة تمامًا.

### الخطوة 6: اختبار التطبيق بعد النشر
1. افتح رابط التطبيق على Cloudflare وسجّل الدخول بحسابك الحالي.
2. تأكد من ظهور الحجوزات، تفاصيل الحجز، التمديدات، المتابعات، والمشكلات.
3. جرّب:
   - تعديل حالة حجز أو إضافة متابعة للتأكد من الحفظ في Neon والمزامنة مع Google Sheets.
   - زر تصدير **Excel (.xlsx)** وزر تصدير **PDF** للتأكد من تنزيل الملفات باللغة العربية بشكل سليم.
   - صفحة الإعدادات → **اختبار الاتصال** و**سحب الحجوزات الآن**.

### الخطوة 7: ربط الدومين النهائي (Custom Domain)
1. داخل صفحة Worker في Cloudflare، اذهب إلى **Settings → Domains & Routes**.
2. اضغط **Add → Custom Domain** (إذا كان الدومين مضافًا مسبقًا على Cloudflare DNS).
3. اكتب الدومين الفرعي أو الرئيسي (مثل `crm.yourdomain.com`) واضغط **Add Domain**.
4. يصدر Cloudflare شهادة SSL تلقائيًا خلال دقائق.
5. (مهم) إذا استخدمت دومينًا مخصصًا، حدّث `NEON_SYNC_URL` في Google Apps Script ليستخدم الدومين الجديد (`https://crm.yourdomain.com/api/sync`).

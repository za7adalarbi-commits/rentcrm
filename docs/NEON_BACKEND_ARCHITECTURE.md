# RENTAL GATE CRM — Neon PostgreSQL Hybrid Cloud Architecture

## نظرة عامة على البنية المعمارية (Architecture Overview)

يجمع النظام بين:
1. **واجهة المستخدم الحالية بالكامل** (HTML/CSS/JS + IndexedDB Cache) بدون أي تغيير في التصميم أو الصفحات أو تجربة الاستخدام.
2. **Neon PostgreSQL** كقاعدة بيانات سحابية رئيسية مصممة لاستيعاب +100,000 حجز مع فهارس B-tree وGIN (`pg_trgm`) ومعاملات `ACID`.
3. **Backend API آمن** (`/api/crm`، `/api/sync`، `/api/health`) يعمل محليًا عبر Express (`server.ts`) وعلى Vercel كـ Serverless Functions (`/vercel.json`).
4. **Google Apps Script + Google Sheets**:
   - يستمر Apps Script في سحب الحجوزات والتمديدات من Rental Gate API (مصدر الحجوزات الأصلي).
   - يقوم `NeonSync.gs` بدفع التغييرات التزايدية فقط (**Incremental Sync**) إلى `/api/sync` مع منع التكرار وإعادة المحاولة التلقائية.
   - تظل جداول **Google Sheets** محدثة كنسخة احتياطية ومصدر تقارير عبر قائمة `sheets_mirror_outbox` ودالة `syncFromNeonMirror`.

---

## 1. إعداد قاعدة بيانات Neon PostgreSQL (متغير بيئة واحد فقط على Vercel)

1. أنشئ مشروعًا مجانيًا على [Neon](https://neon.tech) واحصل على `DATABASE_URL` (مع `sslmode=require`).
2. أضف متغير بيئة **واحد فقط** في `.env` أو في **Vercel Environment Variables**:

```bash
DATABASE_URL="postgresql://user:password@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

3. تطبيق هيكل الجداول والفهارس:
```bash
node scripts/migrate-from-sheets.mjs --schema-only
```
*(كما يقوم السيرفر بتهيئة الجداول والبذور الافتراضية تلقائيًا عند أول طلب إذا كانت القاعدة فارغة، ويتصل أي مستخدم يفتح رابط الموقع تلقائيًا بـ `/api/crm` عبر `/api/health`.)*

---

## 2. النسخ الاحتياطي والترحيل من Google Sheets

* **أخذ نسخة احتياطية قبل أي ترحيل:**
```bash
node scripts/backup-db.mjs
```
يتم حفظ النسخة داخل مجلد `backups/` (المُستثنى من Git).

* **ترحيل البيانات من لقطة JSON مُصدرة من Google Sheets:**
```bash
node scripts/migrate-from-sheets.mjs --input path/to/sheets-export.json
```
*(يفحص السكربت وجود نسخة احتياطية وينشئ نسخة `pre-migration-*.json` تلقائيًا قبل بدء الترحيل داخل Transaction آمنة.)*

---

## 3. الربط التلقائي من صفحة الإعدادات مع Google Apps Script

1. انسخ محتوى `google-apps-script/` (`NeonSync.gs`, `Utils.gs`, `RentalGateAPI.gs`, `Code.gs`, `Triggers.gs`) إلى مشروع Apps Script وانشره كـ **Web App (`/exec`)**.
2. افتح صفحة **الإعدادات** داخل الموقع بحساب المدير العام وأدخل:
   - **رابط Web App (`/exec`)**: يُحفظ عالميًا في جدول `settings` في Neon لجميع المستخدمين.
   - **Rental Gate API Token**: يُشفر بـ AES-256-GCM داخل Neon دون الحاجة لإعادة ضبط Vercel.
3. فور الحفظ من الإعدادات، يولّد السيرفر `SYNC_API_SECRET` تلقائيًا ويرسله مشفرًا مع `NEON_SYNC_URL` والتوكن عبر `autoBindFromServer` إلى Apps Script مع تفعيل المزامنة التلقائية كل دقيقة (`scheduledMinuteSync`).
4. يستخدم Apps Script بصمة SHA-256 لكل حجز وتمديد في `CacheService`/`PropertiesService` لإرسال **الحجوزات والتمديدات الجديدة أو المعدلة فقط** على دفعات مع `Retry + Backoff` وتسجيل آخر وقت ناجح للمزامنة.

---

## 4. قواعد حل التعارض (Conflict Resolution)

- إذا تغيرت حالة الحجز الأصلية في Rental Gate (مثلًا من `CONFIRMED` إلى `ACTIVE` = `ناشط`)، يتم تحديث `internalStatus` وإضافة المرحلة في `statusHistory` و`follow_up_history`.
- إذا لم تتغير حالة المصدر في Rental Gate، يحتفظ النظام بتعديلات الموظفين (`internalStatus`, `priority`, `assignedEmployeeIds`, `lastUpdateText`, `statusHistory`) دون مساس.

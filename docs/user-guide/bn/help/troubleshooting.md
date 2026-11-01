<!-- guide:meta
feature: help.troubleshooting
title: সমস্যা হলে কী করবেন
summary: সাইন ইন, ফোনে ইনস্টল, অফলাইন হাজিরা, ফির ভুল, প্রিন্ট আর এসএমএসের চেনা সমস্যা: স্ক্রিনে কী লেখা আসে, কেন আসে, কীভাবে ঠিক করবেন।
roles: [TEACHER, ADMIN, EXECUTIVE, ACCOUNTANT, OFFICE_STAFF, EXAM_CONTROLLER, COMMITTEE, PARENT, STUDENT]
sources:
  - ui/src/i18n/locales/bn/auth.json
  - ui/src/i18n/locales/bn/common.json
  - ui/src/i18n/locales/bn/attendance.json
  - ui/src/i18n/locales/bn/printPreview.json
  - ui/src/i18n/locales/bn/communications.json
  - server/src/common/filters/known-errors.ts
labels:
  [
    auth:errors.*,
    common:offline.*,
    common:sync.*,
    attendance:mark.submitOffline,
    attendance:mark.queuedToast,
    printPreview:popupBlocked,
    communications:send.smsNotReady.*,
  ]
helpIds: [help.troubleshooting]
devices: [desktop, phone]
entry: [sidebar]
keywords:
  [সমস্যা, সমাধান, কাজ করছে না, ঢুকতে পারছি না, পাসওয়ার্ড ভুল, অফলাইন, প্রিন্ট হচ্ছে না, এসএমএস যায়নি, ভুল পেমেন্ট, troubleshooting, error, problem, not working, SMS failed]
appVersion: 0.1.0 (21aad534a)
owner: tareq89
lastVerified: 2026-10-25
knownIssues: []
-->

# সমস্যা হলে কী করবেন

সাইন ইন, ফোনে ইনস্টল, অফলাইন হাজিরা, ফির ভুল, প্রিন্ট আর এসএমএসের চেনা সমস্যা এখানে এক জায়গায়। প্রতিটির জন্য আছে: স্ক্রিনে কী লেখা আসে, কেন আসে, আর কীভাবে ঠিক করবেন।

**কীভাবে খুঁজবেন:** স্ক্রিনের লাল বা হলুদ বার্তাটি পড়ুন। নিচে সেই লেখাটি খুঁজুন (কম্পিউটারে Ctrl আর F চাপলে পাতার ভেতরে খোঁজা যায়)। না পেলে যে পাতায় কাজ করছিলেন, সেই পাতার **সমস্যা ও সমাধান** অংশ দেখুন।

<figure>
  <img src="diagrams/help-troubleshooting.svg" alt="সমস্যা হলে তিন ধাপ: স্ক্রিনের বার্তা পড়ুন, এই পাতায় সেই বার্তা খুঁজে কারণ ও সমাধান দেখুন, না মিটলে স্কুলের অ্যাডমিনকে বার্তাটি সহ জানান" width="720" />
</figure>

**এই পাতায় যা আছে**

- [সাইন ইন](#signin)
- [ফোন ও অ্যাপ ইনস্টল](#phone)
- [অফলাইনে উপস্থিতি](#offline)
- [ফির ভুল](#fees)
- [প্রিন্ট](#print)
- [এসএমএস পৌঁছায়নি](#sms)
- [কোনো পাতা বা বোতাম দেখছেন না](#cant-see)
- [তবুও না মিটলে](#help)

---

## সাইন ইন <a href="#signin" id="signin"></a>

### "ইমেইল/ফোন অথবা পাসওয়ার্ড সঠিক নয়।"

- **কেন:** নম্বর, ইমেইল বা পাসওয়ার্ডের কোনো একটি মেলেনি। <!-- source: ui/src/i18n/locales/bn/auth.json errors.invalidCredentials -->
- **কী করবেন:**
  1. নম্বর বা ইমেইল আবার দেখে লিখুন।
  2. পাসওয়ার্ড আবার মন দিয়ে লিখুন।
  3. মনে না পড়লে [পাসওয়ার্ড ভুলে গেলে](../start/sign-in.md#task-forgot) দেখুন।

### "সঠিক ইমেইল অথবা ১১ সংখ্যার ফোন নম্বর দিন।"

- **কেন:** ফোন নম্বর পুরো ১১ সংখ্যার নয়, বা ইমেইলের গঠন ঠিক নেই। <!-- source: ui/src/i18n/locales/bn/auth.json identifier.invalid -->
- **কী করবেন:** নম্বরটি ০ দিয়ে শুরু করে পুরো ১১ সংখ্যা লিখুন, যেমন `01712345678`। <!-- source: docs/user-guide/bn/start/sign-in.md#trouble -->

### "অনেকবার চেষ্টা করা হয়েছে। … সেকেন্ড পর আবার চেষ্টা করুন।"

- **কেন:** অল্প সময়ে অনেকবার ভুল চেষ্টা হয়েছে। নিরাপত্তার জন্য অ্যাপ কিছুক্ষণ থামায়। <!-- source: ui/src/i18n/locales/bn/auth.json errors.rateLimited_* -->
- **কী করবেন:** বার্তায় লেখা সময় অপেক্ষা করুন, তারপর আবার চেষ্টা করুন।

### "এই অ্যাকাউন্ট কোনো স্কুলের সাথে যুক্ত নেই। …"

- **কেন:** আপনার অ্যাকাউন্ট আছে, কিন্তু কোনো স্কুল আপনাকে যোগ করেনি। <!-- source: ui/src/i18n/locales/bn/auth.json errors.noMemberships -->
- **কী করবেন:** স্কুলের অ্যাডমিনকে বলুন আপনাকে যোগ করতে। কর্মী হলে [কর্মী যোগ](../people/staff.md#task-main), অভিভাবক হলে [অভিভাবকের আমন্ত্রণ](../people/guardians.md) পাতা অ্যাডমিনের জন্য।

### "এই অ্যাকাউন্টটি স্থগিত করা হয়েছে।"

- **কেন:** আপনি আমন্ত্রণের লিংক খুলেছেন, কিন্তু স্কুল আপনার অ্যাকাউন্ট বন্ধ রেখেছে। <!-- source: client-admin/src/routes/activate.tsx (status suspended); ui/src/i18n/locales/bn/auth.json activate.suspended -->
- **কী করবেন:** স্কুলের অফিসে যোগাযোগ করুন। শুধু স্কুলই এটি খুলতে পারে।

### কোড আসছে না

- **কেন:** নম্বর ভুল, ফোনে নেটওয়ার্ক নেই, বা ইমেইলের কোড স্প্যামে গেছে। <!-- source: docs/user-guide/bn/start/sign-in.md#trouble -->
- **কী করবেন:**
  1. নম্বরটি ঠিক কি না দেখুন।
  2. ইমেইল হলে স্প্যাম ফোল্ডার দেখুন।
  3. কয়েকবার চেষ্টার পরও না এলে এক ঘণ্টা পরে আবার চেষ্টা করুন।

ডেমো সাইট বা স্টেজিং সাইটে কোনো কোড ফোন বা ইমেইলে যায় না। কোডটি **টেস্ট ইনবক্সে** পাবেন। পাতার উপরের বারে বা কোডের ঘরের নিচের লাইনে **টেস্ট ইনবক্স খুলুন** চাপুন। ধাপগুলো: [ডেমো সাইটে কোড ও বার্তা কোথায় যায়?](../start/sign-in.md#task-test-inbox) <!-- source: ui/src/i18n/locales/bn/auth.json help.testInbox -->

### "এই লিংকের মেয়াদ শেষ হয়ে গেছে।"

- **কেন:** আমন্ত্রণের লিংক পুরোনো হয়ে গেছে। পাসওয়ার্ড বদলের লিংক পুরোনো বা আগে ব্যবহার করা হলে লেখা আসে **এই লিংকের মেয়াদ শেষ হয়ে গেছে অথবা ইতিমধ্যে ব্যবহার করা হয়েছে।** <!-- source: client-admin/src/routes/activate.tsx; client-admin/src/routes/reset-password.tsx; ui/src/i18n/locales/bn/auth.json activate.expired, forgot.linkExpired -->
- **কী করবেন:** আমন্ত্রণের লিংক হলে [আমন্ত্রণের লিংক পেলে](../start/sign-in.md#task-invite), রিসেটের লিংক হলে [পাসওয়ার্ড ভুলে গেলে](../start/sign-in.md#task-forgot) দেখুন।

### "কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন।"

- **কেন:** সাধারণত ইন্টারনেটের সমস্যা। <!-- source: ui/src/i18n/locales/bn/auth.json errors.generic -->
- **কী করবেন:** ইন্টারনেট দেখে আবার চেষ্টা করুন। বারবার হলে অ্যাডমিনকে জানান।

সাইন ইনের সব বার্তা: [সাইন ইন করা → সমস্যা ও সমাধান](../start/sign-in.md#trouble)।

---

## ফোন ও অ্যাপ ইনস্টল <a href="#phone" id="phone"></a>

### মেনুতে "অ্যাপ ইনস্টল করুন" নেই

- **কেন:** অ্যাপ হয়তো আগেই ইনস্টল করা, বা ব্রাউজার এখনো সুযোগ দেয়নি। <!-- source: docs/user-guide/bn/start/phone.md#trouble -->
- **কী করবেন:** [Chrome-এর মেনু থেকে ইনস্টল করুন](../start/phone.md#task-chrome-menu)।

### আইফোনে "অ্যাপ ইনস্টল করুন" নেই

- **কেন:** আপনি Chrome বা অন্য ব্রাউজারে আছেন। আইফোনে ইনস্টল হয় Safari থেকে। <!-- source: docs/user-guide/bn/start/phone.md#trouble -->
- **কী করবেন:** ঠিকানাটি Safari-তে খুলুন, তারপর [আইফোনে](../start/phone.md#task-iphone) অংশের ধাপগুলো করুন।

### আইকন থেকে খুললে আবার সাইন ইন চাইছে

- **কেন:** ইনস্টল করা অ্যাপ ব্রাউজার থেকে আলাদা খুলতে পারে। <!-- source: docs/user-guide/bn/start/phone.md#trouble -->
- **কী করবেন:** আরেকবার [সাইন ইন](../start/sign-in.md) করুন।

### ঠিকানা খুলছে না

- **কী করবেন:** ঠিকানাটি অ্যাডমিনের পাঠানো লেখার সাথে মিলিয়ে নিন, আর ইন্টারনেট দেখুন। <!-- source: docs/user-guide/bn/start/phone.md#trouble -->

---

## অফলাইনে উপস্থিতি <a href="#offline" id="offline"></a>

### জমার বোতামে "ডিভাইসে সংরক্ষণ করুন" লেখা

- **কেন:** ইন্টারনেট নেই। এটি ভুল নয়। হাজিরা আগে আপনার ফোনে বা কম্পিউটারে জমা থাকবে। <!-- source: docs/user-guide/bn/attendance/attendance.md#task-offline; ui/src/i18n/locales/bn/attendance.json mark.submitOffline -->
- **কী করবেন:**
  1. বোতামটি চাপুন। বার্তা আসে **ডিভাইসে সংরক্ষিত হয়েছে — অনলাইনে ফিরলে সিঙ্ক হবে**। <!-- source: ui/src/i18n/locales/bn/attendance.json mark.queuedToast -->
  2. ইন্টারনেট ফিরলে এই ডিভাইসেই অ্যাপটি খুলুন বা খোলা রাখুন। অ্যাপ বন্ধ থাকলে পাঠানো হয় না।
  3. পাঠানো হলে **১টি অফলাইন পরিবর্তন সংরক্ষিত হয়েছে।** বার্তা আসে।

### "আপনি অফলাইনে আছেন — ১টি পরিবর্তন পাঠানো বাকি"

- **কেন:** কাজটি এখনো শুধু এই ডিভাইসে আছে, স্কুলের সিস্টেমে যায়নি। <!-- source: ui/src/i18n/locales/bn/common.json sync.offlineWithCount_* -->
- **কী করবেন:** ইন্টারনেট চালু করুন আর অ্যাপ খোলা রাখুন। তিনটি অবস্থার মানে: [শব্দের তালিকা → তিনটি অবস্থা](glossary.md#states)।

### ইন্টারনেট ফেরার পরও "পাঠানো বাকি"

- **কেন:** দুটি কারণ হতে পারে: এর মধ্যে অন্য কেউ একই খাতায় হাজিরা দিয়েছেন, অথবা কয়েকবার চেষ্টার পরও পাঠানো যায়নি। <!-- source: docs/user-guide/bn/attendance/attendance.md#task-offline -->
- **কী করবেন:**
  1. উপরের **আপনার পরিবর্তনগুলো** প্যানেল খুলুন।
  2. **অপেক্ষার সময়ে এটি অন্য কোথাও বদলে গেছে** লেখা থাকলে কোন সংস্করণ রাখবেন, বেছে নিন।
  3. **কয়েকবার চেষ্টার পরেও এটি পাঠানো যায়নি** লেখা থাকলে খাতাটি আবার খুলে **উপস্থিতি জমা দিন** চাপুন।
  4. তারপরও না হলে অ্যাডমিনকে জানান।

পুরো নিয়ম: [উপস্থিতি নেওয়া → ইন্টারনেট ছাড়া হাজিরা](../attendance/attendance.md#task-offline)।

---

## ফির ভুল <a href="#fees" id="fees"></a>

টাকার হিসাবে কিছু মুছে ফেলা হয় না। ভুল ঠিক করতে নতুন একটি উল্টো এন্ট্রি যোগ হয়, যাতে পরে দেখা যায় কী হয়েছিল। <!-- source: docs/user-guide/bn/finance/payments.md#confirm -->

### ভুল শিক্ষার্থী, ভুল অঙ্ক বা ভুল পদ্ধতিতে পেমেন্ট রেকর্ড হয়েছে

- **কেন:** পেমেন্ট নেওয়ার সময় ভুল হয়েছে। পেমেন্ট নিজে বদলানো যায় না। <!-- source: docs/user-guide/bn/finance/payments.md#task-reverse -->
- **কী করবেন:**
  1. অ্যাডমিন পুরো পেমেন্টটি বাতিল করবেন: [একটি পেমেন্ট বাতিল করুন](../finance/payments.md#task-reverse)। আংশিক বাতিল হয় না।
  2. বাতিল হলে বিলগুলো আবার বকেয়া হয়, আর চালানের বিপরীতে একটি **ক্রেডিট নোট** তৈরি হয়। <!-- source: docs/user-guide/bn/finance/payments.md#task-reverse -->
  3. তারপর ঠিকভাবে আবার [পেমেন্ট রেকর্ড করুন](../finance/record-payment.md)।

### "পরবর্তী পেমেন্টগুলো আগে বাতিল করতে হবে:"

- **কেন:** এই পেমেন্টের কিছু টাকা জমা টাকায় রাখা হয়েছিল, আর পরের কোনো পেমেন্ট সেই জমা টাকা খরচ করেছে। <!-- source: docs/user-guide/bn/finance/payments.md#task-later -->
- **কী করবেন:** লিংকগুলো খুলে পরের পেমেন্টগুলো আগে বাতিল করুন, তারপর এটি। ধাপ: [পরে নেওয়া পেমেন্ট আগে বাতিল করতে বললে](../finance/payments.md#task-later)।

### "এই বাতিল অন্য একজন অ্যাডমিনকে অনুমোদন করতে হবে। তাঁকে তাঁর কোড দিতে বলুন।"

- **কেন:** স্কুলে আরেকজন অ্যাডমিন আছেন, তাই নিজের বাতিল নিজে অনুমোদন করা যায় না। <!-- source: docs/user-guide/bn/finance/payments.md#trouble -->
- **কী করবেন:** আরেকজন অ্যাডমিনকে ডাকুন। আবার **পেমেন্ট বাতিল করুন** চাপুন, তিনি অনুমোদনের জানালায় কোড দেবেন।

### চালান আর ক্রেডিট নোট গুলিয়ে যাচ্ছে

- **কেন:** বাতিল হওয়া পেমেন্টের চালানের বিপরীতে একটি ক্রেডিট নোট থাকে। দুটি একই তালিকায় দেখায়। <!-- source: docs/user-guide/bn/finance/invoices.md#confirm -->
- **কী করবেন:** [চালান না ক্রেডিট নোট, বুঝবেন কীভাবে](../finance/invoices.md#confirm) দেখুন।

### একজন শিক্ষার্থীর এক মাসে একই ফির দুটি বিল

- **কেন:** বিল তৈরির সময় কেউ **তবুও তৈরি করুন** বেছেছিলেন। <!-- source: docs/user-guide/bn/finance/generate-fees.md#trouble -->
- **কী করবেন:** দ্বিতীয় দফায় টাকা না পড়ে থাকলে **অনাদায়ি বিল অপসারণ** চাপুন: [দফার মেয়াদ বদলান, অনাদায়ি বিল সরান বা দফা মুছুন](../finance/generate-fees.md#task-batch)।

### ভুল জরিমানা ধরা হয়েছে

- **কী করবেন:** জরিমানা পুরো বা আংশিক মওকুফ করুন: [জরিমানা মওকুফ করুন](../finance/fines.md#task-waive)। <!-- source: docs/user-guide/bn/finance/fines.md -->

### প্রকাশিত ফলাফলে ভুল নম্বর

ফি নয়, তবে একই রকম প্রশ্ন আসে। প্রকাশিত ফলাফল সরাসরি বদলানো যায় না।

- **কী করবেন:** অ্যাডমিন ফলাফল [পুনরায় খুলবেন](../exams-results/results.md#task-reopen), নম্বর ঠিক হবে, তারপর [আবার প্রক্রিয়া করুন](../exams-results/results.md#task-reprocess)। <!-- source: docs/user-guide/bn/exams-results/results.md -->

---

## প্রিন্ট <a href="#print" id="print"></a>

অ্যাপ নিজে কিছু ছাপে না। ব্রাউজারের নিজের প্রিন্টের জানালা খোলে, সেখান থেকে আপনার প্রিন্টারে ছাপা হয়। <!-- source: docs/user-guide/bn/dashboard/customise.md#task-committee-report; docs/user-guide/bn/administration/print-templates.md#preview-print -->

### "আপনার ব্রাউজার প্রিন্ট উইন্ডো আটকে দিয়েছে। …"

- **কেন:** ব্রাউজার পপ-আপ বন্ধ রেখেছে, তাই প্রিন্টের জানালা খুলতে পারেনি। <!-- source: ui/src/i18n/locales/bn/printPreview.json popupBlocked -->
- **কী করবেন:**
  1. ব্রাউজারে এই সাইটের জন্য পপ-আপ চালু করুন।
  2. আবার **প্রিন্ট করুন** চাপুন।

রসিদ বা চালানে এর বদলে আসতে পারে **রসিদ প্রিন্টের জন্য খোলা যায়নি।** বা **প্রিন্টযোগ্য চালান খোলা যায়নি। আবার চেষ্টা করুন।** পপ-আপ চালু করুন, ইন্টারনেট দেখুন, তারপর আবার চাপুন। <!-- source: docs/user-guide/bn/finance/payments.md#trouble; docs/user-guide/bn/finance/invoices.md#trouble -->

### "প্রিন্ট করতে আগে আপনার প্রথম প্রিন্টার যোগ করুন।"

- **কেন:** স্কুলে এখনো কোনো প্রিন্টার যোগ করা নেই। <!-- source: docs/user-guide/bn/administration/print-templates.md#trouble -->
- **কী করবেন:** অ্যাডমিন [প্রিন্টার ও ক্যালিব্রেশন](../administration/print-templates/printers-and-calibration.md) পাতা থেকে প্রিন্টার যোগ করবেন।

### "এই নথির জন্য এখনও কোনো নকশা নেই"

- **কেন:** এই কাগজের (যেমন আইডি কার্ড) কোনো প্রিন্টের নকশা প্রকাশ করা হয়নি। <!-- source: docs/user-guide/bn/administration/print-templates.md#trouble -->
- **কী করবেন:** অ্যাডমিন [তৈরি নকশা থেকে প্রথম নকশা বানাবেন](../administration/print-templates.md#task-main)।

### ছাপা কাগজে সরে গেছে বা কেটে গেছে

- **কী করবেন:**
  1. ব্রাউজারের প্রিন্টের জানালায় **Scale 100%** আর **Margins None** দিন। <!-- source: docs/user-guide/bn/administration/print-templates.md#trouble -->
  2. তারপরও সরে গেলে প্রিন্টার [ক্যালিব্রেট করুন](../administration/print-templates/printers-and-calibration.md)।

### "প্রিন্ট শুরু করা যায়নি। কিছুই ছাপা হয়নি।"

- **কী করবেন:** কিছুক্ষণ পর আবার চেষ্টা করুন। কিছুই ছাপা হয়নি, তাই দুবার ছাপার ভয় নেই। <!-- source: docs/user-guide/bn/administration/print-templates.md#trouble -->

ফলাফলপত্রের বেলায় আসতে পারে **প্রিন্টের রেকর্ড রাখা যায়নি, তাই প্রিন্ট হয়নি। আবার চেষ্টা করুন।** ইন্টারনেট দেখে আবার **প্রিন্ট করুন** চাপুন। <!-- source: docs/user-guide/bn/exams-results/results.md#trouble -->

---

## এসএমএস পৌঁছায়নি <a href="#sms" id="sms"></a>

কে বার্তা পেলেন আর কে পেলেন না, তা দেখা যায়: ফি রিমাইন্ডারের বেলায় [রিমাইন্ডার ইতিহাস](../communications/reminder-history.md) পাতায়, প্রতিটি না-পৌঁছানো বার্তার পাশে **কেন পৌঁছায়নি** লেখা থাকে। <!-- source: docs/user-guide/bn/communications/reminder-history.md#trouble -->

যেকোনো একটি বার্তা নাম বা ফোন দিয়ে [বার্তার তালিকা](../communications/message-log.md)-য় খুঁজুন। সেখানে **অবস্থা যাচাই করুন** দেখালে চাপুন; কোম্পানি জানায় বার্তাটি পৌঁছাল কি না। <!-- source: docs/user-guide/bn/communications/message-log.md#task-check -->

### "এই স্কুলের SMS ক্রেডিট শেষ, …"

- **কেন:** স্কুলের এসএমএস ক্রেডিট ফুরিয়ে গেছে। ফলাফলের এসএমএসে ক্রেডিট যথেষ্ট না থাকলে একটি বার্তাও যায় না। <!-- source: ui/src/i18n/locales/bn/communications.json send.smsNotReady.NO_CREDIT; docs/user-guide/bn/exams-results/results.md#trouble -->
- **কী করবেন:** অ্যাডমিনকে ক্রেডিট যোগ করতে বলুন। আপাতত হোয়াটসঅ্যাপ বা ইমেইলের মতো অন্য মাধ্যম বাছুন। <!-- source: docs/user-guide/bn/communications/send-message.md#trouble -->

### "এই স্কুলে SMS পাঠানোর ব্যবস্থা চালু নেই, …"

- **কেন:** স্কুলের সেটিংসে এই মাধ্যম চালু করা হয়নি। <!-- source: docs/user-guide/bn/communications/send-message.md#trouble -->
- **কী করবেন:** অ্যাডমিন **সেটিংস › যোগাযোগ** থেকে চালু করবেন ([স্কুলের সেটিংস ঠিক করা](../administration/settings.md))। তারপর আবার পাঠান।

### "এই মাধ্যমের জন্য কোনো ঠিকানা নেই"

- **কেন:** এই অভিভাবকের ফোন নম্বর বা ইমেইল অ্যাপে নেই। <!-- source: docs/user-guide/bn/communications/send-message.md#trouble -->
- **কী করবেন:** [অভিভাবক](../people/guardians.md) পাতায় নম্বর যোগ করুন, অথবা অন্য অভিভাবক বা মাধ্যম বাছুন।

### রিমাইন্ডারের কিছু বার্তা ব্যর্থ হয়েছে

- **কী করবেন:** [ব্যর্থ ডেলিভারিগুলো আবার পাঠান](../communications/reminder-history.md#task-retry)। দফা এখনো **প্রক্রিয়াধীন** হলে আগে শেষ হতে দিন। <!-- source: docs/user-guide/bn/communications/reminder-history.md -->

### ফলাফলের এসএমএস যায়নি

- **কেন:** ফলাফল প্রকাশের আগে এসএমএস যায় না, অথবা ক্রেডিট কম। <!-- source: docs/user-guide/bn/exams-results/results.md#trouble -->
- **কী করবেন:** আগে [ফলাফল প্রকাশ করুন](../exams-results/results.md#task-publish), ক্রেডিট দেখুন, তারপর [এসএমএস পাঠান](../exams-results/results.md#task-sms)।

---

## কোনো পাতা বা বোতাম দেখছেন না <a href="#cant-see" id="cant-see"></a>

মেনুতে কোনো পাতা নেই, তালিকা খালি, বা স্ক্রিনে লেখা **এই পাতাটি দেখার অনুমতি আপনার নেই।**? এটি সাধারণত ভুল নয়: আপনার ভূমিকায় সেই কাজের অনুমতি নেই, বা অন্য স্কুল বা শিক্ষাবর্ষ বাছা আছে। <!-- source: ui/src/i18n/locales/bn/common.json accessDenied.title --> ধাপে ধাপে দেখুন: [আমি এটা দেখতে পাচ্ছি না কেন?](cant-see-this.md)

---

## তবুও না মিটলে <a href="#help" id="help"></a>

1. পাতাটি একবার রিলোড করুন। ইন্টারনেট দেখুন।
2. স্ক্রিনের বার্তাটি হুবহু লিখে রাখুন, বা স্ক্রিনশট নিন।
3. স্কুলের অ্যাডমিনকে জানান: কোন পাতায় ছিলেন, কী চাপলেন, কী লেখা এল।

কোনো শব্দ বুঝতে না পারলে [শব্দের তালিকা](glossary.md) দেখুন।

---

_সংস্করণ ০.১.০ · শেষ যাচাই ২০২৬-১০-২৫_

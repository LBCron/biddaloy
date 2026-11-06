# builds the 7 basic-theme pages from one shell; run: python3 build.py
import pathlib
HERE = pathlib.Path(__file__).parent
NAV = [("home.html","হোম","Home"),("about","আমাদের কথা","About"),("academics","একাডেমিক","Academics"),("admissions.html","ভর্তি","Admissions"),("notices.html","খবর ও নোটিশ","News & Notices"),("results.html","ফলাফল","Results"),("teachers.html","শিক্ষকমণ্ডলী","Teachers"),("contact.html","যোগাযোগ","Contact")]
def t(bn,en): return f'<x-t bn="{bn}" en="{en}"></x-t>'
def nav(cur):
    return "".join(f'<a href="{h}"{" aria-current=\"page\"" if h==cur else ""}>{t(b,e)}</a>' for h,b,e in NAV)
def shell(cur,title_bn,title_en,body,extra_css=""):
    return f'''<!doctype html>
<html lang="bn" data-lang="bn" data-theme="basic">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title_bn} · নবীনগর উচ্চ বিদ্যালয়</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=Noto+Serif+Bengali:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="theme.css">
<link rel="stylesheet" href="../shared/blocks.css">
<style>{extra_css}</style>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="home.html"><span class="logo" role="img" aria-label="School logo slot 512×512">লোগো</span><span><b>{t("নবীনগর উচ্চ বিদ্যালয়","Nabinagar High School")}</b><small>{t("নবীনগর, ব্রাহ্মণবাড়িয়া · স্থাপিত ১৯৭২","Nabinagar, Brahmanbaria · est. 1972")}</small></span></a>
  <nav class="nav" aria-label="Main">{nav(cur)}</nav>
  <div class="tools">
    <div class="lang" role="group" aria-label="Language"><button type="button" data-set="bn" lang="bn">বাং</button><button type="button" data-set="en">EN</button></div>
    <a class="btn btn-ghost portal" href="#portal">{t("পোর্টালে লগইন","Portal login")}</a>
    <button class="menu-btn" type="button" data-open-menu aria-label="Open menu"><span></span></button>
  </div>
</div></header>
<div class="sheet" id="sheet" aria-label="Menu">
  <div class="row"><b>{t("মেনু","Menu")}</b><button class="btn btn-ghost btn-sm" type="button" data-close-menu>{t("বন্ধ","Close")}</button></div>
  <nav>{nav(cur)}</nav>
  <a class="btn btn-primary" href="#portal">{t("পোর্টালে লগইন","Portal login")}</a>
</div>
<main id="main">
{body}
</main>
<footer class="foot"><div class="wrap">
  <div class="grid g4">
    <div><h4>{t("নবীনগর উচ্চ বিদ্যালয়","Nabinagar High School")}</h4><p class="small">{t("কলেজ রোড, নবীনগর, ব্রাহ্মণবাড়িয়া ৩৪১০","College Road, Nabinagar, Brahmanbaria 3410")}<br>০১৭১১-০০০০০০ · office@nabinagarhs.edu.bd</p></div>
    <div><h4>{t("দ্রুত লিংক","Quick links")}</h4><a href="admissions.html">{t("ভর্তি তথ্য","Admissions")}</a><a href="notices.html">{t("নোটিশ বোর্ড","Notice board")}</a><a href="results.html">{t("ফলাফল","Results")}</a><a href="#">{t("ক্লাস রুটিন","Class routine")}</a><a href="#">{t("ছুটির তালিকা","Holiday list")}</a></div>
    <div><h4>{t("ডাউনলোড","Downloads")}</h4><a href="#">{t("ভর্তি ফরম (PDF)","Admission form (PDF)")}</a><a href="#">{t("বইয়ের তালিকা ২০২৭","Book list 2027")}</a><a href="#">{t("সিলেবাস","Syllabus")}</a></div>
    <div><h4>{t("অভিভাবক ও শিক্ষার্থী","Guardians & students")}</h4><p class="small" style="margin-bottom:12px">{t("ফি, উপস্থিতি ও ফলাফল দেখতে পোর্টালে ঢুকুন।","Sign in to see fees, attendance and results.")}</p><a class="btn btn-primary" id="portal" href="#">{t("পোর্টালে লগইন","Portal login")}</a></div>
  </div>
  <div class="credit"><span>© ২০২৬ {t("নবীনগর উচ্চ বিদ্যালয়","Nabinagar High School")}</span><span>Powered by <a href="https://schoolmanagerp.com">SchoolManagerP</a></span></div>
</div></footer>
<script src="shell.js"></script>
<script src="../shared/palettes.js"></script><script src="../shared/blocks.js"></script>
</body></html>'''

def ph(crumb_bn,crumb_en,h_bn,h_en,p_bn,p_en):
    return f'''<section class="ph"><div class="wrap"><div class="crumbs"><a href="home.html">{t("হোম","Home")}</a> › {t(crumb_bn,crumb_en)}</div><h1>{t(h_bn,h_en)}</h1><p>{t(p_bn,p_en)}</p></div></section>'''

NOTICES = [("১৫","নভে","15","Nov","অর্ধবার্ষিক পরীক্ষার ফল প্রকাশ ও অভিভাবক সভা","Half-yearly results published; guardian meeting","পরীক্ষা","Exams","chip-accent"),
 ("১২","নভে","12","Nov","১৬ নভেম্বর স্কুল বন্ধ: স্থানীয় নির্বাচন","School closed on 16 Nov: local election","জরুরি","Urgent","chip-warn"),
 ("০৮","নভে","08","Nov","২০২৭ শিক্ষাবর্ষে ষষ্ঠ শ্রেণিতে ভর্তি বিজ্ঞপ্তি","Admission circular, Class 6, session 2027","ভর্তি","Admission","chip-ok"),
 ("০৩","নভে","03","Nov","শীতকালীন ছুটির তালিকা ও পুনঃমিলন সময়সূচি","Winter holiday list and reopening schedule","ছুটি","Holiday","")]
def notice_rows(n=4):
    out=""
    for d,m,de,me,bn,en,tbn,ten,cls in NOTICES[:n]:
        out+=f'<a class="notice" href="notices.html"><span class="date"><b>{t(d,de)}</b><span>{t(m,me)}</span></span><span><h4>{t(bn,en)}</h4><div class="meta">{t("অফিস · PDF সংযুক্ত","Office · PDF attached")}</div></span><span class="chip {cls}">{t(tbn,ten)}</span></a>'
    return out

HOME = f'''
<div class="ann" role="region" aria-label="Announcements"><span class="ann-label">{t("ঘোষণা","Notice")}</span><div class="ann-view"><div class="ann-track"><div class="ann-set"><a href="#">{t("২০২৭ শিক্ষাবর্ষে ভর্তি চলছে, শেষ তারিখ ১৫ ডিসেম্বর","Admissions for 2027 are open, last date 15 December")}</a><a href="#">{t("অর্ধবার্ষিক পরীক্ষার ফল প্রকাশ ১৫ নভেম্বর","Half-yearly results out on 15 November")}</a><a href="#">{t("বৃহস্পতিবার অভিভাবক সভা, সকাল ১০টা","Guardian meeting on Thursday, 10 am")}</a><a href="#">{t("২৫ ডিসেম্বর থেকে শীতকালীন ছুটি","Winter break from 25 December")}</a><a href="#">{t("বার্ষিক ক্রীড়া প্রতিযোগিতা ২৪ নভেম্বর","Annual sports day on 24 November")}</a></div><div class="ann-set" aria-hidden="true"><a href="#" tabindex="-1">{t("২০২৭ শিক্ষাবর্ষে ভর্তি চলছে, শেষ তারিখ ১৫ ডিসেম্বর","Admissions for 2027 are open, last date 15 December")}</a><a href="#" tabindex="-1">{t("অর্ধবার্ষিক পরীক্ষার ফল প্রকাশ ১৫ নভেম্বর","Half-yearly results out on 15 November")}</a><a href="#" tabindex="-1">{t("বৃহস্পতিবার অভিভাবক সভা, সকাল ১০টা","Guardian meeting on Thursday, 10 am")}</a><a href="#" tabindex="-1">{t("২৫ ডিসেম্বর থেকে শীতকালীন ছুটি","Winter break from 25 December")}</a><a href="#" tabindex="-1">{t("বার্ষিক ক্রীড়া প্রতিযোগিতা ২৪ নভেম্বর","Annual sports day on 24 November")}</a></div></div></div></div>
<section class="hero"><div class="wrap">
  <div>
    <div class="kicker"><i></i>{t("১৯৭২ সাল থেকে নবীনগরের ভরসা","Nabinagar's school of trust since 1972")}</div>
    <h1>{t("ভালো মানুষ হওয়ার শিক্ষা, প্রতিদিন।","An education that builds good people, every day.")}</h1>
    <p class="lead" data-tagline>{t("ষষ্ঠ থেকে দশম শ্রেণি। ৪২ জন শিক্ষক, ১,৮০০ শিক্ষার্থী, আর অভিভাবকদের সঙ্গে প্রতি মাসে একবার মুখোমুখি বসা—এটাই আমাদের নিয়ম।","Classes 6 to 10. 42 teachers, 1,800 students, and a face-to-face meeting with guardians every month. That is how we work.")}</p>
    <div class="cta"><a class="btn btn-primary" href="admissions.html">{t("ভর্তির আবেদন করুন","Apply for admission")}</a><a class="btn btn-ghost" href="contact.html">{t("ক্যাম্পাস দেখুন","Visit the campus")}</a></div>
  </div>
  <div class="hc" data-carousel role="group" aria-roledescription="carousel" aria-label="Campus photos"><div class="hc-track"><div class="hc-slide"><div class="slot" data-size="1920×1080" role="img" aria-label="School building photo slot"><span class="cap">{t("স্কুল ভবনের ছবি","School building photo")}</span>
    <svg viewBox="0 0 640 200" aria-hidden="true"><path d="M0 200V120h60V80h40v40h30V60l40-30 40 30v60h60V90h120v30h50V70h40v50h60V40h40v160z" fill="var(--accent-line)"/><path d="M0 200v-40h640v40z" fill="var(--accent)" opacity=".25"/></svg>
  </div></div><div class="hc-slide"><div class="hc-ph" role="img" aria-label="Campus photo 2 placeholder, 1920 by 1080"><svg viewBox="0 0 640 200" preserveAspectRatio="none" aria-hidden="true"><path d="M0 200V140h80V90h50v50h70V50l30-25 30 25v90h90V100h110v40h60V70h50v70h70v60z" fill="currentColor"/></svg><span class="hc-cap"><span>{t("ক্যাম্পাসের ছবি ২","Campus photo 2")}</span><small>1920 × 1080</small></span></div></div><div class="hc-slide"><div class="hc-ph" role="img" aria-label="Campus photo 3 placeholder, 1920 by 1080"><svg viewBox="0 0 640 200" preserveAspectRatio="none" aria-hidden="true"><path d="M0 200V130h50V100h60v30h40V70h40v60h80V40l35-20 35 20v90h60V110h90v20h50V90h60v110z" fill="currentColor"/></svg><span class="hc-cap"><span>{t("ক্যাম্পাসের ছবি ৩","Campus photo 3")}</span><small>1920 × 1080</small></span></div></div></div><button class="hc-btn hc-prev" type="button" aria-label="Previous photo">&#8249;</button><button class="hc-btn hc-next" type="button" aria-label="Next photo">&#8250;</button><div class="hc-dots"><button type="button" aria-label="Photo 1"></button><button type="button" aria-label="Photo 2"></button><button type="button" aria-label="Photo 3"></button></div></div>
</div></section>
<section class="strip"><div class="wrap"><b>{t("২০২৭ শিক্ষাবর্ষে ষষ্ঠ ও নবম শ্রেণিতে ভর্তি চলছে","Admissions open for Classes 6 and 9, session 2027")}</b><span class="chip">{t("শেষ তারিখ ১৫ ডিসেম্বর · আর ৩৯ দিন","Deadline 15 Dec · 39 days left")}</span><a href="admissions.html">{t("বিস্তারিত ও আবেদন","Details and apply")}</a></div></section>

<section class="sec" id="news"><div class="wrap">
  <div class="sec-head"><div><h2>{t("নোটিশ বোর্ড","Notice board")}</h2><p class="muted">{t("অফিস থেকে সর্বশেষ ঘোষণা","Latest announcements from the office")}</p></div><a class="btn btn-ghost btn-sm" href="notices.html">{t("সব নোটিশ","All notices")}</a></div>
  <div class="island" data-loading aria-busy="true"><div class="sk" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="ready notice-list">{notice_rows()}</div></div>
</div></section>

<section class="sec sec-alt"><div class="wrap grid g2">
  <div><h2>{t("আমাদের কথা","About us")}</h2><p class="muted" style="margin-top:14px">{t("১৯৭২ সালে স্থানীয় কৃষক ও ব্যবসায়ীদের চাঁদায় টিনের ঘরে স্কুলটি শুরু হয়। আজ তিনটি ভবন, একটি বিজ্ঞানাগার, একটি কম্পিউটার ল্যাব আর ১২ হাজার বইয়ের গ্রন্থাগার।","The school began in 1972 in a tin shed, funded by local farmers and traders. Today it has three buildings, a science lab, a computer lab and a 12,000-book library.")}</p><p class="muted" style="margin-top:12px">{t("আমরা বিশ্বাস করি শৃঙ্খলা আর স্নেহ একসাথে চলে। প্রতিটি শ্রেণির একজন শ্রেণিশিক্ষক প্রতিটি শিক্ষার্থীকে নামে চেনেন।","We believe discipline and care go together. Every class teacher knows every student by name.")}</p>
  <div class="facts"><div class="fact"><b>১৯৭২</b><span>{t("প্রতিষ্ঠার বছর","Founded")}</span></div><div class="fact"><b>৪২</b><span>{t("জন শিক্ষক","Teachers")}</span></div><div class="fact"><b>৯৬%</b><span>{t("এসএসসি পাসের হার ২০২৬","SSC pass rate 2026")}</span></div></div></div>
  <div class="slot" data-size="1200×800" style="aspect-ratio:3/2" role="img" aria-label="Campus photo slot"><span class="cap">{t("ক্যাম্পাস বা শ্রেণিকক্ষের ছবি","Campus or classroom photo")}</span></div>
</div></section>

<section class="sec"><div class="wrap">
  <div class="sec-head"><div><h2>{t("একাডেমিক কার্যক্রম","Academics")}</h2><p class="muted">{t("জাতীয় শিক্ষাক্রম, বাংলা মাধ্যম","National curriculum, Bangla medium")}</p></div></div>
  <div class="grid g3">
    <div class="card prog"><span class="ico">৬–৮</span><h3>{t("নিম্ন মাধ্যমিক","Junior secondary")}</h3><p class="muted small">{t("ভিত্তি গড়ার তিন বছর","Three foundation years")}</p><ul><li>{t("বাংলা, ইংরেজি, গণিত, বিজ্ঞান","Bangla, English, Maths, Science")}</li><li>{t("আইসিটি ও কর্মমুখী শিক্ষা","ICT and work education")}</li><li>{t("সপ্তাহে একদিন গ্রন্থাগার","Weekly library period")}</li></ul></div>
    <div class="card prog"><span class="ico">৯–১০</span><h3>{t("মাধ্যমিক · বিজ্ঞান","Secondary · Science")}</h3><p class="muted small">{t("এসএসসি প্রস্তুতি","SSC preparation")}</p><ul><li>{t("পদার্থ, রসায়ন, জীববিজ্ঞান, উচ্চতর গণিত","Physics, Chemistry, Biology, Higher Maths")}</li><li>{t("সাপ্তাহিক ল্যাব ক্লাস","Weekly lab classes")}</li><li>{t("মাসিক মডেল টেস্ট","Monthly model tests")}</li></ul></div>
    <div class="card prog"><span class="ico">৯–১০</span><h3>{t("মাধ্যমিক · মানবিক ও ব্যবসায়","Secondary · Humanities & Business")}</h3><p class="muted small">{t("এসএসসি প্রস্তুতি","SSC preparation")}</p><ul><li>{t("হিসাববিজ্ঞান, ফিন্যান্স, ব্যবসায় উদ্যোগ","Accounting, Finance, Entrepreneurship")}</li><li>{t("ইতিহাস, ভূগোল, পৌরনীতি","History, Geography, Civics")}</li><li>{t("বিতর্ক ও উপস্থাপনা ক্লাব","Debate and presentation club")}</li></ul></div>
  </div>
</div></section>

<section class="sec sec-alt"><div class="wrap">
  <div class="sec-head"><div><h2>{t("শিক্ষকমণ্ডলী","Our teachers")}</h2><p class="muted">{t("যাঁরা প্রতিদিন শ্রেণিকক্ষে থাকেন","The people in the classroom every day")}</p></div></div>
  <div class="grid g4">
    <div class="card tcard"><div class="avatar" role="img" aria-label="Photo slot 400×400"></div><b>{t("মোঃ আব্দুল করিম","Md. Abdul Karim")}</b><span class="small">{t("প্রধান শিক্ষক · গণিত","Headmaster · Mathematics")}</span></div>
    <div class="card tcard"><div class="avatar" role="img" aria-label="Photo slot 400×400"></div><b>{t("শাহানা পারভীন","Shahana Parveen")}</b><span class="small">{t("সহকারী প্রধান শিক্ষক · বাংলা","Assistant Head · Bangla")}</span></div>
    <div class="card tcard"><div class="avatar" role="img" aria-label="Photo slot 400×400"></div><b>{t("তানভীর হাসান","Tanvir Hasan")}</b><span class="small">{t("সহকারী শিক্ষক · পদার্থবিজ্ঞান","Assistant Teacher · Physics")}</span></div>
    <div class="card tcard"><div class="avatar" role="img" aria-label="Photo slot 400×400"></div><b>{t("নাসরিন আক্তার","Nasrin Akter")}</b><span class="small">{t("সহকারী শিক্ষক · ইংরেজি","Assistant Teacher · English")}</span></div>
    <div class="card tcard"><div class="avatar" role="img" aria-label="Photo slot 400×400"></div><b>{t("রফিকুল ইসলাম","Rafiqul Islam")}</b><span class="small">{t("প্রধান শিক্ষক · গণিত","Headmaster · Mathematics")}</span></div>
    <div class="card tcard"><div class="avatar" role="img" aria-label="Photo slot 400×400"></div><b>{t("সুমাইয়া আক্তার","Sumaiya Akter")}</b><span class="small">{t("সহকারী প্রধান শিক্ষক · বাংলা","Assistant Head · Bangla")}</span></div>
    <div class="card tcard"><div class="avatar" role="img" aria-label="Photo slot 400×400"></div><b>{t("আনোয়ার হোসেন","Anwar Hossain")}</b><span class="small">{t("সহকারী শিক্ষক · পদার্থবিজ্ঞান","Assistant Teacher · Physics")}</span></div>
    <div class="card tcard"><div class="avatar" role="img" aria-label="Photo slot 400×400"></div><b>{t("মাহমুদা বেগম","Mahmuda Begum")}</b><span class="small">{t("সহকারী শিক্ষক · ইংরেজি","Assistant Teacher · English")}</span></div>
  </div>
<p class="seeall" data-field="teachers.seeall"><a href="teachers.html">{t("সবাইকে দেখুন","See all teachers")}</a></p>
</div></section>

<section class="sec"><div class="wrap">
  <div class="sec-head"><div><h2>{t("আসছে যে দিনগুলো","Coming up")}</h2><p class="muted">{t("একাডেমিক ক্যালেন্ডার থেকে","From the academic calendar")}</p></div><a class="btn btn-ghost btn-sm" href="#">{t("পুরো ক্যালেন্ডার","Full calendar")}</a></div>
  <div class="island" data-loading aria-busy="true"><div class="sk" aria-hidden="true"><i></i><i></i><i></i></div>
  <div class="ready grid g3">
    <div class="card ev"><span class="date"><b>{t("১৬","16")}</b><span>{t("নভে","Nov")}</span></span><div><b>{t("স্কুল বন্ধ: স্থানীয় নির্বাচন","Closed: local election")}</b><span>{t("সারাদিন","All day")}</span></div></div>
    <div class="card ev"><span class="date"><b>{t("২৪","24")}</b><span>{t("নভে","Nov")}</span></span><div><b>{t("বার্ষিক ক্রীড়া প্রতিযোগিতা","Annual sports day")}</b><span>{t("সকাল ৯টা · স্কুল মাঠ","9:00 am · School field")}</span></div></div>
    <div class="card ev"><span class="date"><b>{t("০১","01")}</b><span>{t("ডিসে","Dec")}</span></span><div><b>{t("বার্ষিক পরীক্ষা শুরু","Annual exams begin")}</b><span>{t("রুটিন নোটিশ বোর্ডে","Routine on the notice board")}</span></div></div>
  </div></div>
</div></section>

<section class="sec sec-alt"><div class="wrap">
  <div class="sec-head"><div><h2>{t("স্কুলের ব্লগ","School blog")}</h2><p class="muted">{t("শ্রেণিকক্ষ ও মাঠের গল্প","Stories from classrooms and the field")}</p></div><a class="btn btn-ghost btn-sm" href="blog-post.html">{t("সব লেখা","All posts")}</a></div>
  <div class="grid g3">
    <a class="card post" href="blog-post.html"><div class="slot" data-size="1200×630"><span class="cap">{t("কভার ছবি","Cover image")}</span></div><div class="body"><span class="tiny">{t("২ নভেম্বর ২০২৬","2 November 2026")}</span><h3>{t("বিজ্ঞান মেলায় আমাদের তিনটি প্রকল্প জেলায় প্রথম","Three of our projects took first place at the district science fair")}</h3></div></a>
    <a class="card post" href="blog-post.html"><div class="slot" data-size="1200×630"><span class="cap">{t("কভার ছবি","Cover image")}</span></div><div class="body"><span class="tiny">{t("২০ অক্টোবর ২০২৬","20 October 2026")}</span><h3>{t("নতুন কম্পিউটার ল্যাব: কী আছে, কারা ব্যবহার করবে","The new computer lab: what is in it and who uses it")}</h3></div></a>
    <a class="card post" href="blog-post.html"><div class="slot" data-size="1200×630"><span class="cap">{t("কভার ছবি","Cover image")}</span></div><div class="body"><span class="tiny">{t("৫ অক্টোবর ২০২৬","5 October 2026")}</span><h3>{t("অভিভাবক সভায় যে পাঁচটি প্রশ্ন সবচেয়ে বেশি এসেছে","The five questions guardians asked most at the meeting")}</h3></div></a>
  </div>
</div></section>

<section class="sec"><div class="wrap contact">
  <div><h2>{t("যোগাযোগ","Contact")}</h2>
    <dl class="kv" style="margin:16px 0 20px"><dt>{t("ঠিকানা","Address")}</dt><dd>{t("কলেজ রোড, নবীনগর, ব্রাহ্মণবাড়িয়া ৩৪১০","College Road, Nabinagar, Brahmanbaria 3410")}</dd><dt>{t("ফোন","Phone")}</dt><dd>০১৭১১-০০০০০০</dd><dt>{t("ইমেইল","Email")}</dt><dd>office@nabinagarhs.edu.bd</dd><dt>{t("অফিস সময়","Office hours")}</dt><dd>{t("রবি–বৃহস্পতি, সকাল ৯টা – বিকেল ৪টা","Sun–Thu, 9:00 am – 4:00 pm")}</dd></dl>
    <div class="cta"><a class="btn wa" href="https://wa.me/8801711000000">{t("WhatsApp-এ লিখুন","Message on WhatsApp")}</a><a class="btn btn-ghost" href="contact.html">{t("বার্তা পাঠান","Send a message")}</a></div></div>
  <div class="map"><button class="btn btn-ghost" type="button">{t("মানচিত্র দেখুন","Show map")}</button></div>
</div></section>
'''

ADMISSIONS = ph("ভর্তি","Admissions","ভর্তি তথ্য ২০২৭","Admissions 2027","ষষ্ঠ ও নবম শ্রেণিতে আসন খালি আছে। নিচের ধাপগুলো অনুসরণ করুন; অনলাইনে আবেদন করতে ১০ মিনিট লাগে।","Seats are open in Classes 6 and 9. Follow the steps below; the online application takes about 10 minutes.") + f'''
<section class="sec"><div class="wrap grid g2" style="gap:40px">
  <div>
    <h2>{t("কীভাবে আবেদন করবেন","How to apply")}</h2>
    <ol class="steps" style="margin-top:12px">
      <li><div><b>{t("অনলাইন ফরম পূরণ","Fill the online form")}</b><span>{t("শিক্ষার্থীর নাম, জন্মতারিখ, অভিভাবকের ফোন। ছবি লাগবে না।","Student's name, date of birth, guardian's phone. No photo needed.")}</span></div></li>
      <li><div><b>{t("SMS-এ আবেদন নম্বর","Application number by SMS")}</b><span>{t("ফোনে একটি নম্বর আসবে; সেটি দিয়ে পরে অবস্থা দেখা যাবে।","A number arrives on the phone; use it later to check status.")}</span></div></li>
      <li><div><b>{t("ভর্তি পরীক্ষা: ২০ ডিসেম্বর","Admission test: 20 December")}</b><span>{t("বাংলা, ইংরেজি ও গণিত; ৬০ নম্বর, ১ ঘণ্টা।","Bangla, English and Maths; 60 marks, 1 hour.")}</span></div></li>
      <li><div><b>{t("ফল ও ভর্তি: ২৮ ডিসেম্বর","Result and enrolment: 28 December")}</b><span>{t("নির্বাচিত হলে অফিসে এসে কাগজপত্র জমা ও ফি পরিশোধ।","If selected, bring documents to the office and pay the fee.")}</span></div></li>
    </ol>
    <div class="cta" style="margin-top:20px"><a class="btn btn-primary" href="#">{t("আবেদন করুন","Apply now")}</a><a class="btn btn-ghost" href="#">{t("আবেদনের অবস্থা দেখুন","Check application status")}</a></div>
    <p class="tiny" style="margin-top:10px">{t("আবেদন ফরমটি SchoolManagerP-তে খোলে; কোনো অ্যাকাউন্ট লাগে না।","The form opens in SchoolManagerP; no account is needed.")}</p>
  </div>
  <div>
    <h2>{t("গুরুত্বপূর্ণ তারিখ","Key dates")}</h2>
    <div class="card" style="margin-top:12px;padding:6px 16px">
      <div class="notice" style="padding:12px 0"><span class="date"><b>১৫</b><span>{t("ডিসে","Dec")}</span></span><span><h4>{t("আবেদনের শেষ দিন","Last day to apply")}</h4><div class="meta">{t("রাত ১১:৫৯ পর্যন্ত","Until 11:59 pm")}</div></span><span class="chip chip-warn">{t("আর ৩৯ দিন","39 days")}</span></div>
      <div class="notice" style="padding:12px 0"><span class="date"><b>২০</b><span>{t("ডিসে","Dec")}</span></span><span><h4>{t("ভর্তি পরীক্ষা","Admission test")}</h4><div class="meta">{t("সকাল ১০টা","10:00 am")}</div></span></div>
      <div class="notice" style="padding:12px 0"><span class="date"><b>২৮</b><span>{t("ডিসে","Dec")}</span></span><span><h4>{t("ফল প্রকাশ ও ভর্তি শুরু","Results and enrolment")}</h4><div class="meta">{t("ওয়েবসাইট ও নোটিশ বোর্ডে","Website and notice board")}</div></span></div>
      <div class="notice" style="padding:12px 0"><span class="date"><b>০১</b><span>{t("জানু","Jan")}</span></span><span><h4>{t("ক্লাস শুরু","Classes begin")}</h4><div class="meta">{t("বই বিতরণ প্রথম দিন","Books handed out on day one")}</div></span></div>
    </div>
  </div>
</div></section>

<section class="sec sec-alt"><div class="wrap">
  <div class="sec-head"><div><h2>{t("ফি কাঠামো ২০২৭","Fee structure 2027")}</h2><p class="muted">{t("সব অঙ্ক টাকায়; ভর্তি ফি এককালীন।","All amounts in BDT; admission fee is one-time.")}</p></div></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>{t("শ্রেণি","Class")}</th><th class="num">{t("ভর্তি ফি","Admission")}</th><th class="num">{t("মাসিক বেতন","Monthly tuition")}</th><th class="num">{t("পরীক্ষা ফি (বার্ষিক)","Exam fee (yearly)")}</th><th class="num">{t("বই ও খাতা","Books & copies")}</th></tr></thead>
  <tbody><tr><td>{t("ষষ্ঠ","Class 6")}</td><td class="num">৩,০০০</td><td class="num">৬০০</td><td class="num">১,২০০</td><td class="num">{t("সরকারি বই বিনামূল্যে","Govt books free")}</td></tr>
  <tr><td>{t("সপ্তম – অষ্টম","Classes 7–8")}</td><td class="num">—</td><td class="num">৬০০</td><td class="num">১,২০০</td><td class="num">{t("সরকারি বই বিনামূল্যে","Govt books free")}</td></tr>
  <tr><td>{t("নবম · বিজ্ঞান","Class 9 · Science")}</td><td class="num">৩,৫০০</td><td class="num">৮০০</td><td class="num">১,৫০০</td><td class="num">৯০০</td></tr>
  <tr><td>{t("নবম · মানবিক / ব্যবসায়","Class 9 · Humanities / Business")}</td><td class="num">৩,৫০০</td><td class="num">৭০০</td><td class="num">১,৫০০</td><td class="num">৭০০</td></tr></tbody></table></div>
  <p class="tiny" style="margin-top:10px">{t("মুক্তিযোদ্ধা পরিবার ও একই পরিবারের দ্বিতীয় সন্তানের বেতনে ৫০% ছাড়। অফিসে কথা বলুন।","50% tuition waiver for freedom-fighter families and a second child from the same family. Talk to the office.")}</p>
</div></section>

<section class="sec"><div class="wrap grid g2" style="gap:40px">
  <div><h2>{t("প্রায়ই জিজ্ঞাসিত প্রশ্ন","Frequently asked")}</h2>
    <div style="margin-top:8px">
    <details open><summary>{t("ভর্তি পরীক্ষায় কী আসে?","What is on the admission test?")}</summary><p>{t("আগের শ্রেণির বাংলা, ইংরেজি ও গণিত বই থেকে। কোনো গাইড বই লাগে না।","Bangla, English and Maths from the previous class's textbooks. No guidebook needed.")}</p></details>
    <details><summary>{t("বয়সের সীমা আছে?","Is there an age limit?")}</summary><p>{t("ষষ্ঠ শ্রেণির জন্য ১ জানুয়ারি ২০২৭-এ বয়স ১০ থেকে ১৩ বছরের মধ্যে হতে হবে।","For Class 6, age must be 10 to 13 on 1 January 2027.")}</p></details>
    <details><summary>{t("কী কী কাগজ লাগবে?","Which documents are needed?")}</summary><p>{t("জন্মনিবন্ধন সনদের কপি, আগের স্কুলের ছাড়পত্র, অভিভাবকের এনআইডি কপি, ২ কপি ছবি।","Birth registration copy, transfer certificate from the previous school, guardian's NID copy, 2 photos.")}</p></details>
    <details><summary>{t("অনলাইনে ফি দেওয়া যাবে?","Can the fee be paid online?")}</summary><p>{t("এখন নয়; ভর্তি ফি অফিসে নগদে বা ব্যাংকে জমা দিতে হয়। রসিদ সাথে সাথে পাবেন।","Not yet; the admission fee is paid in cash at the office or at the bank. You get a receipt at once.")}</p></details>
    </div></div>
  <div><h2>{t("ভর্তি নিয়ে প্রশ্ন? লিখুন","A question about admission? Write to us")}</h2><p class="muted" style="margin:8px 0 16px">{t("অফিস সময়ে এক কর্মদিবসের মধ্যে ফোনে উত্তর দিই।","We call back within one working day during office hours.")}</p>
    <form class="card" style="padding:20px;display:grid;gap:14px" onsubmit="return false">
      <div class="field"><label for="n">{t("আপনার নাম","Your name")}</label><input id="n" autocomplete="name"></div>
      <div class="field"><label for="p">{t("মোবাইল নম্বর","Mobile number")}</label><input id="p" inputmode="tel" placeholder="017xxxxxxxx"><span class="hint">{t("এই নম্বরেই ফোন করব","We will call this number")}</span></div>
      <div class="field"><label for="m">{t("আপনার প্রশ্ন","Your question")}</label><textarea id="m"></textarea></div>
      <div class="turnstile"><i></i>{t("রোবট নয় যাচাই (Turnstile)","Not-a-robot check (Turnstile)")}</div>
      <button class="btn btn-primary" type="submit">{t("পাঠান","Send")}</button>
    </form></div>
</div></section>
'''

NOTICES_PAGE = ph("খবর ও নোটিশ","News & Notices","নোটিশ বোর্ড","Notice board","অফিস থেকে প্রকাশিত সব ঘোষণা। জরুরি নোটিশ লাল চিহ্নে।","Every announcement from the office. Urgent ones are marked in red.") + f'''
<section class="sec"><div class="wrap" style="display:grid;gap:28px">
  <div class="filters" role="group" aria-label="Filter"><button type="button" aria-pressed="true">{t("সব","All")}</button><button type="button" aria-pressed="false">{t("জরুরি","Urgent")}</button><button type="button" aria-pressed="false">{t("পরীক্ষা","Exams")}</button><button type="button" aria-pressed="false">{t("ভর্তি","Admission")}</button><button type="button" aria-pressed="false">{t("ছুটি","Holiday")}</button></div>
  <div class="grid" style="grid-template-columns:1fr;gap:28px" id="nl">
    <div class="island" data-loading aria-busy="true"><div class="sk" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="ready notice-list">{notice_rows(4)}<a class="notice" href="#"><span class="date"><b>২৮</b><span>{t("অক্টো","Oct")}</span></span><span><h4>{t("অভিভাবক সভা ৩০ অক্টোবর, সকাল ১০টা","Guardian meeting 30 October, 10 am")}</h4><div class="meta">{t("প্রধান শিক্ষক","Headmaster")}</div></span><span class="chip">{t("সভা","Meeting")}</span></a><a class="notice" href="#"><span class="date"><b>২০</b><span>{t("অক্টো","Oct")}</span></span><span><h4>{t("ষষ্ঠ শ্রেণির বার্ষিক পরীক্ষার রুটিন","Class 6 annual exam routine")}</h4><div class="meta">{t("পরীক্ষা কমিটি · PDF সংযুক্ত","Exam committee · PDF attached")}</div></span><span class="chip chip-accent">{t("পরীক্ষা","Exams")}</span></a></div></div>
    <div class="cta" style="justify-content:center"><button class="btn btn-ghost" type="button">{t("আরও পুরোনো নোটিশ","Older notices")}</button></div>
  </div>
</div></section>
<section class="sec sec-alt"><div class="wrap">
  <p class="tiny" style="margin-bottom:10px">{t("একটি নোটিশ খুললে এমন দেখায়","What an opened notice looks like")}</p>
  <article class="card" style="padding:24px;display:grid;gap:16px;max-width:860px">
    <div><span class="chip chip-warn">{t("জরুরি","Urgent")}</span> <span class="tiny" style="margin-left:8px">{t("১২ নভেম্বর ২০২৬ · প্রধান শিক্ষক","12 November 2026 · Headmaster")}</span><h2 style="margin-top:10px">{t("১৬ নভেম্বর স্কুল বন্ধ: স্থানীয় নির্বাচন","School closed on 16 November: local election")}</h2></div>
    <p class="muted">{t("উপজেলা নির্বাচন কমিশনের নির্দেশে স্কুল ভবন ভোটকেন্দ্র হিসেবে ব্যবহৃত হবে। ১৬ নভেম্বর (সোমবার) সব শ্রেণির ক্লাস বন্ধ থাকবে। ১৭ নভেম্বর যথারীতি ক্লাস হবে। ওই দিনের নির্ধারিত শ্রেণি-পরীক্ষা ১৯ নভেম্বর নেওয়া হবে।","By order of the Upazila Election Commission the school building will serve as a polling centre. All classes are closed on Monday 16 November. Classes resume on 17 November. That day's class tests move to 19 November.")}</p>
    <div class="slot" data-size="PDF" style="aspect-ratio:4/3;max-height:380px"><span class="cap">{t("সংযুক্ত PDF এখানে দেখা যাবে · নোটিশ-১২৪.pdf","Attached PDF viewer · notice-124.pdf")}</span></div>
    <div class="cta"><a class="btn btn-primary" href="#">{t("PDF ডাউনলোড (২১০ KB)","Download PDF (210 KB)")}</a><button class="btn btn-ghost" type="button">{t("লিংক কপি","Copy link")}</button></div>
  </article>
</div></section>
'''

RESULTS = ph("ফলাফল","Results","পরীক্ষার ফলাফল","Exam results","পরীক্ষা ও শ্রেণি বেছে নিন। রোল দিলে শুধু সেই শিক্ষার্থীর ফল দেখাবে; না দিলে পুরো শাখার তালিকা।","Pick the exam and class. Enter a roll to see one student; leave it blank for the whole section.") + f'''
<section class="sec"><div class="wrap" style="display:grid;gap:28px">
  <form class="card" style="padding:20px;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));align-items:end" onsubmit="return false">
    <div class="field"><label for="ex">{t("পরীক্ষা","Exam")}</label><select id="ex"><option data-bn="অর্ধবার্ষিক পরীক্ষা ২০২৬" data-en="Half-yearly 2026">অর্ধবার্ষিক পরীক্ষা ২০২৬</option><option data-bn="প্রথম সাময়িক ২০২৬" data-en="First term 2026">প্রথম সাময়িক ২০২৬</option></select></div>
    <div class="field"><label for="cl">{t("শ্রেণি","Class")}</label><select id="cl"><option data-bn="অষ্টম" data-en="Class 8">অষ্টম</option></select></div>
    <div class="field"><label for="se">{t("শাখা","Section")}</label><select id="se"><option data-bn="ক" data-en="A">ক</option><option data-bn="খ" data-en="B">খ</option></select></div>
    <div class="field"><label for="ro">{t("রোল (ঐচ্ছিক)","Roll (optional)")}</label><input id="ro" inputmode="numeric" data-ph-bn="যেমন ১২" data-ph-en="e.g. 12" placeholder="যেমন ১২"></div>
    <div class="turnstile" style="grid-column:1/-1"><i></i>{t("রোবট নয় যাচাই (Turnstile)","Not-a-robot check (Turnstile)")}</div>
    <button class="btn btn-primary" type="submit" style="grid-column:1/-1;justify-self:start">{t("ফল দেখুন","Show results")}</button>
  </form>

  <div>
    <div class="sec-head" style="margin-bottom:12px"><div><h2 style="font-size:22px">{t("অর্ধবার্ষিক পরীক্ষা ২০২৬ · অষ্টম শ্রেণি · শাখা ক","Half-yearly 2026 · Class 8 · Section A")}</h2><p class="muted small">{t("৪৬ জন শিক্ষার্থী · ওয়েবসাইটে প্রকাশ ১৫ নভেম্বর ২০২৬","46 students · published to the website 15 November 2026")}</p></div><button class="btn btn-ghost btn-sm" type="button">{t("প্রিন্ট","Print")}</button></div>
    <div class="tbl-wrap"><table class="tbl res"><thead><tr><th class="num">{t("রোল","Roll")}</th><th>{t("নাম","Name")}</th><th class="num">GPA</th><th>{t("গ্রেড","Grade")}</th><th>{t("ফলাফল","Result")}</th><th><span class="sr">{t("বিস্তারিত","Details")}</span></th></tr></thead>
    <tbody>
      <tr><td class="num" data-l="রোল">১</td><td data-l="নাম">{t("সাদিয়া ইসলাম","Sadia Islam")}</td><td class="num" data-l="GPA">৫.০০</td><td data-l="গ্রেড">A+</td><td data-l="ফলাফল"><span class="chip chip-ok">{t("উত্তীর্ণ","Pass")}</span></td><td><button class="btn btn-ghost btn-sm" type="button" data-expand="r1" aria-expanded="true">{t("বিষয়ভিত্তিক","Subjects")}</button></td></tr>
      <tr id="r1" class="detail"><td colspan="6"><div class="subj"><span><b>{t("বাংলা","Bangla")}</b> ৮৮</span><span><b>{t("ইংরেজি","English")}</b> ৮১</span><span><b>{t("গণিত","Maths")}</b> ৯৪</span><span><b>{t("বিজ্ঞান","Science")}</b> ৯০</span><span><b>{t("বাংলাদেশ ও বিশ্বপরিচয়","BD & Global Studies")}</b> ৮৫</span><span><b>{t("ধর্ম","Religion")}</b> ৯১</span><span><b>{t("আইসিটি","ICT")}</b> ৪৬/৫০</span><span><b>{t("মোট","Total")}</b> ৫৭৫/৬৫০</span></div></td></tr>
      <tr><td class="num" data-l="রোল">২</td><td data-l="নাম">{t("রাকিব হোসেন","Rakib Hossain")}</td><td class="num" data-l="GPA">৪.৮৩</td><td data-l="গ্রেড">A</td><td data-l="ফলাফল"><span class="chip chip-ok">{t("উত্তীর্ণ","Pass")}</span></td><td><button class="btn btn-ghost btn-sm" type="button" data-expand="r2" aria-expanded="false">{t("বিষয়ভিত্তিক","Subjects")}</button></td></tr>
      <tr id="r2" class="detail" hidden><td colspan="6"><div class="subj"><span><b>{t("বাংলা","Bangla")}</b> ৭৯</span><span><b>{t("ইংরেজি","English")}</b> ৭২</span><span><b>{t("গণিত","Maths")}</b> ৮৮</span></div></td></tr>
      <tr><td class="num" data-l="রোল">৩</td><td data-l="নাম">{t("মারিয়া আক্তার","Maria Akter")}</td><td class="num" data-l="GPA">৪.৫০</td><td data-l="গ্রেড">A</td><td data-l="ফলাফল"><span class="chip chip-ok">{t("উত্তীর্ণ","Pass")}</span></td><td><button class="btn btn-ghost btn-sm" type="button" data-expand="r3" aria-expanded="false">{t("বিষয়ভিত্তিক","Subjects")}</button></td></tr>
      <tr id="r3" class="detail" hidden><td colspan="6"><div class="subj"><span><b>{t("বাংলা","Bangla")}</b> ৭০</span></div></td></tr>
      <tr><td class="num" data-l="রোল">৪</td><td data-l="নাম">{t("তামিম ইকবাল","Tamim Iqbal")}</td><td class="num" data-l="GPA">—</td><td data-l="গ্রেড">F</td><td data-l="ফলাফল"><span class="chip chip-warn">{t("অকৃতকার্য (গণিত)","Fail (Maths)")}</span></td><td><button class="btn btn-ghost btn-sm" type="button" data-expand="r4" aria-expanded="false">{t("বিষয়ভিত্তিক","Subjects")}</button></td></tr>
      <tr id="r4" class="detail" hidden><td colspan="6"><div class="subj"><span><b>{t("গণিত","Maths")}</b> ২৮</span></div></td></tr>
      <tr><td class="num" data-l="রোল">৫</td><td data-l="নাম">{t("জান্নাতুল ফেরদৌস","Jannatul Ferdous")}</td><td class="num" data-l="GPA">৪.০০</td><td data-l="গ্রেড">A-</td><td data-l="ফলাফল"><span class="chip chip-ok">{t("উত্তীর্ণ","Pass")}</span></td><td><button class="btn btn-ghost btn-sm" type="button" data-expand="r5" aria-expanded="false">{t("বিষয়ভিত্তিক","Subjects")}</button></td></tr>
      <tr id="r5" class="detail" hidden><td colspan="6"><div class="subj"><span><b>{t("বাংলা","Bangla")}</b> ৬৫</span></div></td></tr>
    </tbody></table></div>
    <p class="tiny" style="margin-top:10px">{t("ভুল মনে হলে শ্রেণিশিক্ষকের সাথে কথা বলুন। এই পাতা প্রতি ৫ মিনিটে হালনাগাদ হয়।","If something looks wrong, talk to the class teacher. This page refreshes every 5 minutes.")}</p>
  </div>

  <div>
    <p class="tiny" style="margin-bottom:10px">{t("ফল এখনও না দিলে এমন দেখায়","What shows when results are not published yet")}</p>
    <div class="empty"><b>{t("এই পরীক্ষার ফল এখনও ওয়েবসাইটে প্রকাশ হয়নি","This exam's results are not on the website yet")}</b>{t("প্রকাশ হলে নোটিশ বোর্ডে জানানো হবে। অন্য পরীক্ষা বেছে নিন।","The notice board will say when they are. Pick another exam.")}</div>
  </div>
</div></section>
'''
RESULTS_CSS = '''
.subj{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:14px;padding:4px 0}
.subj span{color:var(--ink-2)} .subj b{color:var(--ink);font-weight:600;margin-right:4px}
tr.detail td{background:var(--bg-2)}
@media(max-width:640px){
  .res thead{display:none}
  .res tr{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;padding:12px 14px;border-bottom:1px solid var(--line)}
  .res td{display:block;border:0;padding:0;text-align:left!important}
  .res td[data-l]::before{content:attr(data-l);display:block;font-size:12px;color:var(--ink-3)}
  .res td[data-l="নাম"]{grid-column:1/-1;font-weight:600;font-size:17px}
  .res td:last-child{grid-column:1/-1}
  .res tr.detail{display:block}.res tr.detail td{padding:0}
}'''

TEACHERS = ph("শিক্ষকমণ্ডলী","Teachers","শিক্ষকমণ্ডলী","Our teachers","৪২ জন শিক্ষক ও ৯ জন কর্মচারী। বিভাগ অনুযায়ী দেখুন।","42 teachers and 9 staff. Filter by department.") + f'''
<section class="sec"><div class="wrap" style="display:grid;gap:24px">
  <div class="filters" role="group" aria-label="Department"><button type="button" aria-pressed="true">{t("সবাই","Everyone")}</button><button type="button" aria-pressed="false">{t("প্রশাসন","Administration")}</button><button type="button" aria-pressed="false">{t("বিজ্ঞান","Science")}</button><button type="button" aria-pressed="false">{t("ভাষা","Languages")}</button><button type="button" aria-pressed="false">{t("মানবিক ও ব্যবসায়","Humanities & Business")}</button></div>
  <div class="grid g4">''' + "".join(f'''<div class="card tcard"><div class="avatar" role="img" aria-label="Photo slot 400×400"></div><b>{t(n,ne)}</b><span class="small">{t(d,de)}</span><span class="tiny">{t(s,se)} · {t("কর্মরত "+y+" সাল থেকে","Since "+ye)}</span></div>''' for n,ne,d,de,s,se,y,ye in [
 ("মোঃ আব্দুল করিম","Md. Abdul Karim","প্রধান শিক্ষক","Headmaster","গণিত, এম.এসসি","Mathematics, MSc","২০০৪","2004"),
 ("শাহানা পারভীন","Shahana Parveen","সহকারী প্রধান শিক্ষক","Assistant Headmaster","বাংলা, এম.এ, বি.এড","Bangla, MA, BEd","২০০৯","2009"),
 ("তানভীর হাসান","Tanvir Hasan","সহকারী শিক্ষক","Assistant Teacher","পদার্থবিজ্ঞান, বি.এসসি (অনার্স)","Physics, BSc Hons","২০১৬","2016"),
 ("নাসরিন আক্তার","Nasrin Akter","সহকারী শিক্ষক","Assistant Teacher","ইংরেজি, এম.এ","English, MA","২০১২","2012"),
 ("আবু সাঈদ","Abu Sayeed","সহকারী শিক্ষক","Assistant Teacher","রসায়ন, এম.এসসি","Chemistry, MSc","২০১৮","2018"),
 ("রোকেয়া বেগম","Rokeya Begum","সহকারী শিক্ষক","Assistant Teacher","জীববিজ্ঞান, বি.এসসি, বি.এড","Biology, BSc, BEd","২০১০","2010"),
 ("মাহবুব আলম","Mahbub Alam","সহকারী শিক্ষক","Assistant Teacher","হিসাববিজ্ঞান, এম.কম","Accounting, MCom","২০১৫","2015"),
 ("ফারহানা ইয়াসমিন","Farhana Yasmin","সহকারী শিক্ষক","Assistant Teacher","আইসিটি, বি.এসসি (সিএসই)","ICT, BSc CSE","২০২১","2021"),
]) + f'''</div>
  <p class="tiny">{t("ছবি ঐচ্ছিক; শিক্ষকের সম্মতিতে অ্যাডমিন যুক্ত করেন।","Photos are optional; the admin adds them with the teacher's consent.")}</p>
</div></section>
'''

CONTACT = ph("যোগাযোগ","Contact","যোগাযোগ ও ঠিকানা","Contact & location","অফিস সময়ে ফোন করুন বা নিচে লিখুন। মূল ক্যাম্পাস ছাড়াও একটি শাখা আছে।","Call during office hours or write below. There is one branch besides the main campus.") + f'''
<section class="sec"><div class="wrap contact" style="gap:32px">
  <div style="display:grid;gap:22px">
    <div><h2 style="font-size:22px">{t("মূল ক্যাম্পাস","Main campus")}</h2>
    <dl class="kv" style="margin-top:12px"><dt>{t("ঠিকানা","Address")}</dt><dd>{t("কলেজ রোড, নবীনগর, ব্রাহ্মণবাড়িয়া ৩৪১০","College Road, Nabinagar, Brahmanbaria 3410")}</dd><dt>{t("অফিস","Office")}</dt><dd>০১৭১১-০০০০০০</dd><dt>{t("প্রধান শিক্ষক","Headmaster")}</dt><dd>০১৭১১-০০০০০১</dd><dt>{t("ইমেইল","Email")}</dt><dd>office@nabinagarhs.edu.bd<br>admission@nabinagarhs.edu.bd</dd></dl></div>
    <div><h3>{t("অফিস সময়","Office hours")}</h3>
    <div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><tbody><tr><td>{t("রবি – বৃহস্পতি","Sun – Thu")}</td><td class="num">{t("সকাল ৯:০০ – বিকেল ৪:০০","9:00 am – 4:00 pm")}</td></tr><tr><td>{t("শুক্রবার","Friday")}</td><td class="num">{t("বন্ধ","Closed")}</td></tr><tr><td>{t("শনিবার","Saturday")}</td><td class="num">{t("সকাল ৯:০০ – দুপুর ১:০০","9:00 am – 1:00 pm")}</td></tr></tbody></table></div></div>
    <div class="cta"><a class="btn wa" href="https://wa.me/8801711000000">{t("WhatsApp-এ লিখুন","Message on WhatsApp")}</a><a class="btn btn-ghost" href="#">{t("ফেসবুক পেজ","Facebook page")}</a></div>
    <div><h3>{t("শাখা ক্যাম্পাস","Branch campus")}</h3><div class="card" style="padding:16px;margin-top:8px;display:grid;gap:4px"><b>{t("নবীনগর উচ্চ বিদ্যালয় · বিদ্যাকুট শাখা","Nabinagar High School · Bidyakut branch")}</b><span class="small muted">{t("বিদ্যাকুট বাজার, নবীনগর · ষষ্ঠ–অষ্টম শ্রেণি","Bidyakut Bazar, Nabinagar · Classes 6–8")}</span><a class="small" href="#">{t("শাখার ওয়েবসাইট","Branch website")}</a></div></div>
  </div>
  <div style="display:grid;gap:22px">
    <div class="map" style="aspect-ratio:4/3"><div style="text-align:center;display:grid;gap:10px"><button class="btn btn-ghost" type="button">{t("মানচিত্র দেখুন","Show map")}</button><span class="tiny">{t("ট্যাপ করলে Google Maps লোড হবে","Google Maps loads on tap")}</span></div></div>
    <form class="card" style="padding:20px;display:grid;gap:14px" onsubmit="return false"><h3>{t("বার্তা পাঠান","Send a message")}</h3>
      <div class="field"><label for="n">{t("আপনার নাম","Your name")}</label><input id="n"></div>
      <div class="field"><label for="p">{t("মোবাইল নম্বর","Mobile number")}</label><input id="p" inputmode="tel"></div>
      <div class="field"><label for="m">{t("বার্তা","Message")}</label><textarea id="m"></textarea></div>
      <div class="turnstile"><i></i>{t("রোবট নয় যাচাই (Turnstile)","Not-a-robot check (Turnstile)")}</div>
      <button class="btn btn-primary" type="submit">{t("পাঠান","Send")}</button></form>
  </div>
</div></section>
'''

BLOG = f'''
<article class="sec"><div class="wrap" style="max-width:760px">
  <div class="crumbs"><a href="home.html">{t("হোম","Home")}</a> › <a href="notices.html">{t("খবর ও ইভেন্ট","News & events")}</a> › {t("ব্লগ","Blog")}</div>
  <h1 style="margin-top:6px">{t("বিজ্ঞান মেলায় আমাদের তিনটি প্রকল্প জেলায় প্রথম","Three of our projects took first place at the district science fair")}</h1>
  <p class="tiny" style="margin:10px 0 24px">{t("২ নভেম্বর ২০২৬ · ৪ মিনিটের পড়া","2 November 2026 · 4 min read")}</p>
  <div class="slot" data-size="1200×630" style="aspect-ratio:1200/630;margin-bottom:28px" role="img" aria-label="Cover image slot"><span class="cap">{t("কভার ছবি","Cover image")}</span></div>
  <div class="prose">
    <p>{t("গত সপ্তাহে ব্রাহ্মণবাড়িয়া জেলা বিজ্ঞান মেলায় ৩৮টি স্কুল অংশ নেয়। আমাদের নবম ও দশম শ্রেণির তিনটি দল তিনটি আলাদা বিভাগে প্রথম হয়েছে। এই লেখায় প্রকল্পগুলো কী, কারা করেছে আর আমরা কী শিখলাম।","Thirty-eight schools took part in last week's Brahmanbaria district science fair. Three teams from our Classes 9 and 10 won first place in three separate categories. Here is what the projects were, who built them, and what we learned.")}</p>
    <h2>{t("তিনটি প্রকল্প","The three projects")}</h2>
    <ul><li>{t("সৌরচালিত ধান শুকানোর যন্ত্র — বৃষ্টির মৌসুমে কৃষকের ক্ষতি কমায়।","A solar paddy dryer that cuts farmers' losses in the rainy season.")}</li><li>{t("পুকুরের পানির অক্সিজেন মাপার সস্তা সেন্সর — দাম ৪০০ টাকার নিচে।","A cheap dissolved-oxygen sensor for fish ponds, under BDT 400.")}</li><li>{t("বাংলা হাতের লেখা চেনার একটি ছোট প্রোগ্রাম, স্কুলের পুরোনো কম্পিউটারে চলে।","A small Bangla handwriting recogniser that runs on the school's old computers.")}</li></ul>
    <h2>{t("ফলাফল এক নজরে","Results at a glance")}</h2>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>{t("প্রকল্প","Project")}</th><th>{t("বিভাগ","Category")}</th><th>{t("দল","Team")}</th><th class="num">{t("স্থান","Place")}</th></tr></thead><tbody><tr><td>{t("সৌর ধান শুকানো","Solar paddy dryer")}</td><td>{t("কৃষি","Agriculture")}</td><td>{t("দশম · বিজ্ঞান","Class 10 · Science")}</td><td class="num">{t("১ম","1st")}</td></tr><tr><td>{t("অক্সিজেন সেন্সর","Oxygen sensor")}</td><td>{t("পরিবেশ","Environment")}</td><td>{t("নবম · বিজ্ঞান","Class 9 · Science")}</td><td class="num">{t("১ম","1st")}</td></tr><tr><td>{t("হাতের লেখা চেনা","Handwriting recogniser")}</td><td>{t("আইসিটি","ICT")}</td><td>{t("দশম · বিজ্ঞান","Class 10 · Science")}</td><td class="num">{t("১ম","1st")}</td></tr></tbody></table></div>
    <blockquote>{t("“যন্ত্রটা কাজ করছে দেখে বাবা প্রথম বললেন, এবার বর্ষায় ধান পচবে না।”","“When my father saw the machine work, the first thing he said was: the paddy won't rot this monsoon.”")}<cite>{t("— দশম শ্রেণির একজন দলনেতা","— a Class 10 team leader")}</cite></blockquote>
    <div class="slot" data-size="≤1200 wide" style="aspect-ratio:3/2" role="img" aria-label="In-post image slot"><span class="cap">{t("লেখার ভেতরের ছবি: প্রকল্পের টেবিল","In-post image: the project table")}</span></div>
    <p>{t("তিনটি দলই এখন বিভাগীয় মেলায় যাবে। যন্ত্রগুলো দেখতে চাইলে বিজ্ঞানাগারে রাখা আছে; অফিস সময়ে এলে দেখানো হবে। পুরো প্রতিযোগিতার নিয়মাবলি","All three teams now go to the divisional fair. The machines are in the science lab; come during office hours and we will show you. The full competition rules are")} <a href="#">{t("জেলা শিক্ষা অফিসের পাতায়","on the district education office page")}</a>।</p>
  </div>
  <div class="cta" style="margin-top:32px;border-top:1px solid var(--line);padding-top:20px"><a class="btn btn-ghost" href="home.html">{t("সব লেখা","All posts")}</a><button class="btn btn-ghost" type="button">{t("লিংক কপি","Copy link")}</button></div>
</div></article>
'''
BLOG_CSS = '''
.prose{font-family:"Noto Serif Bengali","Hind Siliguri",serif;font-size:18px;line-height:1.85;max-width:70ch;display:grid;gap:18px}
html[data-lang=en] .prose{font-family:Georgia,"Noto Serif Bengali",serif;font-size:18px}
.prose h2{font-family:var(--bn);font-size:24px;margin-top:10px}html[data-lang=en] .prose h2{font-family:var(--en)}
.prose ul{margin:0;padding-left:22px}.prose li{margin:4px 0}
.prose blockquote{margin:0;padding:6px 0 6px 20px;border-left:4px solid var(--accent);font-size:20px;color:var(--ink-2)}
.prose blockquote cite{display:block;font-style:normal;font-size:14px;margin-top:8px;color:var(--ink-3)}
.prose .tbl{font-family:var(--bn);font-size:15px}html[data-lang=en] .prose .tbl{font-family:var(--en)}
.prose a{text-underline-offset:3px}
'''

pages = {
 "home.html": ("home.html","হোম","Home",HOME,""),
 "admissions.html": ("admissions.html","ভর্তি","Admissions",ADMISSIONS,""),
 "notices.html": ("notices.html","নোটিশ বোর্ড","Notice board",NOTICES_PAGE,""),
 "results.html": ("results.html","ফলাফল","Results",RESULTS,RESULTS_CSS),
 "teachers.html": ("teachers.html","শিক্ষকমণ্ডলী","Teachers",TEACHERS,""),
 "contact.html": ("contact.html","যোগাযোগ","Contact",CONTACT,""),
 "blog-post.html": ("notices.html","ব্লগ","Blog",BLOG,BLOG_CSS),
}
for f,(cur,tb,te,body,css) in pages.items():
    (HERE/f).write_text(shell(cur,tb,te,body,css),encoding="utf-8")
print("built",len(pages))

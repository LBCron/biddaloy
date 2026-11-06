# Epic 40 — school website theme samples (planning mockups)

> The brief the theme mockups were drawn from, kept as written except paths: the mockups now live in
> `docs/ux-research/epic-40-public-website/site/`, and every path below is relative to that folder.

Purpose: sample previews the product owner reviews before any ticket is written (D24). They must make a school
**stand out for marketing and admissions**, not look like a template. Each theme has ONE strong idea.

## Hard constraints (apply to every theme)

- One self-contained `home.html` per theme in `<theme>/`. Vanilla HTML + CSS (+ tiny JS only for the
  language switch and the notice-board skeleton demo). Google Fonts via `<link>` are allowed. No frameworks.
- **Mobile-first (D13).** Design at 390 px first, then 1440. Zero horizontal overflow at 390 (the shoot script prints it).
  Tap targets ≥ 44 px. Phone nav = a bottom-sheet or full-screen menu, not a hamburger that opens a tiny dropdown.
- **Bilingual (D8).** Bangla is the default language of the page. Put a `bn | en` switch in the header; implement it as
  `data-lang` on `<html>` with `[lang-en]`/`[lang-bn]` spans, or two text nodes toggled by CSS — any lightweight way,
  the point is the reviewer can click it in the browser. Write REAL Bangla copy, not transliteration. English copy real too.
  Bangla display/body fonts (pick per theme): Hind Siliguri, Noto Sans Bengali, Noto Serif Bengali, Tiro Bangla,
  Baloo Da 2, Anek Bangla, Galada (display only). Pair with one Latin family.
- **No photos of children or students (D17).** Imagery = CSS/SVG illustration, patterns, gradients, abstract shapes,
  building/campus silhouettes, objects (books, pencils, geometry, calligraphy). Where a school would upload a campus
  photo, draw a clearly-labelled placeholder slot (e.g. a soft frame with "স্কুল ভবনের ছবি · 1920×1080") that still looks
  designed, never a grey box.
- **Section switches (D12).** Every section is independent; the page must still look finished if any one is removed.
- **Islands (D21).** The notice list and the events strip are "loaded" — show them with a theme-coloured skeleton
  loader for ~1.2 s then reveal (tiny JS). Everything else is static.
- Footer: school contact, quick links, "পোর্টালে লগইন" button, and the credit line **"Powered by SchoolManagerP"** (D3).
- Accessibility floor: WCAG AA contrast, visible focus rings, `prefers-reduced-motion` respected, semantic landmarks,
  alt text on every image slot, no all-caps labels as a system, no "→" glued to link text.
- Avoid the generic tells: cream+terracotta, near-black+acid-green, identical rounded cards everywhere, eyebrow labels
  over every heading, numbered 01/02/03 markers where nothing is a sequence, gradient washes as decoration.
- Motion: at most one orchestrated page-load moment; hover only under `@media (hover:hover)`; buttons `scale(.97)` on press.

## Homepage section order (all themes; the theme decides the visual treatment)

1. Header: logo slot (512×512), school name bn/en, nav (হোম · আমাদের কথা · একাডেমিক · ভর্তি · খবর ও ইভেন্ট · যোগাযোগ), `bn|en`, "পোর্টালে লগইন".
2. Hero: mission line, one strong visual, two CTAs: primary "ভর্তির আবেদন করুন", secondary "ক্যাম্পাস দেখুন"/"যোগাযোগ করুন".
3. Admission status strip (V3): "২০২৭ শিক্ষাবর্ষে ভর্তি চলছে · শেষ তারিখ ১৫ ডিসেম্বর" with a countdown chip.
4. Notice board island (V4): 4 notices, skeleton → list; one tagged "জরুরি". Link "সব নোটিশ".
5. About teaser: history/vision 2 short paragraphs, 3 proof numbers that are _about the school_ (founded year, teachers, pass rate) — not a stats bar of invented SaaS numbers.
6. Academics / programs: classes or departments relevant to the theme type (see per-theme content).
7. Teachers (V5): 4 cards — name, designation, subject; photo slot 400×400 drawn as an illustrated avatar placeholder.
8. Events / calendar strip (V6, island): next 3 events with dates.
9. Blog teasers (V22): 3 posts, cover slot 1200×630, title, date.
10. Contact (V10/V12): address, phone, hours, map placeholder with "মানচিত্র দেখুন" tap-to-load button, WhatsApp button.
11. Footer as above.

## Per-theme concept, content and palette direction (the theme owner may push further, never blander)

See the dispatch prompt for the themes you own. Shared demo school names:

- primary: "সূর্যমুখী শিশু বিদ্যালয়" / Surjomukhi Children's School, Dhanmondi, Dhaka. Play group → Class 5.
- high-school: "রামপুরা মডেল উচ্চ বিদ্যালয়" / Rampura Model High School, est. 1968, Class 6–10, SSC pass 98%.
- college: "স্বপ্নপুর কলেজ" / Shopnopur College, HSC science/business/humanities, est. 1994.
- madrasa: "জামিয়া দারুল উলূম মাদ্রাসা" / Jamia Darul Uloom Madrasa, Hifz · Kitab · Alia (Dakhil/Alim) — show both Qawmi and Alia content as two variants if time allows, else Alia.
- international: "Dreamhill International School" / ড্রিমহিল ইন্টারন্যাশনাল স্কুল, Cambridge curriculum, Play → A-Level. English default here (the only theme where en is the default and bn the switch).
- premium: "কল্পনগর গ্রামার স্কুল" / Kalponagar Grammar School (a made-up town), est. 1961, "heritage + modern".
- basic: "নবীনগর উচ্চ বিদ্যালয়" / Nabinagar High School — the plain default: one accent colour the school picks, clean, fast, zero cleverness, still handsome.

## Output

- `<theme>/home.html` (+ inner pages where asked).
- Run: `node shoot.mjs <theme>/home.html shots/<theme>-home` → `*-1440.webp`, `*-390.webp`.
- Look at both shots yourself (Read tool), fix every defect in ONE batch, re-shoot once, stop.
- Append a 6–10 line "design note" per theme to `NOTES.md`: the one idea, palette (hex), type pair, what you rejected and why.

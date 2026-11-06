## madrasa — জামিয়া দারুল উলূম মাদ্রাসা

- One idea: dignity and calm. Typographic hero (bismillah → Bangla mission → Qur'an line with meaning) plus a "today's schedule" card that merges prayer times and class periods; no human figures anywhere.
- Palette: green #0F3D2E / #17543F, sand #F4EBDA, cream #FBF7EE, gold #B8903F / #D5B36A, ink #1D2A24. Gold is used only for actions, rules and Arabic — never as a wash.
- Type: Noto Serif Bengali (display + body), Amiri (Arabic lines, `lang="ar"`), Source Sans 3 (Latin, numbers, meta).
- Pattern: a hand-drawn SVG eight-point star field at 14–18% opacity on hero/about/contact only.
- Sections: 4 programme cards (হিফজ · কিতাব · দাখিল · আলিম) in stepped greens with an Alia/Qawmi board switch note; care row (residential hall, three meals, safety) because that is what a guardian actually asks.
- Rejected: neon green, mosque clip-art, Arabic-styled Latin fonts, stock photos of boys in caps, stats bars.

## college — স্বপ্নপুর কলেজ

- One idea: editorial confidence, "results are a habit". Oversized Anek Bangla headline, a tall framed campus photo slot, hairline-ruled lists instead of cards.
- Palette: ink #0E1B2A, forest #0F5132 (one strong colour, also the results band), accent #E0552C only for the primary CTA and the "now" admission step, paper #FFFFFF / #F3F5F7, line #DCE1E7.
- Type: Anek Bangla 700–800 display, Hind Siliguri body, Space Grotesk for Latin/numbers.
- Structure: notices as a dated ledger with a sticky heading; departments as an index (big names, arrow discs); admission as a real 4-step sequence (numbered, with done/now states); HSC results band with sourced numbers and a "searchable by roll" note; faculty with credential lines.
- Rejected: student-with-backpack hero, SaaS stat tiles, rounded cards everywhere, decorative gradients.

## primary — সূর্যমুখী শিশু বিদ্যালয় (kids, play group → class 5)

- One idea: _a guardian should feel the school is safe before reading a word_. Calm, sunlit, rounded; nothing shouts.
- Palette: cream #FFF8EC, sage #8FB996 / #4F8A5B, butter #F5D77A, sky #9CCBE8 / #3F7FA6, coral #F28B6E / #D4603F, ink #2E3A33.
- Type: Baloo Da 2 (Bangla + Latin display, rounded) with Nunito for English body. Headline tilts one word (`em` rotated -2°).
- Hero visual is an inline SVG I drew: school house, slow-spinning sun, bobbing kite, crayons, paper boat, no children. Wave divider into the admission strip.
- Programme cards are stacked "building blocks" (stepped heights, lip on top) instead of identical cards; safety promises (CCTV + pick-up card, nurse, arrival SMS) get their own row because that is the real buying argument for this segment.
- "A day at school" routine strip answers the first question a new guardian asks.
- Rejected: circus primaries + confetti (Dribbble "Kiden"-style) — reads cheap; stock photos of kids — banned; emoji-free icons were tried, kept emoji only inside tinted tiles as placeholders for a future icon set.
- Phone: bottom-sheet menu, single-column blocks, 44 px targets; 0 px horizontal overflow.

## high-school — রামপুরা মডেল উচ্চ বিদ্যালয় (class 6–10, est. 1968)

- One idea: _civic pride and results_. The hero is pure typography — the motto in 96 px Bangla serif and the founding year "১৯৬৮" as an outlined gold numeral; no hero photo at all.
- Palette: deep green #0F4D3A / #0A3A2C, gold #C9A227 / #F6EDCF, paper #F7F5EF, ink #15211C, red #A2321F only for "জরুরি".
- Type: Noto Serif Bengali (display) + Noto Sans Bengali (body); English falls to Source Serif 4 + IBM Plex Sans. Square corners everywhere, 1 px rules, gold underline for emphasis.
- Results strip is a real data band: four figures with thin progress bars (pass rate, GPA-5 count, students, teacher ratio), not a stats bar of SaaS vanity numbers.
- Classes 6–10 as a ruled grid with big numerals; the three groups as colour-ruled columns with subject chips.
- Campus photo demoted to a framed placeholder with a caption ("মূল ভবন, ১৯৯২") in the About section.
- SVG crest monogram with 1968 in the header; dark-green top bar with phone/hours like a real BD school letterhead.
- Rejected: navy+uniform-photo hero (the Dribbble default for this category); rounded cards; gradient washes.
- Phone: the outlined year drops under the headline, results 2×2, 0 px overflow.
- Bug caught in review: a `display:block` on the hero language spans beat the `[data-lang]` hide rule by specificity and showed both languages; fixed by scoping the block rule to the active language. Rule for the real theme system: language visibility must be the highest-specificity rule or use the `hidden` attribute.

## basic — the default theme (owner: basic fork)

- One idea: nothing to notice except the school. One accent (`--accent`, demo `#1a4fd6`), white, near-black `#17181c`; every colour is the accent or a grey. A school that never picks a theme still looks trustworthy.
- Type: Hind Siliguri (bn, 16px/1.65) + Inter (en, 15.5px); blog body switches to Noto Serif Bengali 18px/1.85, 70ch measure.
- Structure devices carry meaning only: date tiles on notices/events, a left accent rule on the three school facts, numbered circles only on the admission steps (a real sequence). No eyebrows, no "→", no decorative gradients.
- Photo slots are dashed accent frames with a label and the exact size (1920×1080 hero, 1200×800 about, 1200×630 cover, 400×400 avatar); the hero slot carries a skyline SVG so an empty slot still reads as a design, not a hole.
- Bilingual: `<x-t bn en>` + CSS `attr()` for text; `data-bn/data-en` + 10 lines of JS for `<option>`/placeholders (custom elements do not render inside `<option>` — found in review, fixed).
- Phone: 2-col teacher grid, stacked result cards (`data-l` labels), full-screen menu sheet, brand subtitle ellipsised, strip wraps to two lines. 0 px overflow on all 7 pages.
- Rejected: hero stats bar (invented SaaS numbers), card-shadow kit, a coloured header bar (makes the accent shout), Google-Maps iframe on load (privacy + weight → tap-to-load).
- Skipped: sticky phone CTA bar, dark mode — add when a school asks.

## Inner-page structure (shared by every theme vs theme-specific)

Shared skeleton (every theme reuses, only skinned): header (logo slot, name bn/en, 8-item nav, bn|en, portal login, phone sheet) · page header (crumbs + h1 + one-line intro) · footer (contact, quick links, downloads, portal CTA, "Powered by SchoolManagerP").
Shared page bodies, same blocks in every theme:

- admissions: steps (ordered) · key dates list · fee table (class × fee types) · FAQ (details/summary) · enquiry form w/ Turnstile slot.
- notices: filter chips · notice list island (skeleton→rows; date tile, title, meta, tag) · "older" button · open-notice article (tag, date, body, PDF viewer slot, download + copy link).
- results: filter form (exam→class→section, roll optional, Turnstile) · result header (exam · class · section, count, publish date, print) · table (roll · name · GPA · grade · result · expand) with per-subject detail row · footnote · empty state.
- teachers: department filter chips · 4-col grid (2-col phone) of avatar/name/designation/subjects/since · consent footnote.
- contact: campus address block · office-hours table · WhatsApp/Facebook · branch list (V21) · map tap-to-load · message form.
- blog-post: crumbs · h1 · date/read time · cover slot · prose (p, h2, ul, table, blockquote+cite, image slot, link) · all-posts/copy-link.
  Theme-specific: colours, type pair, hero treatment, section backgrounds/dividers, card shape, avatar illustration style, skeleton colour, motion. The HTML block order above should be the shared Astro component set; themes override tokens + a few slots, never the structure.

## international — Dreamhill International School (en default, bn switch)

- One idea: a Cambridge school that competes with Gulshan's best, told through **one typographic hero and one real pathway**. Dark, cinematic, editorial; the campus photo is a framed plate, not a background.
- Palette: navy `#0A1E3C` / navy-2 `#132C52`, paper `#F5F3EC` / `#EBE7DC`, signal gold `#F0B429` (CTA, rule, step rings), ink `#15213A`, mute `#5B6478`.
- Type: Fraunces (opsz 144, weight 300 display, italic gold accent word) + Inter body; Noto Sans Bengali when bn is on. Headline 44–96 px, body 16–17.
- Structure beyond the brief's list: pathway band Play → Early Years → Primary → Lower Secondary → IGCSE → A-Level as a numbered sequence (it _is_ a sequence), IGCSE June-2026 results plate, four houses as colour blocks, "Book a campus tour" opens a `<dialog>` enquiry form (name, phone, date) = the V2 enquiry idea.
- Islands: notice board (2-col list, date as big numeral) and events strip skeleton → reveal at 1.2 s.
- Rejected: uniformed-student stock hero, all-caps tracked eyebrows, stats bar of invented numbers (proof is founded year / class cap / teacher count), SaaS cards everywhere (lists with rules instead; only events and houses are boxes).
- Phone: brand subtitle hidden under 600 px; full-screen menu with Fraunces 34 px items and gold portal button at the bottom; figure caption flows under the plate.

## premium — কল্পনগর গ্রামার স্কুল (bn default, en switch)

- One idea: **heritage with a modern hand** — a 1961 grammar school: ivory, one oxblood ink, brass hairlines, an engraved crest, and a real timeline. Wide margins, thin rules, no cards.
- Palette: ivory `#F4F1EA`, stone `#E6E0D3` / `#D8D0BF`, oxblood `#5A1E2B` / `#71283A`, brass `#8F7A4D` / `#B59F6B`, ink `#2B2520`, mute `#6E655B`.
- Type: Tiro Bangla display (italic for the two accent words) + Noto Serif Bengali body; in en, Cormorant Garamond display + Libre Caslon Text body. Brass small-caps-style Latin for dates/labels only where they _are_ labels (EST. 1961, CLASS 6–8).
- Structure: crest drawn as an SVG `<symbol>` (shield, open book, laurel) reused in header and footer; history timeline 1961→2026 (sequence, so a list with dots is honest); principal's message with an italic-Cormorant signature; notable alumni as a year-led list; Founders' Scholarship block in oxblood; motto line "Lux in tenebris".
- Motion: one slow (1.4 s) rise on the hero only; everything else static; reduced-motion kills it.
- Rejected: cream+terracotta (kept warm neutrals but the ink is oxblood and accents brass, no clay), dense broadsheet columns, eyebrow label over every heading (trimmed to the one real label "অধ্যক্ষের বাণী" after the first shoot), kids/students imagery (building silhouette plate instead).
- Phone: brand subtitle hidden under 600 px; menu full-screen in Tiro Bangla 32 px; strip wraps to two lines with the "৩৯ দিন বাকি" chip.

## Wave 0 additions (ticket #3611, decisions D25–D31)

Shared pieces live in `shared/` (`blocks.css`, `blocks.js`, `palettes.js`); every theme links them. Real themes should lift the idea, not the file.

**Hero carousel (D26).** Three labelled 1920 x 1080 slots, dots, prev/next, ~6 s auto-advance that pauses on hover and focus and never starts under `prefers-reduced-motion`, pointer swipe. Where a theme already had a hero photo slot (primary, college, international, premium, basic) slide 1 _is_ that slot, unchanged, and slides 2-3 are the generic labelled placeholder. High-school (typographic hero) and madrasa (schedule card) have no hero photo, so the carousel is a band right under the hero. Only Basic gets the one-photo screenshot (`basic-home-onephoto-*.webp`, `?photos=1`: arrows and dots disappear). "Pauses on hover and focus" means two flags, `hover || focus`: moving the mouse away while a carousel button has focus must not restart it, or the next slide makes that button `inert` and focus drops to `<body>` (WCAG 2.2.2).

**Teachers (D27).** Eight cards on every home, then a "সবাইকে দেখুন" button to `teachers.html`. Basic's old header link was removed so there is one link, at the end.

**Announcement bar (D30).** Up to five items, `translateX` marquee, paused on hover and focus-within. `blocks.js` sets `data-count` on the bar. One item (`?marquee=1` shows it, no shot committed): one static line, no scroll, no duplicate set. Reduced motion with 2+ items: no scroll, one item at a time, and `‹ ›` buttons step through all of them, so items 2–5 are never hidden with no way to reach them. Per theme idiom:

- primary: butter-yellow bar, coral pill label, fully rounded.
- high-school: deep-green letterhead bar with a gold hairline, gold label block, square corners.
- college: ink bar, forest label block, hairline under it, Hind Siliguri.
- madrasa: sand bar with a gold hairline, green label block.
- international: navy-2 bar, gold label block with navy text, Inter.
- premium: oxblood bar, brass label and brass hairline, serif body.
- basic: accent-soft bar, solid accent label pill (the school's one colour).

**Palettes (D28).** Tokens: primary, secondary, accent, surface, ink. Set 0 is the theme's own colours (primary school: `--sage-deep` darkened to #3F7A4B and `--coral-deep` to #C9532F so white-on-fill passes AA; everything else unchanged). `contrast.mjs` checks ink on surface and surface on primary at 4.5:1, secondary at 3:1 on surface or primary, accent as UI colour at 3:1 on surface or 4.5:1 against ink drawn on it.

| Theme         | Set                      | primary | secondary | accent  | surface | ink     |
| ------------- | ------------------------ | ------- | --------- | ------- | ------- | ------- |
| primary       | 0 Sunflower              | #3F7A4B | #3F7FA6   | #C9532F | #FFF8EC | #2E3A33 |
| primary       | 1 Sky                    | #2B6A8C | #4F8A5B   | #B8492B | #F3F9FC | #1F2E38 |
| primary       | 2 Pomegranate            | #8C3A52 | #B07A1E   | #2F7A68 | #FFF6F3 | #3A2830 |
| high-school   | 0 Green and gold         | #0F4D3A | #C9A227   | #A2321F | #F7F5EF | #15211C |
| high-school   | 1 Blue and gold          | #1B3F77 | #C9A227   | #A2321F | #F6F6F2 | #141C2B |
| high-school   | 2 Maroon and gold        | #6B1F2E | #C9A227   | #1F5F4A | #F8F4EE | #2A1A1E |
| college       | 0 Forest                 | #0F5132 | #5E6B7A   | #E0552C | #FFFFFF | #0E1B2A |
| college       | 1 Deep blue              | #173F7A | #566274   | #C2410C | #FFFFFF | #0E1B2A |
| college       | 2 Plum                   | #5B2A7A | #5E6670   | #B4380F | #FFFFFF | #1A1224 |
| madrasa       | 0 Green and gold         | #0F3D2E | #B8903F   | #D5B36A | #FBF7EE | #1D2A24 |
| madrasa       | 1 Midnight blue          | #12324F | #B8903F   | #D5B36A | #F8F7F2 | #17222C |
| madrasa       | 2 Date brown             | #4A2E1C | #B8903F   | #D5B36A | #FAF5EC | #2A1E16 |
| international | 0 Navy and gold          | #0A1E3C | #7A5600   | #F0B429 | #F5F3EC | #15213A |
| international | 1 Pine and gold          | #0C3B33 | #7A5600   | #F0B429 | #F4F4EE | #12251F |
| international | 2 Aubergine and gold     | #2E1A47 | #7A5600   | #F0B429 | #F6F3EE | #1E1530 |
| premium       | 0 Oxblood and brass      | #5A1E2B | #8F7A4D   | #B59F6B | #F4F1EA | #2B2520 |
| premium       | 1 Bottle green and brass | #1F4A3A | #8F7A4D   | #B59F6B | #F3F2EA | #222820 |
| premium       | 2 Navy and brass         | #1D2F55 | #8F7A4D   | #B59F6B | #F3F1EB | #1F2330 |
| basic         | 0 Blue                   | #1A4FD6 | #6B7080   | #B4231A | #FFFFFF | #17181C |
| basic         | 1 Green                  | #12703D | #66706A   | #B4231A | #FFFFFF | #16191A |
| basic         | 2 Orange                 | #B34700 | #706A62   | #A31F1F | #FFFFFF | #1B1816 |

**Editable defaults (D25).** Every bn/en text carries `data-field="<section>.<field>"`; the bn and en half of one string share the key. The key says _where_ the text sits, never a counter, so moving a section or adding a card renames nothing, and the same block has the same keys in every theme (`basic/home.html` and `home-reordered.html` have identical key maps). `python3 basic/build.py` writes them for `basic/`, `--key <file>` for the other themes, `--check` asserts the shared ones. Rules:

| Part        | Rule                                                                                                                                                                                                                                                           | Example                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| section     | `header`, `announcements`, `hero`, `admissions`, `notices`, `about`, `academics`, `teachers`, `events`, `blog`, `contact`, `footer` (also `results`, `principal`, `alumni`, `houses`, `page` = inner-page header); found by the section's id, heading or class | `teachers.title`                                                |
| list item   | a repeated card/row is numbered from 1                                                                                                                                                                                                                         | `teachers.3.name`, `notices.2.date.day`, `hero.slide.2.caption` |
| link/button | a fixed role name from the table below, never the label, so a theme can say "All notices" or "See all notices" and the key is the same                                                                                                                         | `header.nav.admissions`, `notices.see_all`, `hero.cta_primary`  |
| role        | h1/h2/h3 `title`, `[data-tagline]` `tagline`, `.seeall` `see_all`, `time`/`.date` `date`, `dt` `<label>.label`, `dd` `<label>`, `p` `text`, caption `caption`; teachers `name` / `role` / `detail`                                                             | `contact.address`, `contact.address.label`                      |
| repeat      | a second, different text with the same key gets `_2`, `_3`                                                                                                                                                                                                     | `about.text_2`                                                  |

Fixed link and button keys. `build.py` picks the role from the English label (the label only picks it; the key is the role name). The table lists every name the seven themes use:

| Key                                                  | Element                                                                                                                                                                                                                       | Labels it covers today (en)                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `header.nav.<role>`                                  | a main-menu link; role is one of `home`, `about`, `academics`, `admissions`, `news`, `results`, `teachers`, `contact`                                                                                                         | "Admissions" / "Admission"; "News & Notices" / "News & Events"                                                       |
| `header.portal_login`, `header.menu`, `header.close` | the portal button; the phone menu open and close buttons                                                                                                                                                                      | "Portal login", "Menu", "Close"                                                                                      |
| `header.school_name`                                 | the logo link with the school's name                                                                                                                                                                                          | the school's name                                                                                                    |
| `hero.cta_primary`, `hero.cta_secondary`             | first and second hero button, by page order                                                                                                                                                                                   | "Apply for admission"; "Visit the campus" / "See the campus" / "Check results" / "Contact us" / "Book a campus tour" |
| `admissions.link`                                    | the link on the admission strip                                                                                                                                                                                               | "Details & apply" / "Apply online" / "Fees & steps" / "Application form"                                             |
| `notices.see_all`                                    | link to the notice board                                                                                                                                                                                                      | "All notices" / "See all notices"                                                                                    |
| `events.see_all_calendar`                            | link to the academic calendar                                                                                                                                                                                                 | "Full calendar" / "Academic calendar" / "Full academic calendar"                                                     |
| `blog.see_all`                                       | link to the blog                                                                                                                                                                                                              | "All posts"                                                                                                          |
| `teachers.see_all`, `teachers.directory`             | link to `teachers.html`; the staff directory link                                                                                                                                                                             | "See all teachers"; "Full staff directory"                                                                           |
| `about.more`, `academics.more`                       | the one "read more" link of that section                                                                                                                                                                                      | "Our story, leadership…", "Scholarship terms"                                                                        |
| `contact.whatsapp`, `contact.map`, `contact.enquiry` | WhatsApp button; "show map" button; the message/enquiry form link                                                                                                                                                             | "Message on WhatsApp" / "WhatsApp us" / "Message us on WhatsApp"; "Show map"; "Send a message" / "Send an enquiry"   |
| `footer.school_name`                                 | the title of footer column 1                                                                                                                                                                                                  | the school's name                                                                                                    |
| `footer.portal_login`                                | the footer portal link                                                                                                                                                                                                        | "Portal login"                                                                                                       |
| `footer.links.<role>`                                | a footer link; role is a nav role above or one of `admission_form`, `how_to_apply`, `fees`, `notices`, `calendar`, `class_routine`, `holiday_list`, `syllabus`, `book_list`, `downloads`, `governors`, `blog`, `hostel_rules` | "Notice board" → `footer.links.notices`; "Tuition & fees" / "Fee structure" → `footer.links.fees`                    |

Shared in every theme (`--check`): `header.nav.home|about|academics|admissions|news|contact`, `header.portal_login`, `announcements.label`, `announcements.1`–`5`, `hero.title`, `hero.tagline`, `hero.cta_primary`, `hero.cta_secondary`, `notices.title`, `teachers.title`, `teachers.1`–`8.name|role`, `teachers.see_all`, `contact.title`, `contact.address`, `contact.whatsapp`, `contact.map`, `footer.school_name`. `--check` also fails when a link or button in the sections above carries a key outside the table (a label-derived key crept back), and when a page's keys are stale (someone edited it and did not run `--key`). It reads every `home*.html` and every `basic/` page (inner pages: header and footer links and staleness only). Theme-only blocks keep the same rules (`about.opened_in_a`, `alumni.3.note`), so #3616 lifts them as they are; W4 decides which become shared fields. `?skip=news&notag=1` removes the notice section and the hero tagline: `*-home-skipped-*.webp`. No empty box in any of the seven, and no JS error: the island scripts return when their section is gone.

**Section order (D31), `basic/` and `college/` home-reordered.** Sections after the hero are reversed.

- basic: the admission strip assumed it sat under the hero; moved last it fused with the dark footer. Fixed in the mockup (`main>.strip:last-child` gets space above the footer). Plain and tinted section backgrounds still alternate.
- college: the dark admission strip is a loose block bolted to the hero, not a section, so it stays pinned under the hero (a real theme must treat it as part of the hero, or make it a section). The ledger sections and the results band need nothing from a neighbour.
- Rule for W4: no section may style itself from `:first-child`, `+` or a neighbour's background.

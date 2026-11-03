# Hindi interface text — review sheet

Generated 2026-11-03 from `lib/i18n/en.ts` and `lib/i18n/hi.ts`. **Status: DRAFT. Not approved.** No string here has been checked by a fluent Hindi reader yet.

## How to review

- Read each Hindi line as a student would see it on a button, label or message. Natural wording beats word-for-word.
- Mark **Approve** or **Change**. For a change, write the replacement in Notes. Keep `{placeholders}` exactly as they are.
- Brand and product names (LockIn, QS, Google), file formats and example searches stay in Latin script on purpose.
- To see the strings in place, run `pnpm dev:local` (the sandbox turns `HINDI_UI_ENABLED` on) and press **हिन्दी में देखें** in the header.
- When every line is approved: change the status line at the top of `lib/i18n/hi.ts`, record the reviewer and date in `DECISIONS.md`, and set `HINDI_UI_ENABLED=true` in the hosting panel. Until then the switch stays hidden and every page renders in English.

## Automatic checks

| Check | Result |
|---|---|
| English keys | 154 |
| Keys with a Hindi draft | 154 |
| Keys with no Hindi (falls back to English) | none |
| Placeholders that differ from English | none |
| Hindi entries with no Devanagari (intentional?) | `language.offer` = "EN"; `language.offerLabel` = "View in English"; `language.offerLang` = "en" |

The three `language.offer*` entries are deliberately English: on a Hindi page, that button offers **View in English**.

## What stays English by design

Homepage, destination pages, verified university cards, chat, sign-up and age pages, admin, legal and privacy text, QS licence wording, university names and data, and copied records. These are marked `lang="en"` so screen readers pronounce them correctly. Translating any of them is a separate decision.

## Site header

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 1 | `header.home` | LockIn Consulting home | LockIn Consulting मुखपृष्ठ | ☐ | ☐ |  |

## Navigation

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 2 | `nav.primary` | Primary | मुख्य | ☐ | ☐ |  |
| 3 | `nav.primaryMobile` | Primary mobile | मुख्य (मोबाइल) | ☐ | ☐ |  |
| 4 | `nav.destinations` | Destinations | देश | ☐ | ☐ |  |
| 5 | `nav.universities` | Universities | विश्वविद्यालय | ☐ | ☐ |  |
| 6 | `nav.howItWorks` | How it works | यह कैसे काम करता है | ☐ | ☐ |  |
| 7 | `nav.team` | Our team | हमारी टीम | ☐ | ☐ |  |
| 8 | `nav.chat` | Chat | चैट | ☐ | ☐ |  |
| 9 | `nav.openMenu` | Open menu | मेन्यू खोलें | ☐ | ☐ |  |
| 10 | `nav.closeMenu` | Close menu | मेन्यू बंद करें | ☐ | ☐ |  |

## Skip link

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 11 | `skip.toContent` | Skip to content | सीधे मुख्य सामग्री पर जाएँ | ☐ | ☐ |  |

## Back to top

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 12 | `backToTop` | Back to top | ऊपर जाएँ | ☐ | ☐ |  |

## Text size control

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 13 | `textSize.title` | Text size | अक्षरों का आकार | ☐ | ☐ |  |
| 14 | `textSize.button` | Text size: {size} | अक्षरों का आकार: {size} | ☐ | ☐ |  |
| 15 | `textSize.standard` | Standard | सामान्य | ☐ | ☐ |  |
| 16 | `textSize.large` | Large | बड़ा | ☐ | ☐ |  |
| 17 | `textSize.larger` | Largest | सबसे बड़ा | ☐ | ☐ |  |

## Language switch

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 18 | `language.offer` | हिं | EN | ☐ | ☐ |  |
| 19 | `language.offerLabel` | हिन्दी में देखें | View in English | ☐ | ☐ |  |
| 20 | `language.offerLang` | hi | en | ☐ | ☐ |  |

## Keyboard shortcuts

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 21 | `shortcuts.button` | Keyboard shortcuts | कीबोर्ड शॉर्टकट | ☐ | ☐ |  |
| 22 | `shortcuts.title` | Keyboard shortcuts | कीबोर्ड शॉर्टकट | ☐ | ☐ |  |
| 23 | `shortcuts.close` | Close | बंद करें | ☐ | ☐ |  |
| 24 | `shortcuts.search` | Search universities (from any page) | विश्वविद्यालय खोजें (किसी भी पेज से) | ☐ | ☐ |  |
| 25 | `shortcuts.help` | Show these shortcuts | ये शॉर्टकट दिखाएँ | ☐ | ☐ |  |
| 26 | `shortcuts.escape` | Close a menu, panel or this window | मेन्यू, पैनल या यह विंडो बंद करें | ☐ | ☐ |  |
| 27 | `shortcuts.tab` | Move between links and controls | लिंक और बटनों के बीच आगे-पीछे जाएँ | ☐ | ☐ |  |
| 28 | `shortcuts.toggle` | Use the single-key shortcuts / and ? | एक-कुंजी वाले शॉर्टकट / और ? इस्तेमाल करें | ☐ | ☐ |  |
| 29 | `shortcuts.note` | Shortcuts never fire while you are typing in a field, or with Ctrl, Alt or ⌘ held, so browser and screen-reader commands keep working. | किसी फ़ील्ड में टाइप करते समय, या Ctrl, Alt या ⌘ दबाए रखने पर शॉर्टकट काम नहीं करते, ताकि ब्राउज़र और स्क्रीन रीडर के कमांड चलते रहें। | ☐ | ☐ |  |

## Shared words

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 30 | `common.opensNewTab` | (opens in a new tab) | (नए टैब में खुलता है) | ☐ | ☐ |  |
| 31 | `common.officialWebsite` | Official website | आधिकारिक वेबसाइट | ☐ | ☐ |  |
| 32 | `common.tryAgain` | Try again | फिर से कोशिश करें | ☐ | ☐ |  |
| 33 | `common.retry` | Retry | फिर से कोशिश करें | ☐ | ☐ |  |
| 34 | `common.loading` | Loading… | लोड हो रहा है… | ☐ | ☐ |  |
| 35 | `common.status` | Status | स्थिति | ☐ | ☐ |  |

## Listing status labels

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 36 | `status.verified` | Verified | सत्यापित | ☐ | ☐ |  |
| 37 | `status.notYetVerified` | Not yet verified | अभी सत्यापित नहीं | ☐ | ☐ |  |
| 38 | `status.websiteChecked` | Official website checked | आधिकारिक वेबसाइट जाँची गई | ☐ | ☐ |  |
| 39 | `status.identityPending` | Identity/source check pending | पहचान और स्रोत की जाँच बाकी | ☐ | ☐ |  |
| 40 | `status.otherType` | Other institution type — classification pending | अन्य प्रकार का संस्थान — वर्गीकरण बाकी | ☐ | ☐ |  |

## University search page

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 41 | `universities.eyebrow` | All destinations | सभी देश | ☐ | ☐ |  |
| 42 | `universities.title` | Find a university | विश्वविद्यालय खोजें | ☐ | ☐ |  |
| 43 | `universities.intro` | Every university in our public directory, with its status. Verified profiles have been checked by our team; the others are listed while we review them, and show only what we have confirmed. | हमारी सार्वजनिक सूची का हर विश्वविद्यालय, उसकी स्थिति के साथ। सत्यापित प्रोफ़ाइल हमारी टीम ने जाँची हैं; बाकी विश्वविद्यालय समीक्षा के दौरान सूची में हैं, और उनकी केवल वही जानकारी दिखाई गई है जिसकी हमने पुष्टि की है। | ☐ | ☐ |  |

## Search filters and results

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 44 | `search.form` | Universities | विश्वविद्यालय | ☐ | ☐ |  |
| 45 | `search.label` | Search by university name or city | विश्वविद्यालय का नाम या शहर लिखकर खोजें | ☐ | ☐ |  |
| 46 | `search.placeholder` | e.g. Toronto, technical, Freie | जैसे Toronto, technical, Freie | ☐ | ☐ |  |
| 47 | `search.filtersButton` | Filters and sorting | फ़िल्टर और क्रम | ☐ | ☐ |  |
| 48 | `search.activeFilters` | {n} active | {n} लागू | ☐ | ☐ |  |
| 49 | `search.destination` | Destination | देश | ☐ | ☐ |  |
| 50 | `search.allDestinations` | All destinations | सभी देश | ☐ | ☐ |  |
| 51 | `search.verification` | Verification | सत्यापन | ☐ | ☐ |  |
| 52 | `search.anyStatus` | Any status | कोई भी स्थिति | ☐ | ☐ |  |
| 53 | `search.status.verified` | Verified profiles | सत्यापित प्रोफ़ाइल | ☐ | ☐ |  |
| 54 | `search.status.checked` | Website checked, not verified | वेबसाइट जाँची गई, सत्यापित नहीं | ☐ | ☐ |  |
| 55 | `search.status.pending` | Identity check pending | पहचान की जाँच बाकी | ☐ | ☐ |  |
| 56 | `search.type` | Institution type | संस्थान का प्रकार | ☐ | ☐ |  |
| 57 | `search.anyType` | Any type | कोई भी प्रकार | ☐ | ☐ |  |
| 58 | `search.type.university` | Universities | विश्वविद्यालय | ☐ | ☐ |  |
| 59 | `search.type.other` | Other institution types | अन्य प्रकार के संस्थान | ☐ | ☐ |  |
| 60 | `search.sort` | Sort by | क्रम | ☐ | ☐ |  |
| 61 | `search.sort.relevance` | Best match | सबसे अच्छा मेल | ☐ | ☐ |  |
| 62 | `search.sort.name` | Name A–Z | नाम A–Z | ☐ | ☐ |  |
| 63 | `search.sort.name_desc` | Name Z–A | नाम Z–A | ☐ | ☐ |  |
| 64 | `search.sort.status` | Verified first | सत्यापित पहले | ☐ | ☐ |  |
| 65 | `search.sort.relevanceHint` |  (name A–Z until you search) |  (खोजने तक नाम A–Z) | ☐ | ☐ |  |
| 66 | `search.note` | Search covers names and, where the official website states it, the city. Rankings are never used to sort: none are licensed for that. | खोज विश्वविद्यालय के नाम में होती है, और जहाँ आधिकारिक वेबसाइट शहर बताती है, वहाँ शहर में भी। क्रम के लिए रैंकिंग का इस्तेमाल कभी नहीं होता, क्योंकि इसकी अनुमति हमारे पास नहीं है। | ☐ | ☐ |  |
| 67 | `search.results` | Results | परिणाम | ☐ | ☐ |  |
| 68 | `search.searching` | Searching… | खोज रहे हैं… | ☐ | ☐ |  |
| 69 | `search.count.one` | 1 result. | 1 परिणाम। | ☐ | ☐ |  |
| 70 | `search.count.many` | {n} results. | {n} परिणाम। | ☐ | ☐ |  |
| 71 | `search.noMatch` | No universities match. | कोई विश्वविद्यालय नहीं मिला। | ☐ | ☐ |  |
| 72 | `search.unavailable` | Search is unavailable right now. | खोज अभी उपलब्ध नहीं है। | ☐ | ☐ |  |
| 73 | `search.limitedShort` | Too many searches. Wait a minute. | बहुत ज़्यादा खोजें हो गईं। एक मिनट रुकें। | ☐ | ☐ |  |
| 74 | `search.limitedLong` | Too many searches in a short time. Wait a minute, then try again. | थोड़े समय में बहुत ज़्यादा खोजें हो गईं। एक मिनट रुककर फिर से कोशिश करें। | ☐ | ☐ |  |
| 75 | `search.failed` | We could not search the directory just now. Nothing is shown in its place. | हम अभी सूची में खोज नहीं पाए। इसकी जगह कुछ और नहीं दिखाया गया है। | ☐ | ☐ |  |
| 76 | `search.clear` | Clear search and filters | खोज और फ़िल्टर हटाएँ | ☐ | ☐ |  |
| 77 | `search.emptyHelp` | Try fewer words, another spelling, or clear a filter. Only universities in our public directory can be found here. | कम शब्द या कोई दूसरी वर्तनी आज़माएँ, या कोई फ़िल्टर हटाएँ। यहाँ केवल हमारी सार्वजनिक सूची के विश्वविद्यालय मिलते हैं। | ☐ | ☐ |  |
| 78 | `search.showMore` | Show {n} more | {n} और दिखाएँ | ☐ | ☐ |  |
| 79 | `search.showing` | Showing {n} of {total}. | {total} में से {n} दिखाए जा रहे हैं। | ☐ | ☐ |  |
| 80 | `search.moreFailed` | More results could not be loaded. | और परिणाम लोड नहीं हो सके। | ☐ | ☐ |  |
| 81 | `search.limitedRetry` | Too many searches. Wait a minute, then retry. | बहुत ज़्यादा खोजें हो गईं। एक मिनट बाद फिर से कोशिश करें। | ☐ | ☐ |  |

## Save button

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 82 | `save.save` | Save | सहेजें | ☐ | ☐ |  |
| 83 | `save.saved` | Saved | सहेजा गया | ☐ | ☐ |  |
| 84 | `save.saveName` | Save {name} | {name} सहेजें | ☐ | ☐ |  |
| 85 | `save.savedMessage` | Saved {name} on this device. | {name} इस डिवाइस पर सहेज लिया गया। | ☐ | ☐ |  |
| 86 | `save.removedMessage` | Removed {name} from saved universities. | {name} सहेजे गए विश्वविद्यालयों से हटा दिया गया। | ☐ | ☐ |  |
| 87 | `save.blockedMessage` | This browser is blocking storage, so nothing could be saved. | यह ब्राउज़र स्टोरेज की अनुमति नहीं दे रहा, इसलिए कुछ सहेजा नहीं जा सका। | ☐ | ☐ |  |
| 88 | `save.blockedTitle` | Saving is unavailable: this browser is blocking site storage. | सहेजना उपलब्ध नहीं: यह ब्राउज़र साइट स्टोरेज की अनुमति नहीं दे रहा। | ☐ | ☐ |  |

## Saved and recently viewed (this device)

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 89 | `device.label` | Your universities on this device | इस डिवाइस पर आपके विश्वविद्यालय | ☐ | ☐ |  |
| 90 | `device.blocked` | This browser is blocking site storage, so saved and recently viewed universities cannot be kept. | यह ब्राउज़र साइट स्टोरेज की अनुमति नहीं दे रहा, इसलिए सहेजे गए और हाल में देखे गए विश्वविद्यालय यहाँ नहीं रखे जा सकते। | ☐ | ☐ |  |
| 91 | `device.savedTitle` | Saved on this device | इस डिवाइस पर सहेजे गए | ☐ | ☐ |  |
| 92 | `device.savedEmpty` | Nothing saved yet. Use Save on a university to keep it here. | अभी कुछ सहेजा नहीं गया है। किसी विश्वविद्यालय को यहाँ रखने के लिए “सहेजें” दबाएँ। | ☐ | ☐ |  |
| 93 | `device.recentTitle` | Recently viewed | हाल में देखे गए | ☐ | ☐ |  |
| 94 | `device.recentEmpty` | Universities you open will appear here. | आप जो विश्वविद्यालय खोलेंगे, वे यहाँ दिखेंगे। | ☐ | ☐ |  |
| 95 | `device.recheck` | Check their status again | इनकी स्थिति फिर से जाँचें | ☐ | ☐ |  |
| 96 | `device.privacy` | These lists stay in this browser only; LockIn does not store them. Clearing your browser’s site data removes them. | ये सूचियाँ केवल इसी ब्राउज़र में रहती हैं; LockIn इन्हें अपने पास नहीं रखता। ब्राउज़र का साइट डेटा मिटाने पर ये भी मिट जाती हैं। | ☐ | ☐ |  |
| 97 | `device.clearAll` | Clear all | सब हटाएँ | ☐ | ☐ |  |
| 98 | `device.confirmClear` | Confirm: clear all | पक्का करें: सब हटाएँ | ☐ | ☐ |  |
| 99 | `device.gone` | No longer listed. It may have been removed or be under review. | अब सूची में नहीं है। इसे हटाया गया हो सकता है, या इसकी समीक्षा चल रही हो सकती है। | ☐ | ☐ |  |
| 100 | `device.checking` | Checking its current status… | मौजूदा स्थिति जाँची जा रही है… | ☐ | ☐ |  |
| 101 | `device.checkFailed` | Status could not be checked just now. | स्थिति अभी जाँची नहीं जा सकी। | ☐ | ☐ |  |
| 102 | `device.removeSaved` | Remove {name} from saved universities | {name} को सहेजे गए विश्वविद्यालयों से हटाएँ | ☐ | ☐ |  |
| 103 | `device.removeRecent` | Remove {name} from recently viewed | {name} को हाल में देखे गए से हटाएँ | ☐ | ☐ |  |

## University profile page

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 104 | `profile.breadcrumb` | Breadcrumb | आप यहाँ हैं | ☐ | ☐ |  |
| 105 | `profile.eyebrowVerified` | Verified profile | सत्यापित प्रोफ़ाइल | ☐ | ☐ |  |
| 106 | `profile.eyebrowCandidate` | Candidate listing | समीक्षा के दौरान सूचीबद्ध | ☐ | ☐ |  |
| 107 | `profile.introVerified` | Every detail below was checked by our team against the official source cited next to it, on the date shown. | नीचे दी गई हर जानकारी हमारी टीम ने उसके साथ बताए गए आधिकारिक स्रोत से, दी गई तारीख़ पर जाँची है। | ☐ | ☐ |  |
| 108 | `profile.introCandidate` | This university is listed while our team reviews it. Being listed is not a verified profile, a ranking or a recommendation. | यह विश्वविद्यालय हमारी टीम की समीक्षा के दौरान सूची में है। सूची में होने का मतलब सत्यापित प्रोफ़ाइल, रैंकिंग या सिफ़ारिश नहीं है। | ☐ | ☐ |  |
| 109 | `profile.unavailableTitle` | This profile is temporarily unavailable. | यह प्रोफ़ाइल अभी उपलब्ध नहीं है। | ☐ | ☐ |  |
| 110 | `profile.unavailableBody` | We could not load it just now. Nothing is shown in its place. Please try again later. | हम इसे अभी लोड नहीं कर पाए। इसकी जगह कुछ और नहीं दिखाया गया है। कृपया थोड़ी देर बाद फिर से कोशिश करें। | ☐ | ☐ |  |
| 111 | `profile.backTo` | All universities in {country} | {country} के सभी विश्वविद्यालय | ☐ | ☐ |  |
| 112 | `profile.searchAll` | Search all universities, saved and recently viewed | सभी विश्वविद्यालय खोजें, साथ ही सहेजे गए और हाल में देखे गए | ☐ | ☐ |  |

## Share and copy actions

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 113 | `actions.share` | Share | शेयर करें | ☐ | ☐ |  |
| 114 | `actions.copyLink` | Copy link | लिंक कॉपी करें | ☐ | ☐ |  |
| 115 | `actions.copyInfo` | Copy information | जानकारी कॉपी करें | ☐ | ☐ |  |
| 116 | `actions.linkCopied` | Link copied. | लिंक कॉपी हो गया। | ☐ | ☐ |  |
| 117 | `actions.infoCopied` | Information copied, with its verification status and source. | जानकारी उसकी सत्यापन स्थिति और स्रोत के साथ कॉपी हो गई। | ☐ | ☐ |  |
| 118 | `actions.copyBlocked` | Copying is blocked in this browser. Select the address bar to copy the link instead. | इस ब्राउज़र में कॉपी करने की अनुमति नहीं है। लिंक कॉपी करने के लिए ऊपर का पता चुनें। | ☐ | ☐ |  |
| 119 | `actions.shareFallback` | Link copied. Sharing is not available in this browser. | लिंक कॉपी हो गया। इस ब्राउज़र में शेयर करने की सुविधा नहीं है। | ☐ | ☐ |  |
| 120 | `actions.shareFailed` | Sharing did not work. Try copying the link instead. | शेयर नहीं हो सका। इसके बजाय लिंक कॉपी करके देखें। | ☐ | ☐ |  |
| 121 | `actions.copyInEnglish` | Copied information is in English, as published. | कॉपी की गई जानकारी अंग्रेज़ी में है, जैसी प्रकाशित है। | ☐ | ☐ |  |

## Candidate university cards

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 122 | `card.checkedOn` | Official website checked {date} | आधिकारिक वेबसाइट {date} को जाँची गई | ☐ | ☐ |  |
| 123 | `card.bodyChecked` | Courses, tuition, rankings, entry requirements and other details are still being checked against official sources. Check the university’s own website for current information. | कोर्स, फ़ीस, रैंकिंग, प्रवेश की शर्तें और बाकी जानकारी अभी आधिकारिक स्रोतों से जाँची जा रही है। ताज़ा जानकारी के लिए विश्वविद्यालय की अपनी वेबसाइट देखें। | ☐ | ☐ |  |
| 124 | `card.bodyPending` | We have not yet confirmed this institution’s official website, so no link is shown. Courses, tuition, rankings, entry requirements and other details are still being checked against official sources. | हमने अभी इस संस्थान की आधिकारिक वेबसाइट की पुष्टि नहीं की है, इसलिए कोई लिंक नहीं दिखाया गया है। कोर्स, फ़ीस, रैंकिंग, प्रवेश की शर्तें और बाकी जानकारी अभी आधिकारिक स्रोतों से जाँची जा रही है। | ☐ | ☐ |  |

## Questions and answers page

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 125 | `faq.eyebrow` | Questions | सवाल | ☐ | ☐ |  |
| 126 | `faq.title` | Questions and answers | सवाल और जवाब | ☐ | ☐ |  |
| 127 | `faq.emptyTitle` | No answers are published yet. | अभी कोई जवाब प्रकाशित नहीं हुआ है। | ☐ | ☐ |  |
| 128 | `faq.emptyBefore` | We publish an answer here only once our team has reviewed its wording. Until then, each | हम कोई जवाब यहाँ तभी प्रकाशित करते हैं जब हमारी टीम उसके शब्दों की समीक्षा कर ले। तब तक हर | ☐ | ☐ |  |
| 129 | `faq.emptyLink` | destination page | देश के पेज | ☐ | ☐ |  |
| 130 | `faq.emptyAfter` | links to the official sources for that country. | पर उस देश के आधिकारिक स्रोतों के लिंक दिए गए हैं। | ☐ | ☐ |  |
| 131 | `faq.search` | Frequently asked questions | अक्सर पूछे जाने वाले सवाल | ☐ | ☐ |  |
| 132 | `faq.searchLabel` | Search the questions | सवालों में खोजें | ☐ | ☐ |  |
| 133 | `faq.count` | {n} questions. | {n} सवाल। | ☐ | ☐ |  |
| 134 | `faq.matches` | {n} of {total} questions match. | {total} में से {n} सवाल मिले। | ☐ | ☐ |  |
| 135 | `faq.noMatch` | No questions match. Try another word. | कोई सवाल नहीं मिला। कोई दूसरा शब्द आज़माएँ। | ☐ | ☐ |  |
| 136 | `faq.reviewed` | Reviewed {date} | समीक्षा की तारीख़: {date} | ☐ | ☐ |  |
| 137 | `faq.answersInEnglish` | Answers are published in English, as reviewed. | जवाब अंग्रेज़ी में प्रकाशित हैं, जैसी उनकी समीक्षा हुई है। | ☐ | ☐ |  |

## Page not found

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 138 | `notFound.title` | This page isn’t on the map. | यह पेज नक्शे पर नहीं है। | ☐ | ☐ |  |
| 139 | `notFound.body` | The link may be out of date. Start from the destinations list or the homepage. | हो सकता है लिंक पुराना हो। देशों की सूची या मुखपृष्ठ से शुरू करें। | ☐ | ☐ |  |
| 140 | `notFound.destinations` | All destinations | सभी देश | ☐ | ☐ |  |
| 141 | `notFound.home` | Homepage | मुखपृष्ठ | ☐ | ☐ |  |

## Student sign-in

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 142 | `signIn.email` | Email | ईमेल | ☐ | ☐ |  |
| 143 | `signIn.password` | Password | पासवर्ड | ☐ | ☐ |  |
| 144 | `signIn.submit` | Sign in | साइन इन करें | ☐ | ☐ |  |
| 145 | `signIn.pending` | Signing in… | साइन इन हो रहा है… | ☐ | ☐ |  |
| 146 | `signIn.forgot` | Forgot your password? Ask the LockIn team to reset it for you. | पासवर्ड भूल गए? उसे रीसेट करने के लिए LockIn टीम से कहें। | ☐ | ☐ |  |
| 147 | `signIn.emailRequired` | Enter your email address. | अपना ईमेल पता लिखें। | ☐ | ☐ |  |
| 148 | `signIn.emailFormat` | Enter an email address in the format name@example.com. | ईमेल पता name@example.com की तरह लिखें। | ☐ | ☐ |  |
| 149 | `signIn.passwordRequired` | Enter your password. | अपना पासवर्ड लिखें। | ☐ | ☐ |  |
| 150 | `signIn.passwordMin` | Passwords here are at least {n} characters. | यहाँ पासवर्ड कम से कम {n} अक्षरों का होता है। | ☐ | ☐ |  |
| 151 | `signIn.rejected` | That email and password combination was not accepted. Check both and try again. | यह ईमेल और पासवर्ड स्वीकार नहीं हुए। दोनों जाँचकर फिर से कोशिश करें। | ☐ | ☐ |  |
| 152 | `signIn.throttled` | Too many attempts. Wait a few minutes and try again. | बहुत ज़्यादा कोशिशें हो गईं। कुछ मिनट रुककर फिर से कोशिश करें। | ☐ | ☐ |  |
| 153 | `signIn.unavailable` | Sign-in is unavailable right now. Check your connection and try again shortly. | साइन इन अभी उपलब्ध नहीं है। अपना इंटरनेट कनेक्शन जाँचें और थोड़ी देर बाद फिर से कोशिश करें। | ☐ | ☐ |  |

## Password field

| # | Key | English | Hindi (draft) | Approve | Change | Notes |
|---|---|---|---|---|---|---|
| 154 | `password.show` | Show password | पासवर्ड दिखाएँ | ☐ | ☐ |  |

## Sign-off

| Reviewer | Date | Lines approved | Lines changed |
|---|---|---|---|
|  |  |  |  |

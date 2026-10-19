# Stage 6: University Research Intake Report (18 Oct 2026)

**Batch Reference**: `db/intake/2026-10-18-research-batch.json`  
**Status**: `pending_admin_entry`  
**Institutions Researched**: 33 genuine universities across all 11 active destinations (3 per destination).  
**Publication Status**: None published. Directory remains in the honest `pending verification` state on all destination pages.

---

## 1. Governance & Verification Policy Summary

1. **Rejection of `global_university_directory_2026_2027-v6.pdf`**:
   - The PDF document was audited and rejected (`db/intake/PDF-AUDIT.md`).
   - 754 of 779 rows in the PDF were synthetic placeholders (e.g., *United States State University #18*, *University of Canada #3*), with templated tuition, scores, and dates.
   - Genuine university names were used solely as leads; all factual data in this batch was independently researched from official institutional and government sources.

2. **Rankings and Currency Restrictions**:
   - **No QS or THE rankings** were imported or published. Ranking provider terms remain `not_confirmed` pending documented licensing.
   - **No hardcoded INR conversions** were generated. All candidate exchange-rate providers (`ecb`, `frankfurter`, `fbil`, `imf`) remain `not_reviewed`. Tuition amounts are captured strictly in original currencies (USD, GBP, CAD, EUR, AUD, NZD, SAR, AED, PLN).

3. **Database & Publishing Separation**:
   - Research records are held in the private intake file under `db/intake/` and have **not** been entered or published to the database.
   - Public frontend pages display the designed unverified empty state until records are drafted in `/admin`, independently reviewed, verified, and published.

---

## 2. Destination Profiles (33 Institutions)

### 1. United States (US)
* **University of California, Berkeley** (`https://www.berkeley.edu/`)
  - *Type*: Public · *City*: Berkeley, CA
  - *Researched Programme*: Bachelor of Science in Electrical Engineering & Computer Sciences (48 months, full-time).
  - *Tuition Evidence*: USD 48,600.00/year (USD 34,200 non-resident supplemental tuition + USD 14,400 base tuition & fees). Source: UC Berkeley Financial Aid Office (2025–2026).
  - *Admissions Evidence*: A-G college-preparatory requirements; non-resident minimum GPA 3.4; UC is test-free (no SAT/ACT). Language: TOEFL iBT 80+ (100+ recommended) / IELTS 6.5+ (7.0+ recommended).
  - *Intake & Deadline*: Fall intake (August); UC application filing deadline November 30.
  - *Missing/Unavailable*: General acceptance rate omitted per policy (program-specific admissions rate not published separately by major).
  - *Status*: `captured` (identity & facts recorded, pending entry in `/admin`).

* **Massachusetts Institute of Technology (MIT)** (`https://www.mit.edu/`)
  - *Type*: Private · *City*: Cambridge, MA
  - *Researched Programme*: Master of Science in Electrical Engineering and Computer Science (24 months, full-time).
  - *Tuition Evidence*: USD 61,950.00/year (USD 30,975 per term). Source: MIT Student Financial Services (2025–2026).
  - *Admissions Evidence*: Accredited bachelor's in relevant STEM discipline; 3 recommendations; statement of objectives. Language: IELTS 7.0+ / TOEFL 100+.
  - *Intake & Deadline*: Fall intake (September); application deadline December 15.
  - *Scholarships*: Most admitted EECS graduate students receive Research/Teaching Assistantships covering full tuition plus monthly stipend.
  - *Status*: `captured`.

* **University of Michigan, Ann Arbor** (`https://umich.edu/`)
  - *Type*: Public · *City*: Ann Arbor, MI
  - *Researched Programme*: Master of Science in Information (24 months, full-time).
  - *Tuition Evidence*: USD 57,896.00/year (non-resident graduate tuition of USD 28,948 per semester). Source: UMich Office of the Registrar (2025–2026).
  - *Admissions Evidence*: 4-year bachelor's degree; essays; resume; 3 recommendations. Language: TOEFL 100+ (subscores 25+) or IELTS 7.0+ (subscores 6.5+).
  - *Intake & Deadline*: Fall intake (September); priority deadline January 15.
  - *Status*: `captured`.

---

### 2. United Kingdom (GB)
* **The University of Edinburgh** (`https://www.ed.ac.uk/`)
  - *Type*: Public · *City*: Edinburgh, Scotland
  - *Researched Programme*: MSc in Computer Science (12 months, full-time).
  - *Tuition Evidence*: GBP 43,300.00/year (overseas fee status). Source: Scholarships and Student Funding Services (2025–2026).
  - *Admissions Evidence*: UK first-class honours degree or equivalent (70%+ / 8.0+ CGPA from recognized Indian university) in computer science or mathematics. Language: IELTS 7.0 (min 6.5 per skill), TOEFL iBT 100 (min 23 per skill).
  - *Intake & Deadline*: September intake; main international application round deadline March 31.
  - *Status*: `captured`.

* **University of Oxford** (`https://www.ox.ac.uk/`)
  - *Type*: Public · *City*: Oxford, England
  - *Researched Programme*: MSc in Advanced Computer Science (12 months, full-time).
  - *Tuition Evidence*: GBP 39,710.00/year (overseas fee rate). Source: Oxford Graduate Admissions Course Guide (2025–2026).
  - *Admissions Evidence*: UK first-class undergraduate honours degree or equivalent in computer science or mathematics. Language: Higher level (IELTS 7.5, min 7.0 per component; TOEFL 110).
  - *Intake & Deadline*: October intake (Michaelmas term); application deadline January 9.
  - *Status*: `captured`.

* **Imperial College London** (`https://www.imperial.ac.uk/`)
  - *Type*: Public · *City*: London, England
  - *Researched Programme*: MSc Computing - Artificial Intelligence and Machine Learning (12 months, full-time).
  - *Tuition Evidence*: GBP 44,000.00/year (overseas rate). Source: Imperial Postgraduate Study (2025–2026).
  - *Admissions Evidence*: First-class honours degree in STEM discipline with substantial computing; from India: 4-year degree with 75%+ or 8.0/10. Language: IELTS 7.0 (min 6.5 each band), TOEFL 100 (min 22 each band).
  - *Intake & Deadline*: October intake; rolling rounds with final international deadline March 31.
  - *Status*: `captured`.

---

### 3. Canada (CA)
* **University of Toronto** (`https://www.utoronto.ca/`)
  - *Type*: Public · *City*: Toronto, ON
  - *Researched Programme*: Master of Science in Applied Computing (MScAC) (16 months, full-time including 8-month internship).
  - *Tuition Evidence*: CAD 36,450.00/year (~CAD 54,675 total programme). Source: U of T Planning and Budget (2025–2026).
  - *Admissions Evidence*: 4-year bachelor's in CS/math with B+ average (77–79% or 8.0/10 from Tier 1 Indian universities). Language: TOEFL 93 (writing/speaking 22) or IELTS 7.0 (min 6.5).
  - *Intake & Deadline*: September intake; application deadline December 1.
  - *Status*: `captured`.

* **McGill University** (`https://www.mcgill.ca/`)
  - *Type*: Public · *City*: Montreal, QC
  - *Researched Programme*: Bachelor of Science in Computer Science (48 months, full-time).
  - *Tuition Evidence*: CAD 65,600.00/year (international tuition and mandatory fees for Science). Source: McGill Student Accounts (2025–2026).
  - *Admissions Evidence*: All India Senior School Certificate (CBSE) or CISCE ISC with minimum 85%+ overall and 85%+ in Mathematics and sciences. Language: IELTS 6.5 (min 6.0) or TOEFL 90 (min 21 each).
  - *Intake & Deadline*: Fall intake (September); international deadline January 15.
  - *Status*: `captured`.

* **The University of British Columbia** (`https://www.ubc.ca/`)
  - *Type*: Public · *City*: Vancouver, BC
  - *Researched Programme*: Master of Data Science (MDS) (10 months, full-time).
  - *Tuition Evidence*: CAD 55,274.00 total programme. Source: UBC MDS Tuition Schedule (2025–2026).
  - *Admissions Evidence*: Bachelor's degree with minimum B+ average; prerequisites in programming, probability, and calculus. Language: TOEFL 100 (reading/listening 22, writing/speaking 21) or IELTS 7.0 (min 6.5).
  - *Intake & Deadline*: September intake; application deadline January 15.
  - *Status*: `captured`.

---

### 4. Italy (IT)
* **Politecnico di Milano** (`https://www.polimi.it/en`)
  - *Type*: Public · *City*: Milan
  - *Researched Programme*: Laurea Magistrale in Computer Science and Engineering (24 months, full-time).
  - *Tuition Evidence*: EUR 3,898.00/year (non-EU standard tuition). Source: PoliMi International Admissions (2025–2026).
  - *Admissions Evidence*: Bachelor's in computer science/engineering with minimum CGPA 7.0/10 from India. Language: IELTS 6.0+ or TOEFL 78+.
  - *Intake & Deadline*: September intake; Call 2 for non-EU applicants closes late February.
  - *Status*: `captured`.

* **Alma Mater Studiorum – Università di Bologna** (`https://www.unibo.it/en`)
  - *Type*: Public · *City*: Bologna
  - *Researched Programme*: Master's Degree in Artificial Intelligence (24 months, full-time).
  - *Tuition Evidence*: EUR 3,000.00/year maximum standard rate (progressive fee structure based on ISEE Parificato). Source: Unibo Tuition Fees Office (2025–2026).
  - *Admissions Evidence*: Undergraduate degree in computer science, engineering or mathematics; curricular assessment. Language: CEFR B2 level (IELTS 5.5–6.0).
  - *Intake & Deadline*: September intake; non-EU application round closes March 31.
  - *Status*: `captured`.

* **Sapienza Università di Roma** (`https://www.uniroma1.it/en`)
  - *Type*: Public · *City*: Rome
  - *Researched Programme*: Master of Science in Data Science (24 months, full-time).
  - *Tuition Evidence*: EUR 1,000.00/year (fixed contribution for students from developing countries plus €140 regional tax). Source: Sapienza Student Affairs (2025–2026).
  - *Admissions Evidence*: 3-year bachelor's in engineering/computing/math; pre-selection dossier evaluation. Language: B2 level (IELTS 6.0, TOEFL 80).
  - *Intake & Deadline*: Autumn intake; non-EU pre-selection portal closes April 15.
  - *Status*: `captured`.

---

### 5. Germany (DE)
* **Technical University of Munich (TUM)** (`https://www.tum.de/en/`)
  - *Type*: Public · *City*: Munich, Bavaria
  - *Researched Programme*: Master of Science in Informatics (24 months, full-time).
  - *Tuition Evidence*: EUR 6,000.00/semester (EUR 12,000.00/year) for non-EU students + approx. EUR 102/semester student services fee. Source: TUM Fees Office (2025–2026).
  - *Admissions Evidence*: Bachelor's in computer science; aptitude assessment evaluating curricular credits in algorithms, theoretical computer science and mathematics. Language: C1 level / TOEFL 88+ / IELTS 6.5+.
  - *Intake & Deadline*: Winter semester (October start); application deadline May 31.
  - *Status*: `captured`.

* **Ludwig-Maximilians-Universität München (LMU Munich)** (`https://www.lmu.de/en/`)
  - *Type*: Public · *City*: Munich, Bavaria
  - *Researched Programme*: Master of Science in Data Science (24 months, full-time).
  - *Tuition Evidence*: EUR 0 tuition fee (public tuition-free education; basic semester contribution ~EUR 85/semester). Source: LMU International Office (2025–2026).
  - *Admissions Evidence*: BSc in computer science, statistics or related field with grade 2.0 or better (German scale); assessment interview. Language: CEFR B2 (IELTS 6.5+ / TOEFL 80+).
  - *Intake & Deadline*: Winter semester intake; application deadline June 1.
  - *Status*: `captured`.

* **Rheinisch-Westfälische Technische Hochschule Aachen (RWTH Aachen)** (`https://www.rwth-aachen.de/`)
  - *Type*: Public · *City*: Aachen, North Rhine-Westphalia
  - *Researched Programme*: Master of Science in Software Systems Engineering (24 months, full-time).
  - *Tuition Evidence*: EUR 0 tuition fee (public institution); semester contribution ~EUR 320/semester (includes regional transit pass). Source: RWTH Registrar's Office (2025–2026).
  - *Admissions Evidence*: Bachelor of Science in computer science with minimum credit requirements in math, systems, and algorithms. Language: TOEFL 90+ or IELTS 6.0+.
  - *Intake & Deadline*: Winter semester (October start); non-EU application deadline March 1.
  - *Status*: `captured`.

---

### 6. Australia (AU)
* **The University of Melbourne** (`https://www.unimelb.edu.au/`)
  - *Type*: Public · *City*: Melbourne, Victoria
  - *Researched Programme*: Master of Information Technology (24 months, full-time).
  - *Tuition Evidence*: AUD 54,624.00/year (based on 100 credit points). Source: Study at Melbourne Fees (2025–2026).
  - *Admissions Evidence*: Undergraduate degree with at least one programming course; minimum 65% WAM. Language: IELTS 6.5 (no band below 6.0) or TOEFL 79.
  - *Intake & Deadline*: Semester 1 (February/March); international deadline November 30.
  - *Status*: `captured`.

* **The University of Sydney** (`https://www.sydney.edu.au/`)
  - *Type*: Public · *City*: Sydney, New South Wales
  - *Researched Programme*: Master of Commerce (18 months, full-time).
  - *Tuition Evidence*: AUD 56,500.00/year (indicative 48 credit points). Source: USyd Courses & Fees (2025–2026).
  - *Admissions Evidence*: Bachelor's degree with minimum credit average (65% WAM). Language: IELTS 7.0 (no band below 6.0) or TOEFL 96.
  - *Intake & Deadline*: Semester 1 (February); application deadline January 15.
  - *Status*: `captured`.

* **The Australian National University (ANU)** (`https://www.anu.edu.au/`)
  - *Type*: Public · *City*: Canberra, ACT
  - *Researched Programme*: Master of Computing (24 months, full-time).
  - *Tuition Evidence*: AUD 51,480.00/year (based on 48 units). Source: ANU Programs & Courses (2025–2026).
  - *Admissions Evidence*: Bachelor's degree with minimum GPA 5.0/7.0; introductory programming background. Language: IELTS 6.5 (min 6.0 each band) or TOEFL 80.
  - *Intake & Deadline*: Semester 1 (February); application deadline December 1.
  - *Status*: `captured`.

---

### 7. New Zealand (NZ)
* **University of Auckland** (`https://www.auckland.ac.nz/en.html`)
  - *Type*: Public · *City*: Auckland
  - *Researched Programme*: Master of Information Technology (18 months, full-time).
  - *Tuition Evidence*: NZD 49,862.00/year (120 points international rate). Source: University of Auckland Tuition Fees (2025–2026).
  - *Admissions Evidence*: Bachelor's degree with GPE 4.5/9.0 (approx. 65% from India). Language: IELTS 6.5 (min 6.0 each) or TOEFL 90 (min 21 writing).
  - *Intake & Deadline*: Semester 1 (February); application deadline December 8.
  - *Status*: `captured`.

* **University of Otago** (`https://www.otago.ac.nz/`)
  - *Type*: Public · *City*: Dunedin
  - *Researched Programme*: Master of Business Data Science (12 months, full-time).
  - *Tuition Evidence*: NZD 57,842.00 total programme. Source: Otago International Fees (2025–2026).
  - *Admissions Evidence*: Bachelor's degree with B+ average in 300-level papers. Language: IELTS 6.5 (min 6.0) or TOEFL 90 (min 21 writing).
  - *Intake & Deadline*: Semester 1 (February); application deadline October 31.
  - *Status*: `captured`.

* **Te Herenga Waka – Victoria University of Wellington** (`https://www.wgtn.ac.nz/`)
  - *Type*: Public · *City*: Wellington
  - *Researched Programme*: Master of Professional Business Analysis (16 months, full-time).
  - *Tuition Evidence*: NZD 44,550.00/year (120 points). Source: Wellington International Fees (2025–2026).
  - *Admissions Evidence*: Bachelor's degree with B average (65%+). Language: IELTS 6.5 (min 6.0) or TOEFL 90 (min 20 writing).
  - *Intake & Deadline*: Trimester 1 (February/March); application deadline December 1.
  - *Status*: `captured`.

---

### 8. Saudi Arabia (SA)
* **King Abdullah University of Science and Technology (KAUST)** (`https://www.kaust.edu.sa/en/`)
  - *Type*: Private / Independent · *City*: Thuwal
  - *Researched Programme*: Master of Science in Computer Science (24 months, full-time).
  - *Tuition Evidence*: SAR 0 (KAUST Fellowship covers 100% tuition, on-campus housing, and living stipend of $20,000–$30,000/year). Source: KAUST Admissions (2025–2026).
  - *Admissions Evidence*: Bachelor's in relevant STEM discipline; GPA 3.5/4.0; statement of purpose; 3 recommendations; GRE recommended. Language: TOEFL 79 or IELTS 6.5.
  - *Intake & Deadline*: Fall intake (August); application deadline January 15.
  - *Status*: `captured`.

* **King Fahd University of Petroleum and Minerals (KFUPM)** (`https://www.kfupm.edu.sa/`)
  - *Type*: Public · *City*: Dhahran
  - *Researched Programme*: Master of Science in Artificial Intelligence (24 months, full-time).
  - *Tuition Evidence*: SAR 0 for scholarship recipients (covers 100% tuition, stipend, housing). Source: Deanship of Graduate Studies (2025–2026).
  - *Admissions Evidence*: 4-year bachelor's in CS/engineering with minimum GPA 3.00/4.00; GRE General test. Language: IELTS 6.0 or TOEFL 68.
  - *Intake & Deadline*: Fall intake; international scholarship applications close February 15.
  - *Status*: `captured`.

* **King Saud University** (`https://ksu.edu.sa/en/`)
  - *Type*: Public · *City*: Riyadh
  - *Researched Programme*: Master of Science in Computer Science (24 months, full-time).
  - *Tuition Evidence*: SAR 0 for Saudi Government Scholarship recipients (covers tuition, housing, stipend). Source: KSU Graduate Studies (2025–2026).
  - *Admissions Evidence*: Bachelor's in CS or IT with minimum 'Very Good' rating (GPA 3.75/5.00). Language: TOEFL 61 or IELTS 5.5.
  - *Intake & Deadline*: Fall intake; scholarship portal closes January 31.
  - *Status*: `captured`.

---

### 9. United Arab Emirates (AE)
* **Khalifa University of Science and Technology** (`https://www.ku.ac.ae/`)
  - *Type*: Public · *City*: Abu Dhabi · *Sub-region*: Abu Dhabi
  - *Researched Programme*: Master of Science in Electrical and Computer Engineering (24 months, full-time).
  - *Tuition Evidence*: AED 120,000.00 total programme (AED 3,333/credit hour for 36 credits; full GRTA scholarships available). Source: KU Graduate Admissions (2025–2026).
  - *Admissions Evidence*: Bachelor's in engineering with CGPA 3.0/4.0; research statement. Language: IELTS 6.5 or TOEFL 91.
  - *Intake & Deadline*: Fall intake; regular deadline April 30.
  - *Status*: `captured`.

* **United Arab Emirates University (UAEU)** (`https://www.uaeu.ac.ae/en/`)
  - *Type*: Public · *City*: Al Ain · *Sub-region*: Abu Dhabi
  - *Researched Programme*: Master of Science in Information Technology (24 months, full-time).
  - *Tuition Evidence*: AED 59,400.00 total programme (AED 1,800/credit hour for 33 credits). Source: UAEU College of Graduate Studies (2025–2026).
  - *Admissions Evidence*: Bachelor's in IT or CS with CGPA 3.0/4.0. Language: IELTS 6.0 or TOEFL 79.
  - *Intake & Deadline*: Fall intake; application deadline April 30.
  - *Status*: `captured`.

* **American University of Sharjah (AUS)** (`https://www.aus.edu/`)
  - *Type*: Private · *City*: Sharjah · *Sub-region*: Sharjah
  - *Researched Programme*: Bachelor of Science in Computer Science (48 months, full-time).
  - *Tuition Evidence*: AED 103,820.00/year (AED 51,910 per semester for 12–16 credits). Source: AUS Financial Affairs (2025–2026).
  - *Admissions Evidence*: Secondary school certificate (CBSE / ISC) with 75–80%+ average in math and physics. Language: TOEFL 80 or IELTS 6.5.
  - *Intake & Deadline*: Fall intake; application deadline June 15.
  - *Status*: `captured`.

---

### 10. Finland (FI)
* **University of Helsinki** (`https://www.helsinki.fi/en`)
  - *Type*: Public · *City*: Helsinki
  - *Researched Programme*: Master's Programme in Computer Science (24 months, full-time).
  - *Tuition Evidence*: EUR 15,000.00/year for non-EU/EEA students. Source: University of Helsinki Admissions (2025–2026).
  - *Admissions Evidence*: Bachelor's degree with minimum 60 ECTS in computer science. Language: IELTS 6.5 (min 6.0 writing) or TOEFL 92 (min 22 writing).
  - *Intake & Deadline*: Autumn intake via Finnish Joint Application; application period closes January 15.
  - *Status*: `captured`.

* **Aalto University** (`https://www.aalto.fi/en`)
  - *Type*: Public · *City*: Espoo
  - *Researched Programme*: Master's Programme in Computer, Communication and Information Sciences - Machine Learning, Data Science and AI (24 months, full-time).
  - *Tuition Evidence*: EUR 15,000.00/year for non-EU/EEA students. Source: Aalto Admission Services (2025–2026).
  - *Admissions Evidence*: BSc in computer science, software engineering, or mathematics with high academic standing. Language: IELTS 6.5 (min 5.5 writing) or TOEFL 92 (min 22 writing).
  - *Intake & Deadline*: Autumn intake; application period closes January 8.
  - *Status*: `captured`.

* **University of Oulu** (`https://www.oulu.fi/en`)
  - *Type*: Public · *City*: Oulu
  - *Researched Programme*: Master's Programme in Computer Science and Engineering (24 months, full-time).
  - *Tuition Evidence*: EUR 10,000.00/year for non-EU/EEA students. Source: University of Oulu Admissions (2025–2026).
  - *Admissions Evidence*: Bachelor's in CS or electrical engineering with minimum 60 ECTS in technical computing. Language: IELTS 6.5 (min 5.5 each) or TOEFL 92 (min 20 writing).
  - *Intake & Deadline*: Autumn intake via Joint Application; deadline January 21.
  - *Status*: `captured`.

---

### 11. Poland (PL)
* **University of Warsaw** (`https://en.uw.edu.pl/`)
  - *Type*: Public · *City*: Warsaw
  - *Researched Programme*: Master in Machine Learning (24 months, full-time).
  - *Tuition Evidence*: EUR 4,600.00/year (EUR 2,300 per semester). Source: MIMUW Admissions (2025–2026).
  - *Admissions Evidence*: Bachelor's diploma in CS or mathematics; written qualification exam. Language: CEFR B2 level (IELTS 6.0+, TOEFL 80+).
  - *Intake & Deadline*: Winter semester (October start); registration closes July 7 via IRK.
  - *Status*: `captured`.

* **Jagiellonian University in Kraków** (`https://en.uj.edu.pl/`)
  - *Type*: Public · *City*: Kraków
  - *Researched Programme*: Master in Computer Science - Data Science (24 months, full-time).
  - *Tuition Evidence*: PLN 18,000.00/year (PLN 9,000 per semester). Source: Jagiellonian University International Fees (2025–2026).
  - *Admissions Evidence*: Bachelor's degree in computer science or related quantitative field; interview/evaluation. Language: B2 level (IELTS 6.0+, TOEFL 87+).
  - *Intake & Deadline*: October intake; application deadline July 15 via OAS.
  - *Status*: `captured`.

* **Warsaw University of Technology** (`https://www.pw.edu.pl/eng`)
  - *Type*: Public · *City*: Warsaw
  - *Researched Programme*: B.Sc. in Computer Science (42 months / 7 semesters, full-time).
  - *Tuition Evidence*: EUR 4,000.00/year (EUR 2,000 per semester). Source: WUT International Students Office (2025–2026).
  - *Admissions Evidence*: Secondary school leaving certificate (Class XII CBSE / state board) with high grades in Mathematics and Physics. Language: CEFR B2 level (IELTS 6.0+, TOEFL 87+).
  - *Intake & Deadline*: October intake; application deadline July 15.
  - *Status*: `captured`.

---

## 3. Next Steps in the Review Workflow

1. **Source Registration**: Each official source URL will be registered in `/admin/sources` by staff editors with its retrieval date and publisher metadata.
2. **Draft University Entry**: Each university record will be drafted in `/admin/universities`, attaching campuses, courses, tuition fees, and intake deadlines.
3. **Four-Eyes Review**: A different reviewer will verify facts against the cited official sources before any record is set to `verified` and `published`.
4. **Public Site Readiness**: Once the production MySQL database is provisioned and migrations applied, verified records will automatically appear on destination pages via the `public_*` views.

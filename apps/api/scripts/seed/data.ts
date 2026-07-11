/**
 * Seed data (MM-PLAN-001 §4 salvage manifest): trilingual taxonomy, listing
 * and promotion fixtures ported verbatim from the old repo's 4-script seed
 * pipeline (seed.ts, seed-taxonomy.ts, seed-facilities.ts,
 * seed-homepage.ts). Field names keep the old snake_case shape; the seed
 * runner adapts them to the Phase 3 contracts. Billing tiers/prices are NOT
 * ported (Phase 6) — only the tier ranks facilities carry denormalized.
 */

export const PLACEHOLDER_IMAGE = "/images/specialty-placeholder.svg";

export const SPECIALTIES = [
  {
    key: "cardiology",
    en: "Cardiology",
    ar: "أمراض القلب",
    ckb: "نەخۆشیەکانی دڵ",
    desc_en: "Heart and blood vessel care.",
    desc_ar: "رعاية القلب والأوعية الدموية.",
    desc_ckb: "چاودێری دڵ و خوێنبەرەکان.",
  },
  {
    key: "dermatology",
    en: "Dermatology",
    ar: "الأمراض الجلدية",
    ckb: "نەخۆشیەکانی پێست",
    desc_en: "Skin, hair, and nail conditions.",
    desc_ar: "أمراض الجلد والشعر والأظافر.",
    desc_ckb: "دۆخی پێست، قژ و نینۆک.",
  },
  {
    key: "pediatrics",
    en: "Pediatrics",
    ar: "طب الأطفال",
    ckb: "پزیشکی منداڵان",
    desc_en: "Health care for infants, children, and teens.",
    desc_ar: "الرعاية الصحية للرضع والأطفال والمراهقين.",
    desc_ckb: "چاودێری تەندروستی بۆ کۆرپە، منداڵ و لاوان.",
  },
  {
    key: "dentistry",
    en: "Dentistry",
    ar: "طب الأسنان",
    ckb: "پزیشکی ددان",
    desc_en: "Teeth, gum, and oral health.",
    desc_ar: "صحة الأسنان واللثة والفم.",
    desc_ckb: "تەندروستی ددان، لار و دەم.",
  },
  {
    key: "orthopedics",
    en: "Orthopedics",
    ar: "جراحة العظام",
    ckb: "ئۆرسۆپیدی",
    desc_en: "Bones, joints, and muscles.",
    desc_ar: "العظام والمفاصل والعضلات.",
    desc_ckb: "ئێسک، جومگە و ماسولکەکان.",
  },
  {
    key: "gynecology",
    en: "Gynecology",
    ar: "أمراض النساء",
    ckb: "نەخۆشیەکانی ژنان",
    desc_en: "Women's reproductive health.",
    desc_ar: "صحة المرأة الإنجابية.",
    desc_ckb: "تەندروستی زاوزێی ژنان.",
  },
  {
    key: "ent",
    en: "Ear, Nose & Throat",
    ar: "أنف وأذن وحنجرة",
    ckb: "گوێ، لووت و گەروو",
    desc_en: "Ear, nose, and throat conditions.",
    desc_ar: "أمراض الأذن والأنف والحنجرة.",
    desc_ckb: "دۆخی گوێ، لووت و گەروو.",
  },
  {
    key: "general_medicine",
    en: "General Medicine",
    ar: "الطب العام",
    ckb: "پزیشکی گشتی",
    desc_en: "General health concerns and checkups.",
    desc_ar: "المشاكل الصحية العامة والفحوصات.",
    desc_ckb: "گرفتە تەندروستیە گشتیەکان و پشکنین.",
  },
  {
    key: "neurology",
    en: "Neurology",
    ar: "طب الأعصاب",
    ckb: "دەماردناسی",
    desc_en: "Brain, spine, and nervous system.",
    desc_ar: "الدماغ والعمود الفقري والجهاز العصبي.",
    desc_ckb: "مێشک، مۆری پشت و سیستەمی دەماری.",
  },
  {
    key: "ophthalmology",
    en: "Ophthalmology",
    ar: "طب العيون",
    ckb: "چاوپزیشکی",
    desc_en: "Eye and vision care.",
    desc_ar: "رعاية العين والبصر.",
    desc_ckb: "چاودێری چاو و بینایی.",
  },
  // MM-EXEC-003 specialist launch categories (append-only).
  {
    key: "laboratory",
    en: "Labs",
    ar: "المختبرات",
    ckb: "تاقیگەکان",
    desc_en: "Medical testing and diagnostics.",
    desc_ar: "الفحوصات الطبية والتشخيص.",
    desc_ckb: "پشکنینی پزیشکی و دەستنیشانکردن.",
  },
  {
    key: "physiotherapy",
    en: "Physiotherapy",
    ar: "العلاج الطبيعي",
    ckb: "چارەسەری سروشتی",
    desc_en: "Movement rehabilitation and physical therapy.",
    desc_ar: "إعادة التأهيل الحركي والعلاج الطبيعي.",
    desc_ckb: "چاکبوونەوەی جوڵە و چارەسەری سروشتی.",
  },
  {
    key: "weight_management",
    en: "Weight Management",
    ar: "إدارة الوزن",
    ckb: "بەڕێوەبردنی کێش",
    desc_en: "Nutrition and weight management programs.",
    desc_ar: "برامج التغذية وإدارة الوزن.",
    desc_ckb: "بەرنامەکانی خۆراک و بەڕێوەبردنی کێش.",
  },
] as const;

export const SYMPTOMS: {
  slug: string;
  en: string;
  ar: string;
  ckb: string;
  specialties: { key: string; weight: number }[];
}[] = [
  {
    slug: "headache",
    en: "Headache",
    ar: "صداع",
    ckb: "سەرئێشە",
    specialties: [
      { key: "neurology", weight: 3 },
      { key: "general_medicine", weight: 2 },
      { key: "ent", weight: 1 },
    ],
  },
  {
    slug: "chest-pain",
    en: "Chest pain",
    ar: "ألم في الصدر",
    ckb: "ئازاری سنگ",
    specialties: [
      { key: "cardiology", weight: 3 },
      { key: "general_medicine", weight: 1 },
    ],
  },
  {
    slug: "skin-rash",
    en: "Skin rash",
    ar: "طفح جلدي",
    ckb: "دانەی پێست",
    specialties: [{ key: "dermatology", weight: 3 }],
  },
  {
    slug: "toothache",
    en: "Toothache",
    ar: "ألم في الأسنان",
    ckb: "ئازاری ددان",
    specialties: [{ key: "dentistry", weight: 3 }],
  },
  {
    slug: "joint-pain",
    en: "Joint pain",
    ar: "ألم المفاصل",
    ckb: "ئازاری جومگە",
    specialties: [{ key: "orthopedics", weight: 3 }],
  },
  {
    slug: "back-pain",
    en: "Back pain",
    ar: "ألم في الظهر",
    ckb: "ئازاری پشت",
    specialties: [
      { key: "orthopedics", weight: 3 },
      { key: "neurology", weight: 1 },
    ],
  },
  {
    slug: "sore-throat",
    en: "Sore throat",
    ar: "التهاب الحلق",
    ckb: "ئازاری گەروو",
    specialties: [
      { key: "ent", weight: 3 },
      { key: "general_medicine", weight: 1 },
    ],
  },
  {
    slug: "ear-pain",
    en: "Ear pain",
    ar: "ألم في الأذن",
    ckb: "ئازاری گوێ",
    specialties: [{ key: "ent", weight: 3 }],
  },
  {
    slug: "blurred-vision",
    en: "Blurred vision",
    ar: "عدم وضوح الرؤية",
    ckb: "تەماوی بینین",
    specialties: [{ key: "ophthalmology", weight: 3 }],
  },
  {
    slug: "eye-redness",
    en: "Eye redness",
    ar: "احمرار العين",
    ckb: "سووربوونەوەی چاو",
    specialties: [{ key: "ophthalmology", weight: 3 }],
  },
  {
    slug: "fever-child",
    en: "Fever in a child",
    ar: "حمى عند الطفل",
    ckb: "تای منداڵ",
    specialties: [
      { key: "pediatrics", weight: 3 },
      { key: "general_medicine", weight: 1 },
    ],
  },
  {
    slug: "child-cough",
    en: "Child's cough",
    ar: "سعال عند الطفل",
    ckb: "کۆکەی منداڵ",
    specialties: [{ key: "pediatrics", weight: 3 }],
  },
  {
    slug: "irregular-periods",
    en: "Irregular periods",
    ar: "اضطراب الدورة الشهرية",
    ckb: "خرایی مانگانە",
    specialties: [{ key: "gynecology", weight: 3 }],
  },
  {
    slug: "pregnancy-checkup",
    en: "Pregnancy checkup",
    ar: "متابعة الحمل",
    ckb: "پشکنینی دووگیانی",
    specialties: [{ key: "gynecology", weight: 3 }],
  },
  {
    slug: "hair-loss",
    en: "Hair loss",
    ar: "تساقط الشعر",
    ckb: "ڕووتانی قژ",
    specialties: [{ key: "dermatology", weight: 3 }],
  },
  {
    slug: "acne",
    en: "Acne",
    ar: "حب الشباب",
    ckb: "دانەی گەنجینە",
    specialties: [{ key: "dermatology", weight: 3 }],
  },
  {
    slug: "numbness",
    en: "Numbness or tingling",
    ar: "خدر أو تنميل",
    ckb: "کەرت بوون یان مۆرمۆر",
    specialties: [{ key: "neurology", weight: 3 }],
  },
  {
    slug: "dizziness",
    en: "Dizziness",
    ar: "دوخة",
    ckb: "سەرسووڕان",
    specialties: [
      { key: "neurology", weight: 2 },
      { key: "general_medicine", weight: 2 },
      { key: "ent", weight: 1 },
    ],
  },
  {
    slug: "shortness-of-breath",
    en: "Shortness of breath",
    ar: "ضيق التنفس",
    ckb: "کورتیی هەناسە",
    specialties: [
      { key: "cardiology", weight: 2 },
      { key: "general_medicine", weight: 2 },
    ],
  },
  {
    slug: "high-blood-pressure",
    en: "High blood pressure",
    ar: "ارتفاع ضغط الدم",
    ckb: "بەرزی فشاری خوێن",
    specialties: [
      { key: "cardiology", weight: 3 },
      { key: "general_medicine", weight: 2 },
    ],
  },
  {
    slug: "stomach-pain",
    en: "Stomach pain",
    ar: "ألم في المعدة",
    ckb: "ئازاری گەدە",
    specialties: [{ key: "general_medicine", weight: 3 }],
  },
  {
    slug: "fatigue",
    en: "Fatigue",
    ar: "إرهاق",
    ckb: "ماندووبوون",
    specialties: [{ key: "general_medicine", weight: 3 }],
  },
  {
    slug: "sinus-congestion",
    en: "Sinus congestion",
    ar: "احتقان الجيوب الأنفية",
    ckb: "داخستنی لووت",
    specialties: [{ key: "ent", weight: 3 }],
  },
  {
    slug: "gum-bleeding",
    en: "Bleeding gums",
    ar: "نزيف اللثة",
    ckb: "خوێن هاتنی لار",
    specialties: [{ key: "dentistry", weight: 3 }],
  },
  {
    slug: "knee-pain",
    en: "Knee pain",
    ar: "ألم في الركبة",
    ckb: "ئازاری ئەژنۆ",
    specialties: [{ key: "orthopedics", weight: 3 }],
  },
  {
    slug: "sports-injury",
    en: "Sports injury",
    ar: "إصابة رياضية",
    ckb: "برینداربوونی وەرزشی",
    specialties: [{ key: "orthopedics", weight: 3 }],
  },
  {
    slug: "eczema",
    en: "Eczema",
    ar: "أكزيما",
    ckb: "ئیگزیما",
    specialties: [{ key: "dermatology", weight: 3 }],
  },
  {
    slug: "child-vaccination",
    en: "Child vaccination",
    ar: "تطعيم الأطفال",
    ckb: "مۆڵگری منداڵان",
    specialties: [{ key: "pediatrics", weight: 3 }],
  },
  {
    slug: "menstrual-pain",
    en: "Menstrual pain",
    ar: "ألم الدورة الشهرية",
    ckb: "ئازاری مانگانە",
    specialties: [{ key: "gynecology", weight: 3 }],
  },
  {
    slug: "migraine",
    en: "Migraine",
    ar: "الشقيقة",
    ckb: "میگرین",
    specialties: [{ key: "neurology", weight: 3 }],
  },
];

export const PROCEDURES: {
  slug: string;
  en: string;
  ar: string;
  ckb: string;
  specialty_key: string;
  desc_en?: string;
  desc_ar?: string;
  desc_ckb?: string;
}[] = [
  // Cardiology
  {
    slug: "echocardiogram",
    en: "Echocardiogram",
    ar: "تخطيط صدى القلب",
    ckb: "ئیکۆی دڵ",
    specialty_key: "cardiology",
  },
  {
    slug: "ecg",
    en: "ECG (Electrocardiogram)",
    ar: "تخطيط القلب الكهربائي",
    ckb: "ئی سی جی (تۆمارکردنی کارەبایی دڵ)",
    specialty_key: "cardiology",
  },
  {
    slug: "stress-test",
    en: "Cardiac stress test",
    ar: "اختبار الجهد القلبي",
    ckb: "تاقیکردنەوەی فشاری دڵ",
    specialty_key: "cardiology",
  },
  {
    slug: "holter-monitor",
    en: "Holter monitor",
    ar: "جهاز هولتر",
    ckb: "ئامێری هۆڵتەر",
    specialty_key: "cardiology",
  },
  {
    slug: "pacemaker-checkup",
    en: "Pacemaker checkup",
    ar: "فحص جهاز تنظيم ضربات القلب",
    ckb: "پشکنینی ئامێری ڕێکخەری لێدانی دڵ",
    specialty_key: "cardiology",
  },
  // Dermatology
  {
    slug: "hair-transplant",
    en: "Hair Transplant",
    ar: "زراعة الشعر",
    ckb: "چاندنی قژ",
    specialty_key: "dermatology",
    desc_en: "Restoring hair growth in thinning areas.",
    desc_ar: "استعادة نمو الشعر في المناطق الخفيفة.",
    desc_ckb: "گەڕاندنەوەی گەشەی قژ لە شوێنە باریکەکان.",
  },
  {
    slug: "mole-removal",
    en: "Mole removal",
    ar: "إزالة الشامات",
    ckb: "لابردنی خاڵ",
    specialty_key: "dermatology",
  },
  {
    slug: "acne-treatment",
    en: "Acne treatment",
    ar: "علاج حب الشباب",
    ckb: "چارەسەری دانەی گەنجینە",
    specialty_key: "dermatology",
  },
  {
    slug: "chemical-peel",
    en: "Chemical peel",
    ar: "التقشير الكيميائي",
    ckb: "پاککردنەوەی کیمیایی",
    specialty_key: "dermatology",
  },
  {
    slug: "laser-hair-removal",
    en: "Laser hair removal",
    ar: "إزالة الشعر بالليزر",
    ckb: "لابردنی مووی لەسەر بە لەیزەر",
    specialty_key: "dermatology",
  },
  {
    slug: "skin-biopsy",
    en: "Skin biopsy",
    ar: "خزعة جلدية",
    ckb: "نمونەگرتنی پێست",
    specialty_key: "dermatology",
  },
  {
    slug: "psoriasis-treatment",
    en: "Psoriasis treatment",
    ar: "علاج الصدفية",
    ckb: "چارەسەری سەدەفیە",
    specialty_key: "dermatology",
  },
  // Pediatrics
  {
    slug: "child-wellness-checkup",
    en: "Child wellness checkup",
    ar: "فحص دوري للطفل",
    ckb: "پشکنینی خۆشگوزەرانی منداڵ",
    specialty_key: "pediatrics",
  },
  {
    slug: "vaccination-schedule",
    en: "Vaccination schedule",
    ar: "جدول التطعيمات",
    ckb: "خشتەی مۆڵگری",
    specialty_key: "pediatrics",
  },
  {
    slug: "growth-monitoring",
    en: "Growth monitoring",
    ar: "متابعة النمو",
    ckb: "چاودێری گەشە",
    specialty_key: "pediatrics",
  },
  {
    slug: "newborn-checkup",
    en: "Newborn checkup",
    ar: "فحص المولود الجديد",
    ckb: "پشکنینی نوێلەبوو",
    specialty_key: "pediatrics",
  },
  // Dentistry
  {
    slug: "dental-cleaning",
    en: "Dental cleaning",
    ar: "تنظيف الأسنان",
    ckb: "پاککردنەوەی ددان",
    specialty_key: "dentistry",
  },
  {
    slug: "tooth-extraction",
    en: "Tooth extraction",
    ar: "خلع الأسنان",
    ckb: "دەرهێنانی ددان",
    specialty_key: "dentistry",
  },
  {
    slug: "dental-filling",
    en: "Dental filling",
    ar: "حشو الأسنان",
    ckb: "پڕکردنەوەی ددان",
    specialty_key: "dentistry",
  },
  {
    slug: "root-canal",
    en: "Root canal treatment",
    ar: "علاج قناة الجذر",
    ckb: "چارەسەری ڕەگی ددان",
    specialty_key: "dentistry",
  },
  {
    slug: "dental-implant",
    en: "Dental implant",
    ar: "زراعة الأسنان",
    ckb: "چاندنی ددان",
    specialty_key: "dentistry",
  },
  {
    slug: "teeth-whitening",
    en: "Teeth whitening",
    ar: "تبييض الأسنان",
    ckb: "سپیکردنەوەی ددان",
    specialty_key: "dentistry",
  },
  {
    slug: "braces-consultation",
    en: "Braces consultation",
    ar: "استشارة تقويم الأسنان",
    ckb: "ڕاوێژی ڕێکخستنەوەی ددان",
    specialty_key: "dentistry",
  },
  // Orthopedics
  {
    slug: "joint-replacement-consultation",
    en: "Joint replacement consultation",
    ar: "استشارة استبدال المفصل",
    ckb: "ڕاوێژی گۆڕینەوەی جومگە",
    specialty_key: "orthopedics",
  },
  {
    slug: "fracture-treatment",
    en: "Fracture treatment",
    ar: "علاج الكسور",
    ckb: "چارەسەری شکان",
    specialty_key: "orthopedics",
  },
  {
    slug: "physical-therapy-referral",
    en: "Physical therapy referral",
    ar: "إحالة للعلاج الطبيعي",
    ckb: "ناردن بۆ چارەسەری جەستەیی",
    specialty_key: "orthopedics",
  },
  {
    slug: "arthroscopy",
    en: "Arthroscopy",
    ar: "تنظير المفاصل",
    ckb: "کامێراکردنی جومگە",
    specialty_key: "orthopedics",
  },
  {
    slug: "sports-injury-treatment",
    en: "Sports injury treatment",
    ar: "علاج إصابات الملاعب",
    ckb: "چارەسەری برینداربوونی وەرزشی",
    specialty_key: "orthopedics",
  },
  // Gynecology
  {
    slug: "prenatal-checkup",
    en: "Prenatal checkup",
    ar: "فحص ما قبل الولادة",
    ckb: "پشکنینی پێش لەدایکبوون",
    specialty_key: "gynecology",
  },
  {
    slug: "pap-smear",
    en: "Pap smear",
    ar: "مسحة عنق الرحم",
    ckb: "نمونەی گەردەنی منداڵدان",
    specialty_key: "gynecology",
  },
  {
    slug: "ultrasound-pregnancy",
    en: "Pregnancy ultrasound",
    ar: "الموجات فوق الصوتية للحمل",
    ckb: "ئەلتراساوندی دووگیانی",
    specialty_key: "gynecology",
  },
  {
    slug: "family-planning-consultation",
    en: "Family planning consultation",
    ar: "استشارة تنظيم الأسرة",
    ckb: "ڕاوێژی پلاندانانی خێزان",
    specialty_key: "gynecology",
  },
  {
    slug: "fertility-consultation",
    en: "Fertility consultation",
    ar: "استشارة الخصوبة",
    ckb: "ڕاوێژی بەروبووم",
    specialty_key: "gynecology",
  },
  // ENT
  {
    slug: "hearing-test",
    en: "Hearing test",
    ar: "اختبار السمع",
    ckb: "تاقیکردنەوەی بیستن",
    specialty_key: "ent",
  },
  {
    slug: "tonsillectomy-consultation",
    en: "Tonsillectomy consultation",
    ar: "استشارة استئصال اللوزتين",
    ckb: "ڕاوێژی دەرهێنانی لوزە",
    specialty_key: "ent",
  },
  {
    slug: "sinus-treatment",
    en: "Sinus treatment",
    ar: "علاج الجيوب الأنفية",
    ckb: "چارەسەری لووت",
    specialty_key: "ent",
  },
  {
    slug: "ear-wax-removal",
    en: "Ear wax removal",
    ar: "إزالة شمع الأذن",
    ckb: "لابردنی مۆمی گوێ",
    specialty_key: "ent",
  },
  // General medicine
  {
    slug: "annual-checkup",
    en: "Annual checkup",
    ar: "الفحص السنوي",
    ckb: "پشکنینی ساڵانە",
    specialty_key: "general_medicine",
  },
  {
    slug: "blood-test",
    en: "Blood test",
    ar: "فحص الدم",
    ckb: "تاقیکردنەوەی خوێن",
    specialty_key: "general_medicine",
  },
  {
    slug: "diabetes-management",
    en: "Diabetes management",
    ar: "إدارة السكري",
    ckb: "بەڕێوەبردنی شەکرە",
    specialty_key: "general_medicine",
  },
  {
    slug: "blood-pressure-checkup",
    en: "Blood pressure checkup",
    ar: "فحص ضغط الدم",
    ckb: "پشکنینی فشاری خوێن",
    specialty_key: "general_medicine",
  },
  {
    slug: "vaccination-adult",
    en: "Adult vaccination",
    ar: "تطعيم البالغين",
    ckb: "مۆڵگری گەورەساڵان",
    specialty_key: "general_medicine",
  },
  {
    slug: "travel-health-consultation",
    en: "Travel health consultation",
    ar: "استشارة صحة السفر",
    ckb: "ڕاوێژی تەندروستی گەشتیاری",
    specialty_key: "general_medicine",
  },
  // Neurology
  {
    slug: "eeg",
    en: "EEG (Electroencephalogram)",
    ar: "تخطيط الدماغ الكهربائي",
    ckb: "ئی ئی جی (تۆمارکردنی کارەبایی مێشک)",
    specialty_key: "neurology",
  },
  {
    slug: "migraine-treatment",
    en: "Migraine treatment",
    ar: "علاج الشقيقة",
    ckb: "چارەسەری میگرین",
    specialty_key: "neurology",
  },
  {
    slug: "nerve-conduction-study",
    en: "Nerve conduction study",
    ar: "دراسة التوصيل العصبي",
    ckb: "لێکۆڵینەوەی گواستنەوەی دەماری",
    specialty_key: "neurology",
  },
  {
    slug: "stroke-followup",
    en: "Stroke follow-up",
    ar: "متابعة السكتة الدماغية",
    ckb: "دواداچوونی خوێن مانگرتنی مێشک",
    specialty_key: "neurology",
  },
  // Ophthalmology
  {
    slug: "lasik",
    en: "LASIK",
    ar: "الليزك",
    ckb: "لەیزیک",
    specialty_key: "ophthalmology",
    desc_en: "Laser vision correction surgery.",
    desc_ar: "جراحة تصحيح الرؤية بالليزر.",
    desc_ckb: "نەشتەرگەری چاکسازی بینایی بە لەیزەر.",
  },
  {
    slug: "cataract-surgery",
    en: "Cataract surgery",
    ar: "جراحة الساد (المياه البيضاء)",
    ckb: "نەشتەرگەری مووکی چاو",
    specialty_key: "ophthalmology",
  },
  {
    slug: "eye-exam",
    en: "Comprehensive eye exam",
    ar: "فحص شامل للعين",
    ckb: "پشکنینی گشتگیری چاو",
    specialty_key: "ophthalmology",
  },
  {
    slug: "glaucoma-screening",
    en: "Glaucoma screening",
    ar: "فحص الزرق (الغلوكوما)",
    ckb: "پشکنینی گلۆکۆما",
    specialty_key: "ophthalmology",
  },
  {
    slug: "contact-lens-fitting",
    en: "Contact lens fitting",
    ar: "تركيب العدسات اللاصقة",
    ckb: "گونجاندنی کۆنتاکت لێنز",
    specialty_key: "ophthalmology",
  },
  // Additional cardiology
  {
    slug: "angiogram-consultation",
    en: "Angiogram consultation",
    ar: "استشارة تصوير الأوعية",
    ckb: "ڕاوێژی وێنەگرتنی خوێنبەر",
    specialty_key: "cardiology",
  },
  {
    slug: "cholesterol-management",
    en: "Cholesterol management",
    ar: "إدارة الكوليسترول",
    ckb: "بەڕێوەبردنی کۆلێستەرۆڵ",
    specialty_key: "cardiology",
  },
  // Additional dermatology
  {
    slug: "wart-removal",
    en: "Wart removal",
    ar: "إزالة الثآليل",
    ckb: "لابردنی ژانەوچکە",
    specialty_key: "dermatology",
  },
  {
    slug: "botox",
    en: "Botox treatment",
    ar: "حقن البوتوكس",
    ckb: "دەرمانی بۆتۆکس",
    specialty_key: "dermatology",
  },
  {
    slug: "nail-fungus-treatment",
    en: "Nail fungus treatment",
    ar: "علاج فطريات الأظافر",
    ckb: "چارەسەری کۆمەڵەی نینۆک",
    specialty_key: "dermatology",
  },
  // Additional pediatrics
  {
    slug: "allergy-testing-child",
    en: "Allergy testing (child)",
    ar: "فحص الحساسية للأطفال",
    ckb: "تاقیکردنەوەی حەساسیەت بۆ منداڵان",
    specialty_key: "pediatrics",
  },
  {
    slug: "developmental-screening",
    en: "Developmental screening",
    ar: "فحص النمو التطوري",
    ckb: "پشکنینی پەرەسەندن",
    specialty_key: "pediatrics",
  },
  {
    slug: "asthma-management-child",
    en: "Child asthma management",
    ar: "إدارة الربو عند الأطفال",
    ckb: "بەڕێوەبردنی هەناسەتەنگی منداڵان",
    specialty_key: "pediatrics",
  },
  // Additional dentistry
  {
    slug: "wisdom-tooth-removal",
    en: "Wisdom tooth removal",
    ar: "خلع ضرس العقل",
    ckb: "دەرهێنانی ددانی داناوی",
    specialty_key: "dentistry",
  },
  {
    slug: "dental-crown",
    en: "Dental crown",
    ar: "تلبيسة الأسنان",
    ckb: "تاجی ددان",
    specialty_key: "dentistry",
  },
  {
    slug: "gum-treatment",
    en: "Gum disease treatment",
    ar: "علاج أمراض اللثة",
    ckb: "چارەسەری نەخۆشی لار",
    specialty_key: "dentistry",
  },
  // Additional orthopedics
  {
    slug: "spine-consultation",
    en: "Spine consultation",
    ar: "استشارة العمود الفقري",
    ckb: "ڕاوێژی مۆری پشت",
    specialty_key: "orthopedics",
  },
  {
    slug: "cast-application",
    en: "Cast application",
    ar: "وضع الجبيرة",
    ckb: "دانانی گچ",
    specialty_key: "orthopedics",
  },
  // Additional gynecology
  {
    slug: "menopause-consultation",
    en: "Menopause consultation",
    ar: "استشارة سن اليأس",
    ckb: "ڕاوێژی وەستانی مانگانە",
    specialty_key: "gynecology",
  },
  {
    slug: "contraception-consultation",
    en: "Contraception consultation",
    ar: "استشارة موانع الحمل",
    ckb: "ڕاوێژی ڕێگری لە دووگیانی",
    specialty_key: "gynecology",
  },
  // Additional ENT
  {
    slug: "nasal-polyp-treatment",
    en: "Nasal polyp treatment",
    ar: "علاج لحمية الأنف",
    ckb: "چارەسەری گۆشتەواری لووت",
    specialty_key: "ent",
  },
  {
    slug: "snoring-consultation",
    en: "Snoring consultation",
    ar: "استشارة الشخير",
    ckb: "ڕاوێژی خوراندن",
    specialty_key: "ent",
  },
  // Additional general medicine
  {
    slug: "weight-management",
    en: "Weight management",
    ar: "إدارة الوزن",
    ckb: "بەڕێوەبردنی کێش",
    specialty_key: "general_medicine",
  },
  {
    slug: "smoking-cessation",
    en: "Smoking cessation program",
    ar: "برنامج الإقلاع عن التدخين",
    ckb: "پڕۆگرامی وازهێنان لە جگەرەکێشان",
    specialty_key: "general_medicine",
  },
  {
    slug: "general-consultation",
    en: "General consultation",
    ar: "استشارة عامة",
    ckb: "ڕاوێژی گشتی",
    specialty_key: "general_medicine",
  },
  // Additional neurology
  {
    slug: "epilepsy-management",
    en: "Epilepsy management",
    ar: "إدارة الصرع",
    ckb: "بەڕێوەبردنی گیرفان",
    specialty_key: "neurology",
  },
  {
    slug: "memory-assessment",
    en: "Memory assessment",
    ar: "تقييم الذاكرة",
    ckb: "هەڵسەنگاندنی بیرکردنەوە",
    specialty_key: "neurology",
  },
  // Additional ophthalmology
  {
    slug: "diabetic-eye-exam",
    en: "Diabetic eye exam",
    ar: "فحص العين لمرضى السكري",
    ckb: "پشکنینی چاو بۆ نەخۆشانی شەکرە",
    specialty_key: "ophthalmology",
  },
  {
    slug: "strabismus-treatment",
    en: "Strabismus (crossed eyes) treatment",
    ar: "علاج الحول",
    ckb: "چارەسەری چەپی چاو",
    specialty_key: "ophthalmology",
  },
];

export const CITIES = [
  { slug: "erbil", en: "Erbil", ar: "أربيل", ckb: "هەولێر", order: 0 },
  { slug: "sulaymaniyah", en: "Sulaymaniyah", ar: "السليمانية", ckb: "سلێمانی", order: 1 },
  { slug: "duhok", en: "Duhok", ar: "دهوك", ckb: "دهۆک", order: 2 },
  { slug: "halabja", en: "Halabja", ar: "حلبجة", ckb: "هەڵەبجە", order: 3 },
  { slug: "zakho", en: "Zakho", ar: "زاخو", ckb: "زاخۆ", order: 4 },
  { slug: "akre", en: "Akre", ar: "عقرة", ckb: "ئاکرێ", order: 5 },
  { slug: "soran", en: "Soran", ar: "سوران", ckb: "سۆران", order: 6 },
  { slug: "ranya", en: "Ranya", ar: "رانية", ckb: "ڕانیە", order: 7 },
  { slug: "koya", en: "Koya", ar: "كويسنجق", ckb: "کۆیە", order: 8 },
  { slug: "chamchamal", en: "Chamchamal", ar: "جمجمال", ckb: "چەمچەماڵ", order: 9 },
] as const;

export const CATEGORIES = [
  {
    n: 1,
    slug: "hospital",
    en: "Hospitals",
    ar: "المستشفيات",
    ckb: "نەخۆشخانەکان",
    icon: "building-2",
  },
  {
    n: 2,
    slug: "dental_clinic",
    en: "Dental Clinics",
    ar: "عيادات الأسنان",
    ckb: "کلینیکەکانی ددان",
    icon: "tooth",
  },
  {
    n: 3,
    slug: "beauty_center",
    en: "Beauty Centers",
    ar: "مراكز التجميل",
    ckb: "سەنتەرەکانی جوانکاری",
    icon: "sparkles",
  },
] as const;

export const SECTION_TYPES = [
  { n: 11, key: "department", en: "Departments", ar: "الأقسام", ckb: "بەشەکان" },
  { n: 12, key: "center", en: "Centers", ar: "المراكز", ckb: "سەنتەرەکان" },
  { n: 13, key: "service", en: "Services", ar: "الخدمات", ckb: "خزمەتگوزارییەکان" },
] as const;

// hospital -> department + center; dental_clinic & beauty_center -> service
export const CATEGORY_SECTION_TYPES: Record<string, string[]> = {
  hospital: ["department", "center"],
  dental_clinic: ["service"],
  beauty_center: ["service"],
};

export const TIERS = [
  {
    n: 31,
    key: "tier_1",
    rank: 1,
    max: 10,
    featured: true,
    en: "Tier 1 — Featured",
    ar: "الفئة ١ — مميز",
    ckb: "پلەی ١ — تایبەت",
  },
  {
    n: 32,
    key: "tier_2",
    rank: 2,
    max: 6,
    featured: false,
    en: "Tier 2 — Plus",
    ar: "الفئة ٢ — بلس",
    ckb: "پلەی ٢ — پڵەس",
  },
  {
    n: 33,
    key: "tier_3",
    rank: 3,
    max: 2,
    featured: false,
    en: "Tier 3 — Basic",
    ar: "الفئة ٣ — أساسي",
    ckb: "پلەی ٣ — بنەڕەتی",
  },
] as const;

// Placeholder prices (integer IQD/month) — business sign-off pending
// (flagged as a Remaining Human Gate in MM-REPORT-003).
export const FACILITY_PRICES: Record<string, number> = {
  tier_1: 300_000,
  tier_2: 200_000,
  tier_3: 100_000,
};
export const SPECIALIST_PRICES: Record<string, number> = {
  tier_1: 200_000,
  tier_2: 150_000,
  tier_3: 75_000,
};
export const SPECIALIST_KEYS = ["laboratory", "physiotherapy", "weight_management"] as const;

interface FacilitySeed {
  en: string;
  ar: string;
  ckb: string;
  slug: string;
}

export const HOSPITALS: FacilitySeed[] = [
  {
    slug: "erbil-international-hospital",
    en: "Erbil International Hospital",
    ar: "مستشفى أربيل الدولي",
    ckb: "نەخۆشخانەی نێودەوڵەتی هەولێر",
  },
  {
    slug: "hawler-teaching-hospital",
    en: "Hawler Teaching Hospital",
    ar: "مستشفى هولير التعليمي",
    ckb: "نەخۆشخانەی فێرکاری هەولێر",
  },
  {
    slug: "zheen-general-hospital",
    en: "Zheen General Hospital",
    ar: "مستشفى جين العام",
    ckb: "نەخۆشخانەی گشتی ژین",
  },
  {
    slug: "soran-private-hospital",
    en: "Soran Private Hospital",
    ar: "مستشفى سوران الأهلي",
    ckb: "نەخۆشخانەی ئەهلی سۆران",
  },
  {
    slug: "kurdistan-heart-hospital",
    en: "Kurdistan Heart Hospital",
    ar: "مستشفى كردستان للقلب",
    ckb: "نەخۆشخانەی دڵی کوردستان",
  },
  {
    slug: "medya-surgical-hospital",
    en: "Medya Surgical Hospital",
    ar: "مستشفى ميديا الجراحي",
    ckb: "نەخۆشخانەی نەشتەرگەری میدیا",
  },
  {
    slug: "rojava-children-hospital",
    en: "Rojava Children Hospital",
    ar: "مستشفى روجافا للأطفال",
    ckb: "نەخۆشخانەی منداڵانی ڕۆژئاوا",
  },
  {
    slug: "shorsh-emergency-hospital",
    en: "Shorsh Emergency Hospital",
    ar: "مستشفى شورش للطوارئ",
    ckb: "نەخۆشخانەی فریاکەوتنی شۆڕش",
  },
  {
    slug: "newroz-maternity-hospital",
    en: "Newroz Maternity Hospital",
    ar: "مستشفى نوروز للولادة",
    ckb: "نەخۆشخانەی لەدایکبوونی نەورۆز",
  },
  {
    slug: "ankawa-modern-hospital",
    en: "Ankawa Modern Hospital",
    ar: "مستشفى عنكاوا الحديث",
    ckb: "نەخۆشخانەی مۆدێرنی عەنکاوە",
  },
];

export const DENTAL_CLINICS: FacilitySeed[] = [
  {
    slug: "pearl-dental-clinic",
    en: "Pearl Dental Clinic",
    ar: "عيادة اللؤلؤة للأسنان",
    ckb: "کلینیکی ددانی مروارید",
  },
  {
    slug: "smile-line-dental",
    en: "Smile Line Dental Center",
    ar: "مركز سمايل لاين للأسنان",
    ckb: "سەنتەری ددانی سمایل لاین",
  },
  {
    slug: "erbil-dental-house",
    en: "Erbil Dental House",
    ar: "بيت الأسنان أربيل",
    ckb: "ماڵی ددانی هەولێر",
  },
  {
    slug: "white-tooth-clinic",
    en: "White Tooth Clinic",
    ar: "عيادة السن الأبيض",
    ckb: "کلینیکی ددانی سپی",
  },
  {
    slug: "dilan-orthodontics",
    en: "Dilan Orthodontics Clinic",
    ar: "عيادة ديلان لتقويم الأسنان",
    ckb: "کلینیکی ڕێکخستنی ددانی دیلان",
  },
  {
    slug: "shanadar-dental-center",
    en: "Shanadar Dental Center",
    ar: "مركز شانادار للأسنان",
    ckb: "سەنتەری ددانی شانەدەر",
  },
  {
    slug: "gulan-family-dental",
    en: "Gulan Family Dental",
    ar: "عيادة كولان لأسنان العائلة",
    ckb: "کلینیکی ددانی خێزانی گوڵان",
  },
  {
    slug: "azadi-dental-clinic",
    en: "Azadi Dental Clinic",
    ar: "عيادة آزادي للأسنان",
    ckb: "کلینیکی ددانی ئازادی",
  },
  {
    slug: "royal-smile-erbil",
    en: "Royal Smile Erbil",
    ar: "رويال سمايل أربيل",
    ckb: "ڕۆیاڵ سمایڵی هەولێر",
  },
  {
    slug: "nishtiman-dental",
    en: "Nishtiman Dental Clinic",
    ar: "عيادة نيشتمان للأسنان",
    ckb: "کلینیکی ددانی نیشتمان",
  },
];

export const BEAUTY_CENTERS: FacilitySeed[] = [
  {
    slug: "diva-beauty-center",
    en: "Diva Beauty Center",
    ar: "مركز ديفا للتجميل",
    ckb: "سەنتەری جوانکاری دیڤا",
  },
  {
    slug: "shine-laser-clinic",
    en: "Shine Laser & Skin Clinic",
    ar: "عيادة شاين لليزر والبشرة",
    ckb: "کلینیکی لەیزەر و پێستی شاین",
  },
  {
    slug: "venus-aesthetic-erbil",
    en: "Venus Aesthetic Center",
    ar: "مركز فينوس للتجميل",
    ckb: "سەنتەری جوانکاری ڤینوس",
  },
  {
    slug: "lalav-beauty-house",
    en: "Lalav Beauty House",
    ar: "بيت الجمال لالاف",
    ckb: "ماڵی جوانکاری لالاڤ",
  },
  {
    slug: "glow-skin-center",
    en: "Glow Skin Center",
    ar: "مركز كلو للبشرة",
    ckb: "سەنتەری پێستی گلۆ",
  },
  {
    slug: "aryan-cosmetic-clinic",
    en: "Aryan Cosmetic Clinic",
    ar: "عيادة آريان التجميلية",
    ckb: "کلینیکی جوانکاری ئاریان",
  },
  {
    slug: "silk-touch-beauty",
    en: "Silk Touch Beauty Lounge",
    ar: "صالون سيلك تاتش",
    ckb: "هۆڵی جوانکاری سیلك تاچ",
  },
  {
    slug: "noor-derma-center",
    en: "Noor Derma Center",
    ar: "مركز نور للجلدية",
    ckb: "سەنتەری دێرمای نوور",
  },
  {
    slug: "baran-beauty-clinic",
    en: "Baran Beauty Clinic",
    ar: "عيادة باران للتجميل",
    ckb: "کلینیکی جوانکاری باران",
  },
  { slug: "mira-aesthetics", en: "Mira Aesthetics", ar: "ميرا للتجميل", ckb: "جوانکاری میرا" },
];

export const HOSPITAL_DEPARTMENTS = [
  { en: "Cardiology", ar: "أمراض القلب", ckb: "نەخۆشییەکانی دڵ" },
  { en: "Pediatrics", ar: "طب الأطفال", ckb: "پزیشکی منداڵان" },
  { en: "Orthopedics", ar: "العظام", ckb: "ئێسک و جومگە" },
  { en: "Neurology", ar: "الأعصاب", ckb: "دەمار" },
  { en: "Emergency", ar: "الطوارئ", ckb: "فریاکەوتن" },
  { en: "Radiology", ar: "الأشعة", ckb: "تیشک" },
];
export const HOSPITAL_CENTERS = [
  { en: "Heart Center", ar: "مركز القلب", ckb: "سەنتەری دڵ" },
  { en: "Oncology Center", ar: "مركز الأورام", ckb: "سەنتەری شێرپەنجە" },
];
export const DENTAL_SERVICES = [
  { en: "Dental Implants", ar: "زراعة الأسنان", ckb: "چاندنی ددان" },
  { en: "Orthodontics", ar: "تقويم الأسنان", ckb: "ڕێکخستنی ددان" },
  { en: "Teeth Whitening", ar: "تبييض الأسنان", ckb: "سپیکردنەوەی ددان" },
  { en: "Root Canal Treatment", ar: "علاج قناة الجذر", ckb: "چارەسەری ڕەگی ددان" },
  { en: "Pediatric Dentistry", ar: "أسنان الأطفال", ckb: "ددانی منداڵان" },
];
export const BEAUTY_SERVICES = [
  { en: "Laser Hair Removal", ar: "إزالة الشعر بالليزر", ckb: "لابردنی موو بە لەیزەر" },
  { en: "Skin Care", ar: "العناية بالبشرة", ckb: "چاودێری پێست" },
  { en: "Botox & Fillers", ar: "البوتوكس والفيلر", ckb: "بۆتۆکس و فیلەر" },
  { en: "Facial Treatments", ar: "علاجات الوجه", ckb: "چارەسەری دەموچاو" },
  { en: "Hair Transplant Consultation", ar: "استشارة زراعة الشعر", ckb: "ڕاوێژی چاندنی موو" },
];

export const PLACEHOLDER_IMAGES = [
  "/images/hero/slide-1.svg",
  "/images/hero/slide-2.svg",
  "/images/hero/slide-3.svg",
];

export const SPECIALISTS: Record<(typeof SPECIALIST_KEYS)[number], FacilitySeed[]> = {
  laboratory: [
    {
      slug: "zheen-medical-lab",
      en: "Zheen Medical Laboratory",
      ar: "مختبر جين الطبي",
      ckb: "تاقیگەی پزیشکی ژین",
    },
    { slug: "biolab-erbil", en: "BioLab Erbil", ar: "مختبر بايولاب أربيل", ckb: "بایۆلابی هەولێر" },
    {
      slug: "accurate-diagnostics-lab",
      en: "Accurate Diagnostics Lab",
      ar: "مختبر التشخيص الدقيق",
      ckb: "تاقیگەی دەستنیشانکردنی ورد",
    },
    {
      slug: "hana-central-lab",
      en: "Hana Central Lab",
      ar: "مختبر هناء المركزي",
      ckb: "تاقیگەی ناوەندی هەنا",
    },
    {
      slug: "delta-medical-lab",
      en: "Delta Medical Lab",
      ar: "مختبر دلتا الطبي",
      ckb: "تاقیگەی پزیشکی دێلتا",
    },
  ],
  physiotherapy: [
    {
      slug: "motion-physio-center",
      en: "Motion Physiotherapy Center",
      ar: "مركز موشن للعلاج الطبيعي",
      ckb: "سەنتەری چارەسەری سروشتی مۆشن",
    },
    {
      slug: "rebin-physio-clinic",
      en: "Rebin Physiotherapy Clinic",
      ar: "عيادة ريبين للعلاج الطبيعي",
      ckb: "کلینیکی چارەسەری سروشتی ڕێبین",
    },
    {
      slug: "active-life-physio",
      en: "Active Life Physio",
      ar: "أكتيف لايف للعلاج الطبيعي",
      ckb: "ئاکتیڤ لایف فیزیۆ",
    },
    {
      slug: "hiwa-rehab-center",
      en: "Hiwa Rehabilitation Center",
      ar: "مركز هيوا للتأهيل",
      ckb: "سەنتەری چاکبوونەوەی هیوا",
    },
    {
      slug: "balance-physio-erbil",
      en: "Balance Physiotherapy Erbil",
      ar: "بالانس للعلاج الطبيعي أربيل",
      ckb: "بالانس فیزیۆی هەولێر",
    },
  ],
  weight_management: [
    {
      slug: "slim-clinic-erbil",
      en: "Slim Clinic Erbil",
      ar: "عيادة سليم أربيل",
      ckb: "کلینیکی سلیمی هەولێر",
    },
    {
      slug: "nutrivita-center",
      en: "NutriVita Weight Center",
      ar: "مركز نيوتريفيتا للوزن",
      ckb: "سەنتەری کێشی نیوتریڤیتا",
    },
    { slug: "shape-up-clinic", en: "Shape Up Clinic", ar: "عيادة شيب أب", ckb: "کلینیکی شەیپ ئەپ" },
    {
      slug: "dr-avin-nutrition",
      en: "Dr. Avin Nutrition Clinic",
      ar: "عيادة د. آفين للتغذية",
      ckb: "کلینیکی خۆراکی د. ئاڤین",
    },
    {
      slug: "wellness-weight-center",
      en: "Wellness Weight Center",
      ar: "مركز ويلنس للوزن",
      ckb: "سەنتەری کێشی وێڵنێس",
    },
  ],
};

export const DOCTORS = [
  {
    en: "Dr. Ahmed Doctor",
    ar: "د. أحمد",
    ckb: "د. ئەحمەد",
    specialty: "cardiology",
    slug: "dr-ahmed-doctor",
  },
  {
    en: "Dr. Lana Star",
    ar: "د. لانا ستار",
    ckb: "د. لانا ستار",
    specialty: "dermatology",
    slug: "dr-lana-star",
  },
  {
    en: "Dr. Karwan Aziz",
    ar: "د. كاروان عزيز",
    ckb: "د. کاروان عەزیز",
    specialty: "pediatrics",
    slug: "dr-karwan-aziz",
  },
  {
    en: "Dr. Sara Hassan",
    ar: "د. سارة حسن",
    ckb: "د. سارا حەسەن",
    specialty: "gynecology",
    slug: "dr-sara-hassan",
  },
  {
    en: "Dr. Omar Salih",
    ar: "د. عمر صالح",
    ckb: "د. عومەر ساڵح",
    specialty: "orthopedics",
    slug: "dr-omar-salih",
  },
  {
    en: "Dr. Zhala Rashid",
    ar: "د. جالا رشيد",
    ckb: "د. ژاڵا ڕەشید",
    specialty: "ophthalmology",
    slug: "dr-zhala-rashid",
  },
  {
    en: "Dr. Dler Mahmoud",
    ar: "د. دلير محمود",
    ckb: "د. دلێر مەحموود",
    specialty: "general_medicine",
    slug: "dr-dler-mahmoud",
  },
  {
    en: "Dr. Nask Jalal",
    ar: "د. ناسك جلال",
    ckb: "د. ناسک جەلال",
    specialty: "dentistry",
    slug: "dr-nask-jalal",
  },
  {
    en: "Dr. Rebin Hussein",
    ar: "د. ريبين حسين",
    ckb: "د. ڕێبین حسێن",
    specialty: "cardiology",
    slug: "dr-rebin-hussein",
  },
  {
    en: "Dr. Newroz Faraj",
    ar: "د. نوروز فرج",
    ckb: "د. نەورۆز فەرەج",
    specialty: "dermatology",
    slug: "dr-newroz-faraj",
  },
  {
    en: "Dr. Soran Baram",
    ar: "د. سوران برام",
    ckb: "د. سۆران بەرام",
    specialty: "pediatrics",
    slug: "dr-soran-baram",
  },
  {
    en: "Dr. Peshraw Nawzad",
    ar: "د. بيشراو نوزاد",
    ckb: "د. پێشڕەو نەوزاد",
    specialty: "orthopedics",
    slug: "dr-peshraw-nawzad",
  },
  {
    en: "Dr. Kajin Rostam",
    ar: "د. كاجين رستم",
    ckb: "د. کەژین ڕوستەم",
    specialty: "gynecology",
    slug: "dr-kajin-rostam",
  },
  {
    en: "Dr. Aram Salar",
    ar: "د. آرام سالار",
    ckb: "د. ئارام سالار",
    specialty: "general_medicine",
    slug: "dr-aram-salar",
  },
  {
    en: "Dr. Nazdar Kamal",
    ar: "د. نازدار كمال",
    ckb: "د. نازدار کەمال",
    specialty: "dentistry",
    slug: "dr-nazdar-kamal",
  },
  {
    en: "Dr. Barham Sabah",
    ar: "د. برهم صباح",
    ckb: "د. بەرهەم سەبەح",
    specialty: "neurology",
    slug: "dr-barham-sabah",
  },
  {
    en: "Dr. Rojin Anwar",
    ar: "د. روژين أنور",
    ckb: "د. ڕۆژین ئەنوەر",
    specialty: "ophthalmology",
    slug: "dr-rojin-anwar",
  },
  {
    en: "Dr. Diyar Latif",
    ar: "د. ديار لطيف",
    ckb: "د. دیار لەتیف",
    specialty: "ent",
    slug: "dr-diyar-latif",
  },
  {
    en: "Dr. Shene Qadir",
    ar: "د. شێنێ قادر",
    ckb: "د. شێنێ قادر",
    specialty: "cardiology",
    slug: "dr-shene-qadir",
  },
  {
    en: "Dr. Hawre Ismail",
    ar: "د. هاوري إسماعيل",
    ckb: "د. هاوڕێ ئیسماعیل",
    specialty: "dermatology",
    slug: "dr-hawre-ismail",
  },
  {
    en: "Dr. Gullala Jamal",
    ar: "د. كولالة جمال",
    ckb: "د. گوڵاڵە جەمال",
    specialty: "pediatrics",
    slug: "dr-gullala-jamal",
  },
  {
    en: "Dr. Zana Sherwan",
    ar: "د. زانا شيروان",
    ckb: "د. زانا شێروان",
    specialty: "general_medicine",
    slug: "dr-zana-sherwan",
  },
  {
    en: "Dr. Avesta Nuri",
    ar: "د. أفيستا نوري",
    ckb: "د. ئەڤیستا نووری",
    specialty: "gynecology",
    slug: "dr-avesta-nuri",
  },
  {
    en: "Dr. Kawa Barzan",
    ar: "د. كاوا برزان",
    ckb: "د. کاوا بەرزان",
    specialty: "orthopedics",
    slug: "dr-kawa-barzan",
  },
  {
    en: "Dr. Sirwan Majid",
    ar: "د. سيروان ماجد",
    ckb: "د. سیروان مەجید",
    specialty: "dentistry",
    slug: "dr-sirwan-majid",
  },
  {
    en: "Dr. Hazha Amin",
    ar: "د. هزة أمين",
    ckb: "د. هەژار ئەمین",
    specialty: "neurology",
    slug: "dr-hazha-amin",
  },
  // Pending (not verified — excluded from public search)
  {
    en: "Dr. Hemin New",
    ar: "د. هيمن",
    ckb: "د. هێمن",
    specialty: "neurology",
    slug: "dr-hemin-new",
    pending: true,
  },
  {
    en: "Dr. Avan Fresh",
    ar: "د. آفان",
    ckb: "د. ئاڤان",
    specialty: "ent",
    slug: "dr-avan-fresh",
    pending: true,
  },
] as const;

export const COUNTRIES = [
  {
    slug: "iraq",
    en: "Iraq",
    ar: "العراق",
    ckb: "عێراق",
    iso: "IQ",
    active: true,
    comingSoon: false,
    order: 0,
  },
  {
    slug: "iran",
    en: "Iran",
    ar: "إيران",
    ckb: "ئێران",
    iso: "IR",
    active: false,
    comingSoon: true,
    order: 1,
  },
  {
    slug: "india",
    en: "India",
    ar: "الهند",
    ckb: "هیندستان",
    iso: "IN",
    active: false,
    comingSoon: true,
    order: 2,
  },
  {
    slug: "turkey",
    en: "Turkey",
    ar: "تركيا",
    ckb: "تورکیا",
    iso: "TR",
    active: false,
    comingSoon: true,
    order: 3,
  },
  {
    slug: "jordan",
    en: "Jordan",
    ar: "الأردن",
    ckb: "ئوردن",
    iso: "JO",
    active: false,
    comingSoon: true,
    order: 4,
  },
  {
    slug: "germany",
    en: "Germany",
    ar: "ألمانيا",
    ckb: "ئەڵمانیا",
    iso: "DE",
    active: false,
    comingSoon: true,
    order: 5,
  },
  {
    slug: "uae",
    en: "United Arab Emirates",
    ar: "الإمارات العربية المتحدة",
    ckb: "میرنشینە یەکگرتووەکانی عەرەبی",
    iso: "AE",
    active: false,
    comingSoon: true,
    order: 6,
  },
] as const;

// A curated handful spanning facility + doctor categories, all in Erbil.
// Slugs match real rows created by seedFacilities (index-0 tier_1 facility
// per category is verified+active; specialist doctors are all verified).
export const PROMOTIONS = [
  { n: 1, category: "hospitals" as const, entityRef: "erbil-international-hospital" },
  { n: 2, category: "dentists" as const, entityRef: "pearl-dental-clinic" },
  { n: 3, category: "beauty_centers" as const, entityRef: "diva-beauty-center" },
  { n: 4, category: "doctors" as const, entityRef: "dr-ahmed-doctor" },
  { n: 5, category: "labs" as const, entityRef: "zheen-medical-lab" },
  { n: 6, category: "physiotherapy" as const, entityRef: "motion-physio-center" },
  { n: 7, category: "weight_management" as const, entityRef: "slim-clinic-erbil" },
];

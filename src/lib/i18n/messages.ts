/**
 * UI strings for the shop-floor surfaces (navigation, heat entry, offline sync).
 * English is the source of truth; Hindi and Marathi must define every key
 * (enforced by a test). The Hindi and Marathi text is a first draft and should be
 * reviewed by a native speaker from the foundry before it is relied on.
 */
export const LOCALES = ["en", "hi", "mr"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "energyos_lang";
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", hi: "हिन्दी", mr: "मराठी" };

const en = {
  "nav.overview": "Overview",
  "nav.operations": "Operations",
  "nav.decisions": "Decisions",
  "nav.records": "Records",
  "nav.demo": "Demo",
  "nav.dashboard": "Dashboard",
  "nav.heats": "Heat log",
  "nav.meters": "Meter data",
  "nav.anomalies": "Anomalies",
  "nav.optimizer": "Schedule optimiser",
  "nav.approvals": "Approvals",
  "nav.verification": "Verification",
  "nav.tariffs": "Tariffs",
  "nav.reports": "Reports & exports",
  "nav.audit": "Audit log",
  "nav.evidence": "Evidence & assumptions",
  "nav.settings": "Factory settings",
  "nav.scenario": "Scenario control",
  "nav.open": "Open navigation",
  "nav.close": "Close navigation",
  "nav.advisory": "Advisory only. No command is sent to plant equipment.",
  "lang.label": "Language",
  "heat.heatNo": "Heat number *",
  "heat.charge": "Charge, kg *",
  "heat.capacity": "Capacity {n} kg",
  "heat.start": "Start *",
  "heat.tap": "Tap",
  "heat.poured": "Poured, kg",
  "heat.pouredHint": "Required once tapped",
  "heat.mouldSet": "Mould set",
  "heat.more": "More fields (mould ready time, grade, order, notes)",
  "heat.log": "Log heat",
  "heat.save": "Save changes",
  "heat.now": "Now",
  "heat.logged": "Heat logged. The meter supplies its energy.",
  "offline.banner": "No connection. Heats you log are kept on this device and sent when the connection returns.",
  "offline.saved": "No connection. Heat saved on this device; it will be sent when you are back online.",
  "offline.waiting": "{n} heat(s) waiting to be sent",
  "offline.syncNow": "Send now",
  "offline.syncing": "Sending…",
  "offline.synced": "{n} heat(s) sent.",
  "offline.rejected": "The server did not accept this heat",
  "offline.discard": "Discard",
  "offline.checkLog": "Check the heat log before logging it again.",
} as const;

export type MessageKey = keyof typeof en;

const hi: Record<MessageKey, string> = {
  "nav.overview": "अवलोकन",
  "nav.operations": "संचालन",
  "nav.decisions": "निर्णय",
  "nav.records": "रिकॉर्ड",
  "nav.demo": "डेमो",
  "nav.dashboard": "डैशबोर्ड",
  "nav.heats": "हीट लॉग",
  "nav.meters": "मीटर डेटा",
  "nav.anomalies": "असामान्यताएँ",
  "nav.optimizer": "शेड्यूल ऑप्टिमाइज़र",
  "nav.approvals": "मंज़ूरियाँ",
  "nav.verification": "सत्यापन",
  "nav.tariffs": "टैरिफ़",
  "nav.reports": "रिपोर्ट और एक्सपोर्ट",
  "nav.audit": "ऑडिट लॉग",
  "nav.evidence": "प्रमाण और मान्यताएँ",
  "nav.settings": "फ़ैक्टरी सेटिंग्स",
  "nav.scenario": "परिदृश्य नियंत्रण",
  "nav.open": "नेविगेशन खोलें",
  "nav.close": "नेविगेशन बंद करें",
  "nav.advisory": "केवल सलाह। संयंत्र के उपकरणों को कोई कमांड नहीं भेजी जाती।",
  "lang.label": "भाषा",
  "heat.heatNo": "हीट नंबर *",
  "heat.charge": "चार्ज, किग्रा *",
  "heat.capacity": "क्षमता {n} किग्रा",
  "heat.start": "शुरू *",
  "heat.tap": "टैपिंग",
  "heat.poured": "डाला गया, किग्रा",
  "heat.pouredHint": "टैपिंग के बाद आवश्यक",
  "heat.mouldSet": "मोल्ड सेट",
  "heat.more": "और फ़ील्ड (मोल्ड तैयार समय, ग्रेड, ऑर्डर, नोट)",
  "heat.log": "हीट दर्ज करें",
  "heat.save": "बदलाव सहेजें",
  "heat.now": "अभी",
  "heat.logged": "हीट दर्ज हो गई। ऊर्जा मीटर से आएगी।",
  "offline.banner": "इंटरनेट नहीं है। आपकी दर्ज की हुई हीट इस डिवाइस पर रहेंगी और कनेक्शन लौटते ही भेज दी जाएँगी।",
  "offline.saved": "इंटरनेट नहीं है। हीट इस डिवाइस पर सहेजी गई; ऑनलाइन होते ही भेज दी जाएगी।",
  "offline.waiting": "{n} हीट भेजने के लिए प्रतीक्षा में",
  "offline.syncNow": "अभी भेजें",
  "offline.syncing": "भेजा जा रहा है…",
  "offline.synced": "{n} हीट भेज दी गईं।",
  "offline.rejected": "सर्वर ने यह हीट स्वीकार नहीं की",
  "offline.discard": "हटाएँ",
  "offline.checkLog": "दोबारा दर्ज करने से पहले हीट लॉग देखें।",
};

const mr: Record<MessageKey, string> = {
  "nav.overview": "आढावा",
  "nav.operations": "कामकाज",
  "nav.decisions": "निर्णय",
  "nav.records": "नोंदी",
  "nav.demo": "डेमो",
  "nav.dashboard": "डॅशबोर्ड",
  "nav.heats": "हीट नोंदवही",
  "nav.meters": "मीटर डेटा",
  "nav.anomalies": "विसंगती",
  "nav.optimizer": "वेळापत्रक ऑप्टिमायझर",
  "nav.approvals": "मंजुरी",
  "nav.verification": "पडताळणी",
  "nav.tariffs": "दरपत्रक",
  "nav.reports": "अहवाल आणि एक्सपोर्ट",
  "nav.audit": "ऑडिट नोंद",
  "nav.evidence": "पुरावे आणि गृहीतके",
  "nav.settings": "कारखाना सेटिंग्ज",
  "nav.scenario": "परिस्थिती नियंत्रण",
  "nav.open": "नेव्हिगेशन उघडा",
  "nav.close": "नेव्हिगेशन बंद करा",
  "nav.advisory": "फक्त सल्ला. प्लांटच्या उपकरणांना कोणतीही आज्ञा पाठवली जात नाही.",
  "lang.label": "भाषा",
  "heat.heatNo": "हीट क्रमांक *",
  "heat.charge": "चार्ज, किलो *",
  "heat.capacity": "क्षमता {n} किलो",
  "heat.start": "सुरू *",
  "heat.tap": "टॅपिंग",
  "heat.poured": "ओतलेले, किलो",
  "heat.pouredHint": "टॅपिंगनंतर आवश्यक",
  "heat.mouldSet": "मोल्ड सेट",
  "heat.more": "आणखी रकाने (मोल्ड तयार वेळ, ग्रेड, ऑर्डर, टिप्पणी)",
  "heat.log": "हीट नोंदवा",
  "heat.save": "बदल जतन करा",
  "heat.now": "आत्ता",
  "heat.logged": "हीट नोंदवली. ऊर्जा मीटरवरून येईल.",
  "offline.banner": "इंटरनेट नाही. तुम्ही नोंदवलेल्या हीट या उपकरणावर राहतील आणि जोडणी परत येताच पाठवल्या जातील.",
  "offline.saved": "इंटरनेट नाही. हीट या उपकरणावर जतन केली; ऑनलाइन येताच पाठवली जाईल.",
  "offline.waiting": "{n} हीट पाठवण्यासाठी प्रतीक्षेत",
  "offline.syncNow": "आत्ता पाठवा",
  "offline.syncing": "पाठवत आहे…",
  "offline.synced": "{n} हीट पाठवल्या.",
  "offline.rejected": "सर्व्हरने ही हीट स्वीकारली नाही",
  "offline.discard": "काढून टाका",
  "offline.checkLog": "पुन्हा नोंदवण्यापूर्वी हीट नोंदवही तपासा.",
};

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, hi, mr };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** Translate a key, filling `{name}` placeholders. Falls back to English, then to the key. */
export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  let s = MESSAGES[locale]?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// AI Vision (Google Gemini) — jadval rasmini tuzilgan JSON'ga aylantirish.
// API kalit faqat serverda (GEMINI_API_KEY muhit o'zgaruvchisi), frontendga hech qachon yuborilmaydi.

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
// Ixtiyoriy fikrlash darajasi (GEMINI_THINKING=low|high). Standart: modelning o'z sozlamasi. Model qo'llamasa, avtomatik o'chiriladi.
const THINKING = process.env.GEMINI_THINKING || '';
const KEY = process.env.GEMINI_API_KEY || '';
// Asosiy model band (503/429) bo'lsa navbatdagi zaxira modellar sinab ko'riladi
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash').split(',').map((x) => x.trim()).filter((x) => x && x !== MODEL);
const BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
const ENDPOINT = (m) => `${BASE}/v1beta/models/${encodeURIComponent(m)}:generateContent`;

export const aiStatus = () => ({ gemini: Boolean(KEY), model: KEY ? MODEL : null });

const PROMPT = `Sen maktab o'qituvchisining baholash jadvali rasmini o'qiyotgan aniq OCR tizimisan.
Rasmda o'quvchilar ro'yxati va ularning ballari bo'lgan jadval bor (qog'oz, Excel screenshoti yoki foto).

Vazifa: jadval tuzilishini aniqlab, har bir o'quvchi qatorini ustunlar bo'yicha qaytar.

QOIDALAR (juda muhim):
- HECH QACHON taxmin qilma. Raqamni aniq o'qiy olmasang: value = null, raw = rasmda ko'ringan belgi (yoki "?"), confidence < 0.5.
- Katak haqiqatan bo'sh bo'lsa: value = null, raw = "", confidence = 1.
- Bir o'quvchining ballarini boshqa qatorga o'tkazma. Har bir qatordagi kataklar soni columns soniga teng bo'lsin, tartib ham bir xil.
- Ism-familiyani rasmda qanday yozilgan bo'lsa, shunday yoz (lotin yoki kirill). O'zgartirma, tarjima qilma.
- columns — ism ustunidan O'NGDAGI barcha raqamli ustunlar, chapdan o'ngga.
  kind: "score" (topshiriq/mezon bali), "total" (umumiy/jami ball), "percent" (foiz), "bilish", "qollash", "mulohaza", "other".
  max: sarlavhada yoki alohida qatorda maksimal ball yozilgan bo'lsa — o'sha son, aks holda null.
  label: sarlavhadagi matn (masalan "Listening", "6", "Foiz %").
- "Jami", "Foiz", "O'rtacha" kabi yakuniy qatorlarni rows ga qo'shma — ularni footer ga yoz.
- Foizlarni 0..100 oralig'idagi son sifatida yoz (75% -> 75).
- index — qator boshidagi tartib raqami (bo'lsa).
- confidence — 0 dan 1 gacha, o'qishga qanchalik ishonchingiz.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    columns: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          max: { type: 'NUMBER', nullable: true },
          kind: { type: 'STRING', enum: ['score', 'total', 'percent', 'bilish', 'qollash', 'mulohaza', 'other'] },
        },
        required: ['label', 'kind'],
      },
    },
    rows: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          index: { type: 'INTEGER', nullable: true },
          name: { type: 'STRING' },
          nameConfidence: { type: 'NUMBER' },
          cells: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                value: { type: 'NUMBER', nullable: true },
                raw: { type: 'STRING' },
                confidence: { type: 'NUMBER' },
              },
              required: ['raw', 'confidence'],
            },
          },
        },
        required: ['name', 'cells'],
      },
    },
    footer: { type: 'STRING', nullable: true },
    notes: { type: 'STRING', nullable: true },
  },
  required: ['columns', 'rows'],
};

const hits = new Map(); // userId -> vaqtlar (daqiqasiga 20 ta so'rov)

export async function extractTable({ userId, image, mimeType }) {
  if (!KEY) {
    const e = new Error('AI Vision sozlanmagan. Administrator serverda GEMINI_API_KEY ni o‘rnatishi kerak');
    e.status = 503;
    throw e;
  }
  const now = Date.now();
  const list = (hits.get(userId) || []).filter((t) => now - t < 60_000);
  if (list.length >= 20) {
    const e = new Error('Juda ko‘p so‘rov. Bir daqiqadan keyin qayta urinib ko‘ring');
    e.status = 429;
    throw e;
  }
  list.push(now);
  hits.set(userId, list);

  if (!/^image\/(png|jpeg|webp)$/.test(mimeType || '')) {
    const e = new Error('Faqat PNG, JPEG yoki WEBP rasm qabul qilinadi');
    e.status = 400;
    throw e;
  }
  const call = (thinking, model = MODEL) => fetch(ENDPOINT(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: image } }] }],
      generationConfig: {
        temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA,
        ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
      },
    }),
    signal: AbortSignal.timeout(110_000),
  }).catch((err) => {
    const e = new Error(`AI xizmatiga ulanib bo‘lmadi: ${err.name === 'TimeoutError' ? 'javob kutish vaqti tugadi' : err.message}`);
    e.status = 502;
    throw e;
  });
  let res = await call(THINKING || null);
  let json = await res.json().catch(() => ({}));
  if (!res.ok && res.status === 400 && THINKING && /thinking/i.test(json?.error?.message || '')) {
    res = await call(null); // bu model fikrlash sozlamasini qo'llamaydi
    json = await res.json().catch(() => ({}));
  }
  for (const fb of FALLBACKS) {
    if (res.ok || (res.status !== 503 && res.status !== 429)) break;
    res = await call(null, fb);
    json = await res.json().catch(() => ({}));
  }
  if (!res.ok) {
    const e = new Error(`AI xizmati xatosi (${res.status}): ${json?.error?.message || 'noma’lum'}`);
    e.status = 502;
    throw e;
  }
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  try {
    return JSON.parse(text);
  } catch {
    const e = new Error('AI javobini o‘qib bo‘lmadi. Qayta urinib ko‘ring yoki mahalliy OCR’dan foydalaning');
    e.status = 502;
    throw e;
  }
}

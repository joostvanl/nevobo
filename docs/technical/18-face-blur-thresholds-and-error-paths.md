# 18 — Face blur: drempels, kwaliteitschecks en foutpaden

**Implementatie:** `server/services/faceBlur.js`  
**Aanvulling op:** [09-services-face-blur-and-libs.md](./09-services-face-blur-and-libs.md), [13-environment-security-and-secrets.md](./13-environment-security-and-secrets.md).

---

## 1. Environment

| Variabele | Effect |
|-----------|--------|
| `FACE_BLUR_ENABLED` | Moet exact `true` zijn (trim) om modellen te laden en blur te draaien. Anders: vroege return overal. |
| `FACE_BLUR_THRESHOLD` | Euclidean distance: match als `bestDist < threshold`. Default **0.6** in code als env leeg/ongeldig. |

`FACE_BLUR_DEBUG` (alleen `social.js`): extra kwaliteitsdebug naar client bij upload.

---

## 2. Constanten (niet via env) — upload / detectie

| Constante | Waarde | Betekenis |
|-----------|--------|-----------|
| `MATCH_THRESHOLD` | uit env of 0.6 | Anon matching |
| `MIN_CONFIDENCE` | 0.4 | SSD MobileNet bij **upload**-detectie (`detectAllFaces` in blur-pipeline) |
| `PIXELATE_BLOCKS` | 8 | Pixelblokken voor default blur-stijl |
| `BLUR_SIGMA` | 40 | Gaussian op regio |
| `EXPAND_RATIO` | 0.25 | Bbox uitbreiding |

**Tap-to-blur** (`detectFaceAtPoint`): `minConfidence` **0.15** (toleranter).

**Reference upload** (`checkReferencePhotoQuality`): face detect `minConfidence` **0.4**; `REF_MIN_FACE_RATIO` 0.05; `REF_MIN_FACE_CONF` 0.65.

---

## 3. Upload-kwaliteit (`checkUploadedPhotoQuality`)

Meet brightness, Laplacian sharpness @640px, grain ratio (640 vs 80px), resolutie. **Niet-blokkerend** — bij meetfout: `{ ok: true, warnings: [] }`.

| Check | Drempel | Gevolg |
|-------|---------|--------|
| Te donker | brightness < 35 | warning |
| Overbelicht | brightness > 220 | warning |
| Wazig | sharpness < 2 | warning |
| Korrelig | grainRatio > 3.2 | warning |
| Te klein | min(width,height) < 200 | warning |

**In `social.js` upload:** als `warnings.length > 0` voor een bestand → **geen** `blurFacesIfNeeded` voor dat bestand (stille skip); andere bestanden in dezelfde request kunnen wél blur krijgen.

---

## 4. Productie-gedrag / foutpaden

| Situatie | Gedrag |
|----------|--------|
| Feature uit | `loadModels` logt skip; `blurFacesIfNeeded` → `false`; geen error naar client. |
| Geen anonieme leden in team | `teamHasAnonymousMembers` → skip blur (geen model-load voor die call). |
| Geen descriptors | Lege refs / missing files → skip blur. |
| 0 gezichten in upload | Log + return `false` — origineel blijft. |
| Geen match onder threshold | Log + return `false`. |
| `blurFacesIfNeeded` throw | `social.js` vangt, logt, **upload gaat door** zonder blur. |
| EXIF rotate fail | Log, origineel behouden. |
| `applyBlurRegions` geen valide composities | Schrijft genormaliseerde rotatie zonder blur, return `false`. |
| `.orig` | Eerste succesvolle blur: backup; revert gebruikt `revertBlur`. |

**Reference foto (auth-route):** `checkReferencePhotoQuality` kan upload **blokkeren** (`ok: false` + issues/hints) — zie `routes/auth.js` (face-reference endpoint).

---

## 5. Logging

Console: o.a. backend keuze (tfjs-node vs wasm), per-file face counts, `bestDist` / `matched`, upload quality metrics. In productie log aggregatie nuttig voor tuning van `FACE_BLUR_THRESHOLD` en kwaliteitsdrempels.

---

## Zie ook

- [datamodel-match-media-opponent.md](../datamodel-match-media-opponent.md) — teamcontext voor blur.  
- `FUNCTIONELE_DOCUMENTATIE.md` §6 — gebruikersgerichte uitleg (kan afwijken van exacte getallen).

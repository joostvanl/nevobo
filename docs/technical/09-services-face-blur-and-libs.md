# 09 — Services: face blur en libs

## `server/services/faceBlur.js`

### Rol

- **Upload-pipeline:** optioneel gezichten blurren op team-foto’s (privacy)  
- **Kwaliteitscheck vóór blur:** te donker / te wazig → geen blur, waarschuwing naar client  
- **Handmatige blur in reel:** detectie, toggle per gezicht, blur-at-point, revert naar origineel (`.orig` backup)

### Stack

- **@vladmandic/face-api** + **@tensorflow/tfjs** (+ WASM backend)  
- Modellen onder `server/models/` (manifest + weights; grote binaries vaak `.gitignore`, download via `server/scripts/download-models.js`)  
- **Sharp** voor image resize/convert vóór inference

### Levenscyclus

- `loadModels()` — async na server start; fouten mogen app niet killen  
- Zware work op upload/async routes — timeouts en try/catch in callers (`social.js`)

### Omgevingsvariabelen

- `FACE_BLUR_ENABLED`, `FACE_BLUR_THRESHOLD` — zie [13](./13-environment-security-and-secrets.md)  
- `FACE_BLUR_DEBUG` — extra debug payload naar client bij upload

**Drempels, kwaliteitschecks, foutpaden (productie):** [18-face-blur-thresholds-and-error-paths.md](./18-face-blur-thresholds-and-error-paths.md).

## `server/lib/tiktok-scraper.js` (optioneel)

Kan ontbreken in een checkout; zie [../tiktok-scraper.md](../tiktok-scraper.md) (implementatiestatus). Indien aanwezig: o.a. **`resolveVmTiktokToVideoId`**, **`fetchProfileVideoIds`** voor het CLI-script.

## Zie ook

- [06-api-social-media-and-reel.md](./06-api-social-media-and-reel.md)  
- [01-architecture-overview.md](./01-architecture-overview.md)

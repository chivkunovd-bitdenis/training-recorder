# Исправление координат аннотаций (номер шага, рамка, стрелка)

> **Название документа:** `docs/ANNOTATION_COORDINATE_SYSTEM_TASKS.md`  
> **Для кого:** Cursor Composer (реализация кода)  
> **Контекст:** номер шага (НС) и стрелка «уезжают» с целевого элемента на скриншоте — типично влево на серый фон letterbox. Корневая причина: **несогласованные системы координат** (viewport CSS vs пиксели bitmap) и **transform, размазанный по слоям**, а не единый geometry engine.

---

## 0. Правила выполнения (обязательно)

1. **Строго по порядку:** T-ANN-1 → T-ANN-2 → … → T-ANN-8. Следующую задачу не начинать, пока не зелёные тесты текущей.
2. **После каждой задачи** выполнить:
   ```bash
   npm run typecheck
   npm test
   ```
   Если задача трогает backend — дополнительно `make backend-check`. Полный прогон: `make check`.
3. **Не чинить симптомы в React/CSS отдельно от контракта данных.** Любой «подкрут `-40`» без geometry engine — запрещён.
4. **Максимум 5 файлов за шаг** (кроме новых тест-фикстур). Одна логическая забота на задачу.
5. **Definition of Done задачи:** код + новые/обновлённые тесты из раздела «Тест приёмки» + зелёный `npm test`.

### Целевая архитектура (кратко)

```
DOM click (viewport bbox)
    ↓
Screenshot + CaptureContext (на захвате)
    ↓
Materialize → bbox в screenshot pixels (единственный формат для рендера)
    ↓
Geometry Engine (pure functions, shared/)
    ↓
Editor preview (SVG/HTML)  |  Canvas bake (export)
```

---

## T-ANN-1 — Контракт данных: CaptureContext и coordinateSpace

**Зависит от:** ничего. **Делать первым.**

### Цель

Зафиксировать в схеме **единственную систему координат для рендера аннотаций** — пиксели bitmap скриншота — и «паспорт кадра» для transform viewport → image.

### Затрагиваемые файлы

| Файл | Действие |
|------|----------|
| `shared/timeline.schema.json` | добавить `CaptureContext`, расширить `Screenshot`, `ScreenshotAnnotation` |
| `shared/timeline.types.ts` | синхронизировать TypeScript-типы |
| `tests/timeline-contract.test.mjs` | обновить/добавить кейсы |
| `fixtures/timeline.mock.json` | добавить `captureContext` хотя бы на одном скрине (опционально для backward compat) |

### Начинка — схема

**Новый тип `CaptureContext`** (в `$defs`):

```json
"CaptureContext": {
  "type": "object",
  "additionalProperties": false,
  "required": ["viewportWidth", "viewportHeight", "devicePixelRatio"],
  "properties": {
    "viewportWidth": { "type": "integer", "minimum": 1 },
    "viewportHeight": { "type": "integer", "minimum": 1 },
    "devicePixelRatio": { "type": "number", "minimum": 0.25 },
    "scrollX": { "type": "number", "minimum": 0 },
    "scrollY": { "type": "number", "minimum": 0 },
    "visualViewportScale": { "type": "number", "minimum": 0.25 }
  }
}
```

**`Screenshot`** — добавить (не в `required`, для обратной совместимости):

- `captureContext`: `{ "$ref": "#/$defs/CaptureContext" }`
- Deprecate по смыслу (оставить для compat): `viewportWidth`, `viewportHeight` на корне `Screenshot` — **не удалять**, читать через helper «context или legacy fields».

**`ScreenshotAnnotation`** — добавить:

- `coordinateSpace`: enum `["screenshotPixels"]` — default при записи = `screenshotPixels`
- `confidence`: enum `["measured", "inferred", "manual"]` — optional
- `materializedFromEventId`: string, optional — audit trail

**`ElementContext.bbox`** — **не менять** (остаётся viewport CSS, только для событий/debug).

### Поведение

- Старые JSON без новых полей **валидны**.
- Новые записи расширения должны заполнять `captureContext` (реализация в T-ANN-3).
- Редактор **не** должен трактовать `event.target.bbox` как screenshot pixels.

### Тест приёмки (ловят реальные ошибки)

Файл: `tests/timeline-contract.test.mjs`

1. **`fixtures/timeline.mock.json` по-прежнему валиден** — старые записи не ломаем.
2. **Новый fixture `fixtures/timeline.capture-context.json`** — минимальный timeline с:
   - `screenshot.captureContext`: `{ viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 2, scrollX: 0, scrollY: 480 }`
   - `screenshot.width: 2560`, `screenshot.height: 1440`
   - `screenshotAnnotation.coordinateSpace: "screenshotPixels"`
   - Assert: проходит AJV.
3. **Reject invalid coordinateSpace** — annotation с `coordinateSpace: "viewport"` → схема отклоняет.
4. **`npm run typecheck`** — типы экспортируют `CaptureContext`, `ScreenshotAnnotation.coordinateSpace`.

### После выполнения

```bash
npm run typecheck && npm test
```

---

## T-ANN-2 — Geometry Engine (единый модуль координат)

**Зависит от:** T-ANN-1.

### Цель

Один **pure-function** модуль для всех transform и layout декораций. React и Canvas **не** содержат своей математики стрелок/letterbox.

### Затрагиваемые файлы

| Файл | Действие |
|------|----------|
| `shared/annotation-geometry.mjs` | **создать** |
| `shared/annotation-utils.mjs` | реэкспорт/тонкая обёртка (не дублировать формулы) |
| `tests/annotation-geometry.test.mjs` | **создать** — основная test matrix |
| `fixtures/annotation-matrix.json` | **создать** — ground truth координаты |

### API модуля `annotation-geometry.mjs`

```js
/** @typedef {{ x,y,w,h }} Rect */
/** @typedef {{ viewportWidth, viewportHeight, devicePixelRatio, scrollX?, scrollY?, visualViewportScale? }} CaptureContextLike */
/** @typedef {{ width, height, captureContext?, viewportWidth?, viewportHeight? }} ScreenshotLike */

// --- Capture helpers ---
export function resolveCaptureContext(screenshot): CaptureContextLike | null
export function measuredScale(screenshot): { scaleX: number; scaleY: number } | null

// --- Transforms (единственный источник формул) ---
export function viewportBBoxToScreenshot(bbox, screenshot): Rect
export function screenshotBBoxToDisplay(bbox, screenshot, displayClientSize, fitMode = 'contain'): { rect: Rect; offset: { x: number; y: number }; renderSize: { width: number; height: number } }
export function displayBBoxToScreenshot(bbox, ...): Rect  // inverse для drag в редакторе

// --- Validation ---
export function clampRectToImage(rect, imageWidth, imageHeight): Rect
export function validateBBoxInImage(bbox, imageWidth, imageHeight): { ok: boolean; reason?: string }

// --- Decoration layout (стрелка + badge) ---
export function resolveDecorationLayout(screenshotBBox, stepNumber, imageSize, options?): {
  highlight: Rect;
  badge: Rect;
  arrow: { from: {x,y}; to: {x,y} };
  clamped: boolean;
}
```

**Правила `resolveDecorationLayout`:**

- Badge: prefer **above-left** highlight (`badge.y = highlight.y - badgeSize - gap`), fallback **inside-top-left** если не помещается.
- Arrow: from **badge center** → **highlight center**; если `highlight.x < imageWidth * 0.05` — это **clamped=true** (симптом бага координат, не прятать).
- Все точки **clamp** в `[0 .. imageWidth/Height]`.
- **Запрещено** использовать разные константы в canvas vs SVG — только этот layout.

**`measuredScale`:** предпочитать `imageWidth / captureContext.viewportWidth`, не слепой `devicePixelRatio`, если ratio расходится >5% — использовать measured (реальный tab capture часто ≠ DPR).

### Fixture `fixtures/annotation-matrix.json`

Массив кейсов с **известным ground truth** (ручной расчёт):

| id | viewport | image | DPR | scrollY | viewport bbox кнопки | expected screenshot bbox |
|----|----------|-------|-----|---------|----------------------|--------------------------|
| `dpr1-top-left` | 1440×900 | 1440×900 | 1 | 0 | x:100,y:80,w:120,h:36 | same |
| `dpr2-retina` | 1280×720 | 2560×1440 | 2 | 0 | x:100,y:50,w:200,h:40 | x:200,y:100,w:400,h:80 |
| `dpr2-scrolled` | 1280×720 | 2560×1440 | 2 | 600 | x:400,y:200,w:100,h:30 | x:800,y:400,w:200,h:60 |
| `letterbox-wide` | display 960×360, image 2560×1440 | — | — | — | screenshot bbox x:1000 | display x≈250, offsetY≈125 |

Для каждого кейса — expected `resolveDecorationLayout` badge/arrow **не** at x<50 unless highlight actually near left edge.

### Тест приёмки (ловят реальные ошибки)

Файл: `tests/annotation-geometry.test.mjs`

1. **Matrix transform:** для каждого кейса из `annotation-matrix.json` — `viewportBBoxToScreenshot` === expected (±1px округление).
2. **Passthrough trap (главный регресс):** при `screenshot.width=2560`, `viewportWidth=1280`, bbox viewport `{100,50,200,40}` — результат **должен быть `{200,100,400,80}`**, НЕ passthrough `{100,50,200,40}`. Это ловит текущий баг «стрелка уехала влево».
3. **Legacy screenshot без captureContext:** если есть только `viewportWidth/Height` на корне — `resolveCaptureContext` собирает context, scale работает.
4. **Letterbox display:** для image 2560×1440 в display box 960×360 — highlight center после transform попадает **внутрь** render area, не в отрицательные offset.
5. **validateBBoxInImage:** bbox `{x:-10,...}` → `ok:false`; bbox за правым краем → `ok:false`.
6. **Decoration not at origin bug:** для кейса `dpr2-retina` с кнопкой справа (viewport x:1000) — `resolveDecorationLayout.arrow.from.x` **> 100** (не clamp к 8px — признак неверного bbox).
7. **Roundtrip:** display → screenshot → display для drag-сценария — delta ≤2px.

Обновить `package.json` → `"test"` script: добавить `tests/annotation-geometry.test.mjs`.

### После выполнения

```bash
npm run typecheck && npm test
```

---

## T-ANN-3 — Захват: полный CaptureContext + materialize bbox на скрине

**Зависит от:** T-ANN-1, T-ANN-2.

### Цель

На **границе захвата** (extension content script) собрать provenance и **сразу** перевести bbox в screenshot pixels. Редактор получает уже правильные координаты.

### Затрагиваемые файлы

| Файл | Действие |
|------|----------|
| `extension/content/content.js` | `requestScreenshot`: записать `captureContext`, materialize bbox |
| `extension/content/dom-context.js` | helper `buildCaptureContext()` |
| `shared/annotation-geometry.mjs` | import `viewportBBoxToScreenshot`, `validateBBoxInImage` (через dynamic import или duplicate-free path для extension — см. ниже) |
| `tests/content-t12.test.mjs` | новые кейсы |
| `tests/content-capture-context.test.mjs` | **создать** (unit без Chrome) |

### Начинка

**`buildCaptureContext()`** в `dom-context.js`:

```js
{
  viewportWidth: window.innerWidth,
  viewportHeight: window.innerHeight,
  devicePixelRatio: window.devicePixelRatio || 1,
  scrollX: window.scrollX,
  scrollY: window.scrollY,
  visualViewportScale: window.visualViewport?.scale ?? 1,
}
```

**В `requestScreenshot` после `refreshEventBBox(payload.eventId)`:**

1. Найти main screenshot meta (width/height из ответа offscreen).
2. Записать `captureContext: buildCaptureContext()`.
3. Дублировать legacy: `viewportWidth/Height` на корне (compat).
4. **Materialize:** для `payload.eventId` взять `event.target.bbox` (viewport), прогнать `viewportBBoxToScreenshot`, записать в **новое поле** события или в sidecar — предпочтительно: сохранить в timeline как `screenshotAnnotation` **draft** на уровне screenshot metadata:

   ```js
   // screenshot record at capture time (optional precomputed)
   materializedBbox: { x, y, w, h }  // только если validateBBoxInImage ok
   annotationConfidence: 'measured' | 'invalid'
   ```

   Если bbox invalid — `confidence: 'low'` на screenshot уже есть; дополнительно log/warn.

**Порядок операций (критично):**

```
refreshEventBBox(eventId)   // DOM state at capture
→ buildCaptureContext()
→ viewportBBoxToScreenshot(bbox, { width, height, captureContext })
→ validateBBoxInImage
→ save to screenshot meta
```

**Extension + ESM:** если прямой import `annotation-geometry.mjs` в content script проблемен (нет bundler), допустимо:
- скопировать **только** pure functions в `extension/lib/annotation-geometry.js` с комментарием «sync with shared/» — **но** тесты должны импортировать shared и extension-копию и assert идентичность (или один shared файл подключается в тестах для обоих).

### Тест приёмки (ловят реальные ошибки)

**`tests/content-capture-context.test.mjs`** (jsdom):

1. Mock `window` с `innerWidth=1280`, `devicePixelRatio=2`, `scrollY=600`.
2. `buildCaptureContext()` возвращает все поля.
3. Simulate: event bbox viewport `{400,200,100,30}`, screenshot `{width:2560,height:1440,captureContext:...}` → materialized `{800,400,200,60}`.

**`tests/content-t12.test.mjs`** — дополнить:

4. После симуляции `requestScreenshot` mock — screenshot object содержит `captureContext.devicePixelRatio`.
5. **Regression:** materialized bbox **не равен** raw viewport bbox при DPR=2.

### После выполнения

```bash
npm run typecheck && npm test
```

---

## T-ANN-4 — Resolve аннотации: только screenshot pixels + inference для старых записей

**Зависит от:** T-ANN-2, T-ANN-3.

### Цель

`resolveStepAnnotation` **никогда** не отдаёт viewport coords как screenshot pixels. Старые записи — явный `confidence: inferred`, не silent passthrough.

### Затрагиваемые файлы

| Файл | Действие |
|------|----------|
| `shared/annotation-utils.mjs` | переписать `resolveStepAnnotation`, `scaleViewportBBoxToNatural` → делегировать geometry |
| `editor/src/annotation.ts` | без дублирования math |
| `tests/annotation-t32.test.mjs` | обновить expected values |
| `tests/annotation-hidpi.test.mjs` | усилить + anti-passthrough |
| `tests/annotation-inference.test.mjs` | **создать** |

### Поведение `resolveStepAnnotation`

```
if (existing annotation with coordinateSpace screenshotPixels) → return as-is

if (screenshot.materializedBbox from capture) → return { bbox, coordinateSpace, confidence: measured }

else compute:
  ctx = resolveCaptureContext(screenshot)
  if (ctx && screenshot.width/height) → viewportBBoxToScreenshot
  else if (screenshot.width ≈ viewport legacy fields) → treat 1:1, confidence: inferred
  else → confidence: inferred + needsReview flag semantics (return annotation but editor shows warning)

always set coordinateSpace: 'screenshotPixels'
validateBBoxInImage → if fail, set confidence inferred + clamp or null annotation
```

**Удалить/ deprecate:** silent passthrough в `scaleViewportBBoxToNatural` когда ratio image/viewport явно ≠ 1.

### Тест приёмки (ловят реальные ошибки)

**`tests/annotation-inference.test.mjs`:**

1. **HiDPI без captureContext, но width=2560, legacy viewportWidth=1280** — must scale, not passthrough.
2. **1:1 old recording** width=1440, viewport=1440 — inferred 1:1 OK.
3. **Broken old recording** width=2560, no viewport fields — annotation `confidence: inferred`, bbox still wrong BUT step gets `needsReview`-compatible signal (document exact return shape).
4. **Saved manual annotation** — never overwritten.

**Обновить `annotation-t32.test.mjs`:**

5. Mock timeline fixtures должны включать `captureContext` или consistent legacy fields — иначе тесты врут.

**Anti-regression (обязательный assert):**

```js
// MUST FAIL on old buggy code:
const ann = resolveStepAnnotation({ ... dpr2 case without existing ... });
assert.notDeepEqual(ann.bbox, viewportBbox, 'viewport coords leaked to annotation');
assert.equal(ann.coordinateSpace, 'screenshotPixels');
```

### После выполнения

```bash
npm run typecheck && npm test
```

---

## T-ANN-5 — Редактор preview: один layout engine, letterbox, drag

**Зависит от:** T-ANN-2, T-ANN-4.

### Цель

`ScreenshotAnnotator` использует **только** `annotation-geometry` для display transform и decoration layout. Убрать дублирующие формулы стрелки (`bbox.x - 20` vs `-40`).

### Затрагиваемые файлы

| Файл | Действие |
|------|----------|
| `editor/src/ScreenshotAnnotator.tsx` | refactor |
| `editor/src/App.css` | badge positioning via computed layout (минимальные CSS offsets) |
| `tests/annotation-editor-layout.test.mjs` | **создать** (pure fn tests через geometry, без Playwright) |

### Начинка

1. `screenshotBBoxToDisplay(annotation.bbox, ...)` → `displayRect` + `offset` + `renderSize`.
2. Overlay layer: `left/top/width/height` из `offset` + `renderSize` (как сейчас, но rects из geometry).
3. Badge + arrow SVG: координаты из `resolveDecorationLayout`, затем масштабировать display transform **единым** helper (layout в screenshot space → multiply scale + add offset).
4. Drag: pointer delta в display space → `displayBBoxToScreenshot` → save with `confidence: manual`.

**ResizeObserver** на `img` (вместо только `window.resize`) — пересчёт display size.

### Тест приёмки (ловят реальные ошибки)

**`tests/annotation-editor-layout.test.mjs`:**

1. Import helper `screenshotLayoutToDisplayLayer(annotation, screenshotMeta, displaySize)` extracted from component (or duplicate-free export from geometry wrapper).
2. **Letterbox case:** image 2560×1440, display 960×360 — highlight `displayX` **≥ offsetX** (не 0 на сером фоне).
3. **DPR2 case:** button at screenshot x=2000 → display x **> 50%** display render width (not left edge).
4. **Arrow consistency:** arrow `from` and `to` both inside `[offsetX .. offsetX+renderWidth]`.
5. **Drag roundtrip:** move +30px display X → saved screenshot bbox +30/scale ±2px.

### После выполнения

```bash
npm run typecheck && npm test
```

---

## T-ANN-6 — Canvas bake / export: тот же layout, pixel-perfect с preview

**Зависит от:** T-ANN-2, T-ANN-5.

### Цель

`drawAnnotationOnCanvas` и `bakeAnnotatedScreenshot` рисуют **тот же** `resolveDecorationLayout`, что и SVG preview. Экспорт PNG = WYSIWYG.

### Затрагиваемые файлы

| Файл | Действие |
|------|----------|
| `shared/annotation-utils.mjs` | `drawAnnotationOnCanvas` → thin adapter над layout |
| `editor/src/export.ts` | без изменений логики кроме import |
| `editor/src/ScreenshotAnnotator.tsx` | `downloadAnnotatedPng` uses shared draw |
| `tests/annotation-canvas-parity.test.mjs` | **создать** |

### Начинка

```js
export function drawAnnotationOnCanvas(ctx, annotation, stepNumber, canvasWidth, canvasHeight) {
  const layout = resolveDecorationLayout(annotation.bbox, stepNumber, { width: canvasWidth, height: canvasHeight });
  // draw highlight, badge, arrow from layout — NO inline Math.max(8, bbox.x-40)
}
```

### Тест приёмки (ловят реальные ошибки)

**`tests/annotation-canvas-parity.test.mjs`:**

1. For fixed bbox `{200,100,400,80}` on 2560×1440 — extract layout numbers.
2. **Parity assert:** SVG-equivalent coordinates (from geometry) === canvas draw coordinates (mock ctx with recording calls, or snapshot array of draw ops).
3. **Old bug regression:** for right-side button bbox, badge X **≠ 4** (old clamp to left).
4. **`bakeAnnotatedScreenshot`** smoke with jsdom canvas if available — at least no throw + blob size > 0.

### После выполнения

```bash
npm run typecheck && npm test
```

---

## T-ANN-7 — Regression matrix + fixtures «как на проде»

**Зависит от:** T-ANN-1 … T-ANN-6.

### Цель

Закрепить **8+ комбинаций** DPR / scroll / letterbox / modal в fixtures, чтобы будущие правки не возвращали «стрелку в серый фон».

### Затрагиваемые файлы

| Файл | Действие |
|------|----------|
| `fixtures/annotation-matrix.json` | расширить до 8+ кейсов |
| `fixtures/timeline.hidpi-scrolled.json` | **создать** — полный timeline |
| `tests/annotation-regression.test.mjs` | **создать** — end-to-end через resolve + layout + display |
| `tests/annotation-t32.test.mjs` | использовать hidpi fixture |

### Кейсы matrix (минимум)

| ID | Описание | Что ловит |
|----|----------|-----------|
| `prod-drift-left` | DPR2, кнопка x=1120 viewport → x=2240 image | текущий скрин пользователя |
| `scroll-table` | scrollY=400, input в таблице | bbox без scroll context |
| `modal-click` | click + modal_open, pick pointer | bbox dialog вместо кнопки |
| `no-context-legacy` | width 2x, legacy viewport only | silent passthrough |
| `letterbox-preview` | wide image in narrow editor | offset forgotten |
| `badge-near-top` | y=5 viewport | badge fallback inside |
| `manual-override` | saved annotation | overwrite |
| `invalid-bbox` | x=-50 | validation + needsReview |

### Тест приёмки

**`tests/annotation-regression.test.mjs`:**

Для каждого кейса pipeline:

```
resolveStepAnnotation → resolveDecorationLayout → screenshotBBoxToDisplay
```

Asserts:

- `validateBBoxInImage.ok === true` (кроме invalid кейса)
- `decoration.clamped === false` (кроме edge cases)
- `displayRect.x >= displayOffset.x` (не на letterbox)
- **`prod-drift-left`:** `displayRect.x > displayRenderWidth * 0.5`

### После выполнения

```bash
npm run typecheck && npm test && make check
```

---

## T-ANN-8 — UX сигнал «проверьте подсветку» + документация контракта

**Зависит от:** T-ANN-4, T-ANN-7.

### Цель

Когда координаты **inferred/invalid**, пользователь видит предупреждение, а не молча стрелку слева.

### Затрагиваемые файлы

| Файл | Действие |
|------|----------|
| `editor/src/App.tsx` | badge «Подсветка неточная» если `confidence !== 'measured' && !== 'manual'` |
| `editor/src/App.css` | стиль warning |
| `editor/src/types.ts` | типы confidence |
| `docs/CHROME_EXTENSION.md` или новый раздел в этом doc | таблица coordinate spaces |
| `tests/annotation-confidence-ui.test.mjs` | **создать** (logic-only: shouldShowAnnotationWarning helper) |

### Поведение

- `confidence: measured | manual` — без warning.
- `confidence: inferred` — жёлтый badge «Подсветка могла сдвинуться — проверьте и подвиньте рамку».
- `annotation === null` или `enabled: false` — как сейчас.

Helper (testable):

```ts
export function shouldShowAnnotationWarning(annotation: ScreenshotAnnotation | null): boolean
```

### Тест приёмки

1. `inferred` → true
2. `measured` → false
3. `manual` → false
4. null → false

### После выполнения

```bash
npm run typecheck && npm test && make check
```

---

## Сводная таблица задач

| ID | Название | Файлов ≈ | Блокирует |
|----|----------|----------|-----------|
| T-ANN-1 | Контракт CaptureContext | 4 | всё |
| T-ANN-2 | Geometry Engine | 4 | T-ANN-3…6 |
| T-ANN-3 | Capture materialize | 4–5 | T-ANN-4 |
| T-ANN-4 | Resolve + inference | 5 | T-ANN-5 |
| T-ANN-5 | Editor preview | 3–4 | T-ANN-6 |
| T-ANN-6 | Canvas parity | 3–4 | T-ANN-7 |
| T-ANN-7 | Regression matrix | 4 | T-ANN-8 |
| T-ANN-8 | UX warning | 4 | — |

---

## Финальный Definition of Done (весь эпик)

1. `make check` зелёный.
2. На **новой записи** с DPR=2 рамка на кнопке, номер шага над кнопкой, стрелка от badge к кнопке — **не** на сером letterbox.
3. Экспорт PNG **совпадает** с preview (WYSIWYG).
4. Старая запись без `captureContext` — либо корректный inference, либо явный warning «проверьте подсветку».
5. Тест `prod-drift-left` в `annotation-regression.test.mjs` зелёный — главный регресс текущего бага.

---

## Что НЕ делать в этом эпике

- Playwright e2e (отдельный эпик, если нужен).
- Vision fallback для bbox.
- Zoom/crop на область (T3.2 optional — после стабильных координат).
- Массовая миграция уже сохранённых `GeneratedDoc` на backend — только inference + manual fix в редакторе.

---

## Handoff для Composer

**Начать с T-ANN-1.** Не объединять задачи. После каждой — `npm test`. При красном тесте — чинить в рамках текущей задачи, не идти дальше.

Если extension не может импортировать ESM из `shared/` напрямую — зафиксировать решение в комментарии в T-ANN-3 и покрыть parity-тестом, иначе geometry разъедется.

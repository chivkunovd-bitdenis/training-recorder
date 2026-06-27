# Упрощение захвата: «клик = шаг + скрин сейчас + стрелка в точку нажатия»

> **Файл:** `docs/CLICK_FIRST_CAPTURE_TASKS.md`  
> **Для кого:** владелец продукта (решение) + Cursor Composer (реализация)  
> **Статус:** план к реализации  
> **Контекст:** эпик T-ANN-1…8 закрыл **геометрию** (viewport → пиксели bitmap, letterbox в редакторе).  
> Стрелки всё ещё промахиваются, потому что **источник координат и момент скрина** завязаны на DOM-bbox и «result state после стабилизации», а не на факт клика.

---

## 1. Проблема (простыми словами)

| Что работает | Что ломается |
|--------------|--------------|
| Текст шага («Нажмите *Закрыть короб*») — LLM берёт **название кнопки** из события | Красная рамка/стрелка — берут **рамку DOM-элемента**, часто не той кнопки |
| Пользователь кликает осмысленно | Скрин делается **позже** (тишина сети/DOM до 8 с), UI уже другой |
| В WMS много одинаковых кнопок в строках | `querySelector(cssPath)` находит **первую** такую кнопку на странице |

**Вывод:** геометрия (DPR, letterbox) уже починена. Нужно поменять **семантику захвата**, а не добавлять ещё слой transform.

---

## 2. Новая продуктовая модель (зафиксировать)

### Шаг = значимый клик пользователя

1. Пользователь **нажал** на элемент интерфейса (кнопка, ссылка, пункт меню).
2. **В этот момент** (или +≤50 ms) делаем **один** скриншот вкладки.
3. Запоминаем:
   - **координаты мыши** `(clientX, clientY)` — куда ткнули;
   - **текст/роль элемента** — «Закрыть короб», `button`;
   - **время** `ts` на оси `t0`.
4. Стрелка на скрине указывает **в точку клика** (или маленький круг вокруг неё), не в «пересчитанную рамку из таблицы».

### Модалка / новый экран = следующий шаг

- Клик «Открыть короб» → **шаг 1**: скрин **до** или **в момент** клика, стрелка на кнопку.
- Модалка открылась → это **контекст для шага 2**, когда пользователь **кликнет внутри** модалки («Выбрать товар»).
- Событие `modal_open` **не** становится целью стрелки для предыдущего шага.

### Голос + LLM — без изменений смысла

- Голос по-прежнему даёт **объяснение** шага.
- LLM группирует речь вокруг **кликов**, а не вокруг `focus`/`input`/`modal_open`.
- Описание кнопки уже верное — меняем только **скрин + стрелку**.

---

## 3. Что меняем vs что оставляем

### Оставляем (уже сделано, не трогать без нужды)

- `shared/annotation-geometry.mjs` — transform viewport → screenshot pixels.
- `captureContext` на скрине (DPR, размер вьюпорта).
- Редактор: letterbox, drag рамки, export PNG, warning для `confidence: inferred`.
- tabCapture + offscreen + буфер кадров (механика снятия кадра).
- Маскирование PII, privacy gate.

### Меняем / упрощаем

| Было | Станет |
|------|--------|
| Скрин после «тишины» (400 ms – 8 s) | Скрин **сразу** на significant click (+ опционально короткий debounce 0–50 ms) |
| Triplet кадров (−120 / 0 / +120 ms) как основной | **Один** кадр на клик; triplet — только fallback / ручной выбор в редакторе |
| `event.target.bbox` + `refreshEventBBox(cssPath)` | **`clickPoint`** + опционально bbox кнопки через `closest()`, **без** refresh по селектору |
| `modal_open` конкурирует с `click` за аннотацию | `modal_open` — метаданные экрана, **не** pointer target |
| Подсветка = прямоугольник элемента | Подсветка = **точка клика** + маленький маркер (или микро-rect 24×24 px) |
| Стабилизатор для каждого клика | Стабилизатор **только** для navigation / submit без немедленного клика |

### Явно не делаем в этом эпике

- Vision для bbox.
- Playwright e2e.
- Автомиграция старых записей (inference + ручная правка в редакторе).
- Отказ от стабилизатора полностью (оставляем для навигации и «долгих» loader).

---

## 4. Целевая архитектура

```
click (capture phase)
    ↓
resolveTarget: closest(button|a|[role=button]) + clickPoint {clientX, clientY}
    ↓
RecEvent { type, ts, target{text, role, cssPath, clickPoint}, ... }
    ↓
immediate capture (ts ≈ event.ts)
    ↓
Screenshot { captureContext, eventId, materializedClickPoint in screenshot pixels }
    ↓
merge / LLM — шаг привязан к click-событию
    ↓
resolveStepAnnotation — стрелка в materializedClickPoint
    ↓
editor / export (geometry engine без изменений формул)
```

---

## 5. Правила выполнения

1. **Строго по порядку:** T-CLK-1 → T-CLK-2 → … → T-CLK-8.
2. **≤5 файлов за задачу** (кроме новых тестов/фикстур).
3. После каждой задачи: `npm run typecheck && npm test`; если тронут backend — `make check`.
4. **Не ломать** старые timeline: новые поля optional, старые записи → inference + warning как сейчас.
5. Definition of Done эпика — см. раздел 10.

---

## T-CLK-1 — Контракт: `clickPoint` и режим аннотации

**Зависит от:** ничего. **Делать первым.**

### Цель

Зафиксировать в данных **координаты клика** и тип подсветки «точка», не только bbox элемента.

### Файлы

| Файл | Действие |
|------|----------|
| `shared/timeline.schema.json` | расширить `ElementContext`, `ScreenshotAnnotation` |
| `shared/timeline.types.ts` | синхронизировать типы |
| `tests/timeline-contract.test.mjs` | новые кейсы |
| `fixtures/timeline.click-point.json` | минимальный timeline-пример |

### Схема

**`ElementContext`** — добавить (optional):

```json
"clickPoint": {
  "type": "object",
  "additionalProperties": false,
  "required": ["x", "y"],
  "properties": {
    "x": { "type": "number" },
    "y": { "type": "number" }
  }
}
```

Смысл: **viewport CSS**, те же координаты, что `MouseEvent.clientX/clientY`.

**`Screenshot`** — optional:

```json
"materializedClickPoint": {
  "type": "object",
  "required": ["x", "y"],
  "properties": {
    "x": { "type": "number" },
    "y": { "type": "number" }
  }
}
```

Пиксели bitmap (после transform на захвате).

**`ScreenshotAnnotation`** — optional:

```json
"annotationMode": {
  "type": "string",
  "enum": ["elementRect", "clickPoint"]
}
```

Default при новых записях: `"clickPoint"`. Старые без поля → `"elementRect"` (backward compat).

### Тест приёмки

1. `fixtures/timeline.mock.json` — по-прежнему валиден.
2. `fixtures/timeline.click-point.json` — проходит AJV.
3. `annotationMode: "viewport"` — схема **отклоняет**.

---

## T-CLK-2 — Запись клика: точка мыши + правильная кнопка

**Зависит от:** T-CLK-1.

### Цель

При `click` сохранять **куда нажали** и **интерактивный предок**, а не внутренний `<span>`.

### Файлы

| Файл | Действие |
|------|----------|
| `extension/content/content.js` | handler `click`: `clickPoint`, `resolveClickTarget` |
| `extension/content/dom-context.js` | `resolveClickTarget(element, clickPoint)`, расширить `createRecEvent` |
| `tests/content-t12.test.mjs` | кейсы click на span внутри button |
| `tests/content-click-point.test.mjs` | **создать** |

### Поведение

```js
function resolveClickTarget(rawTarget, clickPoint) {
  const interactive = rawTarget.closest(
    'a, button, summary, [role="button"], [role="link"], [type="submit"], [type="button"]'
  );
  const element = interactive ?? rawTarget;
  return {
    element,
    clickPoint: { x: clickPoint.clientX, y: clickPoint.clientY },
  };
}
```

- `target.text` / `label` — с **кнопки**, не с иконки.
- `target.bbox` — оставить для debug/fallback, но **не primary** для аннотации.
- `target.clickPoint` — **обязателен** для `type === "click"` (и `submit` / `menu_select` где есть координаты).

### Тест приёмки

1. Клик по `<span>` внутри `<button>Закрыть короб</button>` → `target.text === "Закрыть короб"`, `clickPoint` задан.
2. `clickPoint.x/y` — числа в пределах mock viewport.
3. `cssPath` строится от **кнопки**, не от span.

---

## T-CLK-3 — Скрин в момент клика (immediate capture)

**Зависит от:** T-CLK-2.

### Цель

На significant click **сразу** запросить кадр, не ждать 400 ms «тишины» и не ждать открытия модалки.

### Файлы

| Файл | Действие |
|------|----------|
| `extension/content/content.js` | `pushEvent`: для click → `requestScreenshot({ immediate: true })` |
| `extension/content/stabilizer.js` | режим `IMMEDIATE` vs `DEFERRED`; click → immediate |
| `extension/lib/stabilizer-config.js` | `IMMEDIATE_CAPTURE_DELAY_MS = 0` (или 50) |
| `extension/lib/frame-capture.js` | метод `captureSingleFrame()` без triplet loop |
| `tests/stabilizer-immediate.test.mjs` | **создать** |

### Поведение

| Тип события | Скрин |
|-------------|-------|
| `click` на button/link/role=button | **immediate** |
| `submit`, `menu_select` | immediate |
| `navigation` | deferred (стабилизатор как сейчас) |
| `modal_open` | **не** инициирует скрин само по себе |
| `input`, `focus` | **не** инициируют скрин |

**Triplet:** убрать из default path для click. Оставить `candidates: []` или один optional кадр +50 ms — только если immediate blob null.

**`confidence`:** для immediate click — `"high"`, если кадр получен; `"low"` только при ошибке offscreen.

**Timestamp скрина:** `ts` = время клика (не время finishCandidate).

### Тест приёмки

1. Mock: click → `onCapture` вызывается **без** ожидания QUIET_WINDOW.
2. navigation → по-прежнему ждёт stabilizer (mock tick).
3. modal_open → **не** вызывает onCapture.
4. `screenshot.eventId` === id click-события.

---

## T-CLK-4 — Materialize `clickPoint` на захвате; убрать опасный refresh

**Зависит от:** T-CLK-1, T-CLK-3.

### Цель

На границе захвата перевести **точку клика** в пиксели скрина. **Не** пересчитывать bbox через `querySelector` для pointer-событий.

### Файлы

| Файл | Действие |
|------|----------|
| `extension/content/dom-context.js` | `buildScreenshotMeta`: `materializedClickPoint` |
| `extension/content/content.js` | отключить `refreshEventBBox` для click/submit/menu_select |
| `shared/annotation-geometry.mjs` | helper `viewportPointToScreenshot(point, screenshot)` |
| `tests/content-capture-context.test.mjs` | кейсы clickPoint @ DPR=2 |

### Поведение

```
buildCaptureContext()  // в момент кадра, сразу после click
viewportPointToScreenshot(event.target.clickPoint, screenshot)
→ validate point in image bounds
→ screenshot.materializedClickPoint
```

- `refreshEventBBox` — **удалить вызов** для pointer events или no-op.
- `materializedBbox` — optional fallback, если clickPoint нет (старые записи).
- Приоритет аннотации: **clickPoint > bbox**.

### Тест приёмки

1. DPR=2: clickPoint viewport `(640, 360)` → screenshot pixel `(1280, 720)` ±1px.
2. После capture **не** вызывается `document.querySelector` (spy в jsdom).
3. `annotationConfidence: measured` при valid clickPoint.

---

## T-CLK-5 — Resolve аннотации и отрисовка «точка + стрелка»

**Зависит от:** T-CLK-4, T-ANN-2 (geometry engine).

### Цель

Редактор и export рисуют стрелку **в точку клика**, не в DOM-rect.

### Файлы

| Файл | Действие |
|------|----------|
| `shared/annotation-geometry.mjs` | `resolveDecorationLayoutForPoint(point, stepNumber, imageSize)` |
| `shared/annotation-utils.mjs` | `resolveStepAnnotation`: clickPoint path; упростить `pickAnnotationEvent` |
| `editor/src/ScreenshotAnnotator.tsx` | режим point (круг + стрелка) |
| `tests/annotation-click-point.test.mjs` | **создать** |

### Поведение `resolveStepAnnotation`

1. Если `existing` manual annotation → as-is.
2. Если `screenshot.materializedClickPoint` → bbox = квадрат 24×24 px вокруг точки (или только point layout).
3. `annotationMode: "clickPoint"`, `confidence: measured`.
4. Иначе fallback на текущий bbox-path (`inferred` + warning).

**`pickAnnotationEventForScreenshot`:**

- Только событие `screenshot.eventId` если это `click|submit|menu_select`.
- **Игнорировать** `modal_open` для pointer annotation.
- Не перебирать «первый click из списка LLM» — **якорь = eventId скрина**.

### Отрисовка

- Highlight: круг/квадрат ~24px вокруг точки (масштаб от `canvasWidth`).
- Badge + стрелка: как сейчас, `from` = badge, `to` = **click point**.
- Drag в редакторе: двигает точку, `confidence: manual`.

### Тест приёмки

1. Timeline с `materializedClickPoint` справа (x > 50% width) → display arrow **не** у левого края.
2. `modal_open` + click в eventIds → annotation берёт **click**, не dialog bbox.
3. Canvas parity: preview ≈ export для point mode.

---

## T-CLK-6 — Merge и LLM: шаг якорится на клик

**Зависит от:** T-CLK-3.

### Цель

Предварительные шаги и LLM-подсказки строятся вокруг **кликов**, а не вокруг шума (`focus`, `input`, `modal_open`).

### Файлы

| Файл | Действие |
|------|----------|
| `backend/services/merge.py` | якорь шага = nearest significant click к речи |
| `backend/prompts/generate_doc.md` | правила: один logical step ≈ один click; modal_open не в eventIds для pointer |
| `backend/services/screenshot_match.py` | приоритет скрина с `eventId` = click |
| `tests/backend/test_merge_click_anchor.py` | **создать** |
| `tests/backend/test_screenshot_match.py` | дополнить |

### Правила merge

- **Significant events:** `click`, `submit`, `menu_select`, `navigation`.
- **Non-anchor:** `focus`, `input`, `modal_open` — контекст, но не создают отдельный шаг сами.
- `preliminaryStep.eventIds` — **один primary click** + опционально речь; не склеивать 3 click в один шаг без явной речи.

### Правила промпта LLM

- Заголовок шага — по **тексту кнопки** primary click.
- `screenshotId` — скрин с тем же `eventId`, что primary click.
- Если в шаге несколько click — `needsReview: true` (временно, до semantic matcher).

### Тест приёмки

1. Mock timeline: речь + click «Закрыть короб» + modal_open → preliminary step с **click eventId**, screenshot привязан к click.
2. `match_step_screenshot` не выбирает скрин от `modal_open`, если есть скрин от click.

---

## T-CLK-7 — Regression: WMS-таблица и «кнопка vs чужая строка»

**Зависит от:** T-CLK-5, T-CLK-6.

### Цель

Закрепить главный пользовательский баг: одинаковые кнопки в строках таблицы.

### Файлы

| Файл | Действие |
|------|----------|
| `fixtures/timeline.wms-table-clicks.json` | **создать** — 2 click в разных строках, разные clickPoint |
| `fixtures/annotation-matrix.json` | кейс `wms-two-rows-click-point` |
| `tests/annotation-regression.test.mjs` | pipeline для WMS fixture |
| `tests/annotation-wms-table.test.mjs` | **создать** |

### Fixture сценарий

- Строка 1: click «Закрыть короб» — clickPoint слева-центр viewport.
- Строка 2: click «Открыть короб» — clickPoint справа viewport.
- Одинаковый `cssPath` **не** используется для materialize (только clickPoint).

### Assert

1. Аннотация шага 1 и шага 2 — **разные** `materializedClickPoint` (distance > 100 px).
2. Ни одна стрелка не at x < 5% width, если click был справа.
3. **Regression:** старый путь через `refreshEventBBox` + один cssPath → тест документирует, что **без clickPoint** было бы wrong (comment / skipped baseline).

---

## T-CLK-8 — Документация и UX редактора

**Зависит от:** T-CLK-5.

### Цель

Владелец понимает новую модель; в редакторе видно, что подсветка — «куда нажали».

### Файлы

| Файл | Действие |
|------|----------|
| `docs/CHROME_EXTENSION.md` | раздел «Клик = шаг»; таблица полей clickPoint |
| `editor/src/App.tsx` | tooltip/мелкий hint при `annotationMode: clickPoint` |
| `PLAN.md` | примечание: решение F смягчено для pointer events (ссылка на этот doc) |
| `TASKLOG.md` | запись после реализации |

### UX

- При `clickPoint` + `measured` — **без** жёлтой плашки.
- При fallback bbox `inferred` — плашка как сейчас.
- Подпись под превью (опционально): «Подсветка: точка нажатия».

### Тест приёмки

1. `shouldShowAnnotationWarning({ confidence: measured, annotationMode: clickPoint })` → false.
2. Документ содержит явное правило: модалка = следующий шаг.

---

## 6. Сводная таблица задач

| ID | Название | ≈ файлов | Блокирует |
|----|----------|----------|-----------|
| T-CLK-1 | Контракт clickPoint | 4 | всё |
| T-CLK-2 | Запись клика | 4 | T-CLK-3… |
| T-CLK-3 | Immediate capture | 5 | T-CLK-4, T-CLK-6 |
| T-CLK-4 | Materialize point, no refresh | 4 | T-CLK-5 |
| T-CLK-5 | Resolve + render point | 4–5 | T-CLK-7, T-CLK-8 |
| T-CLK-6 | Merge + LLM anchor | 4 | T-CLK-7 |
| T-CLK-7 | WMS regression | 4 | — |
| T-CLK-8 | Docs + UX | 4 | — |

**Оценка:** 8 вертикальных слайсов, каждый с зелёными тестами.

---

## 7. Ручная приёмка (после всего эпика)

1. ↻ расширение в Chrome.
2. Запись на WMS: «Закрыть короб» → «Открыть короб» в **разных** строках.
3. В редакторе:
   - текст шага совпадает с названием кнопки;
   - стрелка **на той** кнопке, на которую нажимали;
   - скрин **до** модалки на шаге открытия (кнопка видна).
4. Скачать PNG — стрелка совпадает с превью.
5. `make check` — зелёный.

---

## 8. Definition of Done (весь эпик T-CLK)

1. `make check` зелёный.
2. Новая запись: pointer-шаги используют **clickPoint**, не DOM refresh.
3. Скрин click-шага снимается **без** ожидания QUIET_WINDOW.
4. `modal_open` не подменяет target стрелки.
5. Старые записи без `clickPoint` — работают через bbox fallback + warning.
6. TASKLOG обновлён.

---

## 9. Риски и mitigations

| Риск | Mitigation |
|------|------------|
| Loader перекрывает экран в момент клика | immediate + `confidence: low`; stabilizer только для navigation |
| Клик → мгновенный full-page navigation | deferred capture для `navigation`; click на `<a href>` — immediate **до** unload если успели |
| Точка на краю кнопки | достаточно для UX; drag в редакторе |
| Старые JSON | backward compat, inference |
| Дублирование geometry в extension | один helper `viewportPointToScreenshot`, parity-тест с shared |

---

## 10. Handoff для Composer

**Начать с T-CLK-1.** Не объединять задачи.  
Эпик T-ANN **не откатывать** — он нужен для transform; меняем **источник координат и timing capture**.

После T-CLK-5 можно отдать владельцу **промежуточную** ручную проверку на WMS до merge/LLM (T-CLK-6).

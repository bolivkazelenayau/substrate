# Производительность: зум, инициализация SDF, halftone, маппинги

Дата: 2026-07-20 · Анализ: чтение исходников `src/` (~40 файлов, все ссылки `file:line` проверены по рабочему дереву).

> **Статус P0 (2026-07-20): реализовано.**
> - **P0-A (зум)**: production переведён на composited-гибрид — GPU-слой во время жеста (`translate3d` + `will-change` под `is-active-interaction`), crisp re-raster после 220 мс idle. `viewportNavigationInstrumentation.ts` (дефолт `"composited"`, getter без DEV-гейта), `CanvasNavigation.tsx`, `styles.css`. Escape-hatch: `__SUBSTRATE_NAV_COMPOSITING__.set("crisp")` в dev.
> - **P0-B (частично)**: статические рендереры при ≥500 элементов (`CANVAS_PREVIEW_ELEMENT_THRESHOLD`, `previewBackend.ts`) автоматически уходят в bitmap-превью через новый `CanvasStaticPreview` (батчинг по opacity, клип как у flow). Предпочтение «SVG Accuracy» и canvas-failure по-прежнему возвращают SVG DOM.
> - **P0 (контролы)**: коммиты контролов коалесцируются в rAF через draft-mirror в `FieldControls`; жесты-коммиты (change/click/dblclick/Enter/blur) флашат синхронно.
> Остальные пункты P1+ (wave field → worker, градиент-растр SDF, `contain`, halftone-градиент) открыты.

---

## TL;DR

1. **Зум лагает из-за растеризации, а не из-за React.** Зум — это CSS `transform: translate() scale()` на обёртке (`CanvasNavigation.tsx:225-227`). React-дерево превью при этом не перерендеривается (bailout на стабильном `children`). Но в production путь намертво зафиксирован на `"crisp"`: слой НЕ композитится, поэтому **каждый committed-кадр зума = полная перерисовка всего SVG-поддерева** браузером.
2. **Стоимость этой перерисовки пропорциональна числу SVG-нод**, а статические рендереры (halftone — до 3000–4300 `<circle>`) рисуются только через SVG DOM: автоматический `canvas-2d` бэкенд захардкожен на `renderer === "flow"` (`previewBackend.ts:41`), параметр `_elementCount` игнорируется.
3. **SDF сам по себе дешёвый** (chamfer 2-pass, O(n)), а вот то, что происходит **после** него на главном потоке, — нет: `buildCompositeWaveField` делает полный проход по растру с `Math.sin` на ячейку × на эмиттера (`compositeWaveField.ts:191-219`). Это главный фриз после каждой пересборки субстрата.
4. **Halftone тратит ~4 билинейных сэмпла SDF на кандидата ради boolean-проверки** (`sdfHalftoneRenderer.ts:153,175`) и до 8–12 сэмплов на кандидата при включённом displacement.
5. Есть подозрение на **устаревание `glyphField` при правке только эмиттера** (параметры эмиттера не входят ни в один ключ до `createStaticRenderContext`) — см. «Побочные находки».

---

## 1. Что мешает зуму без лагов

### Цепочка кадра зума (как устроено сейчас)

```
wheel → zoomFromWheel (математика, дёшево)
      → pendingViewportRef + один rAF-коммит (коалесcинг есть, ок)
      → setViewport → ре-рендер ТОЛЬКО CanvasNavigation
      → style transform на .canvas-navigation-transform
      → браузер перерисовывает всё поддерево (crisp path)
```

Сама React-часть сделана правильно:
- коалесcing wheel-событий в один коммит на кадр (`CanvasNavigation.tsx:90-97`);
- `zoomAtPoint` возвращает тот же объект при клампе (`viewportNavigation.ts:32`);
- `Viewport` и тысячи SVG-нод под ним **не** ре-рендерятся: `children` — стабильная ссылка, React делает bailout.

**Бутылочное горлышко — браузерный paint, а не JS/React.**

### Причина 1.1 — Production залочен на repaint-path без композитинга

`CanvasNavigation.tsx:48`:
```ts
const composited = import.meta.env.DEV && getNavigationCompositingMode() === "composited";
```
В production это compile-time `false` → всегда `transform: translate(...) scale(...)` (2D). Обычный 2D-трансформ в Blink **не создаёт собственный композитный слой**: трансформ применяется во время растеризации, значит каждое изменение зума = повторная растеризация содержимого на новом масштабе. Это осознанное решение (комментарий `CanvasNavigation.tsx:218-224`, `styles.css:178-189`): режим `"composited"` даёт GPU-масштабирование текстуры, но с размытием до конца жеста.

Итог: **платишь полным paint'ом сцены за каждый шаг колёсика**. При 3k+ SVG-нод и DPR 2 это десятки миллисекунд на кадр → 20–40 fps и хуже.

### Причина 1.2 — Статические рендереры живут только в SVG DOM

`previewBackend.ts:41`:
```ts
if (renderer !== "flow" || preference === "svg-dom" || !canvasAvailable) return "svg-dom";
```
`canvas-2d` существует только для `flow`. Все SDF-рендереры (halftone, contours, streamlines, diffuser, wave) всегда идут в DOM: `Viewport.tsx:379` мапит каждую геометрию в отдельный элемент (`GeometryElement`). Пресеты halftone: `maxNodes` 3000–4300 (`presets.ts:138,165`). Диагностика честно пишет `SVG DEBUG / SLOW` при ≥500 элементах (`Viewport.tsx:635`) — но это только надпись, на поведение она не влияет.

Цена зума при этом = O(ноды × площадь × DPR²) на каждый кадр жеста.

### Причина 1.3 — Поверх марок растеризуются маска, ghost-слой и оверлей

При каждом repaint участвуют:
- `<g mask="url(#glyph-mask)">` (`Viewport.tsx:366`) — маска перерисовывается вместе с содержимым; у большинства рендереров `clipPreviewToText` включён;
- всегда видимый `ghost-text` — полный набор контуров глифов с `opacity: .18` (`Viewport.tsx:389-391`, `styles.css:236`);
- текстовый оверлей диффьюзера (`Viewport.tsx:382-388`), когда активен.

### Причина 1.4 — Нет изоляции paint

`.stage` / `.artboard` без `contain: layout paint` / `content-visibility` (`styles.css:211-236`). Браузер не может отсечь поддерево от остальной страницы при инвалидейте.

---

## 2. Особенности инициализации SDF

Пайплайн: `useSubstratePipeline` → дедуп по `inputKey` → **debounce 50 мс** (`useSubstrateBackend.ts:291`) → `LatestOnlyScheduler` (latest-only, ок) → воркер (`OffscreenCanvas` растр → `getImageData` → edge map → SDF) → `postMessage` с **transferables** (три `Float32Array`, `substrate.worker.ts:84-89` — хорошо, без копирования).

### 2.1 Сам SDF дешёвый, но особенности есть

- `buildSignedDistanceField` — двухпроходный chamfer 3×3 (`distanceField.ts:21-42`), O(n). При medium 384×230 (~88k ячеек) это единицы миллисекунд. ОК.
- **Приближённая метрика**: chamfer ≠ евклидова DT (ошибка растёт с расстоянием), плюс мировой масштаб — среднее арифметическое осей: `(worldScaleX + worldScaleY) / 2` (`distanceField.ts:45`). На анизотропных доменах (overscan крупного кегля, `contourDomain.ts:88-103`) расстояния искажаются. Это качество, не скорость — но «лечить качество повышением разрешения» перемножает все downstream-расходы.
- `emptySubstrate` (путь ошибки) всё равно строит SDF и три прохода по массиву (`buildSubstrate.ts:32-40`) — мёртвая работа на упавшем билде.
- `buildEdgeMap` — O(n·9) с ветвлениями на соседа (`edgeMap.ts:11-24`); можно упростить до 4-связности + границы, но вклад мал.
- `rasterizeGlyphs` создаёт новый `OffscreenCanvas` на билд и делает `getImageData` (readback) + пиксельный цикл RGBA→Float32 (`rasterizeGlyphs.ts:70-74`). На этих разрешениях терпимо.

### 2.2 Главный фриз — не SDF, а wave field на главном потоке

После прихода субстрата `createStaticRenderContext` синхронно строит `buildCompositeWaveField` (`renderContextLifecycle.ts:54`):
- полный проход по растру (`compositeWaveField.ts:191-219`): `Math.sin` + `Math.hypot` на ячейку **на каждого эмиттера** при blend `add`/`max`;
- ultra 768×460 ≈ 353k ячеек × N эмиттеров → **10–80 мс блокировки main thread** при каждой пересборке субстрата (смена кегля, текста, quality, amplitude — `amplitude` входит в `substrateProjectSliceKey`, `pipelineStageKeys.ts:81`, через `contourDomain.ts:83`).

Именно этот спайк ощущается как «подлагивание после изменений», и он же блокирует начало зум-жеста, если совпал по времени.

### 2.3 Fallback `cpu-main`

При недоступном воркера субстрат строится на главном потоке (`cpuMainBackend.ts`); предупреждение для ultra уже есть (`performance.ts:34`). Это блокирующий путь: полный растр+SDF+перенос — всё в кадре.

### 2.4 Что в SDF-пайплайне уже хорошо

- семантическая дедупликация по ключу (не по ссылке) — `useSubstrateBackend.ts:134`;
- latest-only коалесcing с supersede — `latestOnlyScheduler.ts`;
- transferables вместо structured clone результатов;
- `planSubstrateRaster` — детерминированные потолки (`safetyBudget.ts:22-27`).

---

## 3. Halftone: горячие точки генерации

`sdfHalftoneRenderer.ts`, на кандидата (сетка до ~5k+ кандидатов при density 62 / spacing ≈ 12.6, пресет `Halftone Press`):

| Строка | Что | Стоимость | Комментарий |
|---|---|---|---|
| `:120-121` | `sampleMask` + `sampleDistance` (+ повтор при промахе `:126-127`) | 2–4 билинейных | ок |
| `:142` | при displacement — до 4 доп. сэмплов | 0–4 билинейных | ок по флагу |
| `:152` | `sampleEdge` | 1 билинейный | ок |
| **`:153`** | `sampleDistanceGradient` = **4 `sampleDistance`** (`sampling.ts:43-44`) | **4 билинейных** | результат используется только в `:175` как `Number.isFinite(gradient.magnitude) ? 1 : 0.85` — **четыре сэмпла ради boolean** |
| `:179-180` | `worldToLocal(...)` дважды | аллокация `{x,y}` на кандидата | GC-шум |
| `:182-192` | occupancy: 9 `Map.get` + `Math.hypot` по соседям | ок (уже числовые ключи после quick win #6) | — |

Итого до **8–12 билинейных сэмплов на кандидата**. Сам билинейный (`sampling.ts:3-15`) — clamp/floor/4 чтения/лерп, плюс `worldToRaster` (`:17-23`) с аллокацией `{x,y}` и повторным чтением `domainBounds` на каждый вызов.

Результат генерации — до 3000–4300 `<circle>` в DOM → это уже не проблема генерации, а проблема зума (раздел 1).

---

## 4. Маппинги

- **world↔raster** (`sampling.ts`): на каждый сэмпл заново вычисляется домен и создаётся промежуточный объект. Константы домена (origin, scale) не выносятся в замыкание на один `generateGeometry`. Дёшево поодиночке, ощутимо ×50k вызовов.
- **Аспект растра** (`useSubstratePipeline.ts:33-36`): высота растра считается от **ширины** базового разрешения через аспект effective-артуборда — корректно, но означает, что разрешение субстрата зависит от сцены, а не от зума (зум вообще не трогает субстрат — это правильно и важно зафиксировать как инвариант).
- **Occupancy/stitch-мапы**: строковые ключи уже заменены на числовые (PERFORMANCE_QUICK_WINS #5/#6) — здесь всё ок.
- **Ключи кэша геометрии**: `rendererGeometryCacheKey` — packed string, ок. Но `rendererGeometryStateKey` делает `JSON.stringify` почти всего `ProjectState` (`rendererRuntime.ts:85`) **на каждый рендер App** (`useRendererRuntime.ts:21`, `CanvasFlowPreview.tsx:54`) — мусорная работа при каждом коммите, включая кадры анимации.
- **Marching squares** (contours) — O(cells × levels) на главном потоке, крышка `contourCellLevelVisits` = 10M (`safetyBudget.ts:54`). При ultra это сам по себе заметный кадр.

---

## 5. Побочные находки (не перф, но рядом)

1. **Подозрение на stale `glyphField`.** Параметры эмиттера (`state.emitter.*`, `state.emitters`) не входят ни в `typographyInputKey` (`exportAuthority.ts:76-90`), ни в `sceneKey` (`sceneLayout.ts:298-305`), ни в `substrateBuildInputKey` (`exportAuthority.ts:100-116`), ни в `staticContextInputKey` (`pipelineStageKeys.ts:100-108`). Мемо `staticRenderContext` зависит только от этих ключей (`App.tsx:236-251`) → при правке **только** эмиттера поле не перестраивается, а рендереры берут `context.glyphField ?? build...` (`glyphFieldModulation.ts:22`) — т.е. старое поле. Геометрия при этом регенерирует (`emitterGeometryKey` в `rendererGeometryCacheKey`). Стоит проверить тестом: изменить `emitter.frequency`, не трогая ничего else.
2. `selectPreviewBackend` принимает `_elementCount` и игнорирует его (`previewBackend.ts:37-41`) — задел для авто-переключения на canvas при тяжёлых сценах уже заложен в сигнатуру.
3. Вся WebGPU-инфраструктура (`src/engine/gpu/*`) — dev-only; в проде не используется.

---

## 6. Рекомендации (по приоритету)

### P0 — Зум: убрать repaint-per-frame

**Вариант A (минимальный, 1–2 дня): production-гибрид crisp/composited.**
Механика уже есть: во время жеста включать композитинг (`translate3d` + `will-change`), по таймауту `ACTIVE_INTERACTION_IDLE_MS` (уже 220 мс, `CanvasNavigation.tsx:29`) снимать → один финальный crisp-repaint. Размытие только в полёте, чёткость после остановки. Сейчас это dev-only; нужно вынести из-под `import.meta.env.DEV` (`CanvasNavigation.tsx:48`, `styles.css:190-191`) и включить по умолчанию.

**Вариант B (правильный, 3–5 дней): bitmap-превью для статических рендереров.**
Рисовать сгенерированную геометрию в `<canvas>` один раз на `geometry.id` (обобщить `CanvasFlowPreview` на статические марки: круги — это `arc`+`fill`, батчинг по opacity). Зум = масштабирование битмапы композитором (GPU, стоимость не зависит от числа марок). После settle жеста — один перерендер с `dpr × zoom` для чёткости. SVG остаётся экспортным форматом — превью уже давно «preview only» (`previewBackend.ts:12-27`).

**В любом варианте:** задействовать `_elementCount` в `selectPreviewBackend` — авто-fallback на canvas при превышении бюджета (порог ~500 нод уже «зашит» в диагностику).

### P1 — Убрать главный пост-SDF спайк

- Перенести `buildCompositeWaveField` в substrate-воркер (ему нужны только substrate + срез state): результат — ещё один transferable `Float32Array`. Снимает 10–80 мс с main thread на каждую пересборку. Заодно починит/прояснит находку 5.1 (ключ поля = emitter key + substrate key).
- Halftone: заменить `sampleDistanceGradient` на один `sampleDistance` + `Number.isFinite` (`sdfHalftoneRenderer.ts:153,175`). Экономия ~4 билинейных × ~3–5k кандидатов на регенерацию. Сначала проверить визуальную паритетность на пресетах.

### P1 — Изоляция и состав сцены

- `contain: layout paint` на `.stage` (и/или `content-visibility: auto` на диагностических блоках) — локализация инвалидейтов (`styles.css:211+`).
- Дать пользователю/дефолту выключатель `ghost-text` при >N марок — это лишний полный комплект контуров в каждом repaint.

### P2 — Микрооптимизации сэмплинга (общая правка `sampling.ts`)

- Хоистить `domain/scale` в фабрику сэмплеров на один `generateGeometry`; убрать аллокации `{x,y}` из `worldToRaster`/`worldToLocal`.
- Объединить `sampleMask`+`sampleDistance` в один проход с общими floor/clamp (экономия ~40% математики координат).

### P2 — Ключи и мелочи

- Мемоизировать `rendererGeometryStateKey` по ссылке на state (`useMemo`/WeakMap) — убрать `JSON.stringify` с каждого рендера.
- `emptySubstrate`: ранний выход с нулевым `distance` без `buildSignedDistanceField` (`buildSubstrate.ts:34`).
- SDF-качество при необходимости: точный EDT (Felzenszwalb–Huttenlocher) — тот же O(n), убирает и chamfer-ошибку, и усреднение осей (`distanceField.ts:45`).

### P3 — Структурное

- Пачкать одно-опасити круги halftone в один `<path>` (arc-команды) для SVG-пути: резко меньше DOM/display items. Риск: расхождение preview/export — только после варианта B или с отдельным экспортным сериализатором.
- Рассмотреть вывод WebGPU-поля из dev-only в opt-in preview.

---

## 7. Чем мерить (уже есть в репо)

- `__SUBSTRATE_NAV_PERF__.snapshot()` — счётчики навигации (dev), `viewportNavigationInstrumentation.ts:150-163`. **Важно:** они не меряют paint — для зума основной инструмент: DevTools → Performance → Paint/Composite, либо `chrome://tracing` с категорией `blink`.
- `PreviewPerformanceMeter` (dev) + `interactionTrace` — спаны `substrate.compute`, `field.static-context`, `renderer.build` покажут спайки 2.2.
- Диагностика субстрата в HUD: `RASTER/EDGE/SDF/BUILD ms` (`Viewport.tsx:460-463`) — быстрый индикатор регрессий.

## 8. Проверочный план после правок

1. Пресет `Halftone Press` (density 62, maxNodes 3000): зум колесом 0.25×→8× — целевой бюджет: кадр зума ≤ 4 мс (композитинг) вместо полного repaint.
2. Смена `substrateQuality` low→ultra: отсутствие main-thread спайков > 16 мс от `field.static-context`.
3. `npm test`, `npm run typecheck`, `npm run test:e2e` — паритет геометрии (детерминизм seeded random в halftone не трогаем).

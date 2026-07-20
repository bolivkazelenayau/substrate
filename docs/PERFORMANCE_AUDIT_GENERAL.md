# Общий аудит производительности SUBSTRATE

Дата: 2026-07-20 · Версия: `0.20.1` · Метод: чтение исходников `src/` (~60 файлов, ссылки `file:line` по рабочему дереву), прод-сборка для замера бандла. Код не изменялся.
Связанный документ: `docs/ZOOM_SDF_HALFTONE_PERFORMANCE.md` (детальный разбор зума, SDF-инициализации и halftone — здесь не дублируется).

---

## 1. Резюме

Кодовая база уже прошла несколько волн оптимизации (worker's transferables, latest-only scheduler, packed cache keys, числовые occupancy-ключи, bucketed FlowPreview). Архитектура ключей идентичности хорошая. Оставшиеся проблемы сосредоточены в четырёх местах:

| # | Находка | Степень | Где ощущается |
|---|---|---|---|
| 1 | Зум = полный repaint SVG-поддерева на кадр (прод залочен на «crisp») | **Критично** | зум/пан на сценах >500 нод |
| 2 | Статические рендереры живут только в SVG DOM (canvas-2d только для flow) | **Критично** | зум + правки слайдеров на halftone/contours/diffuser |
| 3 | `buildCompositeWaveField` на главном потоке: O(cells × emitters), `Math.sin` на ячейку | **Высокая** | фриз 10–80 мс после каждой пересборки субстрата |
| 4 | Избыточные SDF-сэмплы в горячих циклах (градиент через 4 билинейных, повторные full-scan marching squares) | **Высокая** | лаг при правках параметров на SDF-рендерерах |
| 5 | Контролы коммитят state на каждый `input`-event без rAF-коалесcинга | **Средняя** | драг слайдеров → несколько полных прогонов пайплайна на кадр |
| 6 | Покадровые аллокации геометрии flow (~100k объектов/сек) + строки плана путей | **Средняя** | steady-state анимация, GC-паузы |
| 7 | `traceEvent({...})` аллоцирует объект аргумента даже в проде (no-op внутри) | **Низкая** | GC-шум на кадрах и коммитах |
| 8 | Diffuser: filter+sort всего пула кандидатов на каждого эмиттера | **Средняя** | правки на glyph-diffuser с multi-emitter |
| 9 | Бандл 450 KB (137 KB gzip) — приемлемо; opentype ленивый (243 KB отдельным чанком) | **ОК** | стартап |
| 10 | Автостарт анимации (`playing=true`, flow) — фоновая нагрузка 30 fps с загрузки | **Низкая** | батарея/CPU в простое |

---

## 2. Анатомия стоимости по сценариям

### 2.1 Зум/пан (колесо, space+drag)

```
wheel → zoomFromWheel → pendingViewportRef → rAF commit → setViewport
      → style transform на .canvas-navigation-transform
      → браузер: repaint всего SVG-поддерева (crisp path, prod)
```

- React здесь **не** бутылочное горлышко (children bailout работает, см. `CanvasNavigation.tsx`).
- Узкое место — raster ∝ (ноды × площадь × DPR²). Подробности и решения — в `ZOOM_SDF_HALFTONE_PERFORMANCE.md` §1, §6 (P0-A гибрид composited/crisp, P0-B bitmap-превью).

### 2.2 Драг слайдера параметров (density, turbulence, ...)

```
input event → patchField → новый ProjectState → ре-рендер App
  → JSON.stringify-ключи (5+ штук, см. 4.1)
  → useMemo цепочка: scene/substrate/typography по ключам (дешёво при неизменных ключах)
  → generateRendererGeometry (cache miss на новое значение) — ОСНОВНАЯ ЦЕНА
  → React commit: реконсиляция до ~4k SVG-элементов
```

- **`input` события range-контролов не коалесцируются** (`FieldControls.tsx:168`, `Range onChange` `:216-232`). На указательных событиях с частотой выше кадровой пайплайн прогоняется несколько раз за кадр. Для fontSize такая машинерия есть (rAF draft в `useSizeInteraction`), для остальных контролов — нет.
- Каждый тик = полный прогон рендерера (halftone: ~5k кандидатов × ~10 билинейных сэмплов) + реконсиляция DOM. Именно это, а не ключи, определяет отзывчивость.

### 2.3 Анимация (flow, steady state)

```
rAF (30 fps cap) → setContext в useAnimationClock → ре-рендер App
  → generateRendererGeometry(flow): НОВЫЙ массив ~1564 line-объектов/кадр
    (flowLinesRenderer.ts:53-67; ~100k объектов {start,end}/сек → постоянный GC)
  → FlowPreview: buildFlowPathPlan → новые d-строки на бакет → ≤48 setAttribute
```

- Путь уже хорошо оптимизирован на DOM-стороне (bucketed paths, `flowPreviewOptimization.ts`).
- Оставшаяся цена — **аллокации**: геометрия пересоздаётся каждый кадр (`rendererRuntime.ts:160-165`, для `usesTime` без кэша), плюс строки `d` на кадр.
- Дефолтный пресет — flow + `playing=true` (`presets.ts:61`, `App.tsx:92`): нагрузка идёт сразу после загрузки. Уважает `prefers-reduced-motion` (`usePreviewSettings.ts:9`) — ок.

### 2.4 Ввод текста / смена кегля

```
keystroke → state → typography rebuild (layoutGlyphs, кэш по ключу)
  → substrate input key меняется → debounce 50 мс → worker build (transferables)
  → createStaticRenderContext → buildCompositeWaveField НА MAIN THREAD ← фриз
  → geometry regen → DOM commit
```

Главный провал — шаг поля (см. 4.4). Сам субстрат: 5–15 мс в воркере, ок.

---

## 3. Бандл и стартап

Замерено (`npm run build`, vite 6.4.3):

| Чанк | Размер | gzip | Комментарий |
|---|---|---|---|
| `index-*.js` | 450 KB | 137 KB | React 19 + приложение |
| `opentypeFontEngine-*.js` | 243 KB | 68 KB | **ленивый** чанк, грузится при загрузке шрифта — правильно |
| `substrate.worker-*.js` | 7.4 KB | — | воркер субстрата |
| `index-*.css` | 16.8 KB | 4 KB | — |

- Dev-код (WebGPU overlay, perf meter, trace) отсечён через `import.meta.env.DEV` и tree-shaken — проверено по гейтам (`App.tsx:56-61`, `interactionTrace.ts:233`).
- Мелочь: `@types/opentype.js` лежит в `dependencies` (`package.json:29`) — перенести в devDependencies.
- Стартап: для flow субстрат не требуется (`resolveRendererRequirements`), пайплайн корректно встаёт в `not-required` (`useSubstrateBackend.ts:114-130`). Лишней работы на старте нет.

---

## 4. Находки по зонам

### 4.1 React commit path

1. **Нет rAF-коалесcинга на контролах.** `patchField` (`FieldControls.tsx:101`) коммитит state на каждый `input`. → Обёртка commit'ов в rAF (или `useDeferredValue` для тяжёлых derived) даст ≤1 полный прогон пайплайна на кадр без изменения семантики.
2. **Ключи-через-JSON на каждый рендер:** `sceneLayoutStageKey` (`useSceneLayout.ts:31`), `substrateProjectSliceKey` (`useSubstratePipeline.ts:21`), `typographyInputKey` (`App.tsx:125`), `rendererGeometryStateKey` (`useRendererRuntime.ts:21`, `CanvasFlowPreview.tsx:54`) — каждый = `JSON.stringify` (`exportAuthority.ts:49`). Поодиночке микросекунды; в сумме на каждом коммите + GC-мусор. Мемоизация по ссылке на state снимает полностью.
3. **Реконсиляция Viewport:** `GeometryElement` не мемоизирован, на каждый новый массив геометрии React пересоздаёт vdom всех ~N элементов; для polyline ещё и `points.map().join(" ")` на рендер (`Viewport.tsx:659`). Смягчается тем, что регенерация происходит только на cache miss. Достаточно `React.memo(GeometryElement)` + предрасчёт `points`-строки в рендерере.
4. `<Profiler>` в проде инертен (стандартная сборка React) — не проблема, но и бесплатной телеметрии в проде нет.

### 4.2 Горячие циклы рендереров

Общий паттерн: `sampleDistanceGradient` = 4 билинейных сэмпла (`sampling.ts:43-44`), и он вызывается там, где достаточно 1–2.

| Рендерер | Проблема | Место | Цена |
|---|---|---|---|
| sdf-halftone | градиент ради boolean `isFinite` | `sdfHalftoneRenderer.ts:153,175` | 4 сэмпла × кандидат |
| sdf-flow | mask+distance+edge+gradient на кандидата | `sdfFlowRenderer.ts:63-66` | 7 сэмплов × до 14·target попыток |
| sdf-streamlines | градиент на **каждый шаг интегрирования** | `sdfStreamlinesRenderer.ts:73` | 4 сэмпла × ≤48 шагов × 2 × seeds |
| sdf-contours | `displaceFragment`: градиент+mask на точку; плюс glyph-ветка ещё 2 градиента | `sdfContoursRenderer.ts:192-204,272-290` | 5–9 сэмплов × точки контура |
| sdf-contours / wave-contours | `extractSegments` полностью сканирует растр **на каждый уровень** | `sdfContoursRenderer.ts:267-268`, `waveContoursRenderer.ts:183-184` | O(cells × levels) полных проходов |
| glyph-diffuser | nearest-domain `Math.hypot` × E на кандидата; затем `filter+sort` всего пула на каждого эмиттера и, возможно, повторный глобальный sort | `glyphDiffuserRenderer.ts:162-176,252-261` | O(P·E + P log P) на десятках тысяч кандидатов |

**Ключевая рекомендация (одна правка закрывает половину таблицы):** считать **предрассчитанный растр градиента SDF** (gx, gy, magnitude — 2–3 канала Float32Array) один раз на субстрат (в воркере, рядом с distance). Тогда `sampleDistanceGradient` = 1 билинейный ×2 канала вместо 4 полных. Экономия: halftone −4 сэмпла/кандидат, streamlines −3/шаг, contours −4/точку, sdf-flow −4/попытку.
**Вторая:** marching squares — слить уровни в один проход по растру (для ячейки вычислять пересечения всех уровней сразу). O(cells×levels) → O(cells + crossings).
**Diffuser:** один глобальный sort по priority с тегом эмиттера + проход с per-emitter квотами вместо filter/sort на эмиттера.

### 4.3 Поле (`buildCompositeWaveField`)

- Main-thread, O(cells × emitters), `Math.sin`+`Math.hypot` на ячейку (`compositeWaveField.ts:191-219`): ultra ≈ 353k ячеек → **10–80 мс блок** после каждой пересборки субстрата. → В воркер (transferable Float32Array), ключ = emitter key + substrate key. См. также `ZOOM_SDF_HALFTONE_PERFORMANCE.md` §5.1 — подозрение на stale поле при правке только эмиттера (не входит ни в один ключ до `createStaticRenderContext`).

### 4.4 Субстрат-пайплайн (дополнение к прошлому отчёту)

- `buildEdgeMap` — O(n·9) с ветвлением на соседа (`edgeMap.ts:11-24`): можно 4-связность без потери семантики края для chamfer — мелкий выигрыш.
- `emptySubstrate` строит SDF на пустых данных (`buildSubstrate.ts:34`) — ранний выход.
- Хорошее (не трогать): debounce 50 мс + latest-only + transferables + `planSubstrateRaster` крышки.

### 4.5 Трейс/диагностика в проде

`interactionTraceEnabled` = false в проде, и тела no-op. **Но** объектные литералы аргументов `traceEvent({...})` / замыкания `traceStartSpan(...)` создаются на каждом вызове — минификатор это не вырезает (нет `@__PURE__`). Горячие места: `CanvasFlowPreview.draw` — span + 2 события **на кадр** (`CanvasFlowPreview.tsx:125-177`); `useSizeInteraction.emitDraftFrame` — 2 события на rAF (`useSizeInteraction.ts:76-93`); navigation commit. → Гейтить вызовы `if (interactionTraceEnabled)` в горячих путях или пометить чистыми. Низкий приоритет, но бесплатный.

### 4.6 Память и кэши

- `geometryCache` (24) + `baseCache` flow (12) — ограничены, ок (`rendererRuntime.ts:13`, `flowLinesRenderer.ts:19`).
- Flow: покадровые объекты геометрии (см. 2.3) — основной источник GC в steady state. Вариант: пулить line-объекты (переиспользование массива при неизменном count) или генерить в плоские typed arrays до сериализации.
- Старые субстраты (3 × Float32Array до ~1.4 MB на ultra) отпускаются при замене — утечек не видно.

### 4.7 Экспорт

On-demand, за гейтом readiness; сериализация — конкатенация строк (`exportSvg.ts:20-35`), `DOMParser`-валидация на экспорт (`svgValidation.ts:28`). Диагностика стоимости — debounce 200 мс и только при включённом `debug.costEstimate` (`App.tsx:401-412`). Узких мест нет.

### 4.8 Типографика

`layoutGlyphs` по ключу типографики, `toPathData(precision)` на глиф, `getKerningValue` на пару (`glyphLayout.ts:57-61`). Оптический спейсинг — bbox на пару, ок. Узких мест нет.

---

## 5. Дорожная карта

**P0 (дни, эффект — убрать жалобы «редактор лагает»)**
1. Зум: production-гибрид composited/crisp (см. `ZOOM_SDF_HALFTONE_PERFORMANCE.md` P0-A).
2. Задействовать `_elementCount` в `selectPreviewBackend` (`previewBackend.ts:37-41`): авто-canvas при >500 нод.
3. rAF-коалесcинг коммитов контролов (4.1.1).

**P1 (неделя, эффект — отзывчивость правок)**
4. `buildCompositeWaveField` → воркер (4.3).
5. Предрасчитанный градиент-растр SDF + переход всех `sampleDistanceGradient` на него (4.2).
6. Halftone: убрать градиент-ради-boolean (см. прошлый отчёт P1).
7. `contain: layout paint` на `.stage` (см. прошлый отчёт P1).

**P2 (по возможности)**
8. Marching squares: один проход на все уровни (4.2).
9. Diffuser: один глобальный sort + квоты (4.2).
10. Мемоизация JSON-ключей по ссылке на state (4.1.2); `React.memo(GeometryElement)` + предрасчёт polyline points (4.1.3).
11. Гейтинг trace-вызовов в горячих путях (4.5).

**P3 (структурное)**
12. Пулинг геометрии flow / typed arrays (4.6).
13. Bitmap-превью статических рендереров (см. прошлый отчёт P0-B) — снимает класс проблем SVG DOM.
14. `@types/opentype.js` → devDependencies.

---

## 6. Чем мерить

- DevTools Performance: paint/composite для зума; JS self-time для `renderer.build`, `field.static-context` (спаны уже размечены trace-событиями).
- `__SUBSTRATE_NAV_PERF__.snapshot()` (dev) — счётчики навигации.
- HUD-диагностика субстрата/рендерера (GEN/SUB/FIELD BUILD ms) — быстрый индикатор регрессий при правках 4.2/4.3.
- `npm run build` — контроль бандла; `npm run analyze` — визуализатор чанков.
- После P0/P1: пресеты `Halftone Press`, `Topographic Type`, `Edge Current` — целевые: кадр зума ≤4 мс, правка слайдера без >16 мс main-thread блоков, steady flow без роста GC.

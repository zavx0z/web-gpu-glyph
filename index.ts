import { TrueTypeFont } from "./TrueTypeFont"

// -------------------- WebGPU init --------------------
const adapter = await navigator.gpu.requestAdapter()
if (!adapter) throw new Error("WebGPU адаптер не найден")
const device = await adapter.requestDevice()

const format = navigator.gpu.getPreferredCanvasFormat()
const canvas = document.getElementById("canvas") as HTMLCanvasElement
const context = canvas.getContext("webgpu")
if (!context) throw new Error("WebGPU не поддерживается")
context.configure({ device, format })

// -------------------- КОНФИГУРАЦИЯ ОТРИСОВКИ --------------------

/**
 * Размер шрифта в пикселях
 * @remarks
 * - Определяет базовый масштаб для всех глифов
 * - Влияет на преобразование из font-units в пиксели
 * - Чем больше значение, тем крупнее будет текст
 * 
 * @defaultValue 96
 */
const FONT_SIZE_PX = 96

/**
 * Межбуквенный интервал в пикселях
 * @remarks
 * - Добавляется к advance каждого глифа
 * - Положительное значение увеличивает пробелы между буквами
 * - Отрицательное значение сближает буквы (керинг)
 * 
 * @defaultValue 6
 */
const LETTER_SPACING_PX = 6

/**
 * Межстрочный интервал в пикселях
 * @remarks
 * - Определяет расстояние между строками текста
 * - Рассчитывается как `FONT_SIZE_PX * LINE_HEIGHT_MULTIPLIER`
 * - Значение по умолчанию соответствует стандартному line-height 1.35
 * 
 * @defaultValue Math.round(FONT_SIZE_PX * 1.35)
 */
const LINE_GAP_PX = Math.round(FONT_SIZE_PX * 1.35)

/**
 * Начальная позиция отрисовки по оси X в пикселях
 * @remarks
 * - Координата отсчитывается от левого края canvas
 * - Влияет на отступ текста от края
 * - Можно использовать для создания полей
 * 
 * @defaultValue 60
 */
const START_X = 60

/**
 * Начальная позиция отрисовки по оси Y в пикселях
 * @remarks
 * - Координата отсчитывается от верхнего края canvas
 * - Учитывает ascent шрифта для правильного позиционирования
 * - Может потребовать коррекции для разных шрифтов
 * 
 * @defaultValue 160
 */
const START_Y = 160

/**
 * Текст для отображения, разбитый по строкам
 * @remarks
 * - Каждый элемент массива — отдельная строка
 * - Поддерживает Unicode символы
 * - Можно добавлять тестовые наборы символов
 * 
 * @defaultValue [
 *   "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
 *   "abcdefghijklmnopqrstuvwxyz",
 *   "0123456789",
 *   "!@#$%^&*()_+-=[]{}|;:,.<>?",
 *   "`~'\"\\/©®™°±×÷",
 *   "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ",
 *   "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
 * ]
 */
const TEXT_LINES = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "!@#$%^&*()_+-=[]{}|;:,.<>?",
  "`~'\"\\/©®™°±×÷",
  "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ",
  "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
]

// -------------------- КОНФИГУРАЦИЯ АДАПТИВНОЙ СУБДИВИЗИИ --------------------

/**
 * Допустимая ошибка аппроксимации в font-units
 * @remarks
 * - Контролирует точность аппроксимации кривых Безье
 * - Меньшие значения → более гладкие кривыe → больше вершин
 * - Большие значения → менее гладкие кривыe → меньше вершин
 * - Рекомендуемые значения:
 *   - 0.25: максимальная точность, для больших размеров
 *   - 0.75: оптимально для wireframe рендеринга
 *   - 1.5+: грубая аппроксимация, визуально заметны углы
 * 
 * @defaultValue 0.75
 */
const ADAPTIVE_TOLERANCE_FU = 0.75

/**
 * Максимальная глубина рекурсии для адаптивной субдивизии
 * @remarks
 * - Защита от бесконечной рекурсии для вырожденных кривых
 * - Ограничивает максимальное количество сегментов на кривой
 * - Каждый уровень удваивает количество сегментов
 * - Значение 12 соответствует максимум 4096 сегментов на кривой
 * 
 * @defaultValue 12
 */
const MAX_SUBDIVISION_DEPTH = 12

// -------------------- Геометрические утилиты --------------------

type Point = { x: number; y: number; on: boolean }

/**
 * Расстояние от точки до отрезка
 * @param px - X координата точки
 * @param py - Y координата точки
 * @param x0 - X координата начала отрезка
 * @param y0 - Y координата начала отрезка
 * @param x1 - X координата конца отрезка
 * @param y1 - Y координата конца отрезка
 * @returns Расстояние от точки до ближайшей точки на отрезке
 * @remarks
 * Используется для вычисления ошибки аппроксимации кривой отрезком
 */
function pointLineDistance(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x0, py - y0)
  
  const t = ((px - x0) * dx + (py - y0) * dy) / len2
  const projx = x0 + t * dx
  const projy = y0 + t * dy
  return Math.hypot(px - projx, py - projy)
}

/**
 * Делит квадратичную Безье пополам (de Casteljau)
 * @param p0 - Начальная точка кривой
 * @param p1 - Контрольная точка кривой
 * @param p2 - Конечная точка кривой
 * @returns Пять точек: [p0, p01, p012, p12, p12]
 * @remarks
 * - p01 - середина между p0 и p1
 * - p12 - середина между p1 и p2
 * - p012 - середина между p01 и p12 (точка на кривой при t=0.5)
 * - Левая половинка кривой: p0 → p01 → p012
 * - Правая половинка кривой: p012 → p12 → p2
 */
function splitQuad(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number]
): [[number, number], [number, number], [number, number], [number, number], [number, number]] {
  const p01: [number, number] = [(p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5]
  const p12: [number, number] = [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5]
  const p012: [number, number] = [(p01[0] + p12[0]) * 0.5, (p01[1] + p12[1]) * 0.5]

  return [p0, p01, p012, p12, p2]
}

/**
 * Адаптивная аппроксимация квадратичной Безье ломаной
 * @param p0 - Начальная точка кривой
 * @param p1 - Контрольная точка кривой
 * @param p2 - Конечная точка кривой
 * @param tolerance - Допустимая ошибка в font-units
 * @param out - Массив для записи вершин ломаной
 * @param depth - Текущая глубина рекурсии (внутренний параметр)
 * @remarks
 * Рекурсивно делит кривую до тех пор, пока линейная аппроксимация
 * не будет удовлетворять заданной точности. Использует стандартный
 * для TrueType критерий: расстояние контрольной точки до хорды.
 */
function quadBezierAdaptive(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  tolerance: number,
  out: number[],
  depth = 0
) {
  // защита от бесконечной рекурсии
  if (depth > MAX_SUBDIVISION_DEPTH) {
    out.push(p2[0], p2[1])
    return
  }

  // Ошибка аппроксимации = расстояние контрольной точки до хорды
  const err = pointLineDistance(p1[0], p1[1], p0[0], p0[1], p2[0], p2[1])

  if (err <= tolerance) {
    // достаточно одной линии
    out.push(p2[0], p2[1])
    return
  }

  // Делим кривую пополам
  const [a, b, c, d, e] = splitQuad(p0, p1, p2)

  // Рекурсивно обрабатываем левую и правую половины
  quadBezierAdaptive(a, b, c, tolerance, out, depth + 1)
  quadBezierAdaptive(c, d, e, tolerance, out, depth + 1)
}

// -------------------- Загрузка шрифта --------------------

const font = await TrueTypeFont.fromUrl("JetBrainsMono-Bold.ttf")

/**
 * Преобразует контур TTF глифа в полилинию с адаптивной аппроксимацией кривых
 * @param o - Объект с данными контура TTF
 * @param o.points - Массив координат точек (x, y чередуются)
 * @param o.onCurve - Массив флагов on-curve для каждой точки
 * @param o.contours - Массив индексов последних точек контуров
 * @returns Объект с полилинией: массив вершин и индексы контуров
 * @remarks
 * Обрабатывает все типы сегментов TrueType:
 * - Линии (on-curve → on-curve)
 * - Квадратичные Безье (on-curve → off-curve → on-curve)
 * - Неявные on-curve точки между off-curve точками
 * Использует адаптивную субдивизию для аппроксимации кривых
 */
function outlineToPolylineTTF(
  o: { points: Float32Array; onCurve: Uint8Array; contours: Uint16Array }
): { points: Float32Array; contours: Uint32Array } {
  const P = o.points
  const ON = o.onCurve
  const ends = o.contours

  const outPts: number[] = []
  const outEnds: number[] = []

  let start = 0

  for (let ci = 0; ci < ends.length; ci++) {
    const end = ends[ci]
    if (end === undefined) continue
    
    const contourStartIndex = outPts.length / 2

    const count = end - start + 1

    // циклический доступ
    const get = (i: number): Point => {
      const idx = start + ((i % count + count) % count)
      return {
        x: P[idx * 2] || 0,
        y: P[idx * 2 + 1] || 0,
        on: ON[idx] !== 0,
      }
    }

    let prev = get(0)
    let curr: Point

    // если первый off-curve — implicit start
    if (!prev.on) {
      const last = get(count - 1)
      if (last.on) {
        prev = { ...last }
      } else {
        prev = {
          x: (last.x + prev.x) * 0.5,
          y: (last.y + prev.y) * 0.5,
          on: true,
        }
      }
      outPts.push(prev.x, prev.y)
    } else {
      outPts.push(prev.x, prev.y)
    }

    for (let i = 1; i <= count; i++) {
      curr = get(i)

      if (prev.on && curr.on) {
        // line
        outPts.push(curr.x, curr.y)
        prev = curr
      } else if (prev.on && !curr.on) {
        // wait for next
        const next = get(i + 1)

        let endPt: Point
        if (next.on) {
          endPt = next
          i++
        } else {
          endPt = {
            x: (curr.x + next.x) * 0.5,
            y: (curr.y + next.y) * 0.5,
            on: true,
          }
        }

        // АДАПТИВНАЯ БЕЗЬЕ вместо фиксированных шагов
        // Стартовая точка prev уже добавлена
        quadBezierAdaptive(
          [prev.x, prev.y],
          [curr.x, curr.y],
          [endPt.x, endPt.y],
          ADAPTIVE_TOLERANCE_FU,
          outPts
        )

        prev = endPt
      }
    }

    const added = outPts.length / 2 - contourStartIndex
    if (added >= 2) outEnds.push(outPts.length / 2 - 1)
    start = end + 1
  }

  return {
    points: new Float32Array(outPts),
    contours: new Uint32Array(outEnds),
  }
}

/**
 * Создает индексы для LINE_LIST с замыканием контуров
 * @param contourEnds - массив индексов последних вершин каждого контура
 * @returns массив пар индексов [i, i+1] с дополнительными парами [end, start] для замыкания
 * @remarks
 * Генерирует индексы для рендеринга линиями:
 * - Для каждой пары соседних вершин в контуре создает пару индексов
 * - Добавляет замыкающую линию от последней вершины к первой
 * - Подходит для WebGPU topology: "line-list"
 */
function makeLineListIndices(contourEnds: Uint32Array): Uint32Array {
  const idx: number[] = []
  let start = 0
  for (let c = 0; c < contourEnds.length; c++) {
    const end = contourEnds[c]
    if (end === undefined) continue
    
    for (let i = start; i < end; i++) idx.push(i, i + 1)
    idx.push(end, start) // замыкание
    start = end + 1
  }
  return new Uint32Array(idx)
}

// -------------------- Кэширование глифов --------------------

/**
 * Структура данных для кэшированного меша глифа
 */
type GlyphMesh = {
  /** GPU буфер с координатами вершин */
  pointBuffer: GPUBuffer
  /** GPU буфер с индексами для LINE_LIST */
  indexBuffer: GPUBuffer
  /** Количество индексов в indexBuffer */
  indicesCount: number
  /** Ширина advance глифа в font-units */
  advanceWidthFU: number
}

/**
 * Кэш для мешей глифов
 * @remarks
 * - Ключ: идентификатор глифа (glyphId)
 * - Значение: меш глифа или null для пустых глифов
 * - Ускоряет рендеринг, избегая повторного вычисления контуров
 */
const GLYPH_CACHE = new Map<number, GlyphMesh | null>()

/**
 * Создает (и кэширует) меш для глифа по его glyphId
 * @param gid - идентификатор глифа
 * @returns кэшированный меш глифа или null если глиф пустой
 * @remarks
 * Алгоритм:
 * 1. Проверяет кэш, если есть — возвращает кэшированный результат
 * 2. Извлекает контур глифа из шрифта
 * 3. Преобразует контур в полилинию с адаптивной аппроксимацией
 * 4. Создает индексный буфер для line-list рендеринга
 * 5. Создает GPU буферы и сохраняет их в кэш
 */
function getGlyphMesh(gid: number): GlyphMesh | null {
  const cached = GLYPH_CACHE.get(gid)
  if (cached !== undefined) return cached

  const outline = font.getGlyphOutline(gid)
  const poly = outlineToPolylineTTF(outline)
  if (poly.points.length === 0 || poly.contours.length === 0) {
    GLYPH_CACHE.set(gid, null)
    return null
  }

  const indices = makeLineListIndices(poly.contours)

  const pointBuffer = device.createBuffer({
    label: `glyph${gid}-points`,
    size: poly.points.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(pointBuffer, 0, poly.points.buffer, poly.points.byteOffset, poly.points.byteLength)

  const indexBuffer = device.createBuffer({
    label: `glyph${gid}-indices`,
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(indexBuffer, 0, indices.buffer, indices.byteOffset, indices.byteLength)

  const { advanceWidth } = font.getHMetric(gid)
  const mesh: GlyphMesh = {
    pointBuffer,
    indexBuffer,
    indicesCount: indices.length,
    advanceWidthFU: advanceWidth,
  }
  GLYPH_CACHE.set(gid, mesh)
  return mesh
}

// -------------------- WebGPU Pipeline --------------------

const shaderCode = await (await fetch("./text.wgsl")).text()
const shader = device.createShaderModule({ label: "text", code: shaderCode })

const pipeline = device.createRenderPipeline({
  label: "Glyph wireframe (line-list)",
  layout: "auto",
  vertex: {
    module: shader,
    entryPoint: "vs_point",
    buffers: [{ arrayStride: 8, attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] }],
  },
  fragment: { module: shader, entryPoint: "fs_point", targets: [{ format }] },
  primitive: { topology: "line-list" },
})

// -------------------- Render Loop --------------------

/**
 * Основная функция рендеринга
 * @remarks
 * Выполняется при инициализации и при изменении размеров окна.
 * Отрисовывает все строки текста, используя кэшированные меши глифов.
 * Учитывает масштабирование для HiDPI дисплеев.
 */
function render() {
  const dpr = window.devicePixelRatio || 1
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr))
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr))
  canvas.width = W
  canvas.height = H

  const scale = FONT_SIZE_PX / font.unitsPerEm // FU -> px

  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context!.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  })

  pass.setPipeline(pipeline)

  let penY = START_Y
  for (const line of TEXT_LINES) {
    let penX = START_X
    for (const ch of line) {
      const cp = ch.codePointAt(0)
      if (cp === undefined) continue
      
      const gid = font.mapCharToGlyph(cp)
      const mesh = getGlyphMesh(gid)
      const { advanceWidth } = font.getHMetric(gid)

      if (mesh) {
        // Создаем отдельный uniform buffer для каждого глифа
        const glyphParams = new Float32Array([
          font.unitsPerEm, 
          FONT_SIZE_PX, 
          penX, 
          penY, 
          W, 
          H, 
          0, 
          0
        ])
        const glyphUniformBuf = device.createBuffer({
          label: "glyph-params",
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        device.queue.writeBuffer(glyphUniformBuf, 0, glyphParams)

        const glyphBindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: glyphUniformBuf } }],
        })

        pass.setBindGroup(0, glyphBindGroup)
        pass.setVertexBuffer(0, mesh.pointBuffer)
        pass.setIndexBuffer(mesh.indexBuffer, "uint32")
        pass.drawIndexed(mesh.indicesCount)
      }

      penX += advanceWidth * scale + LETTER_SPACING_PX
    }
    penY += LINE_GAP_PX
  }

  pass.end()
  device.queue.submit([encoder.finish()])
}

// Запуск рендеринга при изменении размеров окна
new ResizeObserver(render).observe(canvas)

// Первоначальный рендеринг
render()
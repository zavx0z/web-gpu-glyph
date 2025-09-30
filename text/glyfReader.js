/** Считывает контурные данные для каждого глифа из бинарных данных шрифта.
 * @param {ArrayBuffer} buffer - Буфер, содержащий бинарные данные TTF файла.
 * @param {import("./fontReader.js").GlyfTable} glyfTable - Объект, содержащий смещение и длину таблицы glyf.
 * @returns {Object} - Объект, содержащий контурные данные для каждого глифа.
 */
export function readGlyphData(buffer, glyfTable) {
  const dataView = new DataView(buffer)
  let offset = glyfTable.offset

  // Чтение смещений контуров
  const numContours = dataView.getInt16(offset, false)
  offset += 2 + 8 // Пропускаем bound size.
  const contourEndIndices = Array.from({ length: numContours }).map(() => {
    const endIndex = dataView.getUint16(offset, false)
    offset += 2
    return endIndex
  })

  // Пропуск инструкций
  const instructionLength = dataView.getUint16(offset, false)
  console.log(instructionLength)
  offset += 2 + instructionLength

  // Чтение флагов
  const numPoints = contourEndIndices[numContours - 1] + 1 // Последний индекс контура содержит кол-во точек в контуре +1.

  /** Функция для чтения координат точек.
   * @param {DataView} dataView - Объект, содержащий бинарные данные.
   * @param {Number} numPoints - Кол-во точек.
   */
  function readFlags(dataView, numPoints) {
    let flags = []
    let i = 0
    while (i < numPoints) {
      const flag = dataView.getUint8(offset++)
      flags.push(flag)
      if (isBitSet(flag, 3)) {
        const repeatCount = dataView.getUint8(offset++)
        for (let j = 0; j < repeatCount; j++) {
          flags.push(flag)
          i++
        }
      }
      i++
    }
    return flags
  }

  const allFlags = readFlags(dataView, numPoints)

  console.log(allFlags)

  // Чтение координат
  function readCoordinates(dataView, allFlags, readingX) {
    const offsetSizeFlagBit = readingX ? 1 : 2
    const offsetSignOrSkipBit = readingX ? 4 : 5
    let coordinates = new Array(allFlags.length).fill(0)

    for (let i = 0; i < allFlags.length; i++) {
      const flag = allFlags[i]
      if (isBitSet(flag, offsetSizeFlagBit)) {
        const offsetValue = dataView.getUint8(offset++)
        coordinates[i] += isBitSet(flag, offsetSignOrSkipBit) ? offsetValue : -offsetValue
      } else if (!isBitSet(flag, offsetSignOrSkipBit)) {
        coordinates[i] += dataView.getInt16(offset, false)
        offset += 2
      }

      if (i > 0) {
        coordinates[i] += coordinates[i - 1]
      }
    }

    return coordinates
  }

  const xCoords = readCoordinates(dataView, allFlags, true)
  const yCoords = readCoordinates(dataView, allFlags, false)

  const result = new Array()
  for (var i = 0; i < xCoords.length; i++) result.push([xCoords[i], yCoords[i]])
  return result
}

/**
 * Проверяет, установлен ли указанный бит в байте.
 * @param {number} flag - Байт, в котором проверяется бит.
 * @param {number} bitIndex - Индекс бита (0-7), который надо проверить.
 * @returns {boolean} - Возвращает true, если бит установлен; иначе false.
 */
const isBitSet = (flag, bitIndex) => ((flag >> bitIndex) & 1) === 1

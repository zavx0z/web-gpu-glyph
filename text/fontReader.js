/**
 * @typedef {object} GlyfTable - Таблица glyf.
 * @property {number} offset - Смещение в байтах от начала буфера.
 * @property {number} length - Длина таблицы в байтах.
 */

/** Функция для чтения 2-байтного числа из буфера.
 * @param {ArrayBuffer} buffer - Буфер, из которого нужно прочитать число.
 * @param {Number} offset - Смещение в байтах от начала буфера.
 * @returns {Number} - Прочитанное число.
 */
const readUInt16 = (buffer, offset) => new DataView(buffer, offset, 2).getUint16(0, false)

/** Функция для чтения 4-байтного числа из буфера.
 * @param {ArrayBuffer} buffer - Буфер, из которого нужно прочитать число.
 * @param {Number} offset - Смещение в байтах от начала буфера.
 * @returns {Number} - Прочитанное число.
 */
const readUInt32 = (buffer, offset) => new DataView(buffer, offset, 4).getUint32(0, false)

/** Функция для чтения 4-буквенного тега таблицы из буфера.
 * @param {ArrayBuffer} buffer - Буфер, из которого нужно прочитать тег.
 * @param {Number} offset - Смещение в байтах от начала буфера.
 * @returns {String} - Строка, содержащая тег.
 */
const readTag = (buffer, offset) => String.fromCharCode.apply(null, new Uint8Array(buffer, offset, 4))

/** Функция для чтения заголовка TTF файла.
 * @param {ArrayBuffer} buffer - Буфер, содержащий бинарные данные TTF файла.
 * @typedef {string} tag - 4-буквенный тег таблицы
 * @typedef {Map<tag, GlyfTable>} TTFHeader
 * @property {Table[]} tables - Массив объектов таблиц
 * @returns {TTFHeader} Объект заголовка файла
 */
export const parseFont = (buffer) => {
  let offset = 4
  const /** @type {TTFHeader} */ header = new Map()
  const tablesLength = readUInt16(buffer, offset)
  offset += 8 // Пропускаем ненужные поля.
  Array.from({ length: tablesLength }).forEach(() => {
    const tableTag = readTag(buffer, offset)
    offset += 8 // Пропускаем ненужные поля.
    const tableOffset = readUInt32(buffer, offset)
    offset += 4
    const tableLength = readUInt32(buffer, offset)
    offset += 4
    header.set(tableTag, { offset: tableOffset, length: tableLength })
  })
  return header
}

/** Функция для чтения таблицы 'loca', которая содержит смещения глифов.
 * @param {ArrayBuffer} buffer - Буфер, содержащий бинарные данные TTF файла.
 * @param {Object} table - Таблица 'loca' из заголовка.
 * @returns {Array} - Массив со смещениями для каждого глифа в таблице 'glyf'.
 */
export function readLocaTable(buffer, table) {
  const loca = []
  const dataView = new DataView(buffer)
  // Допустим, что у нас short смещения (0 - использовать long смещения)
  // Количество глифов на 1 больше, чем количество смещений, поэтому делим на 2 (short = 2 байта)
  for (let i = table.offset; i < table.offset + table.length; i += 2) loca.push(dataView.getUint16(i))
  return loca
}

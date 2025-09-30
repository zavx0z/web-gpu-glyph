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
 * @typedef {Object} TTFHeader
 * @property {Number} version - Версия файла.
 * @property {Number} numTables - Количество таблиц в файле.
 * @property {Object[]} tables - Массив объектов, представляющих таблицы в файле.
 * @property {String} tables.tag - Тег таблицы.
 * @property {Number} tables.offset - Смещение таблицы в файле.
 * @property {Number} tables.length - Длина таблицы в байтах.
 * @returns {TTFHeader} - Объект, представляющий заголовок файла.
 */
export const readTTFHeader = (buffer) => {
  let offset = 0
  const /** @type {TTFHeader} */ header = {}
  header.version = readUInt32(buffer, offset)
  offset += 4
  header.numTables = readUInt16(buffer, offset)
  offset += 2
  offset += 6 // Пропускаем ненужные поля.
  header.tables = []
  for (var i = 0; i < header.numTables; i++) {
    let table = {}
    table.tag = readTag(buffer, offset)
    offset += 4
    offset += 4 // Пропускаем ненужные поля.
    table.offset = readUInt32(buffer, offset)
    offset += 4
    table.length = readUInt32(buffer, offset)
    offset += 4
    header.tables.push(table)
  }
  return header
}

/** Функция fetchBinaryData загружает бинарные данные.
 * @param {string} url - URL, по которому доступен файл.
 * @returns {Promise<ArrayBuffer>} - Promise, возвращающий ArrayBuffer бинарных данных.
 */
export async function fetchBinaryData(url) {
  const response = await fetch(url)
  if (!response.ok) console.error(`HTTP error! status: ${response.status}`)
  return await response.arrayBuffer()
}

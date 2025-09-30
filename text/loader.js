/** Функция fetchBinaryData загружает бинарные данные.
 * @param {string} url - URL, по которому доступен файл.
 * @returns {Promise<ArrayBuffer>} - Promise, возвращающий ArrayBuffer бинарных данных.
 */
export async function fetchBinaryData(url) {
    const response = await fetch(url)
    if (!response.ok) console.error(`HTTP error! status: ${response.status}`)
    return await response.arrayBuffer()
  }
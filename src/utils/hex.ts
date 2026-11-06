// Перевіряє, що значення це рядок з hex-символів (0-9, a-f, нижній регістр) рівно потрібної довжини.
// Довжина задається в БАЙТАХ: 1 байт = 2 hex-символи (32 байти = 64 символи).
//
// Buffer.from(текст, 'hex') НЕ скаржиться на сміття, а мовчки обрізає хвіст
// (наприклад, '12zz34' стає одним байтом 0x12). Тому формат треба перевірити ДО перетворення.
export function isHex(value: unknown, byteLength: number): value is string {
  return (
    typeof value === "string" &&
    new RegExp(`^[0-9a-f]{${byteLength * 2}}$`).test(value)
  );
}

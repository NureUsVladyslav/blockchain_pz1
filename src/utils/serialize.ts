/* Детермінована серіалізація: одні й ті самі дані ЗАВЖДИ перетворюються на один і той самий рядок.

Навіщо: хеш і підпис рахуються від байтів. Звичайний JSON.stringify пише поля в тому порядку,
в якому їх додали до об'єкта, тому {a:1,b:2} і {b:2,a:1} дають різні рядки,
а отже різні байти, різні хеші та підписи, які не проходять перевірку на іншому вузлі.

Правила канонічного запису:
 - ключі об'єкта йдуть за алфавітом;
 - порядок елементів масиву зберігається;
 - числа лише цілі;
 - жодних пробілів. */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";

  if (typeof value === "string") return JSON.stringify(value);

  if (typeof value === "boolean") return value ? "true" : "false";

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `Можна серіалізувати лише ціле число, отримано: ${value}`,
      );
    }
    return String(value);
  }

  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalize(item)).join(",") + "]";
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (key) => JSON.stringify(key) + ":" + canonicalize(obj[key]),
    );
    return "{" + parts.join(",") + "}";
  }

  throw new Error(`Не можна серіалізувати значення типу ${typeof value}`);
}

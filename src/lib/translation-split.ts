// Splits a translation such as "дом или здание" or "house, building" into its
// alternatives. Separators are ";", "|", ", ", " / " and the words "or" /
// "или" standing on their own. Tokens like "1,000" or "km/h" stay whole, and
// a value that is only a separator word (French "or", gold) is kept as is.
const ALTERNATIVE_SEPARATOR =
  /\s*(?:[;|]|,\s|\s\/\s|(?<![\p{L}\p{N}])(?:or|или)(?![\p{L}\p{N}]))\s*/iu;

export function splitTranslationAlternatives(value: string): string[] {
  const text = value.trim();
  if (!text) return [];
  const parts = text
    .split(ALTERNATIVE_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

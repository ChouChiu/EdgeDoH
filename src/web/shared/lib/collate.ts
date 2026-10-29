const pinyin = new Intl.Collator("zh-Hans-u-co-pinyin", { sensitivity: "base", numeric: true });

/** The first Han character of each pinyin initial; collation puts every other character between two */
const BOUNDS = [..."阿八嚓哒妸发旮哈丌咔垃妈拿噢妑七呥仨他屲夕丫帀"];
const LETTERS = "ABCDEFGHJKLMNOPQRSTWXYZ";

/** A–Z for Latin and (by pinyin) Han names, empty for anything else so digits sort first */
function initial(name: string): string {
  const c = [...name][0] ?? "";
  if (/[a-z]/i.test(c)) return c.toUpperCase();
  if (!/\p{Script=Han}/u.test(c)) return "";
  let i = BOUNDS.length - 1;
  while (i > 0 && pinyin.compare(c, BOUNDS[i]!) < 0) i--;
  return LETTERS[i]!;
}

/**
 * Orders names A–Z with Chinese names filed under their pinyin initial (旷视 among the K names),
 * which no single Intl.Collator does: they sort all Han before or after all Latin
 */
export function compareNames(a: string, b: string): number {
  return initial(a).localeCompare(initial(b)) || pinyin.compare(a, b);
}

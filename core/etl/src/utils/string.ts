/**
 * String case conversion utilities
 */

/**
 * Convert string to kebab-case
 * @param str - Input string in any case
 * @returns String in kebab-case format
 */
export function toKebabCase(str: string): string {
  return str
    .replaceAll(/([a-z])([A-Z])/g, '$1-$2')
    .replaceAll(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * Convert kebab-case string to camelCase
 * @param str - Input string in kebab-case
 * @returns String in camelCase format
 */
export function toCamelCase(str: string): string {
  return str.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert string to PascalCase
 * @param str - Input string in any case
 * @returns String in PascalCase format
 */
export function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

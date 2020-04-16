/**
 * Make a map and return a function for checking if a key
 * is in that map. Match lowercase and uppercase if is strict mode.
 */
export function createMap(str, isStrict = true) {
  const map = Object.create(null);
  const arr = str.split('/');

  for (let i = 0; i < arr.length; i++) {
    map[arr[i]] = true
  }

  return function(tag) {
    return isStrict ? map[tag] : map[tag] || map[tag.toUpperCase()] || map[tag.toLowerCase()];
  }
}
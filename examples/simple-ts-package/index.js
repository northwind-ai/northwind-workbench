export function slugify(input) {
  return input.toLowerCase().trim().replace(/\s+/g, '-');
}

export function titleCase(input) {
  return input.replace(/\b\w/g, (c) => c.toUpperCase());
}

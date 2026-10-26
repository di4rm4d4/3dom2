export function searchKey(text) {
  return text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '');
}

export function findPublication(maps, query) {
  const key = searchKey(query);
  if (!key) return null;
  return maps.find(map => [map.name, ...map.aliases].some(name => searchKey(name) === key)) || null;
}

export function validateCatalog(value) {
  if (!value || typeof value.liveResearch !== 'boolean' || !Array.isArray(value.maps) || !value.maps.length ||
    !value.maps.every(m => m && /^[a-f0-9-]{36}$/.test(m.id) && /^[a-z0-9-]+$/.test(m.slug) &&
      typeof m.name === 'string' && Array.isArray(m.aliases) && m.aliases.every(a => typeof a === 'string'))) {
    throw new Error('The saved map list could not be loaded. Please reload the page.');
  }
  return value;
}

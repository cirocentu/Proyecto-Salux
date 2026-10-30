// Los ids de la base son enteros de 32 bits. parseInt('12abc') da 12 y un número enorme
// llega a Postgres y revienta con un 500: acá se aceptan solo dígitos y dentro de rango.
const INT32_MAX = 2147483647;

// Devuelve el id como número, o null si no es un id válido.
function parsearId(valor) {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const texto = String(valor);
  if (!/^\d{1,10}$/.test(texto)) return null;
  const id = Number(texto);
  return id >= 1 && id <= INT32_MAX ? id : null;
}

module.exports = { parsearId, INT32_MAX };

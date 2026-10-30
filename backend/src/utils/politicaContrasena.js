const { z } = require('zod');

const MIN = 10;
// bcrypt solo mira los primeros 72 bytes: más largo no suma seguridad.
const MAX = 72;

// Contraseñas muy usadas (en español e inglés) que no se aceptan aunque
// cumplan el largo. Se comparan en minúsculas y sin los dígitos/símbolos del
// final, para atrapar variantes como "Password123!".
const COMUNES = new Set([
  'password', 'passw0rd', 'contrasena', 'contraseña', 'clave', 'claveclave', 'qwerty', 'qwertyuiop',
  'asdfghjkl', 'zxcvbnm', 'abcdefgh', 'abcdefghij', 'abcd', 'admin', 'administrador', 'administrator',
  'root', 'toor', 'letmein', 'welcome', 'bienvenido', 'iloveyou', 'tequiero', 'teamo', 'monkey',
  'dragon', 'football', 'futbol', 'bocajuniors', 'riverplate', 'boca', 'river', 'argentina',
  'buenosaires', 'master', 'shadow', 'sunshine', 'princess', 'superman', 'batman', 'trustno',
  'salux', 'saluxturnos', 'salud', 'medico', 'paciente', 'hospital', 'clinica', 'turnos',
  'universidad', 'facultad', 'estudiante', 'secreto', 'miclave', 'micontrasena', 'prueba',
  'test', 'testing', 'changeme', 'cambiame', 'default', 'guest', 'user', 'usuario',
  '1234567890', '12345678', '123456789', '0123456789', '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4',
]);

// Minúsculas y sin tildes: "Pérez" en el nombre tiene que detectar "Perez" en la clave.
function normalizar(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Devuelve la lista de problemas de una contraseña (vacía si es aceptable).
// `contexto` permite rechazar contraseñas armadas con los datos de la cuenta.
function problemasDeContrasena(contrasena, contexto = {}) {
  const problemas = [];
  const pw = String(contrasena ?? '');
  const bajo = normalizar(pw);

  if (pw.length < MIN) problemas.push(`Debe tener al menos ${MIN} caracteres`);
  if (pw.length > MAX) problemas.push(`No puede superar los ${MAX} caracteres`);
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(pw) || !/\d/.test(pw)) {
    problemas.push('Tiene que combinar letras y números');
  }

  const sinFinal = bajo.replace(/[\d\W_]+$/u, '');
  if (COMUNES.has(bajo) || COMUNES.has(sinFinal)) {
    problemas.push('Es una contraseña demasiado común');
  }
  if (/^(.)\1+$/.test(pw)) problemas.push('No puede ser un mismo carácter repetido');

  const { email, dni, nombre } = contexto;
  if (dni && bajo.includes(normalizar(dni))) problemas.push('No puede contener tu DNI');
  const usuarioDelMail = normalizar(email).split('@')[0];
  if (usuarioDelMail.length >= 4 && bajo.includes(usuarioDelMail)) {
    problemas.push('No puede contener tu email');
  }
  const partesDelNombre = normalizar(nombre).split(/\s+/).filter((p) => p.length >= 4);
  if (partesDelNombre.some((p) => bajo.includes(p))) problemas.push('No puede contener tu nombre');

  return problemas;
}

// Campo Zod para una contraseña nueva, sin datos de contexto.
const contrasenaSegura = z.string().superRefine((valor, ctx) => {
  problemasDeContrasena(valor).forEach((mensaje) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: mensaje }));
});

// Para schemas de objeto que además traen email/dni/nombre: agrega a
// `contrasena` los problemas que dependen de esos datos.
function validarContrasenaConContexto(datos, ctx) {
  problemasDeContrasena(datos.contrasena, { email: datos.email, dni: datos.dni, nombre: datos.nomYape })
    // los de largo/composición/común ya los reporta `contrasenaSegura`
    .filter((m) => /DNI|email|nombre/.test(m))
    .forEach((mensaje) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contrasena'], message: mensaje }));
}

module.exports = { problemasDeContrasena, contrasenaSegura, validarContrasenaConContexto, MIN, MAX };

import { useCallback, useState } from 'react';

// Cuando un envío falla por un campo concreto, el foco tiene que ir a ese campo:
// quien usa teclado o lector de pantalla no debería tener que buscarlo. El campo
// además se marca como inválido y se enlaza con el mensaje de error, para que el
// lector de pantalla lo lea junto al nombre del campo.
//
// Los errores de validación del navegador (required, minLength) ya hacen esto solos;
// este helper cubre las validaciones propias ("las contraseñas no coinciden") y los
// errores que devuelve el servidor por campo.

// Dado un error de la API (con `campos`: [{ campo, mensaje }]) y un mapa
// { nombreEnLaApi: idDelInput }, devuelve el id del primer campo afectado.
export function campoDelError(error, mapa) {
  const hallado = error?.campos?.find((c) => mapa[c.campo]);
  return hallado ? mapa[hallado.campo] : null;
}

export function useCampoInvalido() {
  const [invalido, setInvalido] = useState(null);

  // Marca el campo como inválido y le lleva el foco.
  const marcar = useCallback((id) => {
    setInvalido(id);
    if (id) document.getElementById(id)?.focus();
  }, []);

  const limpiar = useCallback(() => setInvalido(null), []);

  // Atributos para un <input>: aria-invalid si es el marcado, y aria-describedby con
  // su ayuda (si tiene) más el mensaje de error (solo mientras está marcado).
  const atributos = (id, { error, ayuda } = {}) => {
    const describedby = [ayuda, invalido === id ? error : null].filter(Boolean).join(' ');
    return {
      ...(invalido === id ? { 'aria-invalid': true } : {}),
      ...(describedby ? { 'aria-describedby': describedby } : {}),
    };
  };

  return { invalido, marcar, limpiar, atributos };
}

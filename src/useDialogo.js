import { useEffect, useId, useRef } from 'react';

const ENFOCABLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Diálogos abiertos, el último es el de más arriba. Con uno encima de otro (por
// ejemplo la confirmación de borrar una especialidad sobre el modal de alta), solo
// el de arriba reacciona a Tab y a Escape.
const pila = [];

// Comportamiento de accesibilidad de un modal:
//  - al abrirse, el foco pasa al diálogo (que un lector de pantalla anuncia por su título);
//  - Tab y Shift+Tab quedan dentro del diálogo;
//  - Escape lo cierra;
//  - al cerrarse, el foco vuelve al elemento que lo abrió.
// Devuelve la `ref` del panel y el `tituloId` que va en el encabezado del diálogo.
// El panel además tiene que llevar role="dialog", aria-modal="true" y
// aria-labelledby={tituloId}.
//
// Con { cerrarConClicEnFondo: true } devuelve también `propsFondo`, para esparcir en
// el contenedor que cubre la pantalla: un clic en el fondo oscuro cierra el diálogo.
// Se usa en los que no tienen datos escritos que perder (confirmaciones, asistente
// de turnos); en los formularios no, para que un clic de más no borre lo tipeado.
export function useDialogo(onClose, { cerrarConClicEnFondo = false } = {}) {
  const ref = useRef(null);
  const tituloId = useId();
  const cerrarRef = useRef(onClose);

  useEffect(() => {
    cerrarRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = ref.current;
    if (!panel) return undefined;

    const quienLoAbrio = document.activeElement;
    const marca = {};
    pila.push(marca);

    // Foco en el panel y no en un control: el contenido de varios modales llega
    // después (carga asíncrona) y así el primer Tab siempre cae en el primer control.
    panel.tabIndex = -1;
    panel.style.outline = 'none';
    panel.focus();

    const alTeclear = (e) => {
      if (pila[pila.length - 1] !== marca) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        cerrarRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const controles = [...panel.querySelectorAll(ENFOCABLES)];
      if (controles.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const primero = controles[0];
      const ultimo = controles[controles.length - 1];
      const activo = document.activeElement;
      const afuera = !panel.contains(activo) || activo === panel;

      if (e.shiftKey && (afuera || activo === primero)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (afuera || activo === ultimo)) {
        e.preventDefault();
        primero.focus();
      }
    };

    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('keydown', alTeclear);
      pila.splice(pila.indexOf(marca), 1);
      if (quienLoAbrio && document.contains(quienLoAbrio)) quienLoAbrio.focus();
    };
  }, []);

  // Se escucha el botón al PRESIONAR (no al soltar): si alguien selecciona texto dentro
  // del panel y suelta el mouse afuera, el "clic" resultante no debe cerrar nada.
  const propsFondo = cerrarConClicEnFondo
    ? { onMouseDown: (e) => { if (e.target === e.currentTarget) cerrarRef.current?.(); } }
    : {};

  return { ref, tituloId, propsFondo };
}

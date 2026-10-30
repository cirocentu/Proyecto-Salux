import { useDialogo } from './useDialogo';

// Confirmación simple ("¿Cancelar este turno?", "¿Cerrar sesión?"). Escape equivale a
// la opción de volver atrás.
function DialogoConfirmacion({ titulo, children, textoVolver, textoConfirmar, onVolver, onConfirmar }) {
  const { ref, tituloId, propsFondo } = useDialogo(onVolver, { cerrarConClicEnFondo: true });

  return (
    <div {...propsFondo} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60">
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm text-slate-100 p-6 space-y-4"
      >
        <h2 id={tituloId} className="font-bold text-lg">{titulo}</h2>
        <p className="text-slate-400 text-sm">{children}</p>
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onVolver}
            className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 font-medium transition"
          >
            {textoVolver}
          </button>
          <button
            onClick={onConfirmar}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition"
          >
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DialogoConfirmacion;

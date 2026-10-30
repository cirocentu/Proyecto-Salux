import { useState, useEffect } from 'react';
import { api } from './api';
import { useCampoInvalido, campoDelError } from './campos';

const inputClase = 'w-full px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 focus:ring-2 focus:ring-blue-600 focus:outline-none text-slate-200 placeholder-slate-400 text-sm';
const labelClase = 'block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1';

// Pantalla bloqueante para cuentas creadas por un administrador: tienen una
// contraseña inicial y no pueden usar la app hasta cambiarla.
function CambioContrasenaObligatorio({ usuario, onCambiada, onLogout }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Elegí tu contraseña — Salux';
  }, []);
  const { marcar, limpiar, atributos } = useCampoInvalido();

  const guardar = async (e) => {
    e.preventDefault();
    setError('');
    limpiar();
    if (nueva !== confirmar) {
      setError('Las contraseñas no coinciden.');
      marcar('cambio-confirmar-contrasena');
      return;
    }
    setEnviando(true);
    try {
      await api.cambiarContrasena(actual, nueva);
      onCambiada({ ...usuario, debeCambiarContrasena: false });
    } catch (err) {
      setError(err.message);
      marcar(campoDelError(err, { contrasenaNueva: 'cambio-contrasena-nueva' }));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <form onSubmit={guardar} className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-md text-slate-100 p-8 space-y-4">
        <div>
          <h1 className="font-bold text-xl">Elegí tu contraseña</h1>
          <p className="text-slate-400 text-sm mt-1">
            Hola {usuario.nombre}. Tu cuenta se creó con una contraseña inicial: para seguir, tenés que reemplazarla por una propia.
          </p>
        </div>

        {error && <div id="cambio-error" role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}

        <div>
          <label htmlFor="cambio-contrasena-actual" className={labelClase}>Contraseña inicial (la que te dieron)</label>
          <input id="cambio-contrasena-actual" type="password" value={actual} onChange={(e) => setActual(e.target.value)} required autoComplete="current-password" className={inputClase} />
        </div>
        <div>
          <label htmlFor="cambio-contrasena-nueva" className={labelClase}>Contraseña nueva</label>
          <input id="cambio-contrasena-nueva" {...atributos('cambio-contrasena-nueva', { error: 'cambio-error', ayuda: 'cambio-contrasena-nueva-ayuda' })} type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} required minLength={10} autoComplete="new-password" placeholder="Mínimo 10 caracteres" className={inputClase} />
          <p id="cambio-contrasena-nueva-ayuda" className="text-slate-400 text-xs mt-1">Mínimo 10 caracteres, con letras y números. No uses una contraseña común ni tus datos personales.</p>
        </div>
        <div>
          <label htmlFor="cambio-confirmar-contrasena" className={labelClase}>Repetí la contraseña nueva</label>
          <input id="cambio-confirmar-contrasena" {...atributos('cambio-confirmar-contrasena', { error: 'cambio-error' })} type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required minLength={10} autoComplete="new-password" className={inputClase} />
        </div>

        <button type="submit" disabled={enviando} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition">
          {enviando ? 'Guardando...' : 'Guardar y continuar'}
        </button>
        <button type="button" onClick={onLogout} className="w-full text-slate-400 hover:text-slate-200 text-sm">
          Cerrar sesión
        </button>
      </form>
    </main>
  );
}

export default CambioContrasenaObligatorio;

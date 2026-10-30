import { useState, useEffect } from 'react';
import { api } from './api';
import { useCampoInvalido, campoDelError } from './campos';
import { useDialogo } from './useDialogo';

const inputClase = 'w-full px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 focus:ring-2 focus:ring-blue-600 focus:outline-none text-slate-200 placeholder-slate-400 text-sm disabled:opacity-50 disabled:cursor-not-allowed';
const labelClase = 'block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1';

const ROL_TEXTO = { admin: 'Administrador', medico: 'Médico', paciente: 'Paciente' };

function PerfilModal({ usuario, onClose, onActualizado }) {
  const { ref, tituloId } = useDialogo(onClose);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [perfil, setPerfil] = useState(null);

  const [nombre, setNombre] = useState('');
  const [obraSocial, setObraSocial] = useState('');
  const [telefono, setTelefono] = useState('');
  const [guardandoDatos, setGuardandoDatos] = useState(false);
  const [errorDatos, setErrorDatos] = useState('');
  const [exitoDatos, setExitoDatos] = useState('');

  const [contrasenaActual, setContrasenaActual] = useState('');
  const [contrasenaNueva, setContrasenaNueva] = useState('');
  const [confirmarContrasena, setConfirmarContrasena] = useState('');
  const [cambiandoPassword, setCambiandoPassword] = useState(false);
  const [errorPassword, setErrorPassword] = useState('');
  const { marcar, limpiar, atributos } = useCampoInvalido();
  const [exitoPassword, setExitoPassword] = useState('');

  useEffect(() => {
    api.perfil()
      .then(({ usuario: datos }) => {
        setPerfil(datos);
        setNombre(datos.nombre);
        setObraSocial(datos.obraSocial || '');
        setTelefono(datos.telefono || '');
      })
      .catch((err) => setErrorCarga(err.message))
      .finally(() => setCargando(false));
  }, []);

  const esPaciente = perfil?.rol === 'paciente';

  const guardarDatos = async (e) => {
    e.preventDefault();
    setErrorDatos('');
    setExitoDatos('');
    limpiar();
    setGuardandoDatos(true);
    try {
      const tareas = [api.actualizarPerfil(nombre)];
      if (esPaciente) tareas.push(api.actualizarPerfilPaciente({ obraSocial, telefono }));
      await Promise.all(tareas);

      setPerfil((prev) => ({ ...prev, nombre, obraSocial, telefono }));
      setExitoDatos('Datos actualizados con éxito.');
      onActualizado?.({ ...usuario, nombre });
    } catch (err) {
      setErrorDatos(err.message);
      marcar(campoDelError(err, { nomYape: 'perfil-nombre-completo', obraSocial: 'perfil-obra-social', telefono: 'perfil-telefono' }));
    } finally {
      setGuardandoDatos(false);
    }
  };

  const cambiarPassword = async (e) => {
    e.preventDefault();
    setErrorPassword('');
    setExitoPassword('');
    limpiar();
    if (contrasenaNueva !== confirmarContrasena) {
      setErrorPassword('La confirmación no coincide con la contraseña nueva.');
      marcar('perfil-confirmar-contrasena');
      return;
    }
    setCambiandoPassword(true);
    try {
      await api.cambiarContrasena(contrasenaActual, contrasenaNueva);
      setExitoPassword('Contraseña actualizada con éxito.');
      setContrasenaActual('');
      setContrasenaNueva('');
      setConfirmarContrasena('');
    } catch (err) {
      setErrorPassword(err.message);
      marcar(campoDelError(err, { contrasenaNueva: 'perfil-contrasena-nueva' }));
    } finally {
      setCambiandoPassword(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tituloId} className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg text-slate-100 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <h2 id={tituloId} className="font-bold text-lg">Mi perfil</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-200 text-xl leading-none w-10 h-10 -mr-2 inline-flex items-center justify-center rounded-lg">&times;</button>
        </div>

        <div className="px-6 py-5 space-y-6 overflow-y-auto">
          {cargando && <p role="status" className="text-slate-400 text-sm">Cargando tu perfil...</p>}

          {errorCarga && !cargando && (
            <div role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              No se pudo cargar tu perfil: {errorCarga}
            </div>
          )}

          {!cargando && !errorCarga && perfil && (
            <>
              <form onSubmit={guardarDatos} className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Datos personales</p>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                    {ROL_TEXTO[perfil.rol] || perfil.rol}
                  </span>
                </div>

                {exitoDatos && <div role="status" className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">{exitoDatos}</div>}
                {errorDatos && <div id="perfil-error-datos" role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{errorDatos}</div>}

                <div>
                  <label htmlFor="perfil-nombre-completo" className={labelClase}>Nombre completo</label>
                  <input id="perfil-nombre-completo" {...atributos('perfil-nombre-completo', { error: 'perfil-error-datos' })} type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required className={inputClase} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="perfil-email" className={labelClase}>Email</label>
                    <input id="perfil-email" type="text" value={perfil.email} disabled className={inputClase} />
                  </div>
                  <div>
                    <label htmlFor="perfil-dni" className={labelClase}>DNI</label>
                    <input id="perfil-dni" type="text" value={perfil.dni} disabled className={inputClase} />
                  </div>
                </div>

                {esPaciente && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="perfil-obra-social" className={labelClase}>Obra social</label>
                      <input id="perfil-obra-social" {...atributos('perfil-obra-social', { error: 'perfil-error-datos' })} type="text" value={obraSocial} onChange={(e) => setObraSocial(e.target.value)} placeholder="Ej: OSDE" className={inputClase} />
                    </div>
                    <div>
                      <label htmlFor="perfil-telefono" className={labelClase}>Teléfono</label>
                      <input id="perfil-telefono" {...atributos('perfil-telefono', { error: 'perfil-error-datos' })} type="text" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Ej: 11-2345-6789" className={inputClase} />
                    </div>
                  </div>
                )}

                {perfil.rol === 'medico' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="perfil-matricula" className={labelClase}>Matrícula</label>
                      <input id="perfil-matricula" type="text" value={perfil.matricula} disabled className={inputClase} />
                    </div>
                    <div>
                      <label htmlFor="perfil-consultorio" className={labelClase}>Consultorio</label>
                      <input id="perfil-consultorio" type="text" value={perfil.consultorio || 'Sin asignar'} disabled className={inputClase} />
                    </div>
                  </div>
                )}

                <button type="submit" disabled={guardandoDatos} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition">
                  {guardandoDatos ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </form>

              <div className="border-t border-slate-800 pt-5">
                <form onSubmit={cambiarPassword} className="space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Cambiar contraseña</p>

                  {exitoPassword && <div role="status" className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">{exitoPassword}</div>}
                  {errorPassword && <div id="perfil-error-password" role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{errorPassword}</div>}

                  <div>
                    <label htmlFor="perfil-contrasena-actual" className={labelClase}>Contraseña actual</label>
                    <input id="perfil-contrasena-actual" type="password" value={contrasenaActual} onChange={(e) => setContrasenaActual(e.target.value)} required className={inputClase} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="perfil-contrasena-nueva" className={labelClase}>Contraseña nueva</label>
                      <input id="perfil-contrasena-nueva" {...atributos('perfil-contrasena-nueva', { error: 'perfil-error-password' })} type="password" value={contrasenaNueva} onChange={(e) => setContrasenaNueva(e.target.value)} required minLength={10} placeholder="Mínimo 10 caracteres" className={inputClase} />
                    </div>
                    <div>
                      <label htmlFor="perfil-confirmar-contrasena" className={labelClase}>Confirmar contraseña</label>
                      <input id="perfil-confirmar-contrasena" {...atributos('perfil-confirmar-contrasena', { error: 'perfil-error-password' })} type="password" value={confirmarContrasena} onChange={(e) => setConfirmarContrasena(e.target.value)} required minLength={10} className={inputClase} />
                    </div>
                  </div>

                  <button type="submit" disabled={cambiandoPassword} className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 text-slate-200 font-medium py-2.5 rounded-lg transition">
                    {cambiandoPassword ? 'Actualizando...' : 'Cambiar contraseña'}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('Se cerrará tu sesión en todos los dispositivos, incluido este. ¿Continuar?')) return;
                    try {
                      await api.logoutTodas();
                      window.location.reload();
                    } catch (err) {
                      setErrorPassword(err.message);
                    }
                  }}
                  className="w-full mt-3 text-red-400 hover:text-red-300 text-sm font-medium"
                >
                  Cerrar sesión en todos los dispositivos
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default PerfilModal;

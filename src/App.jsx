import { useState, useEffect, useRef } from 'react';
import Dashboard from './Dashboard';
import CambioContrasenaObligatorio from './CambioContrasenaObligatorio';
import { useCampoInvalido, campoDelError } from './campos';
import { api, getUsuarioGuardado, guardarSesion, borrarSesion, actualizarUsuarioGuardado, getPreferenciasAccesibilidad, guardarPreferenciasAccesibilidad } from './api';

const TITULOS_DE_ACCESO = {
  login: 'Iniciar sesión',
  registro: 'Crear una cuenta',
  olvide: 'Recuperar contraseña',
  reset: 'Nueva contraseña',
  verificar: 'Verificación de email',
};

function App() {
  const [usuario, setUsuario] = useState(() => getUsuarioGuardado());
  // El Access Token vive en memoria (no en localStorage), así que se pierde
  // al recargar la página. Si ya teníamos un usuario cacheado lo mostramos
  // optimistamente mientras renovamos la sesión de verdad en el fondo con
  // el refresh token (cookie httpOnly); si no hay nada cacheado, esperamos
  // el resultado antes de mostrar cualquier pantalla.
  const [verificandoSesion, setVerificandoSesion] = useState(() => !getUsuarioGuardado());
  const [modoAdultoMayor, setModoAdultoMayor] = useState(() => getPreferenciasAccesibilidad().modoAdultoMayor ?? false);
  const [mostrarPassword, setMostrarPassword] = useState(false);
  // Si el link del mail de "recuperar contraseña" trae ?reset=TOKEN, arrancamos
  // directo en esa pantalla en vez del login.
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('reset'));
  // Si el link del mail de "activar cuenta" trae ?verificar=TOKEN, mostramos el resultado.
  const [verificarToken] = useState(() => new URLSearchParams(window.location.search).get('verificar'));
  const verificacionIniciada = useRef(false);
  const [requiereVerificacion, setRequiereVerificacion] = useState(false);
  const [modo, setModo] = useState(() => (resetToken ? 'reset' : verificarToken ? 'verificar' : 'login')); // 'login' | 'registro' | 'olvide' | 'reset' | 'verificar'
  const [email, setEmail] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [confirmarContrasena, setConfirmarContrasena] = useState('');
  const [nomYape, setNomYape] = useState('');
  const [dni, setDni] = useState('');
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { marcar, limpiar, atributos } = useCampoInvalido();

  // Título de la pestaña según la pantalla (un lector de pantalla lo anuncia al cambiar).
  useEffect(() => {
    if (!usuario) document.title = `${TITULOS_DE_ACCESO[modo] || 'Salux'} — Salux`;
  }, [modo, usuario]);

  // Al cargar la app pedimos un Access Token nuevo con el refresh token de
  // la cookie httpOnly — es la única forma de recuperar sesión, ya que el
  // Access Token en sí no sobrevive un refresh de página.
  useEffect(() => {
    api.refrescarSesion()
      .then(({ token, usuario: usuarioActual }) => {
        guardarSesion(token, usuarioActual);
        setUsuario(usuarioActual);
      })
      .catch(() => {
        borrarSesion();
        setUsuario(null);
      })
      .finally(() => setVerificandoSesion(false));
  }, []);

  // Saber si el servidor exige verificar el email (muestra la opción de reenviar el enlace).
  useEffect(() => {
    api.configPublica()
      .then(({ data }) => setRequiereVerificacion(!!data.requiereVerificacionEmail))
      .catch(() => {});
  }, []);

  // Confirma el email al llegar desde el enlace del correo. El token es de un
  // solo uso: en desarrollo React ejecuta los efectos dos veces, de ahí el ref.
  useEffect(() => {
    if (!verificarToken || verificacionIniciada.current) return;
    verificacionIniciada.current = true;
    api.verificarEmail(verificarToken)
      .then(({ message }) => setMensaje(message))
      .catch((err) => setError(err.message))
      .finally(() => window.history.replaceState({}, '', window.location.pathname));
  }, [verificarToken]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const { token, usuario: usuarioLogueado } = await api.login(email, contrasena);
      guardarSesion(token, usuarioLogueado);
      setUsuario(usuarioLogueado);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const reenviarVerificacion = async () => {
    setError('');
    setMensaje('');
    if (!email.trim()) {
      setError('Escribí tu email arriba y volvé a tocar "Reenviar".');
      return;
    }
    try {
      const { message } = await api.reenviarVerificacion(email);
      setMensaje(message);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRegistro = async (e) => {
    e.preventDefault();
    setError('');
    limpiar();
    setEnviando(true);
    try {
      const respuesta = await api.register({ email, dni, contrasena, nomYape });
      if (respuesta.requiereVerificacion) {
        // El servidor exige confirmar el email: no hay sesión todavía.
        setMensaje(respuesta.message);
        setContrasena('');
        setModo('login');
        return;
      }
      const { token, usuario: usuarioLogueado } = await api.login(email, contrasena);
      guardarSesion(token, usuarioLogueado);
      setUsuario(usuarioLogueado);
    } catch (err) {
      setError(err.message);
      // El servidor dice qué campo falló (DNI, contraseña débil...): el foco va ahí.
      marcar(campoDelError(err, {
        email: 'acceso-identificador', dni: 'acceso-dni', contrasena: 'acceso-contrasena', nomYape: 'acceso-nombre-completo',
      }));
    } finally {
      setEnviando(false);
    }
  };

  const handleOlvideContrasena = async (e) => {
    e.preventDefault();
    setError('');
    setMensaje('');
    setEnviando(true);
    try {
      const { message } = await api.solicitarResetContrasena(email);
      setMensaje(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const handleResetearContrasena = async (e) => {
    e.preventDefault();
    setError('');
    setMensaje('');
    limpiar();
    if (contrasena !== confirmarContrasena) {
      setError('Las contraseñas no coinciden.');
      marcar('acceso-confirmar-contrasena');
      return;
    }
    setEnviando(true);
    try {
      await api.resetearContrasena(resetToken, contrasena);
      setMensaje('Contraseña actualizada. Ya podés iniciar sesión.');
      setContrasena('');
      setConfirmarContrasena('');
      // Limpiamos el ?reset=... de la URL para que un F5 no reintente el token ya usado
      window.history.replaceState({}, '', window.location.pathname);
      setModo('login');
    } catch (err) {
      setError(err.message);
      marcar(campoDelError(err, { contrasenaNueva: 'acceso-contrasena-nueva' }));
    } finally {
      setEnviando(false);
    }
  };

  const cambiarModo = (nuevoModo) => {
    setModo(nuevoModo);
    limpiar();
    setError('');
    setMensaje('');
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Si el logout en el servidor falla igual limpiamos todo localmente:
      // el objetivo es que el usuario quede deslogueado sí o sí de su lado.
    }
    borrarSesion();
    setUsuario(null);
    setEmail('');
    setContrasena('');
    setNomYape('');
    setDni('');
    setModo('login');
  };

  if (verificandoSesion) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <p role="status">Cargando...</p>
      </main>
    );
  }

  const handleUsuarioActualizado = (usuarioActualizado) => {
    setUsuario(usuarioActualizado);
    actualizarUsuarioGuardado(usuarioActualizado);
  };

  if (usuario?.debeCambiarContrasena) {
    return <CambioContrasenaObligatorio usuario={usuario} onCambiada={handleUsuarioActualizado} onLogout={handleLogout} />;
  }

  if (usuario) {
    return <Dashboard usuario={usuario} onLogout={handleLogout} onUsuarioActualizado={handleUsuarioActualizado} />;
  }

  return (
    <main className={`min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 transition-all ${modoAdultoMayor ? 'text-[20px]' : 'text-base'}`}>

      {/* Tarjeta principal de Login (Modo oscuro por defecto #0F172A / #1E293B) */}
      <div className={`bg-slate-900 p-8 rounded-2xl shadow-2xl w-full border border-slate-800 text-slate-100 transition-all ${modoAdultoMayor ? 'max-w-xl p-10' : 'max-w-md'}`}>

        {/* Logo / Ícono superior: Corazón con pulso médico */}
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-500">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h2l1-1.5 2 3L15 12h2" />
            </svg>
          </div>
        </div>

        {/* Cabecera / Título */}
        <div className="text-center mb-6">
          <h1 className={`font-bold tracking-tight text-white ${modoAdultoMayor ? 'text-4xl' : 'text-2xl'}`}>Salux</h1>
          <p className={`text-slate-400 mt-1 ${modoAdultoMayor ? 'text-sm' : 'text-xs'}`}>
            {modo === 'olvide' ? 'Recuperar contraseña' : modo === 'reset' ? 'Elegí tu nueva contraseña' : modo === 'verificar' ? 'Verificación de email' : 'Sistema de Gestión de Turnos Médicos'}
          </p>
        </div>

        {error && (
          <div id="acceso-error" role="alert" className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}
        {mensaje && (
          <div role="status" className="mb-4 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
            {mensaje}
          </div>
        )}

        {/* Formulario: pedir el email para el reset */}
        {modo === 'olvide' && (
          <form className={`space-y-4 ${modoAdultoMayor ? 'space-y-6' : ''}`} onSubmit={handleOlvideContrasena}>
            <p className={`text-slate-400 ${modoAdultoMayor ? 'text-sm' : 'text-xs'}`}>Ingresá el email de tu cuenta y te mandamos un enlace para elegir una contraseña nueva.</p>
            <div>
              <label htmlFor="acceso-email" className={`block font-semibold uppercase tracking-wider text-slate-400 mb-1 ${modoAdultoMayor ? 'text-sm' : 'text-xs'}`}>
                Email <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <input id="acceso-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="Ej: nombre@email.com"
                className={`w-full rounded-lg bg-slate-950 border border-slate-700 focus:ring-2 focus:ring-blue-600 focus:outline-none text-slate-200 placeholder-slate-400 ${modoAdultoMayor ? 'px-5 py-4 text-lg min-h-[56px]' : 'px-4 py-3 text-sm'}`}
              />
            </div>
            <button
              type="submit"
              disabled={enviando}
              className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition shadow-md flex items-center justify-center disabled:opacity-60 ${modoAdultoMayor ? 'py-4 text-lg min-h-[60px]' : 'py-3 text-sm min-h-[52px]'}`}
            >
              {enviando ? 'Enviando...' : 'Enviar enlace'}
            </button>
            <button
              type="button"
              onClick={() => cambiarModo('login')}
              className={`w-full bg-transparent hover:bg-slate-800 text-slate-300 border border-slate-700 font-medium rounded-lg transition flex items-center justify-center ${modoAdultoMayor ? 'py-4 text-lg min-h-[60px]' : 'py-3 text-sm min-h-[52px]'}`}
            >
              &larr; Volver a iniciar sesión
            </button>
          </form>
        )}

        {/* Resultado de la verificación de email (llegó acá con ?verificar=TOKEN) */}
        {modo === 'verificar' && (
          <button
            type="button"
            onClick={() => cambiarModo('login')}
            className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition shadow-md flex items-center justify-center ${modoAdultoMayor ? 'py-4 text-lg min-h-[60px]' : 'py-3 text-sm min-h-[52px]'}`}
          >
            Ir a iniciar sesión
          </button>
        )}

        {/* Formulario: elegir la nueva contraseña (llegó acá con ?reset=TOKEN) */}
        {modo === 'reset' && (
          <form className={`space-y-4 ${modoAdultoMayor ? 'space-y-6' : ''}`} onSubmit={handleResetearContrasena}>
            <div>
              <label htmlFor="acceso-contrasena-nueva" className={`block font-semibold uppercase tracking-wider text-slate-400 mb-1 ${modoAdultoMayor ? 'text-sm' : 'text-xs'}`}>
                Contraseña nueva <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <input id="acceso-contrasena-nueva" {...atributos('acceso-contrasena-nueva', { error: 'acceso-error', ayuda: 'acceso-contrasena-nueva-ayuda' })}
                type="password"
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
                required
                minLength={10}
                placeholder="Mínimo 10 caracteres"
                className={`w-full rounded-lg bg-slate-950 border border-slate-700 focus:ring-2 focus:ring-blue-600 focus:outline-none text-slate-200 placeholder-slate-400 ${modoAdultoMayor ? 'px-5 py-4 text-lg min-h-[56px]' : 'px-4 py-3 text-sm'}`}
              />
              <p id="acceso-contrasena-nueva-ayuda" className="text-slate-400 text-xs mt-1">Con letras y números; sin contraseñas comunes ni tus datos.</p>
            </div>
            <div>
              <label htmlFor="acceso-confirmar-contrasena" className={`block font-semibold uppercase tracking-wider text-slate-400 mb-1 ${modoAdultoMayor ? 'text-sm' : 'text-xs'}`}>
                Confirmar contraseña <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <input id="acceso-confirmar-contrasena" {...atributos('acceso-confirmar-contrasena', { error: 'acceso-error' })}
                type="password"
                value={confirmarContrasena}
                onChange={(e) => setConfirmarContrasena(e.target.value)}
                required
                minLength={10}
                className={`w-full rounded-lg bg-slate-950 border border-slate-700 focus:ring-2 focus:ring-blue-600 focus:outline-none text-slate-200 placeholder-slate-400 ${modoAdultoMayor ? 'px-5 py-4 text-lg min-h-[56px]' : 'px-4 py-3 text-sm'}`}
              />
            </div>
            <button
              type="submit"
              disabled={enviando}
              className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition shadow-md flex items-center justify-center disabled:opacity-60 ${modoAdultoMayor ? 'py-4 text-lg min-h-[60px]' : 'py-3 text-sm min-h-[52px]'}`}
            >
              {enviando ? 'Guardando...' : 'Guardar contraseña nueva'}
            </button>
            <button
              type="button"
              onClick={() => {
                window.history.replaceState({}, '', window.location.pathname);
                cambiarModo('login');
              }}
              className={`w-full bg-transparent hover:bg-slate-800 text-slate-300 border border-slate-700 font-medium rounded-lg transition flex items-center justify-center ${modoAdultoMayor ? 'py-4 text-lg min-h-[60px]' : 'py-3 text-sm min-h-[52px]'}`}
            >
              &larr; Volver a iniciar sesión
            </button>
          </form>
        )}

        {/* Formulario: login / registro */}
        {(modo === 'login' || modo === 'registro') && (
        <form className={`space-y-4 ${modoAdultoMayor ? 'space-y-6' : ''}`} onSubmit={modo === 'login' ? handleLogin : handleRegistro}>
          {modo === 'registro' && (
            <>
              <div>
                <label htmlFor="acceso-nombre-completo" className={`block font-semibold uppercase tracking-wider text-slate-400 mb-1 ${modoAdultoMayor ? 'text-sm' : 'text-xs'}`}>
                  Nombre completo <span className="text-red-500" aria-hidden="true">*</span>
                </label>
                <input id="acceso-nombre-completo" {...atributos('acceso-nombre-completo', { error: 'acceso-error' })}
                  type="text"
                  value={nomYape}
                  onChange={(e) => setNomYape(e.target.value)}
                  required
                  placeholder="Ej: Juan Pérez"
                  className={`w-full rounded-lg bg-slate-950 border border-slate-700 focus:ring-2 focus:ring-blue-600 focus:outline-none text-slate-200 placeholder-slate-400 ${modoAdultoMayor ? 'px-5 py-4 text-lg min-h-[56px]' : 'px-4 py-3 text-sm'}`}
                />
              </div>
              <div>
                <label htmlFor="acceso-dni" className={`block font-semibold uppercase tracking-wider text-slate-400 mb-1 ${modoAdultoMayor ? 'text-sm' : 'text-xs'}`}>
                  DNI <span className="text-red-500" aria-hidden="true">*</span>
                </label>
                <input id="acceso-dni" {...atributos('acceso-dni', { error: 'acceso-error' })}
                  type="text"
                  value={dni}
                  onChange={(e) => setDni(e.target.value)}
                  required
                  placeholder="Ej: 30456789"
                  className={`w-full rounded-lg bg-slate-950 border border-slate-700 focus:ring-2 focus:ring-blue-600 focus:outline-none text-slate-200 placeholder-slate-400 ${modoAdultoMayor ? 'px-5 py-4 text-lg min-h-[56px]' : 'px-4 py-3 text-sm'}`}
                />
              </div>
            </>
          )}

          <div>
            <label htmlFor="acceso-identificador" className={`block font-semibold uppercase tracking-wider text-slate-400 mb-1 ${modoAdultoMayor ? 'text-sm' : 'text-xs'}`}>
              {modo === 'login' ? 'DNI o Email' : 'Email'} <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            <input id="acceso-identificador" {...atributos('acceso-identificador', { error: 'acceso-error' })}
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder={modo === 'login' ? 'Ej: 30456789 o nombre@email.com' : 'Ej: nombre@email.com'}
              className={`w-full rounded-lg bg-slate-950 border border-slate-700 focus:ring-2 focus:ring-blue-600 focus:outline-none text-slate-200 placeholder-slate-400 ${modoAdultoMayor ? 'px-5 py-4 text-lg min-h-[56px]' : 'px-4 py-3 text-sm'}`}
            />
          </div>

          <div>
            <label htmlFor="acceso-contrasena" className={`block font-semibold uppercase tracking-wider text-slate-400 mb-1 ${modoAdultoMayor ? 'text-sm' : 'text-xs'}`}>
              Contraseña <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            <div className="relative">
              <input id="acceso-contrasena" {...atributos('acceso-contrasena', { error: 'acceso-error' })}
                type={mostrarPassword ? "text" : "password"}
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
                required
                minLength={modo === 'registro' ? 10 : undefined}
                placeholder={modo === 'login' ? 'Ingresá tu contraseña' : 'Mínimo 10 caracteres'}
                className={`w-full rounded-lg bg-slate-950 border border-slate-700 focus:ring-2 focus:ring-blue-600 focus:outline-none text-slate-200 placeholder-slate-400 pr-10 ${modoAdultoMayor ? 'px-5 py-4 text-lg min-h-[56px]' : 'px-4 py-3 text-sm'}`}
              />
              {/* Botón del ícono de visibilidad (ojo) */}
              <button
                type="button"
                onClick={() => setMostrarPassword(!mostrarPassword)}
                aria-label={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={mostrarPassword}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mostrarPassword ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          {modo === 'login' && requiereVerificacion && (
            <button
              type="button"
              onClick={reenviarVerificacion}
              className={`text-blue-500 hover:underline text-left ${modoAdultoMayor ? 'text-base' : 'text-xs'}`}
            >
              ¿No te llegó el email para activar tu cuenta? Reenviar enlace
            </button>
          )}

          {modo === 'login' && (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => cambiarModo('olvide')}
                className={`text-blue-500 hover:underline ${modoAdultoMayor ? 'text-base' : 'text-xs'}`}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={enviando}
            className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition shadow-md flex items-center justify-center disabled:opacity-60 ${modoAdultoMayor ? 'py-4 text-lg min-h-[60px]' : 'py-3 text-sm min-h-[52px]'}`}
          >
            {enviando ? (modo === 'login' ? 'Ingresando...' : 'Creando cuenta...') : (modo === 'login' ? 'Iniciar sesión' : 'Crear cuenta')}
          </button>

          <button
            type="button"
            onClick={() => cambiarModo(modo === 'login' ? 'registro' : 'login')}
            className={`w-full bg-transparent hover:bg-slate-800 text-slate-300 border border-slate-700 font-medium rounded-lg transition flex items-center justify-center ${modoAdultoMayor ? 'py-4 text-lg min-h-[60px]' : 'py-3 text-sm min-h-[52px]'}`}
          >
            {modo === 'login' ? 'Crear una cuenta' : 'Ya tengo una cuenta'}
          </button>
        </form>
        )}

        {/* Toggle de Modo Adulto Mayor centrado y abajo en la tarjeta (según PDF) */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex flex-col items-center justify-center space-y-2">
          <span className={`text-slate-400 font-medium ${modoAdultoMayor ? 'text-sm text-blue-400' : 'text-xs'}`}>
            Modo adulto mayor
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={modoAdultoMayor}
            aria-label="Modo adulto mayor"
            onClick={() => {
              guardarPreferenciasAccesibilidad({ modoAdultoMayor: !modoAdultoMayor });
              setModoAdultoMayor(!modoAdultoMayor);
            }}
            className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-300 ${modoAdultoMayor ? 'bg-blue-600' : 'bg-slate-700'}`}
          >
            <div className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${modoAdultoMayor ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>

      </div>

      {/* Footer / Copyright según el documento */}
      <footer className="mt-6 text-center text-slate-400 text-xs">
        © 2026 Salux — Sistema Médico Accesible
      </footer>

    </main>
  );
}

export default App;

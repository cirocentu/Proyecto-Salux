import { useState, useEffect } from 'react';
import { api } from './api';
import { useDialogo } from './useDialogo';
import { DIAS_A_MOSTRAR, generarProximosDias, generarHorariosDelDia } from './turnoUtils';

function NuevoTurnoModal({ onClose, onCreado }) {
  const { ref, tituloId, propsFondo } = useDialogo(onClose, { cerrarConClicEnFondo: true });
  const [paso, setPaso] = useState(1);
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [especialidades, setEspecialidades] = useState([]);
  const [medicos, setMedicos] = useState([]);

  const [especialidadId, setEspecialidadId] = useState(null);
  const [medicoId, setMedicoId] = useState(null);
  const [fechaSeleccionada, setFechaSeleccionada] = useState(null);
  const [horaSeleccionada, setHoraSeleccionada] = useState(null);
  const [disponibilidadMedico, setDisponibilidadMedico] = useState(null);

  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState('');

  const [proximosDias] = useState(() => generarProximosDias(DIAS_A_MOSTRAR));
  const horariosDelDia = generarHorariosDelDia(fechaSeleccionada, disponibilidadMedico);

  const elegirDia = (dia) => {
    setFechaSeleccionada(dia);
    setHoraSeleccionada(null);
  };

  // Al elegir médico, traemos su disponibilidad real para generar los
  // horarios del paso 3 (en vez del rango fijo 8-20hs).
  const elegirMedico = (idMedico) => {
    setMedicoId(idMedico);
    setPaso(3);
    setFechaSeleccionada(null);
    setHoraSeleccionada(null);
    setDisponibilidadMedico(null);
    api.disponibilidadDeMedico(idMedico)
      .then(({ data }) => setDisponibilidadMedico(data))
      .catch(() => setDisponibilidadMedico(null));
  };

  useEffect(() => {
    Promise.all([api.especialidades(), api.medicos()])
      .then(([resEsp, resMed]) => {
        setEspecialidades(resEsp.data);
        setMedicos(resMed.data);
      })
      .catch((err) => setErrorCarga(err.message))
      .finally(() => setCargandoDatos(false));
  }, []);

  const medicosDeLaEspecialidad = medicos.filter((m) =>
    m.especialidades?.some((e) => e.idEspecialidad === especialidadId)
  );
  const medicoElegido = medicos.find((m) => m.idMedico === medicoId);

  const confirmar = async () => {
    setEnviando(true);
    setErrorEnvio('');
    try {
      await api.crearTurno(medicoId, horaSeleccionada.toISOString(), especialidadId);
      onCreado();
    } catch (err) {
      setErrorEnvio(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div {...propsFondo} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tituloId} className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg text-slate-100 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 id={tituloId} className="font-bold text-lg">Solicitar turno</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-200 text-xl leading-none w-10 h-10 -mr-2 inline-flex items-center justify-center rounded-lg">&times;</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {cargandoDatos && <p role="status" className="text-slate-400 text-sm">Cargando especialidades y médicos...</p>}

          {errorCarga && !cargandoDatos && (
            <div role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              No se pudo cargar la información: {errorCarga}
            </div>
          )}

          {!cargandoDatos && !errorCarga && paso === 1 && (
            <>
              <p className="text-sm text-slate-400">Paso 1 de 3 — Elegí una especialidad</p>
              {especialidades.length === 0 ? (
                <p className="text-slate-400 text-sm">Todavía no hay especialidades cargadas en el sistema.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {especialidades.map((esp) => (
                    <button
                      key={esp.idEspecialidad}
                      onClick={() => { setEspecialidadId(esp.idEspecialidad); setMedicoId(null); setPaso(2); }}
                      className="px-4 py-3 rounded-lg border border-slate-700 bg-slate-800 hover:border-blue-500 text-left font-medium transition"
                    >
                      {esp.nombre}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {!cargandoDatos && !errorCarga && paso === 2 && (
            <>
              <p className="text-sm text-slate-400">Paso 2 de 3 — Elegí un médico</p>
              {medicosDeLaEspecialidad.length === 0 ? (
                <p className="text-slate-400 text-sm">No hay médicos cargados para esta especialidad todavía.</p>
              ) : (
                <div className="space-y-2">
                  {medicosDeLaEspecialidad.map((m) => (
                    <button
                      key={m.idMedico}
                      onClick={() => elegirMedico(m.idMedico)}
                      className="w-full px-4 py-3 rounded-lg border border-slate-700 bg-slate-800 hover:border-blue-500 text-left transition"
                    >
                      <p className="font-medium">{m.usuario?.nomYape}</p>
                      <p className="text-xs text-slate-400">{m.consultorio ? `Consultorio ${m.consultorio}` : 'Consultorio a confirmar'}</p>
                      <p className="text-xs mt-1">
                        {m.proximaDisponibilidad ? (
                          <span className="text-emerald-400">
                            Próximo lugar: {new Date(m.proximaDisponibilidad).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} a las {new Date(m.proximaDisponibilidad).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : (
                          <span className="text-slate-400">Sin franjas configuradas todavía</span>
                        )}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setPaso(1)} className="text-sm text-blue-400 hover:underline">&larr; Cambiar especialidad</button>
            </>
          )}

          {!cargandoDatos && !errorCarga && paso === 3 && (
            <>
              <p className="text-sm text-slate-400">Paso 3 de 3 — Elegí fecha y hora</p>
              <div className="px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-sm">
                <p className="font-medium">{medicoElegido?.usuario?.nomYape}</p>
                <p className="text-slate-400">{especialidades.find((e) => e.idEspecialidad === especialidadId)?.nombre}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Elegí un día</p>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                  {proximosDias.map((dia) => {
                    const seleccionado = fechaSeleccionada?.getTime() === dia.getTime();
                    return (
                      <button
                        key={dia.getTime()}
                        type="button"
                        onClick={() => elegirDia(dia)}
                        className={`shrink-0 flex flex-col items-center justify-center w-16 py-2 rounded-lg border text-xs font-medium transition ${
                          seleccionado
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'border-slate-700 bg-slate-800 hover:border-blue-500 text-slate-300'
                        }`}
                      >
                        <span className="uppercase">{dia.toLocaleDateString('es-AR', { weekday: 'short' })}</span>
                        <span className="text-lg font-bold leading-tight">{dia.getDate()}</span>
                        <span className="capitalize">{dia.toLocaleDateString('es-AR', { month: 'short' })}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {fechaSeleccionada && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Elegí un horario</p>
                  {horariosDelDia.length === 0 ? (
                    <p className="text-slate-400 text-sm">No quedan horarios disponibles ese día. Probá con otra fecha.</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-2">
                      {horariosDelDia.map((slot) => {
                        const seleccionado = horaSeleccionada?.getTime() === slot.getTime();
                        return (
                          <button
                            key={slot.getTime()}
                            type="button"
                            onClick={() => setHoraSeleccionada(slot)}
                            className={`py-2 rounded-lg border text-sm font-medium transition ${
                              seleccionado
                                ? 'bg-blue-600 border-blue-500 text-white'
                                : 'border-slate-700 bg-slate-800 hover:border-blue-500 text-slate-300'
                            }`}
                          >
                            {slot.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {horaSeleccionada && (
                <div className="px-4 py-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 text-sm">
                  Turno el{' '}
                  <strong className="capitalize">
                    {horaSeleccionada.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </strong>{' '}
                  a las <strong>{horaSeleccionada.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</strong>
                </div>
              )}

              {errorEnvio && (
                <div role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                  {errorEnvio}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setPaso(2)} className="text-sm text-blue-400 hover:underline">&larr; Cambiar médico</button>
                <button
                  onClick={confirmar}
                  disabled={!horaSeleccionada || enviando}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg transition"
                >
                  {enviando ? 'Reservando...' : 'Confirmar turno'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default NuevoTurnoModal;

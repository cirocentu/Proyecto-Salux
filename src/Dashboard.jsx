import { useState, useEffect, useRef } from 'react';
import { api, getPreferenciasAccesibilidad, guardarPreferenciasAccesibilidad } from './api';
import NuevoTurnoModal from './NuevoTurnoModal';
import AdminAltaModal from './AdminAltaModal';
import PerfilModal from './PerfilModal';
import EditarMedicoModal from './EditarMedicoModal';
import ReprogramarTurnoModal from './ReprogramarTurnoModal';
import DialogoConfirmacion from './DialogoConfirmacion';

const ESTADO_TEXTO = { PENDIENTE: 'Pendiente', CONFIRMADO: 'Confirmado', CANCELADO: 'Cancelado', FINALIZADO: 'Finalizado' };
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function horaAMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}
function minutosAHora(minutos) {
  const h = Math.floor(minutos / 60).toString().padStart(2, '0');
  const m = (minutos % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatearTurno(t) {
  const fecha = new Date(t.fechaYhora);
  const fechaTexto = fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const horaTexto = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + ' hs';
  return {
    id: t.idTurno,
    medicoId: t.medico?.idMedico,
    especialidad: t.especialidad?.nombre || t.medico?.especialidades?.[0]?.nombre || 'Consulta general',
    medico: t.medico?.usuario?.nomYape || 'Médico',
    consultorio: t.medico?.consultorio ? `Consultorio ${t.medico.consultorio}` : 'Consultorio a confirmar',
    fecha: fechaTexto.charAt(0).toUpperCase() + fechaTexto.slice(1),
    hora: horaTexto,
    estado: ESTADO_TEXTO[t.estado] || t.estado,
    fechaISO: t.fechaYhora,
    confirmadoPorPaciente: !!t.confirmadoPorPaciente,
  };
}

function formatearTurnoAdmin(t) {
  const fecha = new Date(t.fechaYhora);
  const fechaTexto = fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaTexto = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + ' hs';
  return {
    id: t.idTurno,
    paciente: t.paciente?.usuario?.nomYape || 'Paciente',
    especialidad: t.especialidad?.nombre || t.medico?.especialidades?.[0]?.nombre || 'Consulta general',
    medico: t.medico?.usuario?.nomYape || 'Médico',
    fecha: fechaTexto,
    hora: horaTexto,
    estado: ESTADO_TEXTO[t.estado] || t.estado,
    fechaISO: t.fechaYhora,
  };
}

function formatearTurnoMedico(t) {
  const fecha = new Date(t.fechaYhora);
  const fechaTexto = fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const horaTexto = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + ' hs';
  return {
    id: t.idTurno,
    paciente: t.paciente?.usuario?.nomYape || 'Paciente',
    email: t.paciente?.usuario?.email || '',
    obraSocial: t.paciente?.obraSocial || 'Sin obra social registrada',
    telefono: t.paciente?.telefono || 'Sin teléfono registrado',
    fecha: fechaTexto.charAt(0).toUpperCase() + fechaTexto.slice(1),
    hora: horaTexto,
    estado: ESTADO_TEXTO[t.estado] || t.estado,
    fechaISO: t.fechaYhora,
    confirmadoPorPaciente: !!t.confirmadoPorPaciente,
  };
}

const ESTADO_ENUM = { Pendiente: 'PENDIENTE', Confirmado: 'CONFIRMADO', Cancelado: 'CANCELADO', Finalizado: 'FINALIZADO' };

function saludoSegunHora() {
  const hora = new Date().getHours();
  if (hora < 12) return 'Buenos días,';
  if (hora < 20) return 'Buenas tardes,';
  return 'Buenas noches,';
}

function iniciales(nombre) {
  if (!nombre) return '??';
  return nombre.trim().split(/\s+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

// ¿La persona pidió menos movimiento en su sistema operativo?
function prefiereMenosMovimiento() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const TITULOS_DE_VISTA = {
  dashboard: 'Inicio',
  'mis-turnos': 'Mis turnos',
  historial: 'Historial',
  admin: 'Administración',
  'agenda-medico': 'Mi agenda',
  disponibilidad: 'Mi disponibilidad',
};

function Dashboard({ usuario, onLogout, onUsuarioActualizado }) {
  const [vistaActual, setVistaActual] = useState('dashboard');
  const [filtroEstado, setFiltroEstado] = useState('Todos');

  // En una app de una sola página, cambiar de vista no recarga nada: un lector de pantalla no
  // se entera. Se actualiza el título de la pestaña y, al CAMBIAR de vista (no al cargar), el
  // foco pasa al título de la vista nueva, que el lector anuncia.
  const vistaPrevia = useRef(vistaActual);
  useEffect(() => {
    document.title = `${TITULOS_DE_VISTA[vistaActual] || 'Salux'} — Salux`;
    if (vistaPrevia.current === vistaActual) return;
    vistaPrevia.current = vistaActual;
    const titulo = document.querySelector('main h1');
    if (titulo) {
      titulo.tabIndex = -1;
      titulo.style.outline = 'none'; // el foco es programático: no es un control con el que se interactúa
      titulo.focus({ preventScroll: true });
    }
  }, [vistaActual]);

  // Estados de accesibilidad globales
  const [menuAccesibilidadAbierto, setMenuAccesibilidadAbierto] = useState(false);
  const [menuMobileAbierto, setMenuMobileAbierto] = useState(false);
  const [alertaActiva, setAlertaActiva] = useState(true);
  const [prefsGuardadas] = useState(getPreferenciasAccesibilidad);
  const [modoOscuro, setModoOscuro] = useState(prefsGuardadas.modoOscuro ?? true);
  const [altoContraste, setAltoContraste] = useState(prefsGuardadas.altoContraste ?? false);
  const [modoAdultoMayor, setModoAdultoMayor] = useState(prefsGuardadas.modoAdultoMayor ?? false);
  // Sin preferencia guardada se respeta la del sistema operativo (prefers-reduced-motion).
  const [reducirAnimaciones, setReducirAnimaciones] = useState(prefsGuardadas.reducirAnimaciones ?? prefiereMenosMovimiento());

  useEffect(() => {
    guardarPreferenciasAccesibilidad({ modoOscuro, altoContraste, modoAdultoMayor, reducirAnimaciones });
  }, [modoOscuro, altoContraste, modoAdultoMayor, reducirAnimaciones]);

  // Colores por tema. Cada combinación cumple WCAG AA (4,5:1) sobre su fondo; los números
  // están medidos con axe-core (ver test/a11y). No uses la variante dark de Tailwind: depende
  // del tema del SISTEMA operativo, no del que la persona elige acá.
  // Texto secundario sobre el fondo de la PÁGINA (oscuro en el tema oscuro, claro en los demás).
  const textoApoyo = altoContraste ? 'text-slate-700' : modoOscuro ? 'text-slate-400' : 'text-slate-600';
  // Texto secundario sobre las TARJETAS (blancas en alto contraste, oscuras en el resto).
  // Azul de las etiquetas dentro de tarjetas: claro sobre tarjeta oscura, profundo sobre tarjeta blanca.
  const azulEnTarjeta = altoContraste ? 'text-blue-800' : 'text-blue-400';
  const textoEnTarjeta = altoContraste ? 'text-slate-700' : 'text-slate-400';
  // Acción destructiva ("Eliminar") sobre tarjeta: rojo claro sobre oscuro, rojo profundo sobre blanco.
  const claseEliminar = altoContraste ? 'text-[#991B1B] hover:text-[#7F1D1D]' : 'text-red-400 hover:text-red-300';
  // Elemento "activo" del menú: azul claro sobre fondo oscuro, azul profundo sobre fondo claro.
  const textoAzul = modoOscuro ? 'text-[#60A5FA]' : 'text-[#1D4ED8]';
  const tonoAzul = modoOscuro ? 'bg-[#2563EB]/10 text-[#60A5FA]' : 'bg-[#2563EB]/10 text-[#1D4ED8]';
  const claseNavActiva = altoContraste ? 'bg-black text-white font-semibold' : `${tonoAzul} font-semibold`;
  const claseSalir = altoContraste ? 'text-[#991B1B]' : modoOscuro ? 'text-[#F87171]' : 'text-[#B91C1C]';
  const claseSaludo = altoContraste ? 'text-black font-medium' : modoOscuro ? 'text-[#94A3B8]' : 'text-[#475569]';
  // Anillo de foco de una tarjeta clicable (solo con teclado).
  const anilloFoco = altoContraste
    ? 'has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-black'
    : modoOscuro
      ? 'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#60A5FA]'
      : 'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#1D4ED8]';
  // Bordes y fondos de los botones del encabezado (antes dependían del tema del sistema).
  const bordeEncabezado = altoContraste ? 'border-black text-black bg-white' : modoOscuro ? 'border-[#334155] hover:bg-slate-800' : 'border-[#E2E8F0] hover:bg-slate-100';

  // Turnos reales del paciente logueado (sección 2.3 del documento)
  const esPaciente = usuario.rol === 'paciente';
  const esAdmin = usuario.rol === 'admin';
  const esMedico = usuario.rol === 'medico';

  const [listaTurnos, setListaTurnos] = useState([]);
  const [cargandoTurnos, setCargandoTurnos] = useState(() => esPaciente);
  const [errorTurnos, setErrorTurnos] = useState('');
  const [ahora] = useState(() => Date.now());
  const [mostrarModalTurno, setMostrarModalTurno] = useState(false);
  const [mostrarModalAlta, setMostrarModalAlta] = useState(false);
  const [mostrarModalPerfil, setMostrarModalPerfil] = useState(false);
  const [mostrarConfirmarSalir, setMostrarConfirmarSalir] = useState(false);
  // { descripcion, ejecutar }: qué turno se va a cancelar y la acción a correr al confirmar
  const [confirmacionCancelacion, setConfirmacionCancelacion] = useState(null);

  const cargarMisTurnos = () => {
    api.misTurnos()
      .then(({ data }) => setListaTurnos(data.map(formatearTurno)))
      .catch((err) => setErrorTurnos(err.message))
      .finally(() => setCargandoTurnos(false));
  };

  useEffect(() => {
    if (!esPaciente) return;
    cargarMisTurnos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turnoCreado = () => {
    setMostrarModalTurno(false);
    setVistaActual('mis-turnos');
    setCargandoTurnos(true);
    cargarMisTurnos();
  };

  const cancelarTurno = async (id) => {
    try {
      await api.cancelarTurno(id);
      setListaTurnos((prev) => prev.map((t) => (t.id === id ? { ...t, estado: 'Cancelado' } : t)));
    } catch (err) {
      alert(`No se pudo cancelar el turno: ${err.message}`);
    }
  };

  const confirmarAsistencia = async (id) => {
    try {
      await api.confirmarAsistencia(id);
      setListaTurnos((prev) => prev.map((t) => (t.id === id ? { ...t, confirmadoPorPaciente: true } : t)));
    } catch (err) {
      alert(`No se pudo confirmar la asistencia: ${err.message}`);
    }
  };

  const [turnoAReprogramar, setTurnoAReprogramar] = useState(null);
  const turnoReprogramado = () => {
    setTurnoAReprogramar(null);
    setCargandoTurnos(true);
    cargarMisTurnos();
  };

  const turnosFiltrados = listaTurnos.filter(turno => {
    if (filtroEstado === 'Todos') return true;
    if (filtroEstado === 'Confirmados') return turno.estado === 'Confirmado';
    if (filtroEstado === 'Pendientes') return turno.estado === 'Pendiente';
    if (filtroEstado === 'Cancelados') return turno.estado === 'Cancelado';
    return true;
  });

  const turnosActivos = listaTurnos.filter(t => t.estado === 'Pendiente' || t.estado === 'Confirmado');
  const historialTurnos = listaTurnos
    .filter(t => t.estado === 'Finalizado' || t.estado === 'Cancelado')
    .sort((a, b) => new Date(b.fechaISO) - new Date(a.fechaISO));
  const proximoTurno = turnosActivos
    .filter(t => new Date(t.fechaISO).getTime() > ahora)
    .sort((a, b) => new Date(a.fechaISO) - new Date(b.fechaISO))[0];
  const diasHastaProximo = proximoTurno
    ? Math.max(0, Math.ceil((new Date(proximoTurno.fechaISO) - ahora) / (1000 * 60 * 60 * 24)))
    : null;

  // ==========================================
  // Estado y datos del Panel de Administración (Sección 2.4)
  // ==========================================
  const [turnosAdmin, setTurnosAdmin] = useState([]);
  const [cargandoAdmin, setCargandoAdmin] = useState(() => esAdmin);
  const [errorAdmin, setErrorAdmin] = useState('');
  const [busquedaAdmin, setBusquedaAdmin] = useState('');
  const [filtroEstadoAdmin, setFiltroEstadoAdmin] = useState('Todos');

  useEffect(() => {
    if (!esAdmin) return;
    api.todosLosTurnos()
      .then(({ data }) => setTurnosAdmin(data.map(formatearTurnoAdmin)))
      .catch((err) => setErrorAdmin(err.message))
      .finally(() => setCargandoAdmin(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const estadisticasAdmin = {
    total: turnosAdmin.length,
    confirmados: turnosAdmin.filter(t => t.estado === 'Confirmado').length,
    pendientes: turnosAdmin.filter(t => t.estado === 'Pendiente').length,
    cancelados: turnosAdmin.filter(t => t.estado === 'Cancelado').length,
  };

  const turnosAdminFiltrados = turnosAdmin.filter(turno => {
    const coincideEstado = filtroEstadoAdmin === 'Todos' || turno.estado === filtroEstadoAdmin;
    const textoBusqueda = busquedaAdmin.trim().toLowerCase();
    const coincideBusqueda = textoBusqueda === '' ||
      turno.paciente.toLowerCase().includes(textoBusqueda) ||
      turno.medico.toLowerCase().includes(textoBusqueda) ||
      turno.especialidad.toLowerCase().includes(textoBusqueda);
    return coincideEstado && coincideBusqueda;
  });

  const actualizarEstadoTurnoAdmin = async (id, nuevoEstado) => {
    try {
      await api.actualizarEstadoTurno(id, ESTADO_ENUM[nuevoEstado]);
      setTurnosAdmin(prev => prev.map(t => t.id === id ? { ...t, estado: nuevoEstado } : t));
    } catch (err) {
      alert(`No se pudo actualizar el turno: ${err.message}`);
    }
  };

  // Data table de médicos (a diferencia de api.medicos(), esta trae también
  // los inactivos para que el admin pueda reactivarlos)
  const [tabAdmin, setTabAdmin] = useState('turnos');
  const [medicoEditando, setMedicoEditando] = useState(null);
  const [medicosAdmin, setMedicosAdmin] = useState([]);
  const [cargandoMedicosAdmin, setCargandoMedicosAdmin] = useState(() => esAdmin);
  const [errorMedicosAdmin, setErrorMedicosAdmin] = useState('');

  const cargarMedicosAdmin = () => {
    api.todosLosMedicos()
      .then(({ data }) => setMedicosAdmin(data))
      .catch((err) => setErrorMedicosAdmin(err.message))
      .finally(() => setCargandoMedicosAdmin(false));
  };

  useEffect(() => {
    if (!esAdmin) return;
    cargarMedicosAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desactivar a un médico con turnos futuros pide confirmación: el servidor responde 409
  // con la cantidad y recién con el "sí" se cancelan esos turnos (y se avisa a los pacientes).
  const [confirmacionDesactivarMedico, setConfirmacionDesactivarMedico] = useState(null);

  const toggleEstadoMedico = async (medico, cancelarTurnosFuturos = false) => {
    const nuevoEstado = !medico.usuario.activo;
    try {
      await (cancelarTurnosFuturos
        ? api.cambiarEstadoMedico(medico.idMedico, nuevoEstado, true)
        : api.cambiarEstadoMedico(medico.idMedico, nuevoEstado));
      setMedicosAdmin(prev => prev.map(m =>
        m.idMedico === medico.idMedico ? { ...m, usuario: { ...m.usuario, activo: nuevoEstado } } : m
      ));
    } catch (err) {
      if (err.turnosFuturos > 0 && !cancelarTurnosFuturos) {
        setConfirmacionDesactivarMedico({ medico, cantidad: err.turnosFuturos });
        return;
      }
      alert(`No se pudo cambiar el estado del médico: ${err.message}`);
    }
  };

  // ==========================================
  // Agenda del médico logueado
  // ==========================================
  const [agendaMedico, setAgendaMedico] = useState([]);
  const [cargandoAgenda, setCargandoAgenda] = useState(() => esMedico);
  const [errorAgenda, setErrorAgenda] = useState('');

  useEffect(() => {
    if (!esMedico) return;
    api.agendaMedico()
      .then(({ data }) => setAgendaMedico(data.map(formatearTurnoMedico)))
      .catch((err) => setErrorAgenda(err.message))
      .finally(() => setCargandoAgenda(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turnosHoyMedico = agendaMedico.filter((t) => {
    const hoy = new Date(ahora);
    const fechaTurno = new Date(t.fechaISO);
    return fechaTurno.toDateString() === hoy.toDateString() && t.estado !== 'Cancelado';
  });

  const actualizarEstadoAgenda = async (id, nuevoEstado) => {
    try {
      await api.actualizarEstadoTurno(id, ESTADO_ENUM[nuevoEstado]);
      setAgendaMedico(prev => prev.map(t => t.id === id ? { ...t, estado: nuevoEstado } : t));
    } catch (err) {
      alert(`No se pudo actualizar el turno: ${err.message}`);
    }
  };

  // ==========================================
  // Disponibilidad semanal del médico logueado
  // ==========================================
  const [disponibilidades, setDisponibilidades] = useState([]);
  const [cargandoDisponibilidad, setCargandoDisponibilidad] = useState(() => esMedico);
  const [errorDisponibilidad, setErrorDisponibilidad] = useState('');
  const [nuevaDia, setNuevaDia] = useState('1');
  const [nuevaHoraInicio, setNuevaHoraInicio] = useState('08:00');
  const [nuevaHoraFin, setNuevaHoraFin] = useState('12:00');
  const [guardandoDisponibilidad, setGuardandoDisponibilidad] = useState(false);
  const [errorNuevaDisponibilidad, setErrorNuevaDisponibilidad] = useState('');

  useEffect(() => {
    if (!esMedico) return;
    api.misDisponibilidades()
      .then(({ data }) => setDisponibilidades(data))
      .catch((err) => setErrorDisponibilidad(err.message))
      .finally(() => setCargandoDisponibilidad(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agregarDisponibilidad = async (e) => {
    e.preventDefault();
    setErrorNuevaDisponibilidad('');
    setGuardandoDisponibilidad(true);
    try {
      const { data } = await api.crearDisponibilidad({
        diaSemana: Number(nuevaDia),
        horaInicioMinutos: horaAMinutos(nuevaHoraInicio),
        horaFinMinutos: horaAMinutos(nuevaHoraFin),
      });
      setDisponibilidades((prev) =>
        [...prev, data].sort((a, b) => a.diaSemana - b.diaSemana || a.horaInicioMinutos - b.horaInicioMinutos)
      );
    } catch (err) {
      setErrorNuevaDisponibilidad(err.message);
    } finally {
      setGuardandoDisponibilidad(false);
    }
  };

  const eliminarFranja = async (idDisponibilidad) => {
    try {
      await api.eliminarDisponibilidad(idDisponibilidad);
      setDisponibilidades((prev) => prev.filter((f) => f.idDisponibilidad !== idDisponibilidad));
    } catch (err) {
      alert(`No se pudo eliminar la franja horaria: ${err.message}`);
    }
  };

  // Ausencias puntuales (vacaciones, un día que el médico avisa que no atiende)
  const [ausencias, setAusencias] = useState([]);
  const [cargandoAusencias, setCargandoAusencias] = useState(() => esMedico);
  const [errorAusencias, setErrorAusencias] = useState('');
  const [nuevaAusenciaDesde, setNuevaAusenciaDesde] = useState('');
  const [nuevaAusenciaHasta, setNuevaAusenciaHasta] = useState('');
  const [nuevaAusenciaMotivo, setNuevaAusenciaMotivo] = useState('');
  const [guardandoAusencia, setGuardandoAusencia] = useState(false);
  const [errorNuevaAusencia, setErrorNuevaAusencia] = useState('');
  const [avisoAusencia, setAvisoAusencia] = useState('');

  useEffect(() => {
    if (!esMedico) return;
    api.misAusencias()
      .then(({ data }) => setAusencias(data))
      .catch((err) => setErrorAusencias(err.message))
      .finally(() => setCargandoAusencias(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agregarAusencia = async (e) => {
    e.preventDefault();
    setErrorNuevaAusencia('');
    setAvisoAusencia('');
    setGuardandoAusencia(true);
    try {
      const { data, turnosAfectados } = await api.crearAusencia({
        fechaInicio: nuevaAusenciaDesde,
        fechaFin: nuevaAusenciaHasta,
        motivo: nuevaAusenciaMotivo,
      });
      setAusencias((prev) => [...prev, data].sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio)));
      setNuevaAusenciaDesde('');
      setNuevaAusenciaHasta('');
      setNuevaAusenciaMotivo('');
      if (turnosAfectados > 0) {
        setAvisoAusencia(`Ojo: tenés ${turnosAfectados} turno(s) ya reservado(s) en esas fechas. No se cancelaron solos: revisalos en «Mi agenda» y cancelalos o avisá a los pacientes.`);
      }
    } catch (err) {
      setErrorNuevaAusencia(err.message);
    } finally {
      setGuardandoAusencia(false);
    }
  };

  const eliminarAusenciaHandler = async (idAusencia) => {
    try {
      await api.eliminarAusencia(idAusencia);
      setAusencias((prev) => prev.filter((a) => a.idAusencia !== idAusencia));
    } catch (err) {
      alert(`No se pudo eliminar la ausencia: ${err.message}`);
    }
  };

  // Las fechas de ausencia se guardan como medianoche UTC del día elegido
  // (ver disponibilidad.controller.js) — para mostrarlas hay que leerlas con
  // los componentes UTC, si no un navegador en un huso negativo (Argentina)
  // las corre un día para atrás.
  const formatearFechaAusencia = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  };

  // Cierra el menú mobile con la tecla Escape (sección 4.2 del documento)
  useEffect(() => {
    const cerrarConEscape = (e) => {
      if (e.key === 'Escape') setMenuMobileAbierto(false);
    };
    document.addEventListener('keydown', cerrarConEscape);
    return () => document.removeEventListener('keydown', cerrarConEscape);
  }, []);

  const irA = (vista) => {
    setVistaActual(vista);
    setMenuMobileAbierto(false);
  };

  // "Alto contraste" y "Adulto mayor" son variantes visuales del mismo eje
  // (qué tan marcado se ve todo), no dos ejes independientes — por eso van
  // como un único selector de 3 opciones en vez de dos checkboxes sueltos
  // que se podían activar juntos sin ninguna combinación clara.
  const elegirTemaAccesibilidad = (tema) => {
    setAltoContraste(tema === 'contraste');
    setModoAdultoMayor(tema === 'mayor');
  };

  return (
    <div
      style={{ fontSize: modoAdultoMayor ? '20px' : '16px' }}
      className={`min-h-screen transition-colors ${reducirAnimaciones ? 'transition-none reduce-motion' : 'duration-200'} ${
        altoContraste ? 'bg-white text-black high-contrast' :
        modoOscuro ? 'bg-[#0F172A] text-[#F1F5F9]' : 'bg-[#F8FAFC] text-[#1E293B]'
      }`}
    >

      <a
        href="#contenido-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-white focus:text-black focus:font-semibold focus:shadow-lg"
      >
        Saltar al contenido
      </a>

      {/* ========================================== */}
      {/* NAVBAR UNIFICADO                          */}
      {/* ========================================== */}
      <header className={`border-b sticky top-0 z-50 backdrop-blur-md ${
        altoContraste ? 'bg-white border-black text-black' :
        modoOscuro ? 'bg-[#0F172A]/90 border-[#334155]' : 'bg-white/90 border-[#E2E8F0]'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">

          <div className="flex items-center space-x-6">
            <button type="button" aria-label="Salux, ir al inicio" className="flex items-center space-x-2 rounded-lg" onClick={() => setVistaActual('dashboard')}>
              <span className="w-9 h-9 rounded-xl bg-[#2563EB] flex items-center justify-center text-white font-bold shadow-sm">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </span>
              <span className="font-bold tracking-tight text-xl">Salux</span>
            </button>

            <nav aria-label="Principal" className="hidden md:flex items-center space-x-4 font-medium" style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}>
              <button
                onClick={() => setVistaActual('dashboard')}
                aria-current={vistaActual === 'dashboard' ? 'page' : undefined}
                className={`px-3 py-1.5 rounded-lg transition ${vistaActual === 'dashboard' ? claseNavActiva : 'hover:text-[#2563EB]'}`}
              >
                Inicio
              </button>
              {esPaciente && (
                <button onClick={() => setMostrarModalTurno(true)} className="px-3 py-1.5 rounded-lg hover:text-[#2563EB] transition">
                  Solicitar turno
                </button>
              )}
              {esPaciente && (
                <button
                  onClick={() => setVistaActual('mis-turnos')}
                  aria-current={vistaActual === 'mis-turnos' ? 'page' : undefined}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${vistaActual === 'mis-turnos' ? claseNavActiva : 'hover:text-[#2563EB]'}`}
                >
                  Mis turnos
                  {turnosActivos.length > 0 && (
                    <span className="bg-[#DC2626] text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{turnosActivos.length}</span>
                  )}
                </button>
              )}
              {esPaciente && (
                <button
                  onClick={() => setVistaActual('historial')}
                  aria-current={vistaActual === 'historial' ? 'page' : undefined}
                  className={`px-3 py-1.5 rounded-lg transition ${vistaActual === 'historial' ? claseNavActiva : 'hover:text-[#2563EB]'}`}
                >
                  Historial
                </button>
              )}
              {esAdmin && (
                <button
                  onClick={() => setVistaActual('admin')}
                  aria-current={vistaActual === 'admin' ? 'page' : undefined}
                  className={`px-3 py-1.5 rounded-lg transition ${vistaActual === 'admin' ? claseNavActiva : 'hover:text-[#2563EB]'}`}
                >
                  Administración
                </button>
              )}
              {esMedico && (
                <button
                  onClick={() => setVistaActual('agenda-medico')}
                  aria-current={vistaActual === 'agenda-medico' ? 'page' : undefined}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${vistaActual === 'agenda-medico' ? claseNavActiva : 'hover:text-[#2563EB]'}`}
                >
                  Mi agenda
                  {turnosHoyMedico.length > 0 && (
                    <span className="bg-[#DC2626] text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{turnosHoyMedico.length}</span>
                  )}
                </button>
              )}
              {esMedico && (
                <button
                  onClick={() => setVistaActual('disponibilidad')}
                  aria-current={vistaActual === 'disponibilidad' ? 'page' : undefined}
                  className={`px-3 py-1.5 rounded-lg transition ${vistaActual === 'disponibilidad' ? claseNavActiva : 'hover:text-[#2563EB]'}`}
                >
                  Mi disponibilidad
                </button>
              )}
            </nav>
          </div>

          <div className="hidden md:flex items-center space-x-3">
            {/* Menú de Accesibilidad Desplegable */}
            <div className="relative">
              <button
                onClick={() => setMenuAccesibilidadAbierto(!menuAccesibilidadAbierto)}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg border transition font-medium ${
                  bordeEncabezado
                }`}
                style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}
                aria-expanded={menuAccesibilidadAbierto}
              >
                <span>♿ Accesibilidad</span>
              </button>

              {menuAccesibilidadAbierto && (
                <div className={`absolute right-0 mt-2 w-72 rounded-xl shadow-2xl p-4 z-50 border ${
                  altoContraste ? 'bg-white border-black text-black' : modoOscuro ? 'bg-[#1E293B] border-[#334155] text-[#F1F5F9]' : 'bg-white border-[#E2E8F0] text-slate-800'
                }`}>
                  <h3 className={`font-bold uppercase tracking-wider ${textoApoyo} mb-3`} style={{ fontSize: modoAdultoMayor ? '14px' : '12px' }}>Accesibilidad</h3>
                  <div className="space-y-3" style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}>
                    <label className="flex items-center justify-between cursor-pointer">
                      <span>Modo oscuro</span>
                      <input type="checkbox" className="w-5 h-5 accent-[#2563EB]" checked={modoOscuro} onChange={() => { setModoOscuro(!modoOscuro); if(altoContraste) setAltoContraste(false); }} />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer">
                      <span>Reducir animaciones</span>
                      <input type="checkbox" className="w-5 h-5 accent-[#2563EB]" checked={reducirAnimaciones} onChange={() => setReducirAnimaciones(!reducirAnimaciones)} />
                    </label>
                  </div>

                  <p className={`font-bold uppercase tracking-wider ${textoApoyo} mt-4 mb-2`} style={{ fontSize: modoAdultoMayor ? '14px' : '12px' }}>Tema</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'normal', label: 'Normal' },
                      { id: 'contraste', label: 'Alto contraste' },
                      { id: 'mayor', label: 'Adulto mayor' },
                    ].map((opcion) => {
                      const activo = opcion.id === 'normal' ? (!altoContraste && !modoAdultoMayor) : opcion.id === 'contraste' ? altoContraste : modoAdultoMayor;
                      return (
                        <button
                          key={opcion.id}
                          type="button"
                          onClick={() => elegirTemaAccesibilidad(opcion.id)}
                          aria-pressed={activo}
                          className={`px-2 py-2 rounded-lg border font-medium transition ${
                            activo
                              ? (altoContraste ? 'border-black bg-black text-white' : modoOscuro ? 'border-blue-500 bg-blue-500/10 text-blue-300' : 'border-[#1D4ED8] bg-[#2563EB]/10 text-[#1D4ED8]')
                              : (altoContraste ? 'border-black text-black' : modoOscuro ? 'border-slate-700 text-slate-300 hover:border-slate-500' : 'border-slate-300 text-slate-700 hover:border-slate-500')
                          }`}
                          style={{ fontSize: modoAdultoMayor ? '13px' : '11px' }}
                        >
                          {opcion.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Perfil de usuario */}
            <button
              onClick={() => setMostrarModalPerfil(true)}
              className={`flex items-center space-x-2 border-l pl-3 hover:opacity-80 transition ${altoContraste ? 'border-black' : modoOscuro ? 'border-slate-700' : 'border-slate-300'}`}
              title="Ver mi perfil"
            >
              <div className="w-8 h-8 rounded-full bg-blue-100 text-[#1D4ED8] font-bold flex items-center justify-center text-xs">{iniciales(usuario.nombre)}</div>
              <span className="font-medium hidden sm:inline" style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}>{usuario.nombre}</span>
            </button>

            <button onClick={() => setMostrarConfirmarSalir(true)} className={`${claseSalir} font-medium hover:underline px-2 py-1`} style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}>Salir</button>
          </div>

          {/* Botón hamburguesa — visible solo en mobile/tablet */}
          <button
            onClick={() => setMenuMobileAbierto(!menuMobileAbierto)}
            className={`md:hidden flex items-center justify-center w-10 h-10 rounded-lg border transition ${
              bordeEncabezado
            }`}
            aria-expanded={menuMobileAbierto}
            aria-controls="menu-mobile"
            aria-label={menuMobileAbierto ? 'Cerrar menú de navegación' : 'Abrir menú de navegación'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              {menuMobileAbierto ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>

        </div>

        {/* ========================================== */}
        {/* MENÚ MOBILE (drawer con navegación + accesibilidad rápida) */}
        {/* ========================================== */}
        {menuMobileAbierto && (
          <div
            id="menu-mobile" role="navigation" aria-label="Principal"
            className={`md:hidden border-t px-4 py-4 space-y-1 ${
              altoContraste ? 'bg-white border-black text-black' :
              modoOscuro ? 'bg-[#0F172A] border-[#334155] text-[#F1F5F9]' : 'bg-white border-[#E2E8F0] text-[#1E293B]'
            }`}
          >
            <button
              onClick={() => irA('dashboard')}
              aria-current={vistaActual === 'dashboard' ? 'page' : undefined}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition ${
                vistaActual === 'dashboard'
                  ? (altoContraste ? 'bg-black text-white' : tonoAzul)
                  : (altoContraste ? 'hover:bg-slate-100' : 'hover:bg-slate-800/60')
              }`}
              style={{ fontSize: modoAdultoMayor ? '18px' : '15px' }}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1V9.5z" />
              </svg>
              Inicio
            </button>

            {esPaciente && (
              <button
                onClick={() => { setMostrarModalTurno(true); setMenuMobileAbierto(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition ${altoContraste ? 'hover:bg-slate-100' : 'hover:bg-slate-800/60'}`}
                style={{ fontSize: modoAdultoMayor ? '18px' : '15px' }}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18" />
                </svg>
                Solicitar turno
              </button>
            )}

            {esPaciente && (
              <button
                onClick={() => irA('mis-turnos')}
                aria-current={vistaActual === 'mis-turnos' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition ${
                  vistaActual === 'mis-turnos'
                    ? (altoContraste ? 'bg-black text-white' : tonoAzul)
                    : (altoContraste ? 'hover:bg-slate-100' : 'hover:bg-slate-800/60')
                }`}
                style={{ fontSize: modoAdultoMayor ? '18px' : '15px' }}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
                </svg>
                Mis turnos
                {turnosActivos.length > 0 && (
                  <span className="ml-auto bg-[#DC2626] text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{turnosActivos.length}</span>
                )}
              </button>
            )}

            {esPaciente && (
              <button
                onClick={() => irA('historial')}
                aria-current={vistaActual === 'historial' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition ${
                  vistaActual === 'historial'
                    ? (altoContraste ? 'bg-black text-white' : tonoAzul)
                    : (altoContraste ? 'hover:bg-slate-100' : 'hover:bg-slate-800/60')
                }`}
                style={{ fontSize: modoAdultoMayor ? '18px' : '15px' }}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v6h6M3.5 13a8.5 8.5 0 108.5-8.5" />
                </svg>
                Historial
              </button>
            )}

            {esAdmin && (
              <button
                onClick={() => irA('admin')}
                aria-current={vistaActual === 'admin' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition ${
                  vistaActual === 'admin'
                    ? (altoContraste ? 'bg-black text-white' : tonoAzul)
                    : (altoContraste ? 'hover:bg-slate-100' : 'hover:bg-slate-800/60')
                }`}
                style={{ fontSize: modoAdultoMayor ? '18px' : '15px' }}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round" />
                  <rect x="14" y="3" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round" />
                  <rect x="14" y="14" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round" />
                  <rect x="3" y="14" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Administración
              </button>
            )}

            {esMedico && (
              <button
                onClick={() => irA('agenda-medico')}
                aria-current={vistaActual === 'agenda-medico' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition ${
                  vistaActual === 'agenda-medico'
                    ? (altoContraste ? 'bg-black text-white' : tonoAzul)
                    : (altoContraste ? 'hover:bg-slate-100' : 'hover:bg-slate-800/60')
                }`}
                style={{ fontSize: modoAdultoMayor ? '18px' : '15px' }}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
                </svg>
                Mi agenda
                {turnosHoyMedico.length > 0 && (
                  <span className="ml-auto bg-[#DC2626] text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{turnosHoyMedico.length}</span>
                )}
              </button>
            )}

            {esMedico && (
              <button
                onClick={() => irA('disponibilidad')}
                aria-current={vistaActual === 'disponibilidad' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition ${
                  vistaActual === 'disponibilidad'
                    ? (altoContraste ? 'bg-black text-white' : tonoAzul)
                    : (altoContraste ? 'hover:bg-slate-100' : 'hover:bg-slate-800/60')
                }`}
                style={{ fontSize: modoAdultoMayor ? '18px' : '15px' }}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01" />
                </svg>
                Mi disponibilidad
              </button>
            )}

            <div className={`border-t my-2 ${altoContraste ? 'border-black' : 'border-slate-700'}`} />

            {/* Accesos rápidos de accesibilidad (sección 4.4) */}
            <div className="grid grid-cols-3 gap-2 py-1">
              <button
                onClick={() => { setModoOscuro(!modoOscuro); if (!modoOscuro) setAltoContraste(false); }}
                aria-pressed={modoOscuro}
                className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border font-medium transition ${
                  modoOscuro
                    ? `border-[#2563EB] ${textoAzul} bg-[#2563EB]/10`
                    : (altoContraste ? 'border-black text-black' : 'border-slate-700 text-slate-300')
                }`}
                style={{ fontSize: modoAdultoMayor ? '14px' : '12px' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
                Oscuro
              </button>
              <button
                onClick={() => elegirTemaAccesibilidad(altoContraste ? 'normal' : 'contraste')}
                aria-pressed={altoContraste}
                className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border font-medium transition ${
                  altoContraste
                    ? 'border-black text-black bg-black/5'
                    : 'border-slate-700 text-slate-300'
                }`}
                style={{ fontSize: modoAdultoMayor ? '14px' : '12px' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Contraste
              </button>
              <button
                onClick={() => elegirTemaAccesibilidad(modoAdultoMayor ? 'normal' : 'mayor')}
                aria-pressed={modoAdultoMayor}
                className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border font-medium transition ${
                  modoAdultoMayor
                    ? `border-[#2563EB] ${textoAzul} bg-[#2563EB]/10`
                    : (altoContraste ? 'border-black text-black' : 'border-slate-700 text-slate-300')
                }`}
                style={{ fontSize: modoAdultoMayor ? '14px' : '12px' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7V4h16v3M9 20h6M12 4v16" />
                </svg>
                Mayor
              </button>
            </div>

            <div className={`border-t my-2 ${altoContraste ? 'border-black' : 'border-slate-700'}`} />

            <button
              onClick={() => { setMostrarModalPerfil(true); setMenuMobileAbierto(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition ${altoContraste ? 'hover:bg-slate-100' : 'hover:bg-slate-800/60'}`}
              style={{ fontSize: modoAdultoMayor ? '18px' : '15px' }}
            >
              <div className="w-5 h-5 shrink-0 rounded-full bg-blue-100 text-[#1D4ED8] font-bold flex items-center justify-center text-[10px]">{iniciales(usuario.nombre)}</div>
              Mi perfil
            </button>

            <div className={`border-t my-2 ${altoContraste ? 'border-black' : 'border-slate-700'}`} />

            <button
              onClick={() => { setMostrarConfirmarSalir(true); setMenuMobileAbierto(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition ${claseSalir} ${altoContraste ? 'hover:bg-slate-100' : 'hover:bg-red-500/10'}`}
              style={{ fontSize: modoAdultoMayor ? '18px' : '15px' }}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 17l5-5-5-5" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12H9" />
              </svg>
              Cerrar sesión
            </button>
          </div>
        )}
      </header>

      {/* ========================================== */}
      {/* VISTA 1: "Mis Turnos"                     */}
      {/* ========================================== */}
      {vistaActual === 'admin' ? (
        // ==========================================
        // VISTA 3: "Panel de Administración" (2.4)
        // ==========================================
        <main id="contenido-principal" tabIndex={-1} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          {errorAdmin && !cargandoAdmin && (
            <div role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              No se pudieron cargar los turnos: {errorAdmin}
            </div>
          )}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <span className={`inline-block font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-2 ${
                altoContraste ? 'bg-black text-white' : tonoAzul
              }`} style={{ fontSize: modoAdultoMayor ? '13px' : '11px' }}>
                Panel de Administración
              </span>
              <h1 className="font-bold" style={{ fontSize: modoAdultoMayor ? '32px' : '24px' }}>
                {tabAdmin === 'medicos' ? 'Gestión de médicos' : 'Gestión de turnos'}
              </h1>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setMostrarModalAlta(true)}
                className={`font-semibold px-4 py-2.5 rounded-xl shadow transition ${
                  altoContraste ? 'bg-black text-white hover:bg-slate-800' : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
                style={{ fontSize: modoAdultoMayor ? '18px' : '14px', minHeight: modoAdultoMayor ? '60px' : 'auto' }}
              >
                + Especialidad / Médico
              </button>
            </div>
          </div>

          {/* Tabs: Turnos / Médicos */}
          <div className="flex gap-2 border-b border-slate-700 pb-3">
            {[{ id: 'turnos', label: 'Turnos' }, { id: 'medicos', label: 'Médicos' }].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setTabAdmin(tab.id)}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  tabAdmin === tab.id
                    ? (altoContraste ? 'bg-black text-white' : 'bg-blue-600 text-white')
                    : (altoContraste ? 'bg-white text-black border border-black' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')
                }`}
                style={{ fontSize: modoAdultoMayor ? '16px' : '14px' }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {tabAdmin === 'turnos' && (
          <>
          {/* Tarjetas de estadísticas en tiempo real */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total de turnos', valor: estadisticasAdmin.total, icono: '📊', color: 'text-[#2563EB] bg-[#2563EB]/10' },
              { label: 'Confirmados', valor: estadisticasAdmin.confirmados, icono: '✅', color: 'text-emerald-500 bg-emerald-500/10' },
              { label: 'Pendientes', valor: estadisticasAdmin.pendientes, icono: '🕒', color: 'text-amber-500 bg-amber-500/10' },
              { label: 'Cancelados', valor: estadisticasAdmin.cancelados, icono: '❌', color: 'text-red-500 bg-red-500/10' },
            ].map((stat) => (
              <div
                key={stat.label}
                className={`p-5 rounded-xl border shadow-sm ${
                  altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold mb-3 ${altoContraste ? 'bg-black text-white' : stat.color}`}>
                  {stat.icono}
                </div>
                <p className={`${altoContraste ? 'text-black' : 'text-slate-400'}`} style={{ fontSize: modoAdultoMayor ? '15px' : '12px' }}>{stat.label}</p>
                <p className="font-bold" style={{ fontSize: modoAdultoMayor ? '30px' : '24px' }}>{stat.valor}</p>
              </div>
            ))}
          </div>

          {/* Buscador y filtro */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <label htmlFor="busqueda-admin" className="sr-only">Buscar por paciente, médico o especialidad</label>
              <input
                id="busqueda-admin"
                type="text"
                value={busquedaAdmin}
                onChange={(e) => setBusquedaAdmin(e.target.value)}
                placeholder="Buscar por paciente, médico o especialidad..."
                className={`w-full px-4 py-2.5 rounded-lg border transition ${
                  altoContraste ? 'bg-white border-black text-black' : 'bg-slate-800 border-slate-700 text-[#F1F5F9] placeholder:text-slate-400'
                }`}
                style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}
              />
            </div>
            <div>
              <label htmlFor="filtro-estado-admin" className="sr-only">Filtrar por estado</label>
              <select
                id="filtro-estado-admin"
                value={filtroEstadoAdmin}
                onChange={(e) => setFiltroEstadoAdmin(e.target.value)}
                className={`px-4 py-2.5 rounded-lg border font-medium transition ${
                  altoContraste ? 'bg-white border-black text-black' : 'bg-slate-800 border-slate-700 text-[#F1F5F9]'
                }`}
                style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}
              >
                {['Todos', 'Confirmado', 'Pendiente', 'Cancelado'].map((opcion) => (
                  <option key={opcion} value={opcion}>{opcion}</option>
                ))}
              </select>
            </div>
          </div>

          <p className={`${textoApoyo}`} style={{ fontSize: modoAdultoMayor ? '16px' : '13px' }}>
            Mostrando {turnosAdminFiltrados.length} de {turnosAdmin.length} turnos
          </p>

          {cargandoAdmin && (
            <div role="status" className={`${textoApoyo} text-sm py-4`}>Cargando turnos...</div>
          )}

          {/* Listado de turnos de todos los pacientes */}
          <div className="space-y-4">
            {!cargandoAdmin && turnosAdminFiltrados.length === 0 && (
              <div className={`p-8 rounded-xl border text-center ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
                No se encontraron turnos con los filtros aplicados.
              </div>
            )}
            {turnosAdminFiltrados.map((turno) => {
              const colorBarra =
                turno.estado === 'Confirmado' ? 'border-l-emerald-500' :
                turno.estado === 'Pendiente' ? 'border-l-amber-500' :
                turno.estado === 'Finalizado' ? 'border-l-blue-500' : 'border-l-red-500';

              const badgeColor =
                turno.estado === 'Confirmado' ? 'bg-emerald-100 text-emerald-700' :
                turno.estado === 'Pendiente' ? 'bg-amber-100 text-amber-700' :
                turno.estado === 'Finalizado' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700';

              const esTerminal = turno.estado === 'Finalizado' || turno.estado === 'Cancelado';
              const yaVencido = new Date(turno.fechaISO) < new Date();

              return (
                <div
                  key={turno.id}
                  className={`p-5 rounded-xl border-l-4 ${colorBarra} border shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${
                    altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 text-[#F1F5F9]'
                  }`}
                >
                  <div className="flex items-start space-x-4">
                    <div className={`w-12 h-12 rounded-full bg-blue-600/20 ${azulEnTarjeta} font-bold flex items-center justify-center shrink-0`}>
                      {turno.paciente.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-bold uppercase tracking-wider ${azulEnTarjeta}`}>{turno.especialidad}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${badgeColor}`}>{turno.estado}</span>
                      </div>
                      <h2 className="font-bold text-lg">{turno.paciente}</h2>
                      <p className={`text-sm mt-1 ${altoContraste ? 'text-black' : 'text-slate-300'}`}>{turno.medico}</p>
                      <p className={`text-xs mt-0.5 ${altoContraste ? 'text-black' : 'text-slate-400'}`}>📅 {turno.fecha} — <strong>{turno.hora}</strong></p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                    <button
                      onClick={() => actualizarEstadoTurnoAdmin(turno.id, 'Confirmado')}
                      disabled={esTerminal || turno.estado === 'Confirmado' || yaVencido}
                      title={yaVencido && !esTerminal ? 'El horario de este turno ya pasó' : undefined}
                      className={`border px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                        altoContraste ? 'border-black text-black hover:bg-slate-100' : 'border-emerald-500 text-emerald-400 hover:bg-emerald-600/10'
                      }`}
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => setConfirmacionCancelacion({ descripcion: `${turno.paciente} con ${turno.medico} — ${turno.fecha}, ${turno.hora}`, ejecutar: () => actualizarEstadoTurnoAdmin(turno.id, 'Cancelado') })}
                      disabled={esTerminal}
                      className={`border px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                        altoContraste ? 'border-black text-black hover:bg-slate-100' : 'border-red-500 text-red-400 hover:bg-red-600/10'
                      }`}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          </>
          )}

          {tabAdmin === 'medicos' && (
            <>
              {errorMedicosAdmin && !cargandoMedicosAdmin && (
                <div role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                  No se pudieron cargar los médicos: {errorMedicosAdmin}
                </div>
              )}

              {cargandoMedicosAdmin && (
                <div role="status" className={`${textoApoyo} text-sm py-4`}>Cargando médicos...</div>
              )}

              {!cargandoMedicosAdmin && !errorMedicosAdmin && medicosAdmin.length === 0 && (
                <div className={`p-8 rounded-xl border text-center ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
                  Todavía no hay médicos cargados. Usá "+ Especialidad / Médico" para agregar el primero.
                </div>
              )}

              {!cargandoMedicosAdmin && !errorMedicosAdmin && medicosAdmin.length > 0 && (
                <>
                <div className={`hidden md:block overflow-x-auto rounded-xl border ${altoContraste ? 'bg-white border-black' : 'border-slate-700 bg-slate-800'}`}>
                  <table className="w-full text-left" style={{ fontSize: modoAdultoMayor ? '16px' : '14px' }}>
                    <thead>
                      <tr className={`border-b ${altoContraste ? 'border-black' : 'border-slate-700'}`}>
                        {['Médico', 'Email', 'DNI', 'Matrícula', 'Consultorio', 'Duración', 'Especialidades', 'Estado', 'Acciones'].map((col) => (
                          <th key={col} className={`px-4 py-3 font-semibold uppercase tracking-wider ${altoContraste ? 'text-black' : 'text-slate-400'}`} style={{ fontSize: modoAdultoMayor ? '13px' : '11px' }}>
                            {col === 'Acciones' ? <span className="sr-only">Acciones</span> : col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {medicosAdmin.map((medico) => (
                        <tr key={medico.idMedico} className={`border-b last:border-0 ${altoContraste ? 'border-black' : 'border-slate-700'}`}>
                          <td className="px-4 py-3 font-medium">{medico.usuario.nomYape}</td>
                          <td className={`px-4 py-3 ${altoContraste ? 'text-black' : 'text-slate-300'}`}>{medico.usuario.email}</td>
                          <td className={`px-4 py-3 ${altoContraste ? 'text-black' : 'text-slate-300'}`}>{medico.usuario.dni}</td>
                          <td className={`px-4 py-3 ${altoContraste ? 'text-black' : 'text-slate-300'}`}>{medico.matricula}</td>
                          <td className={`px-4 py-3 ${altoContraste ? 'text-black' : 'text-slate-300'}`}>{medico.consultorio || '—'}</td>
                          <td className={`px-4 py-3 ${altoContraste ? 'text-black' : 'text-slate-300'}`}>{medico.duracionTurnoMinutos} min</td>
                          <td className={`px-4 py-3 ${altoContraste ? 'text-black' : 'text-slate-300'}`}>
                            {medico.especialidades.map((e) => (e.activo ? e.nombre : `${e.nombre} (inactiva)`)).join(', ') || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${medico.usuario.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                              {medico.usuario.activo ? 'Activo' : 'Inactivo'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <button
                              onClick={() => setMedicoEditando(medico)}
                              className={`border px-3 py-1.5 rounded-lg text-sm font-semibold transition mr-2 ${
                                altoContraste ? 'border-black text-black hover:bg-slate-100' : 'border-slate-600 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => toggleEstadoMedico(medico)}
                              className={`border px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
                                altoContraste ? 'border-black text-black hover:bg-slate-100' :
                                medico.usuario.activo ? 'border-red-500 text-red-400 hover:bg-red-600/10' : 'border-emerald-500 text-emerald-400 hover:bg-emerald-600/10'
                              }`}
                            >
                              {medico.usuario.activo ? 'Desactivar' : 'Activar'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* En pantallas chicas la tabla no entra: una tarjeta por médico */}
                <div className="md:hidden space-y-3">
                  {medicosAdmin.map((medico) => (
                    <div key={medico.idMedico} className={`p-4 rounded-xl border space-y-2 ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold">{medico.usuario.nomYape}</h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${medico.usuario.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {medico.usuario.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                      <p className={`text-sm break-all ${altoContraste ? 'text-black' : 'text-slate-300'}`}>{medico.usuario.email}</p>
                      <p className={`text-xs ${altoContraste ? 'text-black' : 'text-slate-400'}`}>
                        DNI {medico.usuario.dni} · Mat. {medico.matricula} · Cons. {medico.consultorio || '—'} · {medico.duracionTurnoMinutos} min
                      </p>
                      <p className={`text-xs ${altoContraste ? 'text-black' : 'text-slate-400'}`}>
                        {medico.especialidades.map((e) => (e.activo ? e.nombre : `${e.nombre} (inactiva)`)).join(', ') || 'Sin especialidades'}
                      </p>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => setMedicoEditando(medico)}
                          className={`flex-1 border px-3 py-2 rounded-lg text-sm font-semibold transition ${
                            altoContraste ? 'border-black text-black hover:bg-slate-100' : 'border-slate-600 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => toggleEstadoMedico(medico)}
                          className={`flex-1 border px-3 py-2 rounded-lg text-sm font-semibold transition ${
                            altoContraste ? 'border-black text-black hover:bg-slate-100' :
                            medico.usuario.activo ? 'border-red-500 text-red-400 hover:bg-red-600/10' : 'border-emerald-500 text-emerald-400 hover:bg-emerald-600/10'
                          }`}
                        >
                          {medico.usuario.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                </>
              )}
            </>
          )}
        </main>
      ) : vistaActual === 'agenda-medico' ? (
        // ==========================================
        // VISTA: "Agenda del médico"
        // ==========================================
        <main id="contenido-principal" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8 space-y-6">
          <div>
            <h1 className="font-bold" style={{ fontSize: modoAdultoMayor ? '32px' : '24px' }}>Mi agenda</h1>
            <p className={`${textoApoyo} text-sm`}>{turnosHoyMedico.length} turno{turnosHoyMedico.length === 1 ? '' : 's'} hoy</p>
          </div>

          {cargandoAgenda && (
            <div role="status" className={`${textoApoyo} text-sm py-4`}>Cargando tu agenda...</div>
          )}

          {errorAgenda && !cargandoAgenda && (
            <div role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              No se pudo cargar tu agenda: {errorAgenda}
            </div>
          )}

          {!cargandoAgenda && !errorAgenda && agendaMedico.length === 0 && (
            <div className={`p-8 rounded-xl border text-center ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
              Todavía no tenés turnos asignados.
            </div>
          )}

          <div className="space-y-4">
            {agendaMedico.map((turno) => {
              const colorBarra =
                turno.estado === 'Confirmado' ? 'border-l-emerald-500' :
                turno.estado === 'Pendiente' ? 'border-l-amber-500' :
                turno.estado === 'Finalizado' ? 'border-l-blue-500' : 'border-l-red-500';

              const badgeColor =
                turno.estado === 'Confirmado' ? 'bg-emerald-100 text-emerald-700' :
                turno.estado === 'Pendiente' ? 'bg-amber-100 text-amber-700' :
                turno.estado === 'Finalizado' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700';

              const finalizado = turno.estado === 'Finalizado' || turno.estado === 'Cancelado';
              const yaOcurrio = new Date(turno.fechaISO) <= new Date();

              return (
                <div
                  key={turno.id}
                  className={`p-5 rounded-xl border-l-4 ${colorBarra} border shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${
                    altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 text-[#F1F5F9]'
                  }`}
                >
                  <div className="flex items-start space-x-4">
                    <div className={`w-12 h-12 rounded-full bg-blue-600/20 ${azulEnTarjeta} font-bold flex items-center justify-center shrink-0`}>
                      {turno.paciente.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${badgeColor}`}>{turno.estado}</span>
                        {turno.confirmadoPorPaciente && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-700">✓ Paciente confirmó</span>
                        )}
                      </div>
                      <h2 className="font-bold text-lg">{turno.paciente}</h2>
                      <p className={`text-sm mt-1 ${altoContraste ? 'text-black' : 'text-slate-300'}`}>📅 {turno.fecha} — <strong>{turno.hora}</strong></p>
                      <p className={`text-xs mt-0.5 ${altoContraste ? 'text-black' : 'text-slate-400'}`}>{turno.email} · {turno.telefono} · {turno.obraSocial}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto justify-end flex-wrap">
                    <button
                      onClick={() => actualizarEstadoAgenda(turno.id, 'Confirmado')}
                      disabled={finalizado || turno.estado === 'Confirmado' || yaOcurrio}
                      title={yaOcurrio && !finalizado ? 'El horario de este turno ya pasó' : undefined}
                      className={`border px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                        altoContraste ? 'border-black text-black hover:bg-slate-100' : 'border-emerald-500 text-emerald-400 hover:bg-emerald-600/10'
                      }`}
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => actualizarEstadoAgenda(turno.id, 'Finalizado')}
                      disabled={finalizado || !yaOcurrio}
                      title={!yaOcurrio && !finalizado ? 'Solo se puede finalizar un turno que ya ocurrió' : undefined}
                      className={`border px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                        altoContraste ? 'border-black text-black hover:bg-slate-100' : 'border-blue-500 text-blue-400 hover:bg-blue-600/10'
                      }`}
                    >
                      Finalizar
                    </button>
                    <button
                      onClick={() => setConfirmacionCancelacion({ descripcion: `${turno.paciente} — ${turno.fecha}, ${turno.hora}`, ejecutar: () => actualizarEstadoAgenda(turno.id, 'Cancelado') })}
                      disabled={finalizado}
                      className={`border px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                        altoContraste ? 'border-black text-black hover:bg-slate-100' : 'border-red-500 text-red-400 hover:bg-red-600/10'
                      }`}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      ) : vistaActual === 'disponibilidad' ? (
        // ==========================================
        // VISTA: "Mi disponibilidad" (franjas horarias del médico)
        // ==========================================
        <main id="contenido-principal" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8 space-y-6">
          <div>
            <h1 className="font-bold" style={{ fontSize: modoAdultoMayor ? '32px' : '24px' }}>Mi disponibilidad</h1>
            <p className={`${textoApoyo} text-sm`}>Definí los días y horarios en los que atendés. Los pacientes solo van a poder reservar turnos dentro de estas franjas.</p>
          </div>

          <form onSubmit={agregarDisponibilidad} className={`p-5 rounded-xl border space-y-4 ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800'}`}>
            {errorNuevaDisponibilidad && (
              <div role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {errorNuevaDisponibilidad}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label htmlFor="disponibilidad-dia" className={`block text-xs font-semibold uppercase tracking-wider ${textoEnTarjeta} mb-1`}>Día</label>
                <select id="disponibilidad-dia"
                  value={nuevaDia}
                  onChange={(e) => setNuevaDia(e.target.value)}
                  className={`w-full px-3 py-2.5 rounded-lg border ${altoContraste ? 'bg-white border-black text-black' : 'bg-slate-950 border-slate-700 text-slate-200'}`}
                >
                  {DIAS_SEMANA.map((dia, idx) => (
                    <option key={dia} value={idx}>{dia}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="disponibilidad-desde" className={`block text-xs font-semibold uppercase tracking-wider ${textoEnTarjeta} mb-1`}>Desde</label>
                <input id="disponibilidad-desde"
                  type="time"
                  value={nuevaHoraInicio}
                  onChange={(e) => setNuevaHoraInicio(e.target.value)}
                  className={`w-full px-3 py-2.5 rounded-lg border ${altoContraste ? 'bg-white border-black text-black' : 'bg-slate-950 border-slate-700 text-slate-200'}`}
                />
              </div>
              <div>
                <label htmlFor="disponibilidad-hasta" className={`block text-xs font-semibold uppercase tracking-wider ${textoEnTarjeta} mb-1`}>Hasta</label>
                <input id="disponibilidad-hasta"
                  type="time"
                  value={nuevaHoraFin}
                  onChange={(e) => setNuevaHoraFin(e.target.value)}
                  className={`w-full px-3 py-2.5 rounded-lg border ${altoContraste ? 'bg-white border-black text-black' : 'bg-slate-950 border-slate-700 text-slate-200'}`}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={guardandoDisponibilidad}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition"
                >
                  {guardandoDisponibilidad ? 'Agregando...' : '+ Agregar franja'}
                </button>
              </div>
            </div>
          </form>

          {cargandoDisponibilidad && (
            <div role="status" className={`${textoApoyo} text-sm py-4`}>Cargando tu disponibilidad...</div>
          )}

          {errorDisponibilidad && !cargandoDisponibilidad && (
            <div role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              No se pudo cargar tu disponibilidad: {errorDisponibilidad}
            </div>
          )}

          {!cargandoDisponibilidad && !errorDisponibilidad && disponibilidades.length === 0 && (
            <div className={`p-8 rounded-xl border text-center ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
              Todavía no cargaste ninguna franja horaria. Hasta que lo hagas, los pacientes van a poder reservar en cualquier horario de 08:00 a 20:00.
            </div>
          )}

          {!cargandoDisponibilidad && disponibilidades.length > 0 && (
            <div className="space-y-2">
              {disponibilidades.map((f) => (
                <div
                  key={f.idDisponibilidad}
                  className={`px-4 py-3 rounded-lg border flex items-center justify-between ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800'}`}
                >
                  <span className="font-medium">
                    {DIAS_SEMANA[f.diaSemana]} — {minutosAHora(f.horaInicioMinutos)} a {minutosAHora(f.horaFinMinutos)}
                  </span>
                  <button
                    onClick={() => eliminarFranja(f.idDisponibilidad)}
                    className={`${claseEliminar} text-xs font-semibold min-h-[32px] px-2`}
                  >
                    Eliminar
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ========================================== */}
          {/* Ausencias puntuales                        */}
          {/* ========================================== */}
          <div className="pt-4 border-t border-slate-800">
            <h2 className="font-bold mb-1" style={{ fontSize: modoAdultoMayor ? '22px' : '18px' }}>Ausencias puntuales</h2>
            <p className={`${textoApoyo} text-sm mb-4`}>Para vacaciones o un día suelto que no atendés, aunque caiga en tu franja habitual. Los pacientes no van a poder reservar en estas fechas.</p>

            <form onSubmit={agregarAusencia} className={`p-5 rounded-xl border space-y-4 ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800'}`}>
              {errorNuevaAusencia && (
                <div role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                  {errorNuevaAusencia}
                </div>
              )}
              {avisoAusencia && (
                <div role="status" className={`px-4 py-3 rounded-lg border text-sm ${altoContraste ? 'border-black text-black' : 'border-amber-500/40 bg-amber-500/10 text-amber-200'}`}>
                  {avisoAusencia}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="ausencia-desde" className={`block text-xs font-semibold uppercase tracking-wider ${textoEnTarjeta} mb-1`}>Desde</label>
                  <input id="ausencia-desde"
                    type="date"
                    value={nuevaAusenciaDesde}
                    onChange={(e) => setNuevaAusenciaDesde(e.target.value)}
                    required
                    className={`w-full px-3 py-2.5 rounded-lg border ${altoContraste ? 'bg-white border-black text-black' : 'bg-slate-950 border-slate-700 text-slate-200'}`}
                  />
                </div>
                <div>
                  <label htmlFor="ausencia-hasta" className={`block text-xs font-semibold uppercase tracking-wider ${textoEnTarjeta} mb-1`}>Hasta</label>
                  <input id="ausencia-hasta"
                    type="date"
                    value={nuevaAusenciaHasta}
                    onChange={(e) => setNuevaAusenciaHasta(e.target.value)}
                    required
                    className={`w-full px-3 py-2.5 rounded-lg border ${altoContraste ? 'bg-white border-black text-black' : 'bg-slate-950 border-slate-700 text-slate-200'}`}
                  />
                </div>
                <div>
                  <label htmlFor="ausencia-motivo" className={`block text-xs font-semibold uppercase tracking-wider ${textoEnTarjeta} mb-1`}>Motivo (opcional)</label>
                  <input id="ausencia-motivo"
                    type="text"
                    value={nuevaAusenciaMotivo}
                    onChange={(e) => setNuevaAusenciaMotivo(e.target.value)}
                    placeholder="Ej: Vacaciones"
                    maxLength={191}
                    className={`w-full px-3 py-2.5 rounded-lg border ${altoContraste ? 'bg-white border-black text-black' : 'bg-slate-950 border-slate-700 text-slate-200'}`}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={guardandoAusencia}
                className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg transition"
              >
                {guardandoAusencia ? 'Agregando...' : '+ Agregar ausencia'}
              </button>
            </form>

            {cargandoAusencias && (
              <div role="status" className={`${textoApoyo} text-sm py-4`}>Cargando tus ausencias...</div>
            )}

            {errorAusencias && !cargandoAusencias && (
              <div role="alert" className="mt-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                No se pudieron cargar tus ausencias: {errorAusencias}
              </div>
            )}

            {!cargandoAusencias && !errorAusencias && ausencias.length > 0 && (
              <div className="space-y-2 mt-4">
                {ausencias.map((a) => (
                  <div
                    key={a.idAusencia}
                    className={`px-4 py-3 rounded-lg border flex items-center justify-between ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800'}`}
                  >
                    <span className="font-medium">
                      {formatearFechaAusencia(a.fechaInicio)} a {formatearFechaAusencia(a.fechaFin)}
                      {a.motivo && <span className={`${textoEnTarjeta} font-normal`}> — {a.motivo}</span>}
                    </span>
                    <button
                      onClick={() => eliminarAusenciaHandler(a.idAusencia)}
                      className={`${claseEliminar} text-xs font-semibold min-h-[32px] px-2`}
                    >
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      ) : vistaActual === 'mis-turnos' ? (
        <main id="contenido-principal" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="font-bold" style={{ fontSize: modoAdultoMayor ? '32px' : '24px' }}>Mis turnos</h1>
              <p className={`${textoApoyo} text-sm`}>{turnosActivos.length} turno{turnosActivos.length === 1 ? '' : 's'} activo{turnosActivos.length === 1 ? '' : 's'}</p>
            </div>
            <button
              onClick={() => setMostrarModalTurno(true)}
              className={`font-semibold px-4 py-2.5 rounded-xl shadow transition ${
                altoContraste ? 'bg-black text-white hover:bg-slate-800' : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
              style={{ fontSize: modoAdultoMayor ? '18px' : '14px', minHeight: modoAdultoMayor ? '60px' : 'auto' }}
            >
              + Nuevo turno
            </button>
          </div>

          {/* Tabs de filtrado */}
          <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-3">
            {['Todos', 'Confirmados', 'Pendientes', 'Cancelados'].map((tab) => (
              <button
                key={tab}
                onClick={() => setFiltroEstado(tab)}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  filtroEstado === tab
                    ? (altoContraste ? 'bg-black text-white' : 'bg-blue-600 text-white')
                    : (altoContraste ? 'bg-white text-black border border-black' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')
                }`}
                style={{ fontSize: modoAdultoMayor ? '16px' : '14px' }}
              >
                {tab}
              </button>
            ))}
          </div>

          {cargandoTurnos && (
            <div role="status" className={`${textoApoyo} text-sm py-4`}>Cargando tus turnos...</div>
          )}

          {errorTurnos && !cargandoTurnos && (
            <div role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              No se pudieron cargar tus turnos: {errorTurnos}
            </div>
          )}

          {!cargandoTurnos && !errorTurnos && turnosFiltrados.length === 0 && (
            <div className={`p-8 rounded-xl border text-center ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
              No tenés turnos con este filtro todavía.
            </div>
          )}

          {/* Cards de turno */}
          <div className="space-y-4">
            {turnosFiltrados.map((turno) => {
              const colorBarra =
                turno.estado === 'Confirmado' ? 'border-l-emerald-500' :
                turno.estado === 'Pendiente' ? 'border-l-amber-500' :
                turno.estado === 'Finalizado' ? 'border-l-blue-500' : 'border-l-red-500';

              const badgeColor =
                turno.estado === 'Confirmado' ? 'bg-emerald-100 text-emerald-700' :
                turno.estado === 'Pendiente' ? 'bg-amber-100 text-amber-700' :
                turno.estado === 'Finalizado' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700';

              const noCancelable = turno.estado === 'Cancelado' || turno.estado === 'Finalizado';

              return (
                <div
                  key={turno.id}
                  className={`p-5 rounded-xl border-l-4 ${colorBarra} border shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${
                    altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 text-[#F1F5F9]'
                  }`}
                >
                  <div className="flex items-start space-x-4">
                    <div className={`w-12 h-12 rounded-full bg-blue-600/20 ${azulEnTarjeta} font-bold flex items-center justify-center shrink-0`}>
                      {turno.medico.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-bold uppercase tracking-wider ${azulEnTarjeta}`}>{turno.especialidad}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${badgeColor}`}>{turno.estado}</span>
                      </div>
                      <h2 className="font-bold text-lg">{turno.medico}</h2>
                      <p className={`text-sm mt-1 ${altoContraste ? 'text-black' : 'text-slate-300'}`}>📅 {turno.fecha} — <strong>{turno.hora}</strong></p>
                      <p className={`text-xs mt-0.5 ${altoContraste ? 'text-black' : 'text-slate-400'}`}>📍 {turno.consultorio}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto justify-end flex-wrap">
                    {!noCancelable && !turno.confirmadoPorPaciente && (
                      <button
                        onClick={() => confirmarAsistencia(turno.id)}
                        className={`border px-4 py-2 rounded-lg text-sm font-semibold transition ${
                          altoContraste ? 'border-black text-black hover:bg-slate-100' : 'border-emerald-500 text-emerald-400 hover:bg-emerald-600/10'
                        }`}
                      >
                        Confirmo que voy
                      </button>
                    )}
                    {!noCancelable && turno.confirmadoPorPaciente && (
                      <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold bg-emerald-100 text-emerald-700">
                        ✓ Confirmaste tu asistencia
                      </span>
                    )}
                    <button
                      onClick={() => setTurnoAReprogramar(turno)}
                      disabled={noCancelable}
                      className={`border px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                        altoContraste ? 'border-black text-black hover:bg-slate-100' : 'border-blue-500 text-blue-400 hover:bg-blue-600/10'
                      }`}
                    >
                      Reprogramar
                    </button>
                    <button
                      onClick={() => setConfirmacionCancelacion({ descripcion: `${turno.medico} — ${turno.fecha}, ${turno.hora}`, ejecutar: () => cancelarTurno(turno.id) })}
                      disabled={noCancelable}
                      className={`border px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                        altoContraste ? 'border-black text-black hover:bg-slate-100' : 'border-red-500 text-red-400 hover:bg-red-600/10'
                      }`}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      ) : vistaActual === 'historial' ? (
        // ==========================================
        // VISTA: "Historial" (turnos finalizados y cancelados)
        // ==========================================
        <main id="contenido-principal" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8 space-y-6">
          <div>
            <h1 className="font-bold" style={{ fontSize: modoAdultoMayor ? '32px' : '24px' }}>Historial</h1>
            <p className={`${textoApoyo} text-sm`}>{historialTurnos.length} turno{historialTurnos.length === 1 ? '' : 's'} en tu historial</p>
          </div>

          {cargandoTurnos && (
            <div role="status" className={`${textoApoyo} text-sm py-4`}>Cargando tu historial...</div>
          )}

          {errorTurnos && !cargandoTurnos && (
            <div role="alert" className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              No se pudo cargar tu historial: {errorTurnos}
            </div>
          )}

          {!cargandoTurnos && !errorTurnos && historialTurnos.length === 0 && (
            <div className={`p-8 rounded-xl border text-center ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
              Todavía no tenés turnos finalizados o cancelados.
            </div>
          )}

          <div className="space-y-4">
            {historialTurnos.map((turno) => {
              const colorBarra = turno.estado === 'Finalizado' ? 'border-l-blue-500' : 'border-l-red-500';
              const badgeColor = turno.estado === 'Finalizado' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700';

              return (
                <div
                  key={turno.id}
                  className={`p-5 rounded-xl border-l-4 ${colorBarra} border shadow-md flex items-start gap-4 ${
                    altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 text-[#F1F5F9]'
                  }`}
                >
                  <div className={`w-12 h-12 rounded-full bg-blue-600/20 ${azulEnTarjeta} font-bold flex items-center justify-center shrink-0`}>
                    {turno.medico.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-bold uppercase tracking-wider ${azulEnTarjeta}`}>{turno.especialidad}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${badgeColor}`}>{turno.estado}</span>
                    </div>
                    <h2 className="font-bold text-lg">{turno.medico}</h2>
                    <p className={`text-sm mt-1 ${altoContraste ? 'text-black' : 'text-slate-300'}`}>📅 {turno.fecha} — <strong>{turno.hora}</strong></p>
                    <p className={`text-xs mt-0.5 ${altoContraste ? 'text-black' : 'text-slate-400'}`}>📍 {turno.consultorio}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      ) : (
        // ==========================================
        // VISTA 2: "Dashboard Principal"
        // ==========================================
        <main id="contenido-principal" tabIndex={-1} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <div>
            <p className={claseSaludo} style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}>{saludoSegunHora()}</p>
            <h1 className="font-bold" style={{ fontSize: modoAdultoMayor ? '32px' : '24px' }}>{usuario.nombre}</h1>
          </div>

          {esPaciente && alertaActiva && proximoTurno && (
            <div className={`px-4 py-3 rounded-xl flex items-center justify-between border ${
              altoContraste ? 'bg-white border-black text-black font-semibold' : 'bg-[#EFF6FF] border-[#2563EB]/30 text-[#2563EB]'
            }`} style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}>
              <span>🔔 Recordatorio: tenés un turno en {diasHastaProximo} día{diasHastaProximo === 1 ? '' : 's'} con {proximoTurno.medico}.</span>
              <button onClick={() => setAlertaActiva(false)} aria-label="Cerrar recordatorio" className="font-bold hover:opacity-70 w-8 h-8 inline-flex items-center justify-center" style={{ fontSize: modoAdultoMayor ? '22px' : '18px' }}>&times;</button>
            </div>
          )}

          {esPaciente && cargandoTurnos && (
            <div role="status" className={`${textoApoyo} text-sm`}>Cargando tus turnos...</div>
          )}

          {esPaciente && proximoTurno && (
            <div className={`p-6 rounded-2xl shadow-xl relative overflow-hidden ${
              altoContraste ? 'bg-white border-2 border-black text-black' : 'bg-[#1D4ED8] text-white'
            }`}>
              <div className={`absolute top-4 right-4 font-semibold px-2.5 py-1 rounded-full ${
                altoContraste ? 'bg-black text-white' : 'bg-black/25'
              }`} style={{ fontSize: modoAdultoMayor ? '15px' : '12px' }}>
                Próximo turno en {diasHastaProximo} día{diasHastaProximo === 1 ? '' : 's'}
              </div>
              <p className={`uppercase tracking-wider font-semibold mb-1 ${altoContraste ? 'text-black' : 'text-blue-200'}`} style={{ fontSize: modoAdultoMayor ? '16px' : '12px' }}>{proximoTurno.especialidad}</p>
              <h2 className="font-bold mb-1" style={{ fontSize: modoAdultoMayor ? '30px' : '24px' }}>{proximoTurno.medico}</h2>
              <p className={`mb-4 ${altoContraste ? 'text-black' : 'text-blue-100'}`} style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}>📅 {proximoTurno.fecha} — {proximoTurno.hora}</p>
              <button
                onClick={() => setVistaActual('mis-turnos')}
                className={`font-semibold px-4 py-2 rounded-lg shadow transition ${
                  altoContraste ? 'bg-black text-white hover:bg-slate-800' : 'bg-white text-[#2563EB] hover:bg-blue-50'
                }`}
                style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}
              >
                Ver detalles &gt;
              </button>
            </div>
          )}

          {esPaciente && !cargandoTurnos && !proximoTurno && (
            <div className={`p-6 rounded-2xl border text-center ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
              No tenés turnos próximos. ¡Solicitá uno cuando quieras!
            </div>
          )}

          {esPaciente && (
            <div>
              <h2 className="font-bold mb-4" style={{ fontSize: modoAdultoMayor ? '24px' : '18px' }}>¿Qué querés hacer hoy?</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className={`p-5 rounded-xl border shadow-sm cursor-pointer relative transition ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 hover:border-blue-500'} ${anilloFoco}`}>
                  <div className={`w-10 h-10 rounded-lg bg-blue-500/20 ${azulEnTarjeta} flex items-center justify-center font-bold mb-3`}>📅</div>
                  <h3 className="font-bold mb-1" style={{ fontSize: modoAdultoMayor ? '20px' : '16px' }}><button type="button" onClick={() => setMostrarModalTurno(true)} className="text-left after:absolute after:inset-0 after:content-['']">Solicitar turno</button></h3>
                  <p className={textoEnTarjeta} style={{ fontSize: modoAdultoMayor ? '15px' : '12px' }}>Reserva una nueva cita médica</p>
                </div>

                <div className={`p-5 rounded-xl border shadow-sm cursor-pointer transition relative ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 hover:border-blue-500'} ${anilloFoco}`}>
                  {turnosActivos.length > 0 && (
                    <span className="absolute top-4 right-4 bg-red-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">{turnosActivos.length}</span>
                  )}
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold mb-3">📋</div>
                  <h3 className="font-bold mb-1" style={{ fontSize: modoAdultoMayor ? '20px' : '16px' }}><button type="button" onClick={() => setVistaActual('mis-turnos')} className="text-left after:absolute after:inset-0 after:content-['']">Mis turnos{turnosActivos.length > 0 && <span className="sr-only"> ({turnosActivos.length} activo{turnosActivos.length === 1 ? '' : 's'})</span>}</button></h3>
                  <p className={textoEnTarjeta} style={{ fontSize: modoAdultoMayor ? '15px' : '12px' }}>Revisá, cancelá o reprogramá tus citas</p>
                </div>

                <div className={`p-5 rounded-xl border shadow-sm cursor-pointer relative transition ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 hover:border-blue-500'} ${anilloFoco}`}>
                  <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold mb-3">📁</div>
                  <h3 className="font-bold mb-1" style={{ fontSize: modoAdultoMayor ? '20px' : '16px' }}><button type="button" onClick={() => setVistaActual('historial')} className="text-left after:absolute after:inset-0 after:content-['']">Historial</button></h3>
                  <p className={textoEnTarjeta} style={{ fontSize: modoAdultoMayor ? '15px' : '12px' }}>Turnos finalizados y cancelados</p>
                </div>
              </div>
            </div>
          )}

          {esAdmin && (
            <div className={`p-6 rounded-2xl border text-center ${altoContraste ? 'bg-white border-black text-black' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
              Usá el menú "Administración" para gestionar turnos.
            </div>
          )}

          {esMedico && (
            <div className={`p-6 rounded-2xl shadow-xl relative overflow-hidden ${altoContraste ? 'bg-white border-2 border-black text-black' : 'bg-[#1D4ED8] text-white'}`}>
              <p className={`uppercase tracking-wider font-semibold mb-1 ${altoContraste ? 'text-black' : 'text-blue-200'}`} style={{ fontSize: modoAdultoMayor ? '16px' : '12px' }}>Hoy</p>
              <h2 className="font-bold mb-1" style={{ fontSize: modoAdultoMayor ? '30px' : '24px' }}>
                {turnosHoyMedico.length} turno{turnosHoyMedico.length === 1 ? '' : 's'} agendado{turnosHoyMedico.length === 1 ? '' : 's'}
              </h2>
              <p className={`mb-4 ${altoContraste ? 'text-black' : 'text-blue-100'}`} style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}>
                Revisá y confirmá los turnos de tus pacientes.
              </p>
              <button
                onClick={() => setVistaActual('agenda-medico')}
                className={`font-semibold px-4 py-2 rounded-lg shadow transition ${altoContraste ? 'bg-black text-white hover:bg-slate-800' : 'bg-white text-[#2563EB] hover:bg-blue-50'}`}
                style={{ fontSize: modoAdultoMayor ? '18px' : '14px' }}
              >
                Ver mi agenda &gt;
              </button>
            </div>
          )}
        </main>
      )}

      {mostrarModalTurno && (
        <NuevoTurnoModal onClose={() => setMostrarModalTurno(false)} onCreado={turnoCreado} />
      )}

      {turnoAReprogramar && (
        <ReprogramarTurnoModal
          turno={turnoAReprogramar}
          onClose={() => setTurnoAReprogramar(null)}
          onReprogramado={turnoReprogramado}
        />
      )}

      {mostrarModalAlta && (
        <AdminAltaModal onClose={() => { setMostrarModalAlta(false); cargarMedicosAdmin(); }} />
      )}

      {mostrarModalPerfil && (
        <PerfilModal
          usuario={usuario}
          onClose={() => setMostrarModalPerfil(false)}
          onActualizado={onUsuarioActualizado}
        />
      )}

      {medicoEditando && (
        <EditarMedicoModal
          medico={medicoEditando}
          onClose={() => setMedicoEditando(null)}
          onActualizado={(medicoActualizado) => {
            setMedicosAdmin((prev) => prev.map((m) =>
              m.idMedico === medicoActualizado.idMedico
                ? { ...m, consultorio: medicoActualizado.consultorio, duracionTurnoMinutos: medicoActualizado.duracionTurnoMinutos, especialidades: medicoActualizado.especialidades }
                : m
            ));
          }}
        />
      )}

      {confirmacionCancelacion && (
        <DialogoConfirmacion
          titulo="¿Cancelar este turno?"
          textoVolver="Volver"
          textoConfirmar="Sí, cancelar turno"
          onVolver={() => setConfirmacionCancelacion(null)}
          onConfirmar={() => { confirmacionCancelacion.ejecutar(); setConfirmacionCancelacion(null); }}
        >
          {confirmacionCancelacion.descripcion}.
          Esta acción no se puede deshacer; si cambiás de idea tendrías que reservar un turno nuevo.
        </DialogoConfirmacion>
      )}

      {confirmacionDesactivarMedico && (
        <DialogoConfirmacion
          titulo="¿Desactivar y cancelar sus turnos?"
          textoVolver="Volver"
          textoConfirmar="Sí, desactivar y cancelar"
          onVolver={() => setConfirmacionDesactivarMedico(null)}
          onConfirmar={() => { toggleEstadoMedico(confirmacionDesactivarMedico.medico, true); setConfirmacionDesactivarMedico(null); }}
        >
          {confirmacionDesactivarMedico.medico.usuario.nomYape} tiene {confirmacionDesactivarMedico.cantidad} turno(s) futuro(s) sin cerrar.
          Al desactivarlo se cancelan y cada paciente recibe un correo de aviso. Esta acción no se puede deshacer.
        </DialogoConfirmacion>
      )}

      {mostrarConfirmarSalir && (
        <DialogoConfirmacion
          titulo="¿Cerrar sesión?"
          textoVolver="Cancelar"
          textoConfirmar="Sí, salir"
          onVolver={() => setMostrarConfirmarSalir(false)}
          onConfirmar={onLogout}
        >
          Vas a tener que volver a ingresar tu email y contraseña para entrar de nuevo.
        </DialogoConfirmacion>
      )}
    </div>
  );
}

export default Dashboard;

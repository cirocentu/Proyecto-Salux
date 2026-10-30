import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const API = 'http://api.test/api'

// api.js guarda el token y el refresco en variables del módulo: cada test arranca
// con una copia limpia.
async function cargarApi() {
  vi.resetModules()
  vi.stubEnv('VITE_API_URL', API)
  return import('./api.js')
}

const respuesta = (status, cuerpo) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(cuerpo) })

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const llamada = (n) => ({ url: fetchMock.mock.calls[n][0], opciones: fetchMock.mock.calls[n][1] })

describe('sesión', () => {
  it('el token vive en memoria: nunca se escribe en localStorage', async () => {
    const { guardarSesion } = await cargarApi()
    guardarSesion('TOKEN-SECRETO', { id: 1, nombre: 'Ana' })
    expect(JSON.stringify({ ...localStorage })).not.toContain('TOKEN-SECRETO')
  })

  it('guarda y recupera el usuario cacheado', async () => {
    const { guardarSesion, getUsuarioGuardado } = await cargarApi()
    guardarSesion('t', { id: 1, nombre: 'Ana' })
    expect(getUsuarioGuardado()).toEqual({ id: 1, nombre: 'Ana' })
  })

  it('un usuario cacheado corrupto se descarta en vez de romper la app', async () => {
    const { getUsuarioGuardado } = await cargarApi()
    localStorage.setItem('salux_usuario', '{esto no es json')
    expect(getUsuarioGuardado()).toBeNull()
    expect(localStorage.getItem('salux_usuario')).toBeNull()
  })

  it('borrarSesion limpia el usuario y el token', async () => {
    const { guardarSesion, borrarSesion, getUsuarioGuardado, api } = await cargarApi()
    guardarSesion('t', { id: 1 })
    borrarSesion()
    expect(getUsuarioGuardado()).toBeNull()
    fetchMock.mockReturnValue(respuesta(200, { ok: true }))
    await api.perfil().catch(() => {})
    expect(llamada(0).opciones.headers.Authorization).toBeUndefined()
  })

  it('actualizarUsuarioGuardado no toca el token', async () => {
    const { guardarSesion, actualizarUsuarioGuardado, getUsuarioGuardado, api } = await cargarApi()
    guardarSesion('TOK', { id: 1, nombre: 'Ana' })
    actualizarUsuarioGuardado({ id: 1, nombre: 'Ana María' })
    expect(getUsuarioGuardado().nombre).toBe('Ana María')
    fetchMock.mockReturnValue(respuesta(200, {}))
    await api.perfil()
    expect(llamada(0).opciones.headers.Authorization).toBe('Bearer TOK')
  })
})

describe('peticiones', () => {
  it('usa la URL base configurada y manda el token como Bearer', async () => {
    const { guardarSesion, api } = await cargarApi()
    guardarSesion('TOK', { id: 1 })
    fetchMock.mockReturnValue(respuesta(200, { data: [] }))
    await api.misTurnos()
    expect(llamada(0).url).toBe(`${API}/turnos/mis-turnos`)
    expect(llamada(0).opciones.headers.Authorization).toBe('Bearer TOK')
  })

  it('login no manda token y envía las credenciales en el cuerpo', async () => {
    const { guardarSesion, api } = await cargarApi()
    guardarSesion('TOK', { id: 1 })
    fetchMock.mockReturnValue(respuesta(200, { token: 'x' }))
    await api.login('ana@correo.com', 'clave')
    const { url, opciones } = llamada(0)
    expect(url).toBe(`${API}/auth/login`)
    expect(opciones.method).toBe('POST')
    expect(opciones.headers.Authorization).toBeUndefined()
    expect(JSON.parse(opciones.body)).toEqual({ identificador: 'ana@correo.com', contrasena: 'clave' })
  })

  it('incluye credenciales para que viaje la cookie de refresco', async () => {
    const { api } = await cargarApi()
    fetchMock.mockReturnValue(respuesta(200, {}))
    await api.logout()
    expect(llamada(0).opciones.credentials).toBe('include')
  })

  it('los endpoints arman el método y la ruta correctos', async () => {
    const { api } = await cargarApi()
    fetchMock.mockReturnValue(respuesta(200, {}))
    await api.cancelarTurno(7)
    await api.reprogramarTurno(7, '2026-03-03T12:00:00.000Z')
    await api.crearTurno(3, '2026-03-03T12:00:00.000Z', 5)
    await api.eliminarEspecialidad(9)
    await api.confirmarAsistencia(7)
    const [cancelar, reprogramar, crear, eliminar, asistencia] = [0, 1, 2, 3, 4].map(llamada)
    expect([cancelar.url, cancelar.opciones.method]).toEqual([`${API}/turnos/7`, 'PATCH'])
    expect(JSON.parse(cancelar.opciones.body)).toEqual({ estado: 'CANCELADO' })
    expect(reprogramar.url).toBe(`${API}/turnos/7/reprogramar`)
    expect(JSON.parse(crear.opciones.body)).toEqual({ medicoId: 3, fechaYhora: '2026-03-03T12:00:00.000Z', especialidadId: 5 })
    expect([eliminar.url, eliminar.opciones.method]).toEqual([`${API}/especialidades/9`, 'DELETE'])
    expect(asistencia.url).toBe(`${API}/turnos/7/confirmar-asistencia`)
  })
})

describe('errores', () => {
  it('sin conexión: mensaje claro en español', async () => {
    const { api } = await cargarApi()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.login('a', 'b')).rejects.toThrow('No se pudo conectar con el servidor')
  })

  it('usa el message del servidor', async () => {
    const { api } = await cargarApi()
    fetchMock.mockReturnValue(respuesta(409, { ok: false, message: 'Ya existe una especialidad con ese nombre' }))
    await expect(api.crearEspecialidad('x')).rejects.toThrow('Ya existe una especialidad con ese nombre')
  })

  it('une los errores de validación campo por campo', async () => {
    const { api } = await cargarApi()
    fetchMock.mockReturnValue(respuesta(400, {
      message: 'Datos inválidos',
      errores: [{ campo: 'dni', mensaje: 'DNI inválido' }, { campo: 'contrasena', mensaje: 'Muy corta' }],
    }))
    await expect(api.register({})).rejects.toThrow('dni: DNI inválido — contrasena: Muy corta')
  })

  it('conserva el detalle por campo para poder llevar el foco al campo afectado', async () => {
    const { api } = await cargarApi()
    const errores = [{ campo: 'dni', mensaje: 'DNI inválido' }, { campo: 'contrasena', mensaje: 'Muy corta' }]
    fetchMock.mockReturnValue(respuesta(400, { message: 'Datos inválidos', errores }))
    await expect(api.register({})).rejects.toMatchObject({ campos: errores })
  })

  it('un error sin detalle por campo trae una lista vacía', async () => {
    const { api } = await cargarApi()
    fetchMock.mockReturnValue(respuesta(409, { message: 'El email o DNI ya está registrado' }))
    await expect(api.register({})).rejects.toMatchObject({ campos: [] })
  })

  it('conserva el código de negocio del servidor', async () => {
    const { api } = await cargarApi()
    fetchMock.mockReturnValue(respuesta(403, { codigo: 'CAMBIO_CONTRASENA_REQUERIDO', message: 'Cambiá tu contraseña' }))
    await expect(api.misTurnos()).rejects.toMatchObject({ codigo: 'CAMBIO_CONTRASENA_REQUERIDO' })
  })

  it('una respuesta sin JSON no rompe: cae al mensaje genérico', async () => {
    const { api } = await cargarApi()
    fetchMock.mockReturnValue(Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('html')) }))
    await expect(api.login('a', 'b')).rejects.toThrow('Error de conexión con el servidor')
  })
})

describe('renovación de la sesión', () => {
  it('un 401 renueva el token con la cookie y reintenta una vez', async () => {
    const { guardarSesion, api } = await cargarApi()
    guardarSesion('VIEJO', { id: 1 })
    fetchMock
      .mockReturnValueOnce(respuesta(401, { message: 'Token inválido o expirado' }))
      .mockReturnValueOnce(respuesta(200, { token: 'NUEVO' }))
      .mockReturnValueOnce(respuesta(200, { data: ['turno'] }))

    const res = await api.misTurnos()

    expect(res.data).toEqual(['turno'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(llamada(1).url).toBe(`${API}/auth/refresh`)
    expect(llamada(1).opciones.credentials).toBe('include')
    expect(llamada(2).opciones.headers.Authorization).toBe('Bearer NUEVO')
  })

  it('varios 401 simultáneos comparten UNA sola renovación', async () => {
    const { guardarSesion, api } = await cargarApi()
    guardarSesion('VIEJO', { id: 1 })
    fetchMock.mockImplementation((url, opciones) => {
      if (url.endsWith('/auth/refresh')) return respuesta(200, { token: 'NUEVO' })
      return respuesta(opciones.headers.Authorization === 'Bearer NUEVO' ? 200 : 401, { data: [] })
    })

    await Promise.all([api.misTurnos(), api.especialidades(), api.medicos()])

    const refrescos = fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))
    expect(refrescos).toHaveLength(1)
  })

  it('si no hay token pero se está renovando (recarga de página), espera en vez de pedir sin token', async () => {
    const { api } = await cargarApi()
    const refrescarSesion = api.refrescarSesion
    let liberar
    fetchMock.mockImplementation((url) => {
      if (url.endsWith('/auth/refresh')) {
        return new Promise((resolve) => {
          liberar = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ token: 'RENOVADO' }) })
        })
      }
      return respuesta(200, { data: [] })
    })

    const refresco = refrescarSesion()
    const pedido = api.misTurnos()
    await Promise.resolve()
    expect(fetchMock.mock.calls.filter(([u]) => u.endsWith('/turnos/mis-turnos'))).toHaveLength(0)

    liberar()
    await refresco
    await pedido
    const mis = fetchMock.mock.calls.find(([u]) => u.endsWith('/turnos/mis-turnos'))
    expect(mis[1].headers.Authorization).toBe('Bearer RENOVADO')
  })

  it('si la renovación falla, cierra la sesión local y recarga la página', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const { guardarSesion, getUsuarioGuardado, api } = await cargarApi()
    guardarSesion('VIEJO', { id: 1 })
    fetchMock
      .mockReturnValueOnce(respuesta(401, {}))
      .mockReturnValueOnce(respuesta(401, { message: 'Sesión inválida' }))

    api.misTurnos() // queda pendiente a propósito: tras la recarga nunca se resuelve
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(getUsuarioGuardado()).toBeNull()
  })

  it('no reintenta infinitamente: el segundo 401 tras renovar es un error', async () => {
    const { guardarSesion, api } = await cargarApi()
    guardarSesion('VIEJO', { id: 1 })
    fetchMock
      .mockReturnValueOnce(respuesta(401, {}))
      .mockReturnValueOnce(respuesta(200, { token: 'NUEVO' }))
      .mockReturnValueOnce(respuesta(401, { message: 'Sigue sin permiso' }))

    await expect(api.misTurnos()).rejects.toThrow('Sigue sin permiso')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('las rutas públicas (login) no intentan renovar ante un 401', async () => {
    const { api } = await cargarApi()
    fetchMock.mockReturnValue(respuesta(401, { message: 'Credenciales inválidas' }))
    await expect(api.login('a', 'b')).rejects.toThrow('Credenciales inválidas')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refrescarSesion devuelve el usuario y deja el token listo', async () => {
    const { api } = await cargarApi()
    const refrescarSesion = api.refrescarSesion
    fetchMock
      .mockReturnValueOnce(respuesta(200, { token: 'T2', usuario: { id: 1, rol: 'paciente' } }))
      .mockReturnValueOnce(respuesta(200, {}))
    const datos = await refrescarSesion()
    expect(datos.usuario.rol).toBe('paciente')
    await api.perfil()
    expect(llamada(1).opciones.headers.Authorization).toBe('Bearer T2')
  })

  it('cambiarContrasena adopta el token nuevo (el servidor cerró las demás sesiones)', async () => {
    const { guardarSesion, api } = await cargarApi()
    guardarSesion('VIEJO', { id: 1 })
    fetchMock
      .mockReturnValueOnce(respuesta(200, { token: 'TOKEN-NUEVO' }))
      .mockReturnValueOnce(respuesta(200, {}))
    await api.cambiarContrasena('actual', 'nueva')
    await api.perfil()
    expect(llamada(1).opciones.headers.Authorization).toBe('Bearer TOKEN-NUEVO')
  })

  it('logoutTodas cierra todas las sesiones y borra la local', async () => {
    const { guardarSesion, getUsuarioGuardado, api } = await cargarApi()
    guardarSesion('TOK', { id: 1 })
    fetchMock.mockReturnValue(respuesta(200, {}))
    await api.logoutTodas()
    expect(llamada(0).url).toBe(`${API}/auth/logout-todas`)
    expect(getUsuarioGuardado()).toBeNull()
  })
})

describe('preferencias de accesibilidad', () => {
  it('se guardan, se combinan y sobreviven a datos corruptos', async () => {
    const { getPreferenciasAccesibilidad, guardarPreferenciasAccesibilidad } = await cargarApi()
    expect(getPreferenciasAccesibilidad()).toEqual({})
    guardarPreferenciasAccesibilidad({ modoOscuro: false })
    guardarPreferenciasAccesibilidad({ altoContraste: true })
    expect(getPreferenciasAccesibilidad()).toEqual({ modoOscuro: false, altoContraste: true })
    localStorage.setItem('salux_accesibilidad', 'basura{')
    expect(getPreferenciasAccesibilidad()).toEqual({})
  })
})

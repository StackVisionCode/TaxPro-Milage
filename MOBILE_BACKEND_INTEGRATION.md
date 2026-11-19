# Integración con Mobile — 2026-11-19

Se adaptó este checkout conservando las modificaciones locales anteriores. Gateway: http://localhost:5047. Ionic: http://localhost:8100.

## Cambios

- Vehículos, recorridos, estadísticas y configuración usan `/mobile`, con DTOs directos y consultas GET. No se envían identificadores de propietario; el backend los obtiene del JWT.
- El dispositivo conserva `clientTripId` y el ID asignado por el servidor. Los listados recorren todas las páginas y el detalle recupera los puntos por cursor.
- La cola persistente se separa por oficina, cliente y usuario. Cada operación mantiene su secuencia, fecha y contenido durante los reintentos. Los puntos nuevos se envían en bloques de hasta 256.
- La confirmación se guarda antes de retirar una operación. Los fallos de red o almacenamiento conservan el recorrido. Se reintenta al recuperar conectividad, volver al primer plano o renovar sesión.
- Pausa, reanudación, cierre y cancelación notifican al backend. Un cierre pendiente se muestra como pendiente, no como confirmado. Los estados terminales no se reabren.
- El cierre de sesión guarda y pausa primero el tracking. Conserva las colas pendientes en Preferences nativo y en el almacenamiento web, y elimina tokens y datos de perfil. Otra cuenta no envía la cola anterior. Las respuestas tardías de renovación tampoco cambian la cuenta activa.
- Se conservan los pendientes del formato antiguo, pero no se reasignan automáticamente: ese formato no contiene una identidad confiable ni historial de transiciones.
- Edición y borrado usan revisiones actuales y solicitudes persistentes. No se editan ni eliminan recorridos locales pendientes de confirmación.
- Los importes de historial, detalle y dashboard proceden del servidor. No se multiplica el historial por una tarifa fija de $0.70. Sin tarifa o con monedas incompatibles se muestra que no hay estimación. La oficina administra las tarifas; el portal las consulta.
- Se conservaron la URL base de producción y las dependencias existentes.

## Verificación realizada

| Comprobación | Resultado |
| --- | --- |
| `npm run build` | Compilación final correcta; salida en `www`. |
| `npm test -- --watch=false --browsers=ChromeHeadless` | 22 aprobadas, ninguna fallida. |
| ESLint sobre DTOs, journal, adaptador de plataforma, fachada de recorridos, claves de almacenamiento y renovación de sesión | Correcto, código 0. No se declara lint completo del proyecto. |
| Prettier 2.8.8 ya instalado sobre los archivos nuevos y la fachada | Aplicado sin instalar dependencias. |
| `npm start -- --host=localhost --port=8100 --no-open` | Ionic activo; compilación de desarrollo correcta y `/login` responde 200. |
| Preflight CORS desde localhost:8100 a `/mobile/trips` | 204; origen y método POST permitidos. |
| Registros de la sesión ya abierta | GET autenticados de vehículos, recorridos, estadísticas, serie diaria y configuración devuelven 200. El token antiguo recibió 401; la renovación devolvió 200 y las consultas posteriores también 200. |

Las pruebas cubren reintentos exactos, bloques GPS, orden de estados, fallos de persistencia y de confirmación, aislamiento entre cuentas, paginación, cursor, configuración, autorización, renovación y cierre de sesión web.

## Contenedores y bases

Se reconstruyeron y reemplazaron Auth, Mobile y Gateway del proyecto Compose local. Se conservaron puertos, red y volúmenes. El resto de la flota no se recreó. Mobile se incorporó como servicio nuevo detrás del Gateway.

Auth, Mobile y Gateway responden 200 en sus endpoints de salud. Los endpoints protegidos sin sesión responden 401. Mobile está procesando los eventos de permisos publicados por Auth.

DEV001: `TaxVision_Auth` tiene 152 migraciones aplicadas y `TaxVision_Mobile` tiene 2; ambas quedaron con cero pendientes. Esta adaptación cliente no necesita otra migración. No se sembraron tarifas arbitrarias.

## Límites

No se afirma una prueba física de GPS ni ejecución nativa en segundo plano. Para iniciar un recorrido nuevo se necesita cargar el vehículo y la configuración del servidor; un recorrido iniciado conserva sus operaciones durante los cortes de red.

La revisión visual no pudo realizarse porque el host del navegador no estaba disponible. Las pruebas con ChromeHeadless y las comprobaciones HTTP sí se ejecutaron. La prueba opcional de solicitud manual de un token M2M fue rechazada por el control automático con “blocked by policy” y no se ejecutó.

## Archivos principales

- Modelos: `src/app/models/interfaces.ts`, `src/app/models/mobile-api.ts`.
- API y recorridos: `tracking-api.service.ts`, `tracking-api-service.ts`, `trip.service.ts`.
- Persistencia: `mobile-trip-sync.service.ts`, `mobile-tracking-platform.service.ts`, `tracking-storage-keys.ts`.
- GPS y sesión: `gps-tracking.service.ts`, `customer-auth.service.ts`, `customer-session-refresh.service.ts`, `auth.interceptor.ts`.
- Pantallas: dashboard, historial, tracking, detalle, perfil y configuración.
- Entornos: `environment.ts`, `environment.prod.ts`.
- Pruebas: journal, recorridos, renovación, logout y contrato de vehículos.

Los servicios están en `src/app/services/`, el interceptor en `src/app/interceptors/` y las pantallas en `src/app/pages/`.
